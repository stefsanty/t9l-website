import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  __setRedisClientForTesting,
  buildKey,
  getMapping,
  setMapping,
  setMappingOrThrow,
  deleteMapping,
  type RedisLike,
  type PlayerMapping,
} from '@/lib/playerMappingStore'

const KEY_PREFIX = 't9l:auth:map:'
const TTL = 60 * 60 * 24 // 24h sliding window
const NULL_SENTINEL = '__null__'
const LEAGUE = 'l-default'
const LEAGUE_OTHER = 'l-tamachi'

const SAMPLE: PlayerMapping = {
  playerId: 'ian-noseda',
  playerName: 'Ian Noseda',
  teamId: 'mariners-fc',
}

const SAMPLE_OTHER_LEAGUE: PlayerMapping = {
  playerId: 'ian-noseda',
  playerName: 'Ian Noseda',
  teamId: 'fenix-fc',
}

function makeFakeRedis(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial))
  const getMock = vi.fn(async (k: string) => store.get(k) ?? null)
  const setMock = vi.fn(async (k: string, v: string, _opts: { ex: number }) => {
    store.set(k, v)
    return 'OK'
  })
  const delMock = vi.fn(async (k: string) => {
    const had = store.delete(k)
    return had ? 1 : 0
  })
  const expireMock = vi.fn(async (_k: string, _s: number) => 1)
  // SCAN — yields all matching keys in a single batch then cursor=0. Tests
  // can override per-case if they want to exercise the multi-batch loop.
  const scanMock = vi.fn(
    async (_cursor: string | number, opts?: { match?: string; count?: number }) => {
      const pat = opts?.match ?? '*'
      const re = new RegExp('^' + pat.replace(/\*/g, '.*') + '$')
      const keys = [...store.keys()].filter((k) => re.test(k))
      // @upstash/redis returns the tuple shape; either is acceptable.
      return ['0', keys] as [string, string[]]
    },
  )
  const client: RedisLike = {
    get: getMock,
    set: setMock,
    del: delMock,
    expire: expireMock,
    scan: scanMock,
  }
  return { client, store, getMock, setMock, delMock, expireMock, scanMock }
}

beforeEach(() => {
  __setRedisClientForTesting(null)
})

// ─────────────────────────────────────────────────────────────────────────────
// v1.26.0 — per-league key shape
// ─────────────────────────────────────────────────────────────────────────────

describe('playerMappingStore.buildKey — v1.26.0 per-league key shape', () => {
  it('produces "t9l:auth:map:<leagueId>:<lineId>"', () => {
    expect(buildKey('U1', 'l-default')).toBe('t9l:auth:map:l-default:U1')
    expect(buildKey('U2', 'l-tamachi')).toBe('t9l:auth:map:l-tamachi:U2')
  })

  it('keeps the t9l:auth:map: namespace prefix (regression target)', () => {
    expect(buildKey('U1', LEAGUE).startsWith(KEY_PREFIX)).toBe(true)
  })

  it('different leagues for the same lineId produce different keys (so reads / writes are isolated)', () => {
    expect(buildKey('U1', LEAGUE)).not.toBe(buildKey('U1', LEAGUE_OTHER))
  })
})

