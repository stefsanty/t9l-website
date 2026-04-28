/**
 * RSVP store. Backs the read path in `lib/publicData.ts#getRsvpData` and the
 * write path in `app/api/rsvp/route.ts`.
 *
 * Architectural framing (PR 19 / v1.7.0):
 *   This is the **primary store** for per-game-week RSVP signals (rsvp +
 *   participated) on the public-site read path. Pre-v1.7.0, `Availability`
 *   rows lived in Postgres only; the public dashboard read them via the
 *   `dbToPublicLeagueData` adapter, which is wrapped in a 30s
 *   `unstable_cache`. RSVP writes had to bust the cache via
 *   `revalidateTag('public-data')` to surface — read-your-own-write
 *   consistency cost a full re-derivation of the entire LeagueData blob.
 *   v1.7.0 inverts that: Redis is the canonical read store for RSVP; Prisma
 *   `Availability` is the durable secondary that backs admin queries and
 *   serves as the source-of-truth for the recovery script
 *   (`scripts/backfillRedisRsvpFromPrisma.ts`).
 *
 *   Mirrors the shape of `playerMappingStore.ts` (PR 16 / v1.5.0) but for
 *   the RSVP domain. See CLAUDE.md "State-based data on Redis" pattern.
 *
 * Key shape:
 *   `t9l:rsvp:gw:<gameWeekId>` — Redis HASH with fields:
 *     `__seeded`           → '1'  (sentinel: hash has been initialized)
 *     `<playerSlug>:rsvp`  → 'GOING' | 'UNDECIDED' | 'NOT_GOING'
 *     `<playerSlug>:p`     → 'JOINED' | 'NO_SHOWED'  (participated)
 *
 *   The `__seeded` sentinel distinguishes "GameWeek is initialized in Redis,
 *   no RSVPs yet" (legitimate empty state) from "Redis has nothing for this
 *   GameWeek" (miss → fall through to Prisma + repopulate). HGETALL on a
 *   missing key returns null/empty in Upstash; the sentinel turns "empty hash"
 *   into a positive signal rather than ambiguous absence.
 *
 *   `playerSlug` is the public slug (`ian-noseda`), NOT the prefixed DB id
 *   (`p-ian-noseda`). Write-site responsibility: strip the `p-` prefix before
 *   calling `setRsvp`. Matches the contract `dbToPublicLeagueData` produces
 *   for `LeagueData.players[].id`.
 *
 * Absolute TTL (90 days post-matchday):
 *   `expireat(key, max(gwStartDate, now) + 90 days)`. Re-set on every write;
 *   never sliding. Past matchdays expire 90 days after the matchday; future
 *   matchdays expire 90 days after they happen. The 90-day floor gives admins
 *   a comfortable window to investigate participation issues post-match
 *   without losing the canonical Redis copy. Prisma still has the durable
 *   record; Redis is only ever the fast read path.
 *
 *   Why absolute (EXPIREAT) instead of sliding (EXPIRE on every read like the
 *   player-mapping store): RSVP data has a natural lifetime tied to a
 *   real-world event (the matchday). Sliding TTL would keep MD1 hot forever
 *   if anyone keeps loading the dashboard, when in reality the data is frozen
 *   the moment the match ends. Player mapping is per-user and unbounded;
 *   RSVP is per-event and bounded.
 *
 * Miss vs error semantics (mirrors playerMappingStore):
 *   `getRsvpForGameWeek` returns a discriminated union — `hit` / `miss` /
 *   `error` — so the caller in `lib/publicData.ts` can apply the v1.7.0
 *   policy:
 *     - `hit`   → return the data (possibly an empty map; that's a real
 *                 "initialized, no signals" state)
 *     - `miss`  → fall through to Prisma `Availability` and write the result
 *                 back into Redis with `__seeded=1` (cold-cache fill)
 *     - `error` → fall through to Prisma defensively, do NOT write back
 *                 (Upstash transient outage must not corrupt the canonical
 *                 store — defensive-not-self-healing during outages)
 *
 * Recovery:
 *   If Upstash data loss / accidental wipe ever happens, run
 *   `npx tsx scripts/backfillRedisRsvpFromPrisma.ts --apply` to rebuild from
 *   Prisma `Availability`. See CLAUDE.md "Layer 5b — Redis RSVP store
 *   rebuild" in the runbook.
 */

const KEY_PREFIX = 't9l:rsvp:gw:'
const SEEDED_FIELD = '__seeded'
const SEEDED_VALUE = '1'
const RSVP_SUFFIX = ':rsvp'
const PARTICIPATED_SUFFIX = ':p'
const TTL_DAYS_AFTER_MATCH = 90

