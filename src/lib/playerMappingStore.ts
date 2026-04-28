/**
 * Player-mapping store. Backs `lib/auth.ts#getPlayerMapping`.
 *
 * Architectural framing (PR 16 / v1.5.0):
 *   This is the **primary store** for `lineId → Player` lookups in the auth
 *   path, not a cache-aside. The previous shape (PR 8 / v1.2.3) was Upstash
 *   in front of Prisma with a 60-second TTL — every miss fell through to
 *   Prisma. v1.5.0 inverts that: Redis is canonical for auth, Prisma is a
 *   durable secondary that backs admin queries (e.g. `/assign-player`'s
 *   linked-players filter from PR 14) and serves as the source-of-truth for
 *   the recovery script (`scripts/backfillRedisFromPrisma.ts`).
 *
 *   Why invert: the cold-Neon Prisma fallback was the cold-lambda perceived-
 *   latency root cause that PRs 8/9/10/11/12 chipped away at incrementally.
 *   v1.5.0 just removes the fallback. With the JWT-callback read path going
 *   through Redis exclusively, every authenticated request is bounded by an
 *   Upstash REST round-trip (~50–100ms) instead of a possible cold-Neon
 *   relation-include (~1–3s).
 *
 * Sliding TTL (24h):
 *   Every read that hits fires an `expire` to bump the key for another 24h.
 *   Active users (any auth refresh inside 24h) effectively never expire.
 *   Long-inactive users → key expires → next access → cache miss → null
 *   (orphan, must re-link). The 24h sliding window also serves as a self-
 *   healing safety net for write-path bugs: if a write site forgets to
 *   update Redis, the stale entry expires within 24h instead of persisting
 *   indefinitely.
 *
 *   The TTL refresh is fire-and-forget (`expire(...).catch(() => {})`) so it
 *   doesn't add a round-trip to the auth critical path. Worst case: the
 *   refresh races the next read and the key expires once unnecessarily —
 *   acceptable cost for never blocking the JWT callback on it.
 *
 * Miss vs error semantics:
 *   `getMapping` returns a discriminated union — `hit` / `miss` / `error` —
 *   so the caller (`getPlayerMapping` in `auth.ts`) can apply the v1.5.0
 *   policy:
 *     - `hit`   → return the value (mapping or null sentinel)
 *     - `miss`  → return null (orphan, no mapping)  ← NEW: no Prisma fallback
 *     - `error` → fall through to Prisma defensively (Upstash transient
 *                 outage must NOT null every authenticated session)
 *   The pre-v1.5.0 shape collapsed miss and error into a single `undefined`
 *   return, which the caller couldn't distinguish — both fell through to
 *   Prisma. The new shape preserves Upstash-outage resilience while
 *   removing the steady-state Prisma fallback.
 *
 * Recovery:
 *   If Upstash data loss / accidental wipe ever happens, run
 *   `npx tsx scripts/backfillRedisFromPrisma.ts --apply` to rebuild the
 *   store from `Player.lineId`. See CLAUDE.md "Recovery procedure" in the
 *   runbook section.
 */

const KEY_PREFIX = 't9l:auth:map:'
// 24-hour sliding TTL (seconds). Reads bump this on every hit.
const TTL_SECONDS = 60 * 60 * 24
const NULL_SENTINEL = '__null__'

export type PlayerMapping = {
  playerId: string
  playerName: string
  teamId: string
}

export type StoreReadResult =
  | { status: 'hit'; value: PlayerMapping | null }
  | { status: 'miss' }
  | { status: 'error'; reason: 'no-client' | 'redis-error' }

// Minimal interface so the helper is decoupled from `@upstash/redis` at the
// type level — and so tests can drop in a fake without import-mock plumbing.
export type RedisLike = {
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string, opts: { ex: number }) => Promise<unknown>
  del: (key: string) => Promise<unknown>
  expire: (key: string, seconds: number) => Promise<unknown>
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
 * Read the stored mapping for a lineId. Returns a discriminated union so
 * the caller can distinguish miss from error — see file head for the
 * v1.5.0 semantics.
 *
 * On a hit, fires a fire-and-forget `expire` to bump the sliding TTL by
 * another 24h. The bump runs in the background; the caller doesn't wait.
 */
