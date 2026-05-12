import LeagueMatchdayClient from './LeagueMatchdayClient'
import { getPublicLeagueData } from '@/lib/publicData'
import { getLeagueFlags } from '@/lib/leagueFlags'
import { getRecruitingViewerState } from '@/lib/recruitingViewerState'
import { getLeagueDetails } from '@/lib/leagueDetailsServer'
import { getPlannedRosterStats } from '@/lib/plannedRosterStats'
import { findNextMatchday } from '@/lib/stats'
import { normalizeLeagueSlug } from '@/lib/leagueSlug'

/**
 * v2.1.0 — server component owning the MATCHDAY section of `/id/<slug>`.
 *
 * Wraps the heavy `getPublicLeagueData` read (which fans out to Redis
 * for RSVP signals on every active GameWeek) in its own Suspense
 * boundary. Banner-related fetches are NOT awaited here — those live
 * in `<LeagueBannersBlock>`, which sits in a sibling boundary on the
 * page. Splitting them is the v2.1.0 win: each block paints as soon
 * as its own data resolves, instead of both waiting on the slowest
 * common Promise.all.
 *
 * Calls into shared caches alongside `<LeagueBannersBlock>`:
 *   - `getLeagueFlags` and `getLeagueDetails` are `unstable_cache`
 *     -wrapped under the `leagues` tag — second call inside the same
 *     request is a memory hit.
 *   - `getRecruitingViewerState` reuses `getViewer()`'s request-scoped
 *     `cache()` — second call is one Prisma round-trip (the per-league
 *     `leagueAssignments` query).
 *   - `getPlannedRosterStats` is read here too so the in-season
 *     LeagueDetailsPanel slot (rendered INSIDE ClassicLeagueHomepage in
 *     non-preseason mode) receives the same data the banner-side
 *     preseason panel would.
 *
 * On read failure, returns the same `<DataUnavailable>` surface the
 * v1.99.0 `<LeagueDashboardContents>` used so the matchday region
 * degrades gracefully without taking down the banner boundary.
 */
export default async function LeagueMatchdayContent({
  leagueId,
  slug,
}: {
  leagueId: string
  slug: string
}) {
  let data
  let flags
  let recruitingState
  let leagueDetails
  let plannedRosterStats
  try {
    ;[data, flags, recruitingState, leagueDetails, plannedRosterStats] =
      await Promise.all([
        getPublicLeagueData(leagueId),
        getLeagueFlags(leagueId),
        getRecruitingViewerState(leagueId),
        getLeagueDetails(leagueId),
        getPlannedRosterStats(leagueId),
      ])
  } catch {
    return (
      <div
        data-testid="matchday-data-unavailable"
        className="flex items-center justify-center min-h-[40vh] text-white px-6 text-center"
      >
        <div>
          <p className="font-display text-3xl font-black uppercase text-white/80 mb-2">
            Data unavailable
          </p>
          <p className="text-sm text-white/80 font-bold uppercase tracking-widest">
            Try again in a moment
          </p>
        </div>
      </div>
    )
  }

  const nextMd = findNextMatchday(data.matchdays)
  const ballType = flags.league?.ballType ?? leagueDetails?.ballType ?? null

  return (
    <LeagueMatchdayClient
      teams={data.teams}
      players={data.players}
      matchdays={data.matchdays}
      goals={data.goals}
      availability={data.availability}
      availabilityStatuses={data.availabilityStatuses}
      played={data.played}
      guests={data.guests}
      nextMd={nextMd}
      leagueSlug={normalizeLeagueSlug(slug)}
      preseasonMode={flags.preseasonMode}
      ballType={ballType}
      recruitingState={recruitingState}
      leagueDetails={leagueDetails ?? null}
      plannedRosterStats={plannedRosterStats ?? null}
    />
  )
}
