import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  __setRedisClientForTesting,
  getCached,
  setCached,
  invalidate,
  type RedisLike,
  type PlayerMapping,
} from '@/lib/playerMappingCache'

const KEY_PREFIX = 't9l:auth:map:'
const TTL = 60
const NULL_SENTINEL = '__null__'

const SAMPLE: PlayerMapping = {
  playerId: 'ian-noseda',
  playerName: 'Ian Noseda',
  teamId: 'mariners-fc',
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
  const client: RedisLike = { get: getMock, set: setMock, del: delMock }
  return { client, store, getMock, setMock, delMock }
}

beforeEach(() => {
  __setRedisClientForTesting(null)
})

describe('playerMappingCache.getCached', () => {
  it('returns the parsed mapping on cache hit (string-encoded JSON)', async () => {
    const { client, getMock } = makeFakeRedis({
      [`${KEY_PREFIX}U1`]: JSON.stringify(SAMPLE),
    })
    __setRedisClientForTesting(client)

    const result = await getCached('U1')

    expect(result).toEqual({ value: SAMPLE })
    expect(getMock).toHaveBeenCalledWith(`${KEY_PREFIX}U1`)
    expect(getMock).toHaveBeenCalledTimes(1)
  })

  it('distinguishes a cached null mapping (sentinel) from a cache miss', async () => {
    const { client } = makeFakeRedis({
      [`${KEY_PREFIX}U-orphan`]: NULL_SENTINEL,
    })
    __setRedisClientForTesting(client)

    const hit = await getCached('U-orphan')
    expect(hit).toEqual({ value: null })

    const miss = await getCached('U-never-cached')
    expect(miss).toBeUndefined()
  })

  it('returns undefined (not a hit) when Redis returns null', async () => {
    const { client } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    const result = await getCached('U-missing')

    expect(result).toBeUndefined()
  })

  it('handles Upstash REST returning an already-parsed object (not a string)', async () => {
    // Upstash's REST client sometimes auto-parses JSON values. We must accept
    // both `string` and `object` from .get() to avoid spurious cache misses
    // that would re-hit Prisma every request.
    const fakeRedis: RedisLike = {
      get: vi.fn(async () => SAMPLE as unknown as string),
      set: vi.fn(),
      del: vi.fn(),
    }
    __setRedisClientForTesting(fakeRedis)

    const result = await getCached('U-auto-parsed')
    expect(result).toEqual({ value: SAMPLE })
  })

  it('falls through (returns undefined) when Redis throws', async () => {
    const fakeRedis: RedisLike = {
      get: vi.fn(async () => {
        throw new Error('Upstash unreachable')
      }),
      set: vi.fn(),
      del: vi.fn(),
    }
    __setRedisClientForTesting(fakeRedis)

    const result = await getCached('U1')

    expect(result).toBeUndefined()
  })
})

describe('playerMappingCache.setCached', () => {
  it('writes a JSON-stringified mapping with the configured TTL', async () => {
    const { client, setMock, store } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    await setCached('U1', SAMPLE)

    expect(setMock).toHaveBeenCalledWith(
      `${KEY_PREFIX}U1`,
      JSON.stringify(SAMPLE),
      { ex: TTL },
    )
    expect(store.get(`${KEY_PREFIX}U1`)).toBe(JSON.stringify(SAMPLE))
  })

  it('writes the null sentinel for a null mapping (so unmapped IDs cache too)', async () => {
    const { client, setMock, store } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    await setCached('U-orphan', null)

    expect(setMock).toHaveBeenCalledWith(
      `${KEY_PREFIX}U-orphan`,
      NULL_SENTINEL,
      { ex: TTL },
    )
    expect(store.get(`${KEY_PREFIX}U-orphan`)).toBe(NULL_SENTINEL)
  })

  it('round-trips through getCached for both real and null values', async () => {
    const { client } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    await setCached('U-real', SAMPLE)
    await setCached('U-null', null)

    expect(await getCached('U-real')).toEqual({ value: SAMPLE })
    expect(await getCached('U-null')).toEqual({ value: null })
    expect(await getCached('U-untouched')).toBeUndefined()
  })

  it('swallows Redis errors (write failures must not break auth)', async () => {
    const fakeRedis: RedisLike = {
      get: vi.fn(),
      set: vi.fn(async () => {
        throw new Error('boom')
      }),
      del: vi.fn(),
    }
    __setRedisClientForTesting(fakeRedis)

    await expect(setCached('U1', SAMPLE)).resolves.toBeUndefined()
  })
})

