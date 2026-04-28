import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  __setRedisClientForTesting,
  computeRsvpExpireAt,
  parseHashFields,
  getRsvpForGameWeek,
  getRsvpForGameWeeks,
  setRsvp,
  setParticipated,
  seedGameWeek,
  deleteGameWeek,
  type RedisLike,
} from '@/lib/rsvpStore'

const KEY_PREFIX = 't9l:rsvp:gw:'
const SEEDED_FIELD = '__seeded'
const SEEDED_VALUE = '1'
const TTL_DAYS = 90
const TTL_SECS = TTL_DAYS * 24 * 60 * 60

function makeFakeRedis(initial: Record<string, Record<string, string>> = {}) {
  const store = new Map<string, Record<string, string>>()
  for (const [k, v] of Object.entries(initial)) store.set(k, { ...v })

  const hgetallMock = vi.fn(async (k: string) => {
    const h = store.get(k)
    return h && Object.keys(h).length > 0 ? { ...h } : null
  })
  const hsetMock = vi.fn(async (k: string, fields: Record<string, string>) => {
    const cur = store.get(k) ?? {}
    Object.assign(cur, fields)
    store.set(k, cur)
    return Object.keys(fields).length
  })
  const hdelMock = vi.fn(async (k: string, ...fields: string[]) => {
    const cur = store.get(k)
    if (!cur) return 0
    let removed = 0
    for (const f of fields) {
      if (f in cur) {
        delete cur[f]
        removed++
      }
    }
    if (Object.keys(cur).length === 0) store.delete(k)
    return removed
  })
  const expireatMock = vi.fn(async (_k: string, _ts: number) => 1)
  const delMock = vi.fn(async (k: string) => {
    return store.delete(k) ? 1 : 0
  })

  const client: RedisLike = {
    hgetall: hgetallMock,
    hset: hsetMock,
    hdel: hdelMock,
    expireat: expireatMock,
    del: delMock,
  }
  return { client, store, hgetallMock, hsetMock, hdelMock, expireatMock, delMock }
}

beforeEach(() => {
  __setRedisClientForTesting(null)
})

describe('computeRsvpExpireAt — absolute TTL math', () => {
  it('anchors on now() when the matchday is in the past', () => {
    const past = new Date('2025-01-01T00:00:00Z')
    const now = new Date('2026-04-28T00:00:00Z')
    const expireAt = computeRsvpExpireAt(past, now)
    const expected = Math.floor(now.getTime() / 1000) + TTL_SECS
    expect(expireAt).toBe(expected)
  })

  it('anchors on the matchday when the matchday is in the future', () => {
    const future = new Date('2026-08-01T00:00:00Z')
    const now = new Date('2026-04-28T00:00:00Z')
    const expireAt = computeRsvpExpireAt(future, now)
    const expected = Math.floor(future.getTime() / 1000) + TTL_SECS
    expect(expireAt).toBe(expected)
  })

  it('returns Unix seconds (not milliseconds) — defends against EXPIREAT-Off-by-1000', () => {
    const start = new Date('2030-01-01T00:00:00Z')
    const now = new Date('2030-01-01T00:00:00Z')
    const result = computeRsvpExpireAt(start, now)
    // Sanity: 2030 + 90d in seconds is ~1.9 billion, well below
    // milliseconds (which would be 60 trillion). If someone returns ms by
    // accident, this assertion fails by orders of magnitude.
    expect(result).toBeLessThan(10_000_000_000) // < year 2286 in seconds
    expect(result).toBeGreaterThan(1_000_000_000) // > 2001 in seconds
  })
})

describe('parseHashFields — hash → GwRsvpMap', () => {
  it('parses :rsvp and :p suffixes into the same player entry', () => {
    const map = parseHashFields({
      __seeded: '1',
      'ian-noseda:rsvp': 'GOING',
      'ian-noseda:p': 'JOINED',
    })
    expect(map.get('ian-noseda')).toEqual({ rsvp: 'GOING', participated: 'JOINED' })
  })

  it('skips the __seeded sentinel field', () => {
    const map = parseHashFields({ __seeded: '1' })
    expect(map.size).toBe(0)
  })

  it('defensively ignores unknown suffixes', () => {
    const map = parseHashFields({
      __seeded: '1',
      'ian-noseda:rsvp': 'GOING',
      'ian-noseda:reason': 'work',
    })
    expect(map.get('ian-noseda')).toEqual({ rsvp: 'GOING' })
  })

  it('handles a player with only :p (admin-recorded participation, no RSVP)', () => {
    const map = parseHashFields({
      __seeded: '1',
      'guest-player:p': 'JOINED',
    })
    expect(map.get('guest-player')).toEqual({ participated: 'JOINED' })
  })

  it('returns empty map for a hash with only the sentinel (legitimate empty state)', () => {
    const map = parseHashFields({ __seeded: '1' })
    expect(map.size).toBe(0)
  })
})