export async function getMapping(lineId: string): Promise<StoreReadResult> {
  const client = await getClient()
  if (!client) return { status: 'error', reason: 'no-client' }
  let raw: string | null
  try {
    raw = await client.get(key(lineId))
  } catch (err) {
    console.warn('[playerMappingStore] redis GET errored for lineId=%s: %o', lineId, err)
    return { status: 'error', reason: 'redis-error' }
  }
  if (raw === null || raw === undefined) {
    return { status: 'miss' }
  }
  // Parse first; only fire the sliding-TTL refresh on a real hit. Refreshing
  // a malformed/unparseable entry is wasted work — it'll be overwritten on
  // the next `setMapping` for that lineId anyway. Refreshing on `miss` is
  // impossible (no key) and on `error` we don't even reach this point.
  const parsed = parseStoredValue(raw)
  if (parsed.status === 'miss') {
    return { status: 'miss' }
  }
  // Sliding TTL: bump expiry on every confirmed hit. Fire-and-forget so the
  // auth critical path never waits on it.
  client.expire(key(lineId), TTL_SECONDS).catch(() => {
    /* non-fatal — entry will simply expire on its original schedule */
  })
  return parsed
}

/**
 * Pure parser. Splits the raw Redis value into the discriminated-union shape
 * the caller expects, so the I/O wrapper above can decide whether to refresh
 * the sliding TTL based on the parse result.
 */
function parseStoredValue(
  raw: string | object,
): { status: 'hit'; value: PlayerMapping | null } | { status: 'miss' } {
  // Upstash's REST client may return either the raw string or an
  // already-parsed object depending on the value's shape. Normalize both.
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    if (typeof obj.playerId === 'string' && typeof obj.teamId === 'string') {
      return { status: 'hit', value: obj as unknown as PlayerMapping }
    }
    // Defensively treat malformed payloads as a miss — better to re-link
    // than to crash the auth callback on a corrupt entry.
    return { status: 'miss' }
  }
  if (raw === NULL_SENTINEL) return { status: 'hit', value: null }
  try {
    const result = JSON.parse(raw) as PlayerMapping
    return { status: 'hit', value: result }
  } catch {
    return { status: 'miss' }
  }
}

/**
 * Write a mapping (or the null sentinel) for the given lineId. Pre-warmed
 * at every write site (`api/assign-player` POST/DELETE, `admin/actions`
 * `updatePlayer` / `createPlayer`, `admin/leagues/actions`
 * `adminLinkLineToPlayer`) so the post-write JWT callback hits the store
 * immediately without falling through to the defensive Prisma path.
 *
 * Failure semantics: silent no-op on no-client (KV env unset) and on Redis
 * errors. Suitable for write sites where the durable Prisma write has
 * already happened and Redis is the secondary mirror — admin actions, etc.
 *
 * For v1.8.0 public hot paths (`/api/assign-player`, `/api/rsvp`) where
 * Redis is the canonical write target on the response critical path AND
 * Prisma is deferred via `waitUntil`, use {@link setMappingOrThrow}
 * instead — silent failure there would mean the response succeeds but no
 * durable write lands anywhere.
 */
export async function setMapping(
  lineId: string,
  mapping: PlayerMapping | null,
): Promise<void> {
  const client = await getClient()
  if (!client) return
  try {
    const value = mapping === null ? NULL_SENTINEL : JSON.stringify(mapping)
    await client.set(key(lineId), value, { ex: TTL_SECONDS })
  } catch (err) {
    console.warn('[playerMappingStore] redis SET errored for lineId=%s: %o', lineId, err)
  }
}

/**
 * Throwing variant of {@link setMapping} for v1.8.0 public hot paths.
 *
 * Used by `/api/assign-player` POST/DELETE where Redis is the canonical
 * write target on the response critical path and Prisma is deferred via
 * `waitUntil`. A silent Redis failure would leave the user 200-OK with
 * neither store updated — the caller needs to surface a 500 instead.
 *
 * No-client (KV env unset / construction failure) is still silent — that's
 * a dev / test condition without Redis configured, not a real prod failure
 * mode.
 */
export async function setMappingOrThrow(
  lineId: string,
  mapping: PlayerMapping | null,
): Promise<void> {
  const client = await getClient()
  if (!client) return
  const value = mapping === null ? NULL_SENTINEL : JSON.stringify(mapping)
  await client.set(key(lineId), value, { ex: TTL_SECONDS })
}

/**
 * Delete the entry for `lineId`. Used by admin un-link flows where the
 * desired post-write state is "no mapping" but we'd rather have a fresh
 * miss than a stale null sentinel.
 *
 * Pass `undefined` for a no-op (handy when callers conditionally remove
 * a previous-value lineId that may not exist).
 */
export async function deleteMapping(
  lineId: string | null | undefined,
): Promise<void> {
  if (!lineId) return
  const client = await getClient()
  if (!client) return
  try {
    await client.del(key(lineId))
  } catch (err) {
    console.warn('[playerMappingStore] redis DEL errored for lineId=%s: %o', lineId, err)
  }
}