describe('playerMappingCache.invalidate', () => {
  it('deletes the cache key for the given lineId', async () => {
    const { client, delMock, store } = makeFakeRedis({
      [`${KEY_PREFIX}U1`]: JSON.stringify(SAMPLE),
    })
    __setRedisClientForTesting(client)

    await invalidate('U1')

    expect(delMock).toHaveBeenCalledWith(`${KEY_PREFIX}U1`)
    expect(store.has(`${KEY_PREFIX}U1`)).toBe(false)
  })

  it('after invalidate, getCached returns undefined (not the sentinel)', async () => {
    const { client } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    await setCached('U1', SAMPLE)
    expect(await getCached('U1')).toEqual({ value: SAMPLE })

    await invalidate('U1')
    expect(await getCached('U1')).toBeUndefined()
  })

  it('is a no-op for null/undefined/empty lineId', async () => {
    const { client, delMock } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    await invalidate(null)
    await invalidate(undefined)
    await invalidate('')

    expect(delMock).not.toHaveBeenCalled()
  })

  it('swallows Redis errors (delete failures must not break the write site)', async () => {
    const fakeRedis: RedisLike = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(async () => {
        throw new Error('boom')
      }),
    }
    __setRedisClientForTesting(fakeRedis)

    await expect(invalidate('U1')).resolves.toBeUndefined()
  })
})

describe('playerMappingCache when Redis is not configured', () => {
  it('getCached returns undefined and setCached/invalidate are no-ops', async () => {
    // No KV env vars + no test override → getClient() returns null, all calls
    // are silent no-ops. This is the dev-without-Upstash path; auth must still
    // work (just falls back to direct Prisma every request).
    const original = {
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    }
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    __setRedisClientForTesting(null)

    try {
      expect(await getCached('U1')).toBeUndefined()
      await expect(setCached('U1', SAMPLE)).resolves.toBeUndefined()
      await expect(invalidate('U1')).resolves.toBeUndefined()
    } finally {
      if (original.url) process.env.KV_REST_API_URL = original.url
      if (original.token) process.env.KV_REST_API_TOKEN = original.token
    }
  })
})

describe('namespace isolation', () => {
  it('uses a t9l:auth:map: prefix that does not collide with i18n or legacy keys', async () => {
    const { client, setMock } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    await setCached('U1', SAMPLE)

    const writtenKey = setMock.mock.calls[0][0] as string
    expect(writtenKey.startsWith('t9l:auth:map:')).toBe(true)
    expect(writtenKey.startsWith('t9l:i18n:')).toBe(false)
    expect(writtenKey).not.toBe('line-player-map')
  })
})

/**
 * PR 9 — post-write pre-warm contract.
 *
 * v1.2.3 (PR 8) introduced the cache and busted it on every write. That kept
 * steady-state reads warm (~108ms median) but unconditionally cooled the read
 * that ran *immediately* after a write — i.e. the `await update()` inside the
 * assign-player flow. v1.2.5 (PR 9) flips writes from invalidate-then-cold to
 * `setCached(lineId, freshMapping)` so the very next /api/auth/session served
 * by `await update()` is a cache hit.
 *
 * These tests pin the contract that write sites depend on: a value pre-warmed
 * via setCached is served from cache on the next read. If a future change
 * silently reverts a write site to `invalidate`, the round-trip below still
 * passes — but the assertions on read-shape (mapping vs. null sentinel) catch
 * the most likely shape regression (e.g. forgetting to strip the `p-` prefix
 * before pre-warming).
 */
describe('post-write pre-warm contract (PR 9)', () => {
  it('pre-warmed mapping is served from cache without a Prisma read', async () => {
    const { client, getMock } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    // Write site (api/assign-player POST, admin link, etc.) calls this with
    // the post-write relation-include shape. SAMPLE is `{ playerId, playerName,
    // teamId }` — slug-only, no `p-`/`t-` prefix — matching what
    // `getPlayerMappingFromDb` returns.
    await setCached('U-just-assigned', SAMPLE)

    // Auth path's short-circuit:
    //   const cached = await getCachedMapping(lineId)
    //   if (cached !== undefined) return cached.value   // ← skips Prisma
    const cached = await getCached('U-just-assigned')
    expect(cached).toEqual({ value: SAMPLE })
    expect(cached).not.toBeUndefined() // undefined would force the cold read

    // One Redis GET, no second call needed.
    expect(getMock).toHaveBeenCalledTimes(1)
  })

  it('DELETE-style writes pre-warm the null sentinel (no cold confirm of "no mapping")', async () => {
    const { client } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    // assign-player DELETE pre-warms with null — same effect as a Prisma
    // `findUnique({ where: { lineId } })` returning null, but resolved from
    // cache. Without the sentinel, the auth path can't tell "unmapped" from
    // "cache miss" and would re-hit Prisma every request.
    await setCached('U-just-unlinked', null)

    const cached = await getCached('U-just-unlinked')
    expect(cached).toEqual({ value: null })
    expect(cached).not.toBeUndefined()
  })

  it('rejects a malformed pre-warm shape on read (defensive — wrong shape becomes a cache miss)', async () => {
    // If a future write site accidentally pre-warms with `{ id, name, team }`
    // (raw Prisma fields) instead of the slug-stripped `{ playerId, playerName,
    // teamId }`, getCached's object-shape check returns undefined — falling
    // through to Prisma rather than serving a broken session. This is the
    // backstop that makes setCached the safer write op.
    const fakeRedis: RedisLike = {
      get: vi.fn(async () => ({ id: 'p-test', name: 'T', team: 't-x' } as unknown as string)),
      set: vi.fn(),
      del: vi.fn(),
    }
    __setRedisClientForTesting(fakeRedis)

    const result = await getCached('U-malformed')
    expect(result).toBeUndefined()
  })
})