describe('rsvpStore.getRsvpForGameWeek — tri-state result', () => {
  const GW_ID = 'gw-test-1'
  const START = new Date('2026-08-01T00:00:00Z')

  it('returns hit + parsed map when the hash has __seeded and RSVPs', async () => {
    const { client } = makeFakeRedis({
      [`${KEY_PREFIX}${GW_ID}`]: {
        __seeded: '1',
        'ian-noseda:rsvp': 'GOING',
      },
    })
    __setRedisClientForTesting(client)

    const r = await getRsvpForGameWeek(GW_ID, START)
    expect(r.status).toBe('hit')
    if (r.status !== 'hit') return
    expect(r.data.get('ian-noseda')).toEqual({ rsvp: 'GOING' })
  })

  it('returns hit with empty map when only __seeded is present (initialized, no signals)', async () => {
    const { client } = makeFakeRedis({
      [`${KEY_PREFIX}${GW_ID}`]: { __seeded: '1' },
    })
    __setRedisClientForTesting(client)

    const r = await getRsvpForGameWeek(GW_ID, START)
    expect(r.status).toBe('hit')
    if (r.status !== 'hit') return
    expect(r.data.size).toBe(0)
  })

  it('returns hit when Upstash auto-parses __seeded string "1" into the number 1 (regression: prod drift)', async () => {
    // Real Upstash REST client behavior: HGETALL coerces field values that
    // parse as JSON. `'1'` round-trips as the number `1`. The sentinel
    // check must coerce both sides for comparison, otherwise every GW
    // post-apply reads as miss-not-hit and the dashboard falls through to
    // Prisma on every render.
    const fake: RedisLike = {
      hgetall: vi.fn(async () => ({
        __seeded: 1, // <-- number, not string
        'ian-noseda:rsvp': 'GOING',
      })),
      hset: vi.fn(),
      hdel: vi.fn(),
      expireat: vi.fn(async () => 1),
      del: vi.fn(),
    }
    __setRedisClientForTesting(fake)

    const r = await getRsvpForGameWeek(GW_ID, START)
    expect(r.status).toBe('hit')
    if (r.status !== 'hit') return
    expect(r.data.get('ian-noseda')).toEqual({ rsvp: 'GOING' })
  })

  it('returns miss when the key is absent (publicData should fall through to Prisma)', async () => {
    const { client } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    const r = await getRsvpForGameWeek(GW_ID, START)
    expect(r.status).toBe('miss')
  })

  it('returns miss when the hash exists but lacks __seeded (defensive)', async () => {
    const { client } = makeFakeRedis({
      [`${KEY_PREFIX}${GW_ID}`]: { 'ian-noseda:rsvp': 'GOING' },
    })
    __setRedisClientForTesting(client)

    const r = await getRsvpForGameWeek(GW_ID, START)
    expect(r.status).toBe('miss')
  })

  it('returns error: redis-error on Upstash throw', async () => {
    const fake: RedisLike = {
      hgetall: vi.fn(async () => {
        throw new Error('Upstash unreachable')
      }),
      hset: vi.fn(),
      hdel: vi.fn(),
      expireat: vi.fn(async () => 1),
      del: vi.fn(),
    }
    __setRedisClientForTesting(fake)

    const r = await getRsvpForGameWeek(GW_ID, START)
    expect(r).toEqual({ status: 'error', reason: 'redis-error' })
  })

  it('returns error: no-client when Redis env vars are missing', async () => {
    const original = {
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    }
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    __setRedisClientForTesting(null)

    try {
      const r = await getRsvpForGameWeek(GW_ID, START)
      expect(r).toEqual({ status: 'error', reason: 'no-client' })
    } finally {
      if (original.url) process.env.KV_REST_API_URL = original.url
      if (original.token) process.env.KV_REST_API_TOKEN = original.token
    }
  })
})

