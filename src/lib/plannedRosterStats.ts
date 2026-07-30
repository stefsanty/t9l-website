/**
 * v1.67.0 — Compute the planned-roster stats panel data for a given
 * league.
 *
 * Reads the three planned fields from `League` plus a count of every
 * `PlayerLeagueMembership` row tied to the league (active and pending,
 * any onboarding state) — the user wants "current players: N" to
 * include PENDING applications so the recruiting funnel feels real.
 *
 * The auth gate lives at the consumer layer (page.tsx threads the
 * resolved `userId` and the panel only renders when truthy). This
 * helper is purely data — `null` return means "no panel" for one of
 * three reasons: catastrophic config (no league row), zero auth on
 * the page-level boundary, or league has no preseason flags set
 * (caller may decide not to call this).
 *
 * Caller policy:
 *   - Only call when `preseasonMode === true` AND `recruiting === true`
 *     (the panel sits between RecruitingBanner and CompressedMatchdaySchedule
 *     in the same UI region).
 *   - Auth-gate at the page-level by skipping the call when `userId` is
 *     null. The panel is only useful to authenticated viewers; others
 *     get the recruiting CTA instead.
 *
 * Returns:
 *   - `plannedPlayersPerTeam`, `plannedNumberOfTeams` — 0 means "not set",
 *     the renderer hides those rows.
 *   - `currentPlayers` — count of all `PlayerLeagueMembership.leagueId`
 *     rows where toGameWeek is null (active or pending). Includes both
 *     APPROVED and PENDING — the spec says PENDING should count.
 *   - `spotsLeft` — `max(0, plannedTeams * plannedPerTeam - currentPlayers)`.
 *     Floored at 0 so an over-recruited league reads "0 left" not negative.
 *   - `registrationDeadline` — UTC instant or null.
 */
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'

export interface PlannedRosterPositionFee {
  position: string
  fee: number
}

export interface PlannedRosterStats {
  plannedPlayersPerTeam: number
  plannedNumberOfTeams: number
  currentPlayers: number
  spotsLeft: number
  registrationDeadline: Date | null
  /**
   * v1.67.1 — League-level fee surfaced in the panel so prospective
   * members understand the cost before applying. Always populated;
   * the renderer hides the fee row when `defaultFee === 0` AND
   * `positionFees.length === 0`.
   */
  defaultFee: number
  /**
   * v1.67.1 — Non-default per-position fees only. Rows whose fee
   * matches `defaultFee` are filtered out so the renderer only shows
   * positions that diverge (the typical "GK pays more" case). Sorted
   * by position string for deterministic render order.
   */
  positionFees: PlannedRosterPositionFee[]
  /** v1.75.6 — Total number of GameWeek rows for this league. */
  matchdays: number
}

/**
 * v2.4.0 — deliberately does NOT catch. A Prisma failure must propagate out
 * of the `unstable_cache` wrapper so the failure is not what gets stored:
 * `unstable_cache` persists resolved values only, so a rejection leaves the
 * entry empty and the very next request retries. The `null`-on-missing-row
 * return below IS a legitimate cacheable result. The public
 * `getPlannedRosterStats` wrapper restores the never-throws contract.
 */
