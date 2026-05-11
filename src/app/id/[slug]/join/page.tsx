import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getServerSession } from 'next-auth'
import Dashboard from '@/components/Dashboard'
import { findNextMatchday } from '@/lib/stats'
import { authOptions } from '@/lib/auth'
import { normalizeLeagueSlug } from '@/lib/leagueSlug'
import { getLeagueIdBySlug } from '@/lib/leagueSlugServer'
import { getPublicLeagueData } from '@/lib/publicData'
import { getLeagueFlags } from '@/lib/leagueFlags'
import { getRecruitingViewerState } from '@/lib/recruitingViewerState'
import { getUnpaidFeeBannerData } from '@/lib/unpaidFeeBanner'
import { getPlannedRosterStats } from '@/lib/plannedRosterStats'
import { getLeagueDetails } from '@/lib/leagueDetailsServer'
import { touchUserDefaultLeague } from '@/lib/userDefaultLeague'
import { prisma } from '@/lib/prisma'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const leagueId = await getLeagueIdBySlug(slug)
  if (!leagueId) return { title: 'Join | T9L' }
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { name: true, abbreviation: true },
  })
  if (!league) return { title: 'Join | T9L' }
  const short = league.abbreviation ?? league.name
  return { title: `Join ${short} | ${league.name}` }
}

/**
 * v1.94.0 — Private join link.
 *
 * Mirrors the standard league page at `/id/<slug>` but forces the
 * recruiting banner ON regardless of `League.visibility`. The route is
 * gated on a new admin-toggleable flag (`League.privateJoinLinkEnabled`)
 * so admins can opt-in per league. When the flag is off, the route
 * 404s.
 *
 * Use case: admin wants to share a discoverable apply-page URL even on
 * PRIVATE or PUBLIC_CLOSED leagues (where the banner would otherwise
 * not auto-mount). Toggle on, share `t9l.me/id/<slug>/join`, recipient
 * lands on the league page with the recruiting banner visible.
 *
 * Security note (surfaced in the v1.94.0 ledger): the URL is
 * slug-based, so anyone who guesses the slug + tries `/join` with the
 * toggle on gets the recruitment page. For PRIVATE leagues this is a
 * real (if low-severity) exposure. A stronger token-based variant
 * (`/id/<slug>/join/<token>`) is documented as a follow-up.
 *
 * `applyToLeague` server action behaviour is unchanged: PRIVATE
 * leagues still return "invitation-only" when the recipient submits;
 * PUBLIC_CLOSED and PUBLIC_OPEN accept self-serve apply. The banner
 * being visible is necessary but not sufficient for application
 * submission on a PRIVATE league.
 */
export default async function PrivateJoinPage({ params }: Props) {
  const { slug } = await params

  const leagueId = await getLeagueIdBySlug(slug)
  if (!leagueId) notFound()

  // Re-fetch the league row up-front so we can 404 on
  // `privateJoinLinkEnabled === false` before paying for the public
  // data + recruiting-state Promise.all. The same row is reused by the
  // body below to feed the RecruitingBanner.
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      name: true,
      abbreviation: true,
      ballType: true,
      privateJoinLinkEnabled: true,
    },
  })
  if (!league || !league.privateJoinLinkEnabled) notFound()

  // Mirror the v1.85.0 touchUserDefaultLeague write so visiting via the
  // join URL still updates the user's last-selected league pin.
  const session = await getServerSession(authOptions)
  touchUserDefaultLeague({
    userId: (session as { userId?: string | null } | null)?.userId ?? null,
    lineId: (session as { lineId?: string | null } | null)?.lineId ?? null,
    leagueId,
  })

  let data
  let flags
  let recruitingState
  let unpaidFee
  let plannedRosterStats
  let leagueDetails
  try {
    const [
      _data,
      _flags,
      _recruitingState,
      _unpaidFee,
      _plannedRosterStats,
      _leagueDetails,
    ] = await Promise.all([
      getPublicLeagueData(leagueId),
      getLeagueFlags(leagueId),
      getRecruitingViewerState(leagueId),
      getUnpaidFeeBannerData(leagueId),
      getPlannedRosterStats(leagueId),
      getLeagueDetails(leagueId),
    ])
    data = _data
    flags = _flags
    recruitingState = _recruitingState
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
      // The standard `/id/<slug>` page passes the live recruiting gate
      // here. On `/join`, the gate is bypassed via `forceRecruitingBanner`
      // below, so we deliberately pass `false` for the visibility-derived
      // value to keep the contract clean (recruiting=false here means
      // "the league's own visibility doesn't enable the banner"; the
      // force flag tells Dashboard to mount it anyway).
      recruiting={flags.visibility === 'PUBLIC_OPEN'}
      forceRecruitingBanner={true}
      showPrivateJoinIndicator={true}
      recruitingState={recruitingState}
      league={league}
      unpaidFee={unpaidFee ?? null}
      plannedRosterStats={plannedRosterStats ?? null}
      leagueDetails={leagueDetails ?? null}
      guests={data.guests}
    />
  )
}
