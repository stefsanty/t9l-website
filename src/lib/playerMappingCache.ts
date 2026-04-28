/**
 * Cache-aside layer for the LINE-ID → Player mapping resolved on every JWT
 * callback. Backs `lib/auth.ts#getPlayerMapping`.
 *
 * Why this exists: the JWT callback runs on every authenticated request. Pre
 * cutover, the mapping read was a 50 ms Upstash `HGET line-player-map`. After
 * PR 6 it became a Prisma `findUnique` with a relation include, which on a
 * Neon serverless cold connection can take 1–3 s — felt site-wide as auth
 * latency, including in /assign-player navigation. This helper keeps the read
 * fast for repeat hits in the same minute while preserving correctness via
 * explicit invalidation at every lineId write site.
 *
 * Design choices:
 *  - 60-second TTL: short enough that a forgotten invalidation self-heals
 *    within a minute; long enough to absorb the typical multi-request burst
 *    that follows a sign-in or page navigation.
 *  - Distinct namespace `t9l:auth:map:` — does not collide with the legacy
 *    `line-player-map` hash (Redis-side fallback in lib/auth.ts) nor with
 *    the i18n cache `t9l:i18n:*`.
 *  - Null sentinel: cached "no mapping" is `__null__` (a value distinct from
 *    a cache miss). This matters because Prisma's `findUnique` returning null
 *    is itself a real outcome we want to cache — otherwise unmapped LINE IDs
 *    would re-query Prisma every request.
 *  - Redis errors fall through silently. Auth must not break on a Redis
 *    outage; the JWT callback can always re-read Prisma directly.
 */

const KEY_PREFIX = 't9l:auth:map:'
const TTL_SECONDS = 60
const NULL_SENTINEL = '__null__'

export type PlayerMapping = {
  playerId: string
  playerName: string
  teamId: string
}

// Minimal interface so the helper is decoupled from `@upstash/redis` at the
// type level — and so tests can drop in a fake without import-mock plumbing.
export type RedisLike = {
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string, opts: { ex: number }) => Promise<unknown>
  del: (key: string) => Promise<unknown>
}

let testClientOverride: RedisLike | null = null
let cachedClient: RedisLike | null | undefined = undefined

/** Test seam — pass null to clear. Production code never calls this. */
export function __setRedisClientForTesting(client: RedisLike | null): void {
  testClientOverride = client
  // Force getClient() to re-evaluate on next call (in case the override was
  // installed after a prior production-path call cached a real client).
  cachedClient = undefined
}

async function getClient(): Promise<RedisLike | null> {
  if (testClientOverride) return testClientOverride
  if (cachedClient !== undefined) return cachedClient
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    cachedClient = null
    return null
  }
  try {
    const { Redis } = await import('@upstash/redis')
    cachedClient = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    }) as unknown as RedisLike
    return cachedClient
  } catch {
    cachedClient = null
    return null
  }
}

function key(lineId: string): string {
  return `${KEY_PREFIX}${lineId}`
}

/**
 * Read the cached mapping for a lineId.
 *
 * Return shape:
 *   - `{ value: PlayerMapping }` — cache hit, real mapping.
 *   - `{ value: null }`          — cache hit, "no mapping" sentinel.
 *   - `undefined`                 — cache miss (or Redis unavailable / errored).
 */
export async function getCached(
  lineId: string,
): Promise<{ value: PlayerMapping | null } | undefined> {
  const client = await getClient()
  if (!client) return undefined
  try {
    const raw = await client.get(key(lineId))
    if (raw === null || raw === undefined) return undefined
    // Upstash's REST client may return either the raw string or an
    // already-parsed object depending on the value's shape. Normalize both.
    if (typeof raw === 'object') {
      const obj = raw as Record<string, unknown>
      // The sentinel was stored as a plain string; an object can only be a
      // mapping. Defensively check it has the expected shape.
      if (typeof obj.playerId === 'string' && typeof obj.teamId === 'string') {
        return { value: obj as unknown as PlayerMapping }
      }
      return undefined
    }
    if (raw === NULL_SENTINEL) return { value: null }
    try {
      const parsed = JSON.parse(raw) as PlayerMapping
      return { value: parsed }
    } catch {
      return undefined
    }
  } catch {
    return undefined
  }
}

/**
 * Write a mapping (or the null sentinel) for the given lineId. The cache
 * entry expires after TTL_SECONDS regardless of whether it's a hit or null —
 * forgotten invalidation self-heals within a minute.
 */
export async function setCached(
  lineId: string,
  mapping: PlayerMapping | null,
): Promise<void> {
  const client = await getClient()
  if (!client) return
  try {
    const value = mapping === null ? NULL_SENTINEL : JSON.stringify(mapping)
    await client.set(key(lineId), value, { ex: TTL_SECONDS })
  } catch {
    /* non-fatal */
  }
}

/**
 * Drop the cache entry for `lineId`. Call from every site that writes
 * `Player.lineId` (public self-assign, admin link, admin player edit) so the
 * next JWT read sees the post-write Prisma state instead of stale cache.
 *
 * Pass `undefined` for a no-op (handy when callers conditionally invalidate
 * a previous-value lineId that may not exist).
 */
export async function invalidate(lineId: string | null | undefined): Promise<void> {
  if (!lineId) return
  const client = await getClient()
  if (!client) return
  try {
    await client.del(key(lineId))
  } catch {
    /* non-fatal */
  }
}
