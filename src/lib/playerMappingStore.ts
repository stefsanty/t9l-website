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
 * Per-league keying (PR β / v1.26.0):
 *   Pre-v1.26.0 the namespace was a single key per LINE user, league-blind:
 *   `t9l:auth:map:<lineId>`. With multi-tenant a single LINE user can be
 *   assigned to different teams in different leagues, so the JWT
 *   `playerId`/`teamId` resolution is per-league. v1.26.0 namespaces keys
 *   by leagueId: `t9l:auth:map:<leagueId>:<lineId>`. The old single-key
 *   namespace is no longer read; existing entries decay over the 24h
 *   sliding TTL after deploy (no migration required — first-render miss
 *   per (leagueId, lineId) falls through to Prisma + writes back).
 *
 *   Miss policy changes accordingly: pre-v1.26.0 a miss meant "no mapping
 *   exists for this LINE user" → orphan. Post-v1.26.0 a miss is ambiguous
 *   (cold per-league cache vs genuine orphan), so the read path falls
 *   through to Prisma + writes back to Redis on miss. Mirror of the v1.7.0
 *   RSVP store's miss policy. Error policy stays the same: Prisma fallback
 *   without write-back (don't amplify Upstash blips into write storms).
 *
 *   The function-level signatures gain a required `leagueId` parameter on
 *   the read + per-league write paths. `deleteMapping(lineId)` retains its
 *   single-arg shape but now SCANs the per-league namespace internally and
 *   DELs every match — admin write sites that don't operate within a single
 *   league context (`updatePlayer`, `createPlayer`) call this for invalidate.
 *
 * Sliding TTL (24h):
 *   Every read that hits fires an `expire` to bump the key for another 24h.
 *   Active users (any auth refresh inside 24h) effectively never expire.
 *   Long-inactive users → key expires → next access → cache miss → fall
 *   through to Prisma → write back. The 24h sliding window also serves as
 *   a self-healing safety net for write-path bugs: if a write site forgets
 *   to update Redis, the stale entry expires within 24h instead of
 *   persisting indefinitely.
 *
 *   The TTL refresh is fire-and-forget (`expire(...).catch(() => {})`) so it
 *   doesn't add a round-trip to the auth critical path. Worst case: the
 *   refresh races the next read and the key expires once unnecessarily —
 *   acceptable cost for never blocking the JWT callback on it.
 *
 * Miss vs error semantics:
 *   `getMapping` returns a discriminated union — `hit` / `miss` / `error` —
 *   so the caller (`getPlayerMapping` in `auth.ts`) can apply the v1.26.0
 *   policy:
 *     - `hit`   → return the value (mapping or null sentinel)
 *     - `miss`  → fall through to Prisma + write back (NEW in v1.26.0; was
 *                 "orphan" pre-v1.26.0 because the key was league-blind)
 *     - `error` → fall through to Prisma defensively (Upstash transient
 *                 outage must NOT null every authenticated session); do NOT
 *                 write back (don't amplify the outage into a write storm)
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
  /**
   * SCAN-style iteration. v1.26.0 uses this when invalidating a lineId
   * across all leagues (admin write paths that don't operate in a single
   * league context). Returns `{ cursor, keys }` per call; the helper loops
   * until cursor is back to '0'.
   *
   * `@upstash/redis` exposes `scan(cursor, opts)`; we model it loosely so
   * tests can implement a deterministic fake.
   */
  scan: (cursor: string | number, opts?: { match?: string; count?: number }) => Promise<[string, string[]] | { cursor: string; keys: string[] }>
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

/**
 * v1.26.0 — per-league key shape: `t9l:auth:map:<leagueId>:<lineId>`. The
 * old single-key namespace (`t9l:auth:map:<lineId>`) is no longer read; old
 * entries decay over the 24h sliding TTL.
 *
 * Exported pure helper for unit testing the key shape.
 */
export function buildKey(lineId: string, leagueId: string): string {
  return `${KEY_PREFIX}${leagueId}:${lineId}`
}

/**
 * Pattern for SCAN-based wildcard invalidation across all leagues a given
 * lineId is cached in. Used by admin write paths (`updatePlayer` etc.)
 * that change a player's lineId without operating within a single league
 * context.
 */
function scanPatternForLineId(lineId: string): string {
  return `${KEY_PREFIX}*:${lineId}`
}

/**
 * Read the stored mapping for a (lineId, leagueId) pair. Returns a
 * discriminated union so the caller can distinguish miss from error —
 * see file head for the v1.26.0 semantics (miss → Prisma fallthrough +
 * write-back; error → Prisma fallthrough without write-back).
 *
 * On a hit, fires a fire-and-forget `expire` to bump the sliding TTL by
 * another 24h. The bump runs in the background; the caller doesn't wait.
 */
export async function getMapping(
  lineId: string,
  leagueId: string,
): Promise<StoreReadResult> {
  const client = await getClient()
  if (!client) return { status: 'error', reason: 'no-client' }
  const k = buildKey(lineId, leagueId)
  let raw: string | null
  try {
    raw = await client.get(k)
  } catch (err) {
    console.warn(
      '[playerMappingStore] redis GET errored for lineId=%s leagueId=%s: %o',
      lineId,
      leagueId,
      err,
    )
    return { status: 'error', reason: 'redis-error' }
  }
  if (raw === null || raw === undefined) {
    return { status: 'miss' }
  }
  // Parse first; only fire the sliding-TTL refresh on a real hit. Refreshing
  // a malformed/unparseable entry is wasted work — it'll be overwritten on
  // the next `setMapping` for that pair anyway.
  const parsed = parseStoredValue(raw)
  if (parsed.status === 'miss') {
    return { status: 'miss' }
  }
  // Sliding TTL: bump expiry on every confirmed hit. Fire-and-forget so the
  // auth critical path never waits on it.
  client.expire(k, TTL_SECONDS).catch(() => {
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
  leagueId: string,
  mapping: PlayerMapping | null,
): Promise<void> {
  const client = await getClient()
  if (!client) return
  try {
    const value = mapping === null ? NULL_SENTINEL : JSON.stringify(mapping)
    await client.set(buildKey(lineId, leagueId), value, { ex: TTL_SECONDS })
  } catch (err) {
    console.warn(
      '[playerMappingStore] redis SET errored for lineId=%s leagueId=%s: %o',
      lineId,
      leagueId,
      err,
    )
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
  leagueId: string,
  mapping: PlayerMapping | null,
): Promise<void> {
  const client = await getClient()
  if (!client) return
  const value = mapping === null ? NULL_SENTINEL : JSON.stringify(mapping)
  await client.set(buildKey(lineId, leagueId), value, { ex: TTL_SECONDS })
}

/**
 * Delete the cached mapping(s) for `lineId`. Used by admin un-link flows
 * where the desired post-write state is "no mapping" but we'd rather have
 * a fresh miss → Prisma fallthrough than a stale value.
 *
 * v1.26.0 — two modes:
 *   - `deleteMapping(lineId, leagueId)` → DEL the single per-league key.
 *     Used when the admin write path knows the league context (e.g.
 *     `adminLinkLineToPlayer` clearing the target player's prior lineId
 *     within a specific league's write surface).
 *   - `deleteMapping(lineId)` → SCAN and DEL every per-league entry for
 *     this lineId. Used when the admin path doesn't operate within a
 *     single league context (`updatePlayer`, `createPlayer` — the affected
 *     Player may be in 0..N leagues).
 *
 * Pass `undefined`/`null` lineId for a no-op (handy when callers
 * conditionally remove a previous-value lineId that may not exist).
 *
 * SCAN mode walks the entire `t9l:auth:map:*:<lineId>` namespace via
 * Upstash's SCAN cursor protocol. With at most ~30 active LINE users and
 * a small number of leagues, the scan is bounded — under 100 keys total
 * even at the multi-league cap.
 */
export async function deleteMapping(
  lineId: string | null | undefined,
  leagueId?: string,
): Promise<void> {
  if (!lineId) return
  const client = await getClient()
  if (!client) return
  if (leagueId) {
    try {
      await client.del(buildKey(lineId, leagueId))
    } catch (err) {
      console.warn(
        '[playerMappingStore] redis DEL errored for lineId=%s leagueId=%s: %o',
        lineId,
        leagueId,
        err,
      )
    }
    return
  }
  // SCAN-and-DEL across all leagues — admin invalidate.
  const pattern = scanPatternForLineId(lineId)
  let cursor: string | number = '0'
  const allKeys: string[] = []
  // Bounded by namespace size; avoid an infinite loop if the SCAN protocol
  // never converges. 100 iterations × default count(10) = 1000 keys cap is
  // well above realistic cardinality.
  for (let i = 0; i < 100; i++) {
    let result: [string, string[]] | { cursor: string; keys: string[] }
    try {
      result = await client.scan(cursor, { match: pattern, count: 100 })
    } catch (err) {
      console.warn(
        '[playerMappingStore] redis SCAN errored for lineId=%s: %o',
        lineId,
        err,
      )
      return
    }
    let nextCursor: string
    let keys: string[]
    if (Array.isArray(result)) {
      nextCursor = String(result[0])
      keys = result[1]
    } else {
      nextCursor = String(result.cursor)
      keys = result.keys
    }
    allKeys.push(...keys)
    if (nextCursor === '0') break
    cursor = nextCursor
  }
  if (allKeys.length === 0) return
  try {
    // Issue per-key DELs in parallel; @upstash/redis supports varargs DEL
    // but the RedisLike interface stays minimal so tests can model a fake
    // without growing the surface.
    await Promise.all(allKeys.map((k) => client.del(k)))
  } catch (err) {
    console.warn(
      '[playerMappingStore] redis bulk-DEL errored for lineId=%s: %o',
      lineId,
      err,
    )
  }
}
