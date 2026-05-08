import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Dashboard from '@/components/Dashboard'
import { findNextMatchday } from '@/lib/stats'
import { normalizeLeagueSlug } from '@/lib/leagueSlug'
import { getLeagueIdBySlug } from '@/lib/leagueSlugServer'
import { getPublicLeagueData } from '@/lib/publicData'
import { getLeagueFlags } from '@/lib/leagueFlags'
import { getRecruitingViewerState } from '@/lib/recruitingViewerState'
import { getUnpaidFeeBannerData } from '@/lib/unpaidFeeBanner'
import { getPlannedRosterStats } from '@/lib/plannedRosterStats'
import { getLeagueDetails } from '@/lib/leagueDetailsServer'
import { prisma } from '@/lib/prisma'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const leagueId = await getLeagueIdBySlug(slug)
  if (!leagueId) return { title: 'League | T9L' }
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { name: true, abbreviation: true },
  })
  if (!league) return { title: 'League | T9L' }
  const short = league.abbreviation ?? league.name
  return { title: `${short} | ${league.name}` }
}

/**
 * v1.54.0 — canonical per-league route under the security-namespaced form
 * `/id/<slug>`. Replaces the v1.50.0 `/<slug>` short alias and v1.51.0
 * `/league/<slug>` canonical form; both legacy paths are now 308-redirects
 * here so old shared links keep working.
 *
 * Why `/id/`: namespacing every tenant URL under a fixed prefix removes
 * the route-conflict surface entirely. A league slug "admin" no longer
 * threatens to shadow `/admin` (it would just be `/id/admin`); a slug
 * "auth" doesn't collide with `/auth`. The reserved-word policy slims
 * down to a single recursive guard ("id" itself) since every other
 * top-level platform route is a sibling of `/id/`, not a parent.
 *
 * Behaviorally identical to the v1.50.0 `/<slug>` and v1.51.0 `/league/<slug>`
 * pages: resolves the slug to a `League.id` via `getLeagueIdBySlug` (which
 * enforces format + the slim reserved-word policy before hitting the DB)
 * and renders the unified `Dashboard`.
 *
 * 404s when:
 *   - slug fails format validation (uppercase, non-alnum-non-hyphen, etc.)
 *   - slug is reserved (today: 'id' — recursive guard)
 *   - no League row matches the slug
 */
export default async function LeagueByIdPage({ params }: Props) {
  const { slug } = await params

  const leagueId = await getLeagueIdBySlug(slug)
  if (!leagueId) notFound()

  let data
  let flags
  let recruitingState
  let leagueRow
  let unpaidFee
  let plannedRosterStats
  let leagueDetails
  try {
    const [
      _data,
      _flags,
      _recruitingState,
      _leagueRow,
      _unpaidFee,
      _plannedRosterStats,
      _leagueDetails,
    ] = await Promise.all([
      getPublicLeagueData(leagueId),
      getLeagueFlags(leagueId),
      getRecruitingViewerState(leagueId),
      prisma.league.findUnique({
        where: { id: leagueId },
        // v1.82.0 — `ballType` flows into RecruitingBanner so the State D
        // ApplyToLeagueModal renders the right position vocabulary.
        select: { id: true, name: true, abbreviation: true, ballType: true },
      }),
      // v1.66.0 — unpaid-fee banner data; null when banner stays hidden.
      getUnpaidFeeBannerData(leagueId),
      // v1.67.0 — planned-roster panel data. v1.75.5 — threaded
      // unconditionally so the public details panel can render the
      // fee + planned teams + per-team + spots-left mini-section.
      // The panel hides individual rows when value is unset/zero.
      getPlannedRosterStats(leagueId),
      // v1.75.0 — league details panel; v1.75.1 — preseasonMode gate
      // removed; renders on both classic and preseason homepages.
      getLeagueDetails(leagueId),
    ])
    data = _data
    flags = _flags
    recruitingState = _recruitingState
    leagueRow = _leagueRow
    unpaidFee = _unpaidFee
    plannedRosterStats = _plannedRosterStats
    leagueDetails = _leagueDetails
  } catch {
    return (
      <div className="flex items-center justify-center min-h-dvh bg-midnight text-white px-6 text-center">
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

  return (
    <Dashboard
      teams={data.teams}
      players={data.players}
      matchdays={data.matchdays}
      goals={data.goals}
      availability={data.availability}
      availabilityStatuses={data.availabilityStatuses}
      played={data.played}
      nextMd={nextMd}
      leagueSlug={normalizeLeagueSlug(slug)}
      preseasonMode={flags.preseasonMode}
      recruiting={flags.recruiting}
      recruitingState={recruitingState}
      league={leagueRow ?? undefined}
      unpaidFee={unpaidFee ?? null}
      plannedRosterStats={plannedRosterStats ?? null}
      leagueDetails={leagueDetails ?? null}
    />
  )
}