describe('playerMappingStore.getMapping — tri-state result (v1.26.0)', () => {
  it('returns { status: hit, value } for a real per-league mapping', async () => {
    const { client, getMock } = makeFakeRedis({
      [`${KEY_PREFIX}${LEAGUE}:U1`]: JSON.stringify(SAMPLE),
    })
    __setRedisClientForTesting(client)

    const result = await getMapping('U1', LEAGUE)

    expect(result).toEqual({ status: 'hit', value: SAMPLE })
    expect(getMock).toHaveBeenCalledWith(`${KEY_PREFIX}${LEAGUE}:U1`)
    expect(getMock).toHaveBeenCalledTimes(1)
  })

  it('returns { status: hit, value: null } for the null sentinel (orphan cached for this league)', async () => {
    const { client } = makeFakeRedis({
      [`${KEY_PREFIX}${LEAGUE}:U-orphan`]: NULL_SENTINEL,
    })
    __setRedisClientForTesting(client)

    const result = await getMapping('U-orphan', LEAGUE)
    expect(result).toEqual({ status: 'hit', value: null })
  })

  it('returns { status: miss } when the per-league key is not in Redis', async () => {
    // v1.26.0 — miss now means "cold per-(leagueId, lineId) cache OR genuine
    // orphan in this league". The auth callback's miss policy: fall through
    // to Prisma + write back. Pre-v1.26.0 miss meant "definitely orphan"
    // because the key was league-blind; that semantic is gone.
    const { client } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    const result = await getMapping('U-never-stored', LEAGUE)
    expect(result).toEqual({ status: 'miss' })
  })

  it('isolates reads across leagues — a hit in League X does not surface in League Y', async () => {
    // Regression target for v1.26.0 — pre-v1.26.0 the namespace was
    // league-blind, so this test would have failed with both reads hitting
    // the same key.
    const { client } = makeFakeRedis({
      [`${KEY_PREFIX}${LEAGUE}:U1`]: JSON.stringify(SAMPLE),
    })
    __setRedisClientForTesting(client)

    const inDefault = await getMapping('U1', LEAGUE)
    const inTamachi = await getMapping('U1', LEAGUE_OTHER)

    expect(inDefault).toEqual({ status: 'hit', value: SAMPLE })
    expect(inTamachi).toEqual({ status: 'miss' })
  })

  it('returns { status: error, reason: "redis-error" } when Redis throws (transient outage)', async () => {
    const fakeRedis: RedisLike = {
      get: vi.fn(async () => {
        throw new Error('Upstash unreachable')
      }),
      set: vi.fn(),
      del: vi.fn(),
      expire: vi.fn(async () => 1),
      scan: vi.fn(async () => ['0', []] as [string, string[]]),
    }
    __setRedisClientForTesting(fakeRedis)

    const result = await getMapping('U1', LEAGUE)
    expect(result).toEqual({ status: 'error', reason: 'redis-error' })
  })

  it('returns { status: error, reason: "no-client" } when Redis is not configured', async () => {
    const original = {
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    }
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    __setRedisClientForTesting(null)

    try {
      const result = await getMapping('U1', LEAGUE)
      expect(result).toEqual({ status: 'error', reason: 'no-client' })
    } finally {
      if (original.url) process.env.KV_REST_API_URL = original.url
      if (original.token) process.env.KV_REST_API_TOKEN = original.token
    }
  })

  it('handles Upstash REST returning an already-parsed object (not a string)', async () => {
    const fakeRedis: RedisLike = {
      get: vi.fn(async () => SAMPLE as unknown as string),
      set: vi.fn(),
      del: vi.fn(),
      expire: vi.fn(async () => 1),
      scan: vi.fn(async () => ['0', []] as [string, string[]]),
    }
    __setRedisClientForTesting(fakeRedis)

    const result = await getMapping('U-auto-parsed', LEAGUE)
    expect(result).toEqual({ status: 'hit', value: SAMPLE })
  })

  it('treats a malformed payload as miss (defensive — never crash auth on corrupt entry)', async () => {
    const fakeRedis: RedisLike = {
      get: vi.fn(async () => ({ id: 'p-test', name: 'T', team: 't-x' } as unknown as string)),
      set: vi.fn(),
      del: vi.fn(),
      expire: vi.fn(async () => 1),
      scan: vi.fn(async () => ['0', []] as [string, string[]]),
    }
    __setRedisClientForTesting(fakeRedis)

    const result = await getMapping('U-malformed', LEAGUE)
    expect(result.status).toBe('miss')
  })
})