export type RsvpValue = 'GOING' | 'UNDECIDED' | 'NOT_GOING'
export type ParticipatedValue = 'JOINED' | 'NO_SHOWED'

export type RsvpEntry = {
  rsvp?: RsvpValue
  participated?: ParticipatedValue
}

export type GwRsvpMap = Map<string /* playerSlug */, RsvpEntry>

export type RsvpReadResult =
  | { status: 'hit'; data: GwRsvpMap }
  | { status: 'miss' }
  | { status: 'error'; reason: 'no-client' | 'redis-error' }

// Minimal interface so the helper is decoupled from `@upstash/redis` at the
// type level — and so tests can drop in a fake without import-mock plumbing.
// Only the hash + expireat ops we actually use; not a general Redis interface.
export type RedisLike = {
  hgetall: (key: string) => Promise<Record<string, string> | null>
  hset: (key: string, fields: Record<string, string>) => Promise<unknown>
  hdel: (key: string, ...fields: string[]) => Promise<unknown>
  expireat: (key: string, unixSeconds: number) => Promise<unknown>
  del: (key: string) => Promise<unknown>
}

let testClientOverride: RedisLike | null = null
let cachedClient: RedisLike | null | undefined = undefined

/** Test seam — pass null to clear. Production code never calls this. */
export function __setRedisClientForTesting(client: RedisLike | null): void {
  testClientOverride = client
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

function key(gameWeekId: string): string {
  return `${KEY_PREFIX}${gameWeekId}`
}

/**
 * Compute the absolute Unix timestamp (seconds) at which a GameWeek's RSVP
 * hash should expire. Exported for unit testing.
 *
 * `max(gwStartDate, now) + TTL_DAYS_AFTER_MATCH`. Past matchdays anchor on
 * the matchday itself (so MD1 expires ~90 days after MD1 happened, not 90
 * days after we last wrote to it); future matchdays anchor on now (the
 * RSVP started flowing today, so the 90-day clock runs from today even if
 * the match itself is months away — uses the longer of the two windows
 * implicitly via the `max`).
 */
export function computeRsvpExpireAt(
  gwStartDate: Date,
  now: Date = new Date(),
): number {
  const base = Math.max(gwStartDate.getTime(), now.getTime())
  const expireMs = base + TTL_DAYS_AFTER_MATCH * 24 * 60 * 60 * 1000
  return Math.floor(expireMs / 1000)
}

/**
 * Parse a HGETALL result into the (playerSlug → RsvpEntry) map. Skips the
 * `__seeded` sentinel and any field whose suffix doesn't match the schema.
 *
 * Pure — exported for unit testing.
 */
export function parseHashFields(raw: Record<string, string>): GwRsvpMap {
  const data: GwRsvpMap = new Map()
  for (const [field, value] of Object.entries(raw)) {
    if (field === SEEDED_FIELD) continue
    if (field.endsWith(RSVP_SUFFIX)) {
      const slug = field.slice(0, -RSVP_SUFFIX.length)
      if (!slug) continue
      const entry = data.get(slug) ?? {}
      entry.rsvp = value as RsvpValue
      data.set(slug, entry)
    } else if (field.endsWith(PARTICIPATED_SUFFIX)) {
      const slug = field.slice(0, -PARTICIPATED_SUFFIX.length)
      if (!slug) continue
      const entry = data.get(slug) ?? {}
      entry.participated = value as ParticipatedValue
      data.set(slug, entry)
    }
    // Other fields: defensively ignored. Lets us extend the schema later
    // (e.g. `<slug>:reason`) without a coordinated cutover.
  }
  return data
}

/**
 * Read all RSVP signals for a single GameWeek. Returns the discriminated
 * union so the caller can distinguish miss from error — see file head for
 * the v1.7.0 semantics.
 */
export async function getRsvpForGameWeek(
  gameWeekId: string,
  _gwStartDate: Date,
): Promise<RsvpReadResult> {
  const client = await getClient()
  if (!client) return { status: 'error', reason: 'no-client' }
  let raw: Record<string, string> | null
  try {
    raw = await client.hgetall(key(gameWeekId))
  } catch (err) {
    console.warn(
      '[rsvpStore] redis HGETALL errored for gw=%s: %o',
      gameWeekId,
      err,
    )
    return { status: 'error', reason: 'redis-error' }
  }
  // Upstash returns null for a missing key, or `{}`/empty when the hash has
  // been emptied (which auto-deletes the key in Redis — so this is mostly
  // null in practice, but defensively handle both).
  if (!raw || raw[SEEDED_FIELD] !== SEEDED_VALUE) {
    return { status: 'miss' }
  }
  return { status: 'hit', data: parseHashFields(raw) }
}

/**
 * Batch read across N GameWeeks. Fires N parallel HGETALLs (one round-trip
 * each via Upstash REST; with ~8 game weeks per league this is the simplest
 * shape that scales — true Redis pipelining would also work but adds a
 * Upstash-specific dep that would leak through the RedisLike abstraction).
 */
export async function getRsvpForGameWeeks(
  gws: { id: string; startDate: Date }[],
): Promise<Map<string, RsvpReadResult>> {
  const entries = await Promise.all(
    gws.map(async (gw) => {
      const result = await getRsvpForGameWeek(gw.id, gw.startDate)
      return [gw.id, result] as const
    }),
  )
  return new Map(entries)
}

/**
 * Write the RSVP signal for one (gameWeek, player) pair. Pass `null` to
 * clear (HDELs the field; the hash stays initialized via the sentinel).
 *
 * Always re-asserts the `__seeded` sentinel and re-sets the absolute TTL —
 * so a write to a previously-unseeded GameWeek naturally promotes it to
 * initialized state, and the TTL stays anchored to the matchday + 90 days
 * regardless of when the write happens.
 */
export async function setRsvp(
  gameWeekId: string,
  gwStartDate: Date,
  playerSlug: string,
  rsvp: RsvpValue | null,
): Promise<void> {
  const client = await getClient()
  if (!client) return
  const k = key(gameWeekId)
  const field = `${playerSlug}${RSVP_SUFFIX}`
  try {
    if (rsvp === null) {
      await client.hdel(k, field)
      // Always reassert the sentinel so a pure-clear on a fresh hash still
      // marks it initialized. (Upstash auto-deletes a hash that becomes
      // empty after HDEL; the HSET below recreates it.)
      await client.hset(k, { [SEEDED_FIELD]: SEEDED_VALUE })
    } else {
      await client.hset(k, {
        [SEEDED_FIELD]: SEEDED_VALUE,
        [field]: rsvp,
      })
    }
    await client.expireat(k, computeRsvpExpireAt(gwStartDate))
  } catch (err) {
    console.warn(
      '[rsvpStore] redis write errored for gw=%s player=%s: %o',
      gameWeekId,
      playerSlug,
      err,
    )
  }
}

/**
 * Write the participated signal. Same contract as `setRsvp`. Currently no
 * admin endpoint writes this — kept for parity with the Prisma schema and
 * future admin "post-match attendance" workflow.
 */
export async function setParticipated(
  gameWeekId: string,
  gwStartDate: Date,
  playerSlug: string,
  participated: ParticipatedValue | null,
): Promise<void> {
  const client = await getClient()
  if (!client) return
  const k = key(gameWeekId)
  const field = `${playerSlug}${PARTICIPATED_SUFFIX}`
  try {
    if (participated === null) {
      await client.hdel(k, field)
      await client.hset(k, { [SEEDED_FIELD]: SEEDED_VALUE })
    } else {
      await client.hset(k, {
        [SEEDED_FIELD]: SEEDED_VALUE,
        [field]: participated,
      })
    }
    await client.expireat(k, computeRsvpExpireAt(gwStartDate))
  } catch (err) {
    console.warn(
      '[rsvpStore] redis participated write errored for gw=%s player=%s: %o',
      gameWeekId,
      playerSlug,
      err,
    )
  }
}

/**
 * Mark a GameWeek as initialized in Redis with no RSVP entries yet. Called
 * from `admin/leagues/actions.ts#createGameWeek` so a future read for a
 * GameWeek that has never received a public RSVP returns `hit` (with an
 * empty map) instead of `miss` (which would trigger a Prisma fall-through
 * for what is correctly empty data).
 *
 * Idempotent: re-setting `__seeded=1` is a no-op semantically.
 */
export async function seedGameWeek(
  gameWeekId: string,
  gwStartDate: Date,
): Promise<void> {
  const client = await getClient()
  if (!client) return
  const k = key(gameWeekId)
  try {
    await client.hset(k, { [SEEDED_FIELD]: SEEDED_VALUE })
    await client.expireat(k, computeRsvpExpireAt(gwStartDate))
  } catch (err) {
    console.warn('[rsvpStore] redis seed errored for gw=%s: %o', gameWeekId, err)
  }
}

/**
 * Remove a GameWeek's RSVP hash entirely. Called from
 * `admin/leagues/actions.ts#deleteGameWeek`. Cleanup-only: missing TTL or
 * orphan hashes would expire on their own, but eager deletion keeps the
 * namespace tidy.
 */
export async function deleteGameWeek(gameWeekId: string): Promise<void> {
  const client = await getClient()
  if (!client) return
  try {
    await client.del(key(gameWeekId))
  } catch (err) {
    console.warn(
      '[rsvpStore] redis del errored for gw=%s: %o',
      gameWeekId,
      err,
    )
  }
}
