import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  __setRedisClientForTesting,
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
  const expireMock = vi.fn(async (_k: string, _s: number) => 1)
  const client: RedisLike = {
    get: getMock,
    set: setMock,
    del: delMock,
    expire: expireMock,
  }
  return { client, store, getMock, setMock, delMock, expireMock }
}

beforeEach(() => {
  __setRedisClientForTesting(null)
})

describe('playerMappingStore.getMapping — tri-state result (PR 16 / v1.5.0)', () => {
  it('returns { status: hit, value } for a real mapping (string-encoded JSON)', async () => {
    const { client, getMock } = makeFakeRedis({
      [`${KEY_PREFIX}U1`]: JSON.stringify(SAMPLE),
    })
    __setRedisClientForTesting(client)

    const result = await getMapping('U1')

    expect(result).toEqual({ status: 'hit', value: SAMPLE })
    expect(getMock).toHaveBeenCalledWith(`${KEY_PREFIX}U1`)
    expect(getMock).toHaveBeenCalledTimes(1)
  })

  it('returns { status: hit, value: null } for the null sentinel (orphan cached)', async () => {
    const { client } = makeFakeRedis({
      [`${KEY_PREFIX}U-orphan`]: NULL_SENTINEL,
    })
    __setRedisClientForTesting(client)

    const result = await getMapping('U-orphan')
    expect(result).toEqual({ status: 'hit', value: null })
  })

  it('returns { status: miss } when the key is not in Redis (key not present)', async () => {
    // The CRITICAL behavioral change for v1.5.0: miss is now distinct from
    // error. The auth callback uses miss → null (no Prisma fallback) and
    // error → Prisma fallback. Pre-v1.5.0 they were both `undefined`.
    const { client } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    const result = await getMapping('U-never-stored')
    expect(result).toEqual({ status: 'miss' })
  })

  it('returns { status: error, reason: "redis-error" } when Redis throws (transient outage)', async () => {
    const fakeRedis: RedisLike = {
      get: vi.fn(async () => {
        throw new Error('Upstash unreachable')
      }),
      set: vi.fn(),
      del: vi.fn(),
      expire: vi.fn(async () => 1),
    }
    __setRedisClientForTesting(fakeRedis)

    const result = await getMapping('U1')

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
      const result = await getMapping('U1')
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
    }
    __setRedisClientForTesting(fakeRedis)

    const result = await getMapping('U-auto-parsed')
    expect(result).toEqual({ status: 'hit', value: SAMPLE })
  })

  it('treats a malformed payload as miss (defensive — never crash auth on corrupt entry)', async () => {
    const fakeRedis: RedisLike = {
      get: vi.fn(async () => ({ id: 'p-test', name: 'T', team: 't-x' } as unknown as string)),
      set: vi.fn(),
      del: vi.fn(),
      expire: vi.fn(async () => 1),
    }
    __setRedisClientForTesting(fakeRedis)

    const result = await getMapping('U-malformed')
    expect(result.status).toBe('miss')
  })
})

describe('playerMappingStore.getMapping — sliding TTL (PR 16 / v1.5.0)', () => {
  it('fires expire(key, 24h) on every hit (sliding window — active users never expire)', async () => {
    const { client, expireMock } = makeFakeRedis({
      [`${KEY_PREFIX}U1`]: JSON.stringify(SAMPLE),
    })
    __setRedisClientForTesting(client)

    await getMapping('U1')

    // The expire is fire-and-forget; allow the microtask queue to drain.
    await new Promise((r) => setImmediate(r))

    expect(expireMock).toHaveBeenCalledWith(`${KEY_PREFIX}U1`, TTL)
    expect(expireMock).toHaveBeenCalledTimes(1)
  })

  it('does not fire expire on miss or error (no key to refresh)', async () => {
    const { client, expireMock } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    await getMapping('U-never-stored')
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
    }
    __setRedisClientForTesting(fakeRedis)

    // The .catch is on the fire-and-forget Promise. The hit must still
    // return successfully; the rejection is swallowed.
    const result = await getMapping('U1')
    expect(result).toEqual({ status: 'hit', value: SAMPLE })
  })
})