describe('rsvpStore.getRsvpForGameWeeks — batched read', () => {
  it('runs N HGETALLs in parallel and returns one entry per GW', async () => {
    const { client, hgetallMock } = makeFakeRedis({
      [`${KEY_PREFIX}gw-1`]: { __seeded: '1', 'a:rsvp': 'GOING' },
      [`${KEY_PREFIX}gw-2`]: { __seeded: '1' },
    })
    __setRedisClientForTesting(client)

    const result = await getRsvpForGameWeeks([
      { id: 'gw-1', startDate: new Date('2026-08-01') },
      { id: 'gw-2', startDate: new Date('2026-08-08') },
      { id: 'gw-3', startDate: new Date('2026-08-15') },
    ])

    expect(result.size).toBe(3)
    expect(result.get('gw-1')?.status).toBe('hit')
    expect(result.get('gw-2')?.status).toBe('hit')
    expect(result.get('gw-3')?.status).toBe('miss')
    expect(hgetallMock).toHaveBeenCalledTimes(3)
  })
})

describe('rsvpStore.setRsvp', () => {
  const GW_ID = 'gw-w'
  const START = new Date('2026-08-01T00:00:00Z')

  it('writes <slug>:rsvp + __seeded sentinel + EXPIREAT', async () => {
    const { client, hsetMock, expireatMock, store } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    await setRsvp(GW_ID, START, 'ian-noseda', 'GOING')

    expect(hsetMock).toHaveBeenCalledWith(`${KEY_PREFIX}${GW_ID}`, {
      __seeded: '1',
      'ian-noseda:rsvp': 'GOING',
    })
    expect(expireatMock).toHaveBeenCalledWith(
      `${KEY_PREFIX}${GW_ID}`,
      computeRsvpExpireAt(START),
    )
    expect(store.get(`${KEY_PREFIX}${GW_ID}`)).toEqual({
      __seeded: '1',
      'ian-noseda:rsvp': 'GOING',
    })
  })

  it('passing null HDELs the field but reasserts __seeded (legitimate empty state)', async () => {
    const { client, hdelMock, hsetMock, store } = makeFakeRedis({
      [`${KEY_PREFIX}${GW_ID}`]: { __seeded: '1', 'ian-noseda:rsvp': 'GOING' },
    })
    __setRedisClientForTesting(client)

    await setRsvp(GW_ID, START, 'ian-noseda', null)

    expect(hdelMock).toHaveBeenCalledWith(`${KEY_PREFIX}${GW_ID}`, 'ian-noseda:rsvp')
    expect(hsetMock).toHaveBeenCalledWith(`${KEY_PREFIX}${GW_ID}`, { __seeded: '1' })
    expect(store.get(`${KEY_PREFIX}${GW_ID}`)).toEqual({ __seeded: '1' })
  })

  it('round-trips through getRsvpForGameWeek for both real and cleared values', async () => {
    const { client } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    await setRsvp(GW_ID, START, 'ian-noseda', 'GOING')
    let r = await getRsvpForGameWeek(GW_ID, START)
    expect(r.status).toBe('hit')
    if (r.status === 'hit') {
      expect(r.data.get('ian-noseda')).toEqual({ rsvp: 'GOING' })
    }

    await setRsvp(GW_ID, START, 'ian-noseda', null)
    r = await getRsvpForGameWeek(GW_ID, START)
    expect(r.status).toBe('hit')
    if (r.status === 'hit') {
      expect(r.data.size).toBe(0)
    }
  })

  it('swallows Redis errors (write failures must not break the API route)', async () => {
    const fake: RedisLike = {
      hgetall: vi.fn(),
      hset: vi.fn(async () => {
        throw new Error('boom')
      }),
      hdel: vi.fn(),
      expireat: vi.fn(),
      del: vi.fn(),
    }
    __setRedisClientForTesting(fake)

    await expect(setRsvp(GW_ID, START, 'ian-noseda', 'GOING')).resolves.toBeUndefined()
  })
})