describe('playerMappingStore.getMapping — sliding TTL (v1.26.0)', () => {
  it('fires expire(per-league key, 24h) on every hit', async () => {
    const { client, expireMock } = makeFakeRedis({
      [`${KEY_PREFIX}${LEAGUE}:U1`]: JSON.stringify(SAMPLE),
    })
    __setRedisClientForTesting(client)

    await getMapping('U1', LEAGUE)
    await new Promise((r) => setImmediate(r))

    expect(expireMock).toHaveBeenCalledWith(`${KEY_PREFIX}${LEAGUE}:U1`, TTL)
    expect(expireMock).toHaveBeenCalledTimes(1)
  })

  it('does not fire expire on miss or error (no key to refresh)', async () => {
    const { client, expireMock } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    await getMapping('U-never-stored', LEAGUE)
    await new Promise((r) => setImmediate(r))

    expect(expireMock).not.toHaveBeenCalled()
  })

  it('does not block the auth path on expire failure (fire-and-forget)', async () => {
    const fakeRedis: RedisLike = {
      get: vi.fn(async () => JSON.stringify(SAMPLE)),
      set: vi.fn(),
      del: vi.fn(),
      expire: vi.fn(async () => {
        throw new Error('expire failed')
      }),
      scan: vi.fn(async () => ['0', []] as [string, string[]]),
    }
    __setRedisClientForTesting(fakeRedis)

    const result = await getMapping('U1', LEAGUE)
    expect(result).toEqual({ status: 'hit', value: SAMPLE })
  })
})

describe('playerMappingStore.setMapping — v1.26.0 per-league write', () => {
  it('writes a JSON-stringified mapping under the per-league key with the 24h TTL', async () => {
    const { client, setMock, store } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    await setMapping('U1', LEAGUE, SAMPLE)

    expect(setMock).toHaveBeenCalledWith(
      `${KEY_PREFIX}${LEAGUE}:U1`,
      JSON.stringify(SAMPLE),
      { ex: TTL },
    )
    expect(store.get(`${KEY_PREFIX}${LEAGUE}:U1`)).toBe(JSON.stringify(SAMPLE))
  })

  it('writes the null sentinel for a null mapping (per-league orphan cache)', async () => {
    const { client, setMock, store } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    await setMapping('U-orphan', LEAGUE, null)

    expect(setMock).toHaveBeenCalledWith(
      `${KEY_PREFIX}${LEAGUE}:U-orphan`,
      NULL_SENTINEL,
      { ex: TTL },
    )
    expect(store.get(`${KEY_PREFIX}${LEAGUE}:U-orphan`)).toBe(NULL_SENTINEL)
  })

  it('different leagues for the same lineId persist independently — writes are isolated', async () => {
    const { client } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    await setMapping('U1', LEAGUE, SAMPLE)
    await setMapping('U1', LEAGUE_OTHER, SAMPLE_OTHER_LEAGUE)

    expect(await getMapping('U1', LEAGUE)).toEqual({ status: 'hit', value: SAMPLE })
    expect(await getMapping('U1', LEAGUE_OTHER)).toEqual({
      status: 'hit',
      value: SAMPLE_OTHER_LEAGUE,
    })
  })

  it('round-trips through getMapping for both real and null values', async () => {
    const { client } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    await setMapping('U-real', LEAGUE, SAMPLE)
    await setMapping('U-null', LEAGUE, null)

    expect(await getMapping('U-real', LEAGUE)).toEqual({ status: 'hit', value: SAMPLE })
    expect(await getMapping('U-null', LEAGUE)).toEqual({ status: 'hit', value: null })
    expect(await getMapping('U-untouched', LEAGUE)).toEqual({ status: 'miss' })
  })

  it('swallows Redis errors (write failures must not break auth or admin actions)', async () => {
    const fakeRedis: RedisLike = {
      get: vi.fn(),
      set: vi.fn(async () => {
        throw new Error('boom')
      }),
      del: vi.fn(),
      expire: vi.fn(async () => 1),
      scan: vi.fn(async () => ['0', []] as [string, string[]]),
    }
    __setRedisClientForTesting(fakeRedis)

    await expect(setMapping('U1', LEAGUE, SAMPLE)).resolves.toBeUndefined()
  })
})

