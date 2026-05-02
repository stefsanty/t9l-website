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
 *   `revalidate({ domain: 'public' })` to surface — read-your-own-write
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

import {
  RSVP_KEY_PREFIX as KEY_PREFIX,
  RSVP_SEEDED_FIELD as SEEDED_FIELD,
  RSVP_SEEDED_VALUE as SEEDED_VALUE,
  RSVP_FIELD_SUFFIX as RSVP_SUFFIX,
  PARTICIPATED_FIELD_SUFFIX as PARTICIPATED_SUFFIX,
  computeRsvpExpireAt,
} from './rsvpStoreSchema'

export { computeRsvpExpireAt }

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
//
// `hgetall` returns `Record<string, unknown>` because Upstash's REST client
// auto-coerces field values that look like JSON: `'1'` comes back as the
// number `1`, `'true'` as a boolean, etc. The string-typed enum values we
// store (`'GOING'`, `'JOINED'`) survive the round-trip unchanged, but the
// `__seeded='1'` sentinel does not. All call sites must coerce via
// `String()` before comparing against the canonical string forms.
export type RedisLike = {
  hgetall: (key: string) => Promise<Record<string, unknown> | null>
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
 * Shared write primitive for the four field-write paths (setRsvp,
 * setRsvpOrThrow, setParticipated, and the null-clear branches of each).
 * Always re-asserts the `__seeded` sentinel and re-sets the absolute TTL —
 * so a write to a previously-unseeded GameWeek naturally promotes it to
 * initialized state, and the TTL stays anchored to the matchday + 90 days.
 *
 * Stays unaware of error policy: callers wrap in try/catch (silent variants)
 * or let throws propagate (Or-Throw variants).
 */
async function writeRsvpField(
  client: RedisLike,
  gameWeekId: string,
  gwStartDate: Date | null,
  field: string,
  value: string | null,
): Promise<void> {
  const k = key(gameWeekId)
  if (value === null) {
    await client.hdel(k, field)
    // Reassert the sentinel so a pure-clear on a fresh hash still marks it
    // initialized. Upstash auto-deletes a hash that becomes empty after HDEL;
    // the HSET below recreates it.
    await client.hset(k, { [SEEDED_FIELD]: SEEDED_VALUE })
  } else {
    await client.hset(k, {
      [SEEDED_FIELD]: SEEDED_VALUE,
      [field]: value,
    })
  }
  await client.expireat(k, computeRsvpExpireAt(gwStartDate))
}

/**
 * Parse a HGETALL result into the (playerSlug → RsvpEntry) map. Skips the
 * `__seeded` sentinel and any field whose suffix doesn't match the schema.
 *
 * Values are coerced via `String()` before being assigned to entry fields:
 * Upstash's REST client auto-parses numeric strings into numbers and
 * `'true'`/`'false'` into booleans. The enum values we store (`'GOING'`,
 * `'JOINED'`) survive round-tripping unchanged, but defensive coercion
 * here protects against future schema additions that store numeric or
 * boolean-shaped data.
 *
 * Pure — exported for unit testing.
 */
export function parseHashFields(raw: Record<string, unknown>): GwRsvpMap {
  const data: GwRsvpMap = new Map()
  for (const [field, value] of Object.entries(raw)) {
    if (field === SEEDED_FIELD) continue
    if (value === undefined || value === null) continue
    const stringValue = String(value)
    if (field.endsWith(RSVP_SUFFIX)) {
      const slug = field.slice(0, -RSVP_SUFFIX.length)
      if (!slug) continue
      const entry = data.get(slug) ?? {}
      entry.rsvp = stringValue as RsvpValue
      data.set(slug, entry)
    } else if (field.endsWith(PARTICIPATED_SUFFIX)) {
      const slug = field.slice(0, -PARTICIPATED_SUFFIX.length)
      if (!slug) continue
      const entry = data.get(slug) ?? {}
      entry.participated = stringValue as ParticipatedValue
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
  _gwStartDate: Date | null,
): Promise<RsvpReadResult> {
  const client = await getClient()
  if (!client) return { status: 'error', reason: 'no-client' }
  let raw: Record<string, unknown> | null
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
  // null in practice, but defensively handle both). The sentinel is
  // compared via `String()` because Upstash's REST client auto-parses the
  // numeric-string `'1'` into the number `1` on read.
  if (!raw || String(raw[SEEDED_FIELD] ?? '') !== SEEDED_VALUE) {
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
  gws: { id: string; startDate: Date | null }[],
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
  gwStartDate: Date | null,
  playerSlug: string,
  rsvp: RsvpValue | null,
): Promise<void> {
  const client = await getClient()
  if (!client) return
  try {
    await writeRsvpField(
      client,
      gameWeekId,
      gwStartDate,
      `${playerSlug}${RSVP_SUFFIX}`,
      rsvp,
    )
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
 * Throwing variant of {@link setRsvp} for v1.8.0 public hot paths.
 *
 * Used by `/api/rsvp` POST where Redis is the canonical write target on the
 * response critical path and the Prisma upsert is deferred via `waitUntil`.
 * A silent Redis failure would leave the user 200-OK with no durable write
 * landing anywhere — the caller needs to surface a 500.
 *
 * No-client (KV env unset / construction failure) is still silent.
 */
export async function setRsvpOrThrow(
  gameWeekId: string,
  gwStartDate: Date | null,
  playerSlug: string,
  rsvp: RsvpValue | null,
): Promise<void> {
  const client = await getClient()
  if (!client) return
  await writeRsvpField(
    client,
    gameWeekId,
    gwStartDate,
    `${playerSlug}${RSVP_SUFFIX}`,
    rsvp,
  )
}

/**
 * Write the participated signal. Same contract as `setRsvp`. Currently no
 * admin endpoint writes this — kept for parity with the Prisma schema and
 * future admin "post-match attendance" workflow.
 */
export async function setParticipated(
  gameWeekId: string,
  gwStartDate: Date | null,
  playerSlug: string,
  participated: ParticipatedValue | null,
): Promise<void> {
  const client = await getClient()
  if (!client) return
  try {
    await writeRsvpField(
      client,
      gameWeekId,
      gwStartDate,
      `${playerSlug}${PARTICIPATED_SUFFIX}`,
      participated,
    )
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
  gwStartDate: Date | null,
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