describe('playerMappingStore.setMapping', () => {
  it('writes a JSON-stringified mapping with the 24h TTL', async () => {
    const { client, setMock, store } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    await setMapping('U1', SAMPLE)

    expect(setMock).toHaveBeenCalledWith(
      `${KEY_PREFIX}U1`,
      JSON.stringify(SAMPLE),
      { ex: TTL },
    )
    expect(store.get(`${KEY_PREFIX}U1`)).toBe(JSON.stringify(SAMPLE))
  })

  it('writes the null sentinel for a null mapping (so unmapped lineIds resolve fast)', async () => {
    const { client, setMock, store } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    await setMapping('U-orphan', null)

    expect(setMock).toHaveBeenCalledWith(
      `${KEY_PREFIX}U-orphan`,
      NULL_SENTINEL,
      { ex: TTL },
    )
    expect(store.get(`${KEY_PREFIX}U-orphan`)).toBe(NULL_SENTINEL)
  })

  it('round-trips through getMapping for both real and null values', async () => {
    const { client } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    await setMapping('U-real', SAMPLE)
    await setMapping('U-null', null)

    expect(await getMapping('U-real')).toEqual({ status: 'hit', value: SAMPLE })
    expect(await getMapping('U-null')).toEqual({ status: 'hit', value: null })
    expect(await getMapping('U-untouched')).toEqual({ status: 'miss' })
  })

  it('swallows Redis errors (write failures must not break auth or admin actions)', async () => {
    const fakeRedis: RedisLike = {
      get: vi.fn(),
      set: vi.fn(async () => {
        throw new Error('boom')
      }),
      del: vi.fn(),
      expire: vi.fn(async () => 1),
    }
    __setRedisClientForTesting(fakeRedis)

    await expect(setMapping('U1', SAMPLE)).resolves.toBeUndefined()
  })
})

describe('playerMappingStore.deleteMapping', () => {
  it('deletes the key for the given lineId', async () => {
    const { client, delMock, store } = makeFakeRedis({
      [`${KEY_PREFIX}U1`]: JSON.stringify(SAMPLE),
    })
    __setRedisClientForTesting(client)

    await deleteMapping('U1')

    expect(delMock).toHaveBeenCalledWith(`${KEY_PREFIX}U1`)
    expect(store.has(`${KEY_PREFIX}U1`)).toBe(false)
  })

  it('after deleteMapping, getMapping returns miss (not the sentinel)', async () => {
    const { client } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    await setMapping('U1', SAMPLE)
    expect(await getMapping('U1')).toEqual({ status: 'hit', value: SAMPLE })

    await deleteMapping('U1')
    expect(await getMapping('U1')).toEqual({ status: 'miss' })
  })

  it('is a no-op for null/undefined/empty lineId', async () => {
    const { client, delMock } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    await deleteMapping(null)
    await deleteMapping(undefined)
    await deleteMapping('')

    expect(delMock).not.toHaveBeenCalled()
  })

  it('swallows Redis errors (delete failures must not break the write site)', async () => {
    const fakeRedis: RedisLike = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(async () => {
        throw new Error('boom')
      }),
      expire: vi.fn(async () => 1),
    }
    __setRedisClientForTesting(fakeRedis)

    await expect(deleteMapping('U1')).resolves.toBeUndefined()
  })
})

describe('playerMappingStore when Redis is not configured', () => {
  it('getMapping returns error/no-client; setMapping/deleteMapping are no-ops', async () => {
    // No KV env vars + no test override → getClient() returns null. Under
    // v1.5.0 this is treated as `error: no-client` so the auth callback
    // falls through to the defensive Prisma path. Writes are silent no-ops
    // (typical local-dev-without-Upstash story).
    const original = {
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    }
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    __setRedisClientForTesting(null)

    try {
      expect(await getMapping('U1')).toEqual({
        status: 'error',
        reason: 'no-client',
      })
      await expect(setMapping('U1', SAMPLE)).resolves.toBeUndefined()
      await expect(deleteMapping('U1')).resolves.toBeUndefined()
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

    await setMapping('U1', SAMPLE)

    const writtenKey = setMock.mock.calls[0][0] as string
    expect(writtenKey.startsWith('t9l:auth:map:')).toBe(true)
    expect(writtenKey.startsWith('t9l:i18n:')).toBe(false)
    expect(writtenKey).not.toBe('line-player-map')
  })
})

describe('playerMappingStore.setMappingOrThrow — v1.8.0 throwing variant', () => {
  it('writes the mapping with the same shape as setMapping on success', async () => {
    const { client, setMock } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    await setMappingOrThrow('U1', SAMPLE)

    expect(setMock).toHaveBeenCalledWith(
      `${KEY_PREFIX}U1`,
      JSON.stringify(SAMPLE),
      { ex: TTL },
    )
  })

  it('writes the null sentinel for unlinks', async () => {
    const { client, setMock } = makeFakeRedis({})
    __setRedisClientForTesting(client)

    await setMappingOrThrow('U-orphan', null)

    expect(setMock).toHaveBeenCalledWith(
      `${KEY_PREFIX}U-orphan`,
      NULL_SENTINEL,
      { ex: TTL },
    )
  })

  it('THROWS when Redis errors (vs setMapping which swallows)', async () => {
    const { client, setMock } = makeFakeRedis({})
    setMock.mockRejectedValueOnce(new Error('Upstash unreachable'))
    __setRedisClientForTesting(client)

    await expect(setMappingOrThrow('U1', SAMPLE)).rejects.toThrow(
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
      await expect(setMappingOrThrow('U1', SAMPLE)).resolves.toBeUndefined()
    } finally {
      if (original.url) process.env.KV_REST_API_URL = original.url
      if (original.token) process.env.KV_REST_API_TOKEN = original.token
    }
  })
})
