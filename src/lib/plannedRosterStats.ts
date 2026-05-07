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

export async function getPlannedRosterStats(
  leagueId: string,
): Promise<PlannedRosterStats | null> {
  try {
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
      // applications, per the spec.
      prisma.playerLeagueMembership.count({
        where: {
          OR: [
            { leagueId },
            { leagueTeam: { leagueId } },
          ],
          toGameWeek: null,
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
  } catch (err) {
    console.warn('[plannedRosterStats] read failed:', err)
    return null
  }
}