describe('playerMappingStore.deleteMapping — v1.26.0 per-league + SCAN-and-DEL', () => {
  it('with leagueId: deletes the single per-league key', async () => {
    const { client, delMock, store } = makeFakeRedis({
      [`${KEY_PREFIX}${LEAGUE}:U1`]: JSON.stringify(SAMPLE),
      [`${KEY_PREFIX}${LEAGUE_OTHER}:U1`]: JSON.stringify(SAMPLE_OTHER_LEAGUE),
    })
    __setRedisClientForTesting(client)

    await deleteMapping('U1', LEAGUE)

    expect(delMock).toHaveBeenCalledWith(`${KEY_PREFIX}${LEAGUE}:U1`)
    expect(store.has(`${KEY_PREFIX}${LEAGUE}:U1`)).toBe(false)
    // The other league's key MUST NOT be touched.
    expect(store.has(`${KEY_PREFIX}${LEAGUE_OTHER}:U1`)).toBe(true)
  })

  it('without leagueId: SCANs and DELs every league this lineId is cached in', async () => {
    const { client, scanMock, store } = makeFakeRedis({
      [`${KEY_PREFIX}${LEAGUE}:U1`]: JSON.stringify(SAMPLE),
      [`${KEY_PREFIX}${LEAGUE_OTHER}:U1`]: JSON.stringify(SAMPLE_OTHER_LEAGUE),
      // Other LINE users in same leagues — must not be touched.
      [`${KEY_PREFIX}${LEAGUE}:U2`]: JSON.stringify(SAMPLE),
      [`${KEY_PREFIX}${LEAGUE_OTHER}:U-other`]: JSON.stringify(SAMPLE),
    })
    __setRedisClientForTesting(client)

    await deleteMapping('U1')

    expect(scanMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ match: `${KEY_PREFIX}*:U1` }),
    )
    // Both U1 entries gone; the unrelated entries survive.
    expect(store.has(`${KEY_PREFIX}${LEAGUE}:U1`)).toBe(false)
    expect(store.has(`${KEY_PREFIX}${LEAGUE_OTHER}:U1`)).toBe(false)
    expect(store.has(`${KEY_PREFIX}${LEAGUE}:U2`)).toBe(true)
    expect(store.has(`${KEY_PREFIX}${LEAGUE_OTHER}:U-other`)).toBe(true)
  })

  it('after deleteMapping with leagueId, getMapping returns miss for that league only', async () => {
    const { client } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    await setMapping('U1', LEAGUE, SAMPLE)
    await setMapping('U1', LEAGUE_OTHER, SAMPLE_OTHER_LEAGUE)
    await deleteMapping('U1', LEAGUE)

    expect(await getMapping('U1', LEAGUE)).toEqual({ status: 'miss' })
    expect(await getMapping('U1', LEAGUE_OTHER)).toEqual({
      status: 'hit',
      value: SAMPLE_OTHER_LEAGUE,
    })
  })

  it('is a no-op for null/undefined/empty lineId (with or without leagueId)', async () => {
    const { client, delMock, scanMock } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    await deleteMapping(null)
    await deleteMapping(undefined)
    await deleteMapping('')
    await deleteMapping(null, LEAGUE)

    expect(delMock).not.toHaveBeenCalled()
    expect(scanMock).not.toHaveBeenCalled()
  })

  it('SCAN walks multi-batch cursors until cursor=0 (real Upstash protocol)', async () => {
    // Force the SCAN to yield two batches so the cursor loop is exercised.
    let call = 0
    const scanMock = vi.fn(
      async (_cursor: string | number, _opts?: { match?: string; count?: number }) => {
        call++
        if (call === 1) return ['42', [`${KEY_PREFIX}${LEAGUE}:U1`]] as [string, string[]]
        return ['0', [`${KEY_PREFIX}${LEAGUE_OTHER}:U1`]] as [string, string[]]
      },
    )
    const delMock = vi.fn(async () => 1)
    const client: RedisLike = {
      get: vi.fn(),
      set: vi.fn(),
      del: delMock,
      expire: vi.fn(async () => 1),
      scan: scanMock,
    }
    __setRedisClientForTesting(client)

    await deleteMapping('U1')

    expect(scanMock).toHaveBeenCalledTimes(2)
    expect(delMock).toHaveBeenCalledWith(`${KEY_PREFIX}${LEAGUE}:U1`)
    expect(delMock).toHaveBeenCalledWith(`${KEY_PREFIX}${LEAGUE_OTHER}:U1`)
  })

  it('swallows Redis errors during SCAN (delete failures must not break the write site)', async () => {
    const fakeRedis: RedisLike = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      expire: vi.fn(async () => 1),
      scan: vi.fn(async () => {
        throw new Error('scan boom')
      }),
    }
    __setRedisClientForTesting(fakeRedis)

    await expect(deleteMapping('U1')).resolves.toBeUndefined()
  })

  it('swallows Redis errors during single-key DEL', async () => {
    const fakeRedis: RedisLike = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(async () => {
        throw new Error('boom')
      }),
      expire: vi.fn(async () => 1),
      scan: vi.fn(async () => ['0', []] as [string, string[]]),
    }
    __setRedisClientForTesting(fakeRedis)

    await expect(deleteMapping('U1', LEAGUE)).resolves.toBeUndefined()
  })
})