async function readPlannedRosterStats(
  leagueId: string,
): Promise<PlannedRosterStats | null> {
  if (process.env.DEBUG_CACHE_MISS === '1') {
    // Fires only on a genuine cache miss (this body does not run on a hit),
    // so it is the verification handle for the v2.4.0 caching work: it
    // should appear roughly once per league per TTL window or per tag bust,
    // NOT once per request. Off unless the env var is explicitly set.
    console.log('[plannedRosterStats] cache miss leagueId=%s', leagueId)
  }
  const [league, currentPlayers, matchdays] = await Promise.all([
    prisma.league.findUnique({
      where: { id: leagueId },
      select: {
        plannedPlayersPerTeam: true,
        plannedNumberOfTeams: true,
        registrationDeadline: true,
        defaultFee: true,
        positionFees: {
          select: { position: true, fee: true },
        },
      },
    }),
    // Active memberships only (toGameWeek = null). Includes PENDING
    // applications, per the spec. v1.87.0 — exclude retired
    // memberships (retiredAt non-null) from the roster count; retired
    // players keep their slot for stats but no longer consume a
    // "spots left" slot.
    prisma.playerLeagueMembership.count({
      where: {
        OR: [
          { leagueId },
          { leagueTeam: { leagueId } },
        ],
        toGameWeek: null,
        retiredAt: null,
      },
    }),
    prisma.gameWeek.count({ where: { leagueId } }),
  ])
  if (!league) return null
  const plannedTotal = league.plannedNumberOfTeams * league.plannedPlayersPerTeam
  const spotsLeft = Math.max(0, plannedTotal - currentPlayers)
  // Only surface positions whose fee diverges from defaultFee — a
  // row matching the default is informational noise. Sort by position
  // for deterministic UI order across renders.
  const positionFees = league.positionFees
    .filter((p) => p.fee !== league.defaultFee)
    .map((p) => ({ position: p.position, fee: p.fee }))
    .sort((a, b) => a.position.localeCompare(b.position))
  return {
    plannedPlayersPerTeam: league.plannedPlayersPerTeam,
    plannedNumberOfTeams: league.plannedNumberOfTeams,
    currentPlayers,
    spotsLeft,
    registrationDeadline: league.registrationDeadline,
    defaultFee: league.defaultFee,
    positionFees,
    matchdays,
  }
}

/**
 * v2.4.0 (Neon awake-time reduction, step 2) — cached.
 *
 * Pre-v2.4.0 this helper was fully uncached, so every render of the apex
 * hub, `/id/<slug>`, `/id/<slug>/join` and `/id/<slug>/md/<id>` fired
 * three Prisma queries (League + positionFees join, PLM count, GameWeek
 * count). The Neon diagnostic session identified it as the single
 * biggest contributor to compute-awake time: it is on every public page,
 * it runs for anonymous viewers, and nothing about it is per-session.
 *
 * Every field it returns is league-level configuration or a roster
 * count — all of it already invalidated by `revalidate({ domain })` on
 * the admin writes that can change it (league settings, membership
 * approve/retire, schedule edits) via the canonical `'leagues'` tag. So
 * the TTL is pure belt-and-suspenders and can be generous.
 *
 * TTL is 900 s, deliberately longer than the Neon branch's 300 s
 * autosuspend window: a TTL at or below the suspend timeout means a steady
 * trickle of stale-refresh reads that re-wakes compute before it can ever
 * suspend, which is exactly the failure mode this change is fixing.
 *
 * Note there is no separate anon early-return: the data is identical for
 * anonymous and authenticated viewers (the auth gate is purely a render
 * decision at the consumer layer), so a single shared cache entry per
 * league serves everyone and gets the maximum hit rate.
 *
 * The try/catch sits OUTSIDE the cache wrapper, not inside the reader. That
 * ordering is load-bearing at a 900s TTL: if the reader swallowed its own
 * Prisma errors and returned `null`, that `null` would be a resolved value
 * and would be cached — one transient Neon blip would hide the panel for a
 * full 15 minutes. Letting the rejection escape the wrapper leaves the
 * entry unwritten, so the next request retries. `null` from a genuinely
 * missing League row still caches, which is correct.
 */
const getPlannedRosterStatsCached = unstable_cache(
  readPlannedRosterStats,
  ['planned-roster-stats'],
  { revalidate: 900, tags: ['public-data', 'leagues'] },
)

export async function getPlannedRosterStats(
  leagueId: string,
): Promise<PlannedRosterStats | null> {
  try {
    return await getPlannedRosterStatsCached(leagueId)
  } catch (err) {
    console.warn('[plannedRosterStats] read failed:', err)
    return null
  }
}

// Test seam — exposes the uncached implementation for unit tests.
// Production code goes through `getPlannedRosterStats`.
export const __readPlannedRosterStats_for_testing = readPlannedRosterStats
