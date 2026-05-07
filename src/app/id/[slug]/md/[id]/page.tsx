import { notFound } from 'next/navigation'
import Dashboard from '@/components/Dashboard'
import { findNextMatchday } from '@/lib/stats'
import { getLeagueIdBySlug, normalizeLeagueSlug } from '@/lib/leagueSlug'
import { getPublicLeagueData } from '@/lib/publicData'
import { getLeagueFlags } from '@/lib/leagueFlags'
import { getRecruitingViewerState } from '@/lib/recruitingViewerState'
import { getUnpaidFeeBannerData } from '@/lib/unpaidFeeBanner'
import { getPlannedRosterStats } from '@/lib/plannedRosterStats'
import { getLeagueDetails } from '@/lib/leagueDetails'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const metadata = {
  title: 'Matchday | T9L',
}

type Props = { params: Promise<{ slug: string; id: string }> }

/**
 * v1.54.0 — canonical per-matchday route under the security-namespaced
 * form `/id/<slug>/md/<id>`. Replaces the v1.51.0 `/league/<slug>/md/<id>`
 * canonical form (308-redirect from the legacy URL preserves old links).
 *
 * Resolves the league via `getLeagueIdBySlug`, case-insensitively matches
 * the matchday id against the league's matchdays, and renders the unified
 * `Dashboard` with `initialMatchdayId` pre-selecting the URL matchday.
 *
 * Subsequent navigation (banner swipe / arrow / dot) is local state —
 * the URL is the entry point, not a continuous source of truth.
 *
 * 404s when:
 *   - slug fails format/reserved validation (delegated to `getLeagueIdBySlug`)
 *   - no League row matches the slug
 *   - the matchday id (case-insensitive) doesn't match any matchday in
 *     the resolved league
 */
export default async function LeagueByIdMatchdayPage({ params }: Props) {
  const { slug, id } = await params

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
      session,
    ] = await Promise.all([
      getPublicLeagueData(leagueId),
      getLeagueFlags(leagueId),
      getRecruitingViewerState(leagueId),
      prisma.league.findUnique({
        where: { id: leagueId },
        select: { id: true, name: true },
      }),
      // v1.66.0 — unpaid-fee banner data; null when banner stays hidden.
      getUnpaidFeeBannerData(leagueId),
      // v1.67.0 — planned-roster panel; auth + flag gates resolved below.
      getPlannedRosterStats(leagueId),
      // v1.75.0 — league details panel; preseasonMode gate resolved below.
      getLeagueDetails(leagueId),
      getServerSession(authOptions),
    ])
    data = _data
    flags = _flags
    recruitingState = _recruitingState
    leagueRow = _leagueRow
    unpaidFee = _unpaidFee
    const userId = (session as { userId?: string | null } | null)?.userId ?? null
    // v1.75.1 — preseasonMode gate removed; leagueDetails renders on
    // both classic and preseason homepages when showLeagueDetails=true.
    // plannedRosterStats gate relaxed to userId + recruiting only.
    plannedRosterStats =
      userId && flags.recruiting ? _plannedRosterStats : null
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

  // Case-insensitive matchday-id match — matchday ids are canonical
  // lowercase (`md1`, `md2`, ...) per `dbToPublicLeagueData`, but
  // shared links may carry uppercase variants (`/id/t9l/md/MD2`).
  const idLower = id.toLowerCase()
  const md = data.matchdays.find((m) => m.id.toLowerCase() === idLower)
  if (!md) notFound()

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
      initialMatchdayId={md.id}
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