describe('playerMappingStore when Redis is not configured', () => {
  it('getMapping returns error/no-client; setMapping/deleteMapping are no-ops', async () => {
    const original = {
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    }
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    __setRedisClientForTesting(null)

    try {
      expect(await getMapping('U1', LEAGUE)).toEqual({
        status: 'error',
        reason: 'no-client',
      })
      await expect(setMapping('U1', LEAGUE, SAMPLE)).resolves.toBeUndefined()
      await expect(deleteMapping('U1', LEAGUE)).resolves.toBeUndefined()
      await expect(deleteMapping('U1')).resolves.toBeUndefined()
    } finally {
      if (original.url) process.env.KV_REST_API_URL = original.url
      if (original.token) process.env.KV_REST_API_TOKEN = original.token
    }
  })
})

describe('namespace isolation', () => {
  it('uses a t9l:auth:map: prefix that does not collide with other namespaces', async () => {
    const { client, setMock } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    await setMapping('U1', LEAGUE, SAMPLE)

    const writtenKey = setMock.mock.calls[0][0] as string
    expect(writtenKey.startsWith('t9l:auth:map:')).toBe(true)
    expect(writtenKey.startsWith('t9l:i18n:')).toBe(false)
    expect(writtenKey.startsWith('t9l:rsvp:')).toBe(false)
    expect(writtenKey).not.toBe('line-player-map')
  })
})

describe('playerMappingStore.setMappingOrThrow — v1.8.0 throwing variant + v1.26.0 per-league', () => {
  it('writes the per-league mapping with the same shape as setMapping on success', async () => {
    const { client, setMock } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    await setMappingOrThrow('U1', LEAGUE, SAMPLE)

    expect(setMock).toHaveBeenCalledWith(
      `${KEY_PREFIX}${LEAGUE}:U1`,
      JSON.stringify(SAMPLE),
      { ex: TTL },
    )
  })

  it('writes the null sentinel for unlinks at the per-league key', async () => {
    const { client, setMock } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    await setMappingOrThrow('U-orphan', LEAGUE, null)

    expect(setMock).toHaveBeenCalledWith(
      `${KEY_PREFIX}${LEAGUE}:U-orphan`,
      NULL_SENTINEL,
      { ex: TTL },
    )
  })

  it('THROWS when Redis errors (vs setMapping which swallows)', async () => {
    const { client, setMock } = makeFakeRedis({})
    setMock.mockRejectedValueOnce(new Error('Upstash unreachable'))
    __setRedisClientForTesting(client)

    await expect(setMappingOrThrow('U1', LEAGUE, SAMPLE)).rejects.toThrow(
      'Upstash unreachable',
    )
  })

  it('does NOT throw when KV env is unset (no-client = silent no-op for dev/test)', async () => {
    const original = {
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    }
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    __setRedisClientForTesting(null)

    try {
      await expect(
        setMappingOrThrow('U1', LEAGUE, SAMPLE),
      ).resolves.toBeUndefined()
    } finally {
      if (original.url) process.env.KV_REST_API_URL = original.url
      if (original.token) process.env.KV_REST_API_TOKEN = original.token
    }
  })
})
