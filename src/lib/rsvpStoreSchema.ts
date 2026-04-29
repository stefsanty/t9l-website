/**
 * Shared schema constants for the RSVP Redis store. Pure values + the TTL
 * math; no I/O, no side-effect imports. Importable from `src/lib/rsvpStore.ts`
 * (the runtime read/write path) and from
 * `scripts/backfillRedisRsvpFromPrisma.ts` (the recovery script). Keeping
 * them in one file means the store and the recovery script can never drift
 * on prefix / sentinel / TTL math.
 *
 * See `lib/rsvpStore.ts` for the full architectural docstring (PR 19 /
 * v1.7.0). This file only carries the literals.
 */

export const RSVP_KEY_PREFIX = 't9l:rsvp:gw:'
export const RSVP_SEEDED_FIELD = '__seeded'
export const RSVP_SEEDED_VALUE = '1'
export const RSVP_FIELD_SUFFIX = ':rsvp'
export const PARTICIPATED_FIELD_SUFFIX = ':p'
export const RSVP_TTL_DAYS_AFTER_MATCH = 90

/**
 * Compute the absolute Unix timestamp (seconds) at which a GameWeek's RSVP
 * hash should expire.
 *
 * `max(gwStartDate, now) + RSVP_TTL_DAYS_AFTER_MATCH`. Past matchdays anchor
 * on the matchday itself (so MD1 expires ~90 days after MD1 happened, not 90
 * days after we last wrote to it); future matchdays anchor on now (the RSVP
 * started flowing today, so the 90-day clock runs from today even if the
 * match itself is months away — uses the longer of the two windows
 * implicitly via the `max`).
 */
export function computeRsvpExpireAt(
  gwStartDate: Date,
  now: Date = new Date(),
): number {
  const base = Math.max(gwStartDate.getTime(), now.getTime())
  const expireMs = base + RSVP_TTL_DAYS_AFTER_MATCH * 24 * 60 * 60 * 1000
  return Math.floor(expireMs / 1000)
}