describe('rsvpStore.setParticipated', () => {
  const GW_ID = 'gw-p'
  const START = new Date('2026-08-01T00:00:00Z')

  it('writes <slug>:p when value is non-null', async () => {
    const { client, hsetMock } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    await setParticipated(GW_ID, START, 'ian-noseda', 'JOINED')

    expect(hsetMock).toHaveBeenCalledWith(`${KEY_PREFIX}${GW_ID}`, {
      __seeded: '1',
      'ian-noseda:p': 'JOINED',
    })
  })

  it('HDELs <slug>:p when value is null', async () => {
    const { client, hdelMock } = makeFakeRedis({
      [`${KEY_PREFIX}${GW_ID}`]: { __seeded: '1', 'ian-noseda:p': 'JOINED' },
    })
    __setRedisClientForTesting(client)

    await setParticipated(GW_ID, START, 'ian-noseda', null)

    expect(hdelMock).toHaveBeenCalledWith(`${KEY_PREFIX}${GW_ID}`, 'ian-noseda:p')
  })
})

describe('rsvpStore.seedGameWeek', () => {
  it('writes only the __seeded sentinel + sets TTL — used at admin createGameWeek', async () => {
    const { client, hsetMock, expireatMock, store } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    const start = new Date('2026-08-01T00:00:00Z')
    await seedGameWeek('gw-fresh', start)

    expect(hsetMock).toHaveBeenCalledWith(`${KEY_PREFIX}gw-fresh`, { __seeded: '1' })
    expect(expireatMock).toHaveBeenCalledWith(
      `${KEY_PREFIX}gw-fresh`,
      computeRsvpExpireAt(start),
    )
    expect(store.get(`${KEY_PREFIX}gw-fresh`)).toEqual({ __seeded: '1' })
  })

  it('after seedGameWeek, getRsvpForGameWeek returns hit-with-empty (NOT miss)', async () => {
    const { client } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    await seedGameWeek('gw-fresh', new Date('2026-08-01T00:00:00Z'))
    const r = await getRsvpForGameWeek('gw-fresh', new Date('2026-08-01T00:00:00Z'))
    expect(r.status).toBe('hit')
    if (r.status === 'hit') expect(r.data.size).toBe(0)
  })
})

describe('rsvpStore.deleteGameWeek', () => {
  it('DELs the hash key entirely', async () => {
    const { client, delMock, store } = makeFakeRedis({
      [`${KEY_PREFIX}gw-old`]: { __seeded: '1', 'a:rsvp': 'GOING' },
    })
    __setRedisClientForTesting(client)

    await deleteGameWeek('gw-old')

    expect(delMock).toHaveBeenCalledWith(`${KEY_PREFIX}gw-old`)
    expect(store.has(`${KEY_PREFIX}gw-old`)).toBe(false)
  })
})

describe('rsvpStore — namespace isolation', () => {
  it('uses t9l:rsvp:gw: prefix that does not collide with auth or i18n keys', async () => {
    const { client, hsetMock } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    await setRsvp('gw-1', new Date('2026-08-01'), 'ian-noseda', 'GOING')

    const writtenKey = hsetMock.mock.calls[0][0] as string
    expect(writtenKey.startsWith(KEY_PREFIX)).toBe(true)
    expect(writtenKey.startsWith('t9l:auth:map:')).toBe(false)
    expect(writtenKey.startsWith('t9l:i18n:')).toBe(false)
  })
})

describe('rsvpStore when Redis is not configured', () => {
  it('reads return error/no-client; writes/seeds/deletes are silent no-ops', async () => {
    const original = {
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    }
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    __setRedisClientForTesting(null)

    try {
      const start = new Date('2026-08-01')
      expect(await getRsvpForGameWeek('gw-x', start)).toEqual({
        status: 'error',
        reason: 'no-client',
      })
      await expect(
        setRsvp('gw-x', start, 'ian-noseda', 'GOING'),
      ).resolves.toBeUndefined()
      await expect(
        setParticipated('gw-x', start, 'ian-noseda', 'JOINED'),
      ).resolves.toBeUndefined()
      await expect(seedGameWeek('gw-x', start)).resolves.toBeUndefined()
      await expect(deleteGameWeek('gw-x')).resolves.toBeUndefined()
    } finally {
      if (original.url) process.env.KV_REST_API_URL = original.url
      if (original.token) process.env.KV_REST_API_TOKEN = original.token
    }
  })
})
