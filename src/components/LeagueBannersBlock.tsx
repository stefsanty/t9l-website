import dynamic from 'next/dynamic'
import RecruitingBanner from './RecruitingBanner'
import UnpaidFeeBanner from './UnpaidFeeBanner'
import RegistrationCountdown from './RegistrationCountdown'
import { getLeagueFlags } from '@/lib/leagueFlags'
import { getRecruitingViewerState } from '@/lib/recruitingViewerState'
import { getUnpaidFeeBannerData } from '@/lib/unpaidFeeBanner'
import { getPlannedRosterStats } from '@/lib/plannedRosterStats'
import { getLeagueDetails } from '@/lib/leagueDetailsServer'

const LeagueDetailsPanel = dynamic(() => import('./LeagueDetailsPanel'))
const PlannedRosterStats = dynamic(() => import('./PlannedRosterStats'))

/**
 * v2.1.0 — server component owning the BANNER strip of `/id/<slug>`.
 *
 * Pre-v2.1.0 (v1.99.0) the whole dashboard body — banners AND matchday
 * content — sat behind a single `<Suspense>` gated on the slowest call
 * in the 7-fetch `Promise.all` (`getPublicLeagueData`, the Redis-RSVP
 * fanout). Even though every banner-related fetch is cheap (cached
 * `getLeagueFlags` / `getLeagueDetails`, request-scoped
 * `getRecruitingViewerState`, lean `plm.findFirst` / `league.findUnique`
 * for unpaid fees + planned roster), the user saw a single skeleton
 * until the heavy call resolved.
 *
 * This component fetches ONLY banner-related data — five concurrent
 * lightweight reads, none of which touch the RSVP/matchday workload —
 * and renders the banner widgets directly. Wrapped in its own
 * `<Suspense fallback={<LeagueBannersSkeleton />}>` in the page shell,
 * it streams in as a first wave well before the matchday content.
 *
 * Caching notes:
 *   - `getLeagueFlags` and `getLeagueDetails` are both `unstable_cache`
 *     -wrapped under the `leagues` tag — calling them again from
 *     `<LeagueMatchdayContent>` hits the same cache entries.
 *   - `getRecruitingViewerState` uses React `cache()` (request-scoped)
 *     via `getViewer()` — calling it twice in the same render is one
 *     Prisma round-trip.
 *   - `getUnpaidFeeBannerData` and `getPlannedRosterStats` are per-
 *     league reads that only run inside this boundary.
 */
export default async function LeagueBannersBlock({
  leagueId,
  leagueSlug,
  forceRecruitingBanner = false,
  showPrivateJoinIndicator = false,
}: {
  leagueId: string
  leagueSlug: string
  forceRecruitingBanner?: boolean
  showPrivateJoinIndicator?: boolean
}) {
  let flags
  let recruitingState
  let unpaidFee
  let plannedRosterStats
  let leagueDetails
  try {
    ;[flags, recruitingState, unpaidFee, plannedRosterStats, leagueDetails] =
      await Promise.all([
        getLeagueFlags(leagueId),
        getRecruitingViewerState(leagueId),
        getUnpaidFeeBannerData(leagueId),
        getPlannedRosterStats(leagueId),
        getLeagueDetails(leagueId),
      ])
  } catch {
    // Banner-level read failure shouldn't fail the page — the matchday
    // boundary streams independently and surfaces its own error UI.
    // Hide banners silently.
    return null
  }

  const league = flags.league
  const recruiting = flags.visibility === 'PUBLIC_OPEN'
  const preseasonMode = flags.preseasonMode
  const showRecruitingBanner =
    (recruiting || forceRecruitingBanner) && league && recruitingState

  return (
    <div data-testid="league-banners-block">
      <UnpaidFeeBanner data={unpaidFee ?? null} />
      {showPrivateJoinIndicator && (
        <div
          className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-surface-md/80 border border-border-default px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-fg-mid"
          data-testid="private-join-indicator"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-fg-mid" />
          Private join link
        </div>
      )}
      {showRecruitingBanner && league && recruitingState && (
        <RecruitingBanner
          league={league}
          viewer={recruitingState}
          leagueSlug={leagueSlug}
          forceRecruitingBanner={forceRecruitingBanner}
        />
      )}
      {preseasonMode && (
        <RegistrationCountdown
          registrationDeadline={plannedRosterStats?.registrationDeadline ?? null}
        />
      )}
      {preseasonMode &&
        (leagueDetails ? (
          <LeagueDetailsPanel
            data={leagueDetails}
            plannedRosterStats={plannedRosterStats}
            preseasonMode={preseasonMode}
          />
        ) : (
          plannedRosterStats && <PlannedRosterStats data={plannedRosterStats} />
        ))}
    </div>
  )
}
