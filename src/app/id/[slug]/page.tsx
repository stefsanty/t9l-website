import type { Metadata } from 'next'
import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { getServerSession } from 'next-auth'
import Dashboard from '@/components/Dashboard'
import DashboardBodySkeleton from '@/components/DashboardBodySkeleton'
import Header from '@/components/Header'
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
 * v1.99.0 — Suspense streaming. Pre-v1.99.0 the whole page rendered as
 * a single async function that awaited the heavy `Promise.all` BEFORE
 * flushing any HTML. On the warm path that's 4-6 s of "dead screen" —
 * the user saw nothing until the bundle resolved. On cold (Neon
 * spin-up) it reached 10 s.
 *
 * Post-refactor the page resolves the slug → leagueId (single cached
 * lookup, ~50 ms warm), then immediately flushes a streaming shell:
 *   - `<Header>` with the live `<LeagueSwitcher>` chevron (the v1.97.x
 *     in-place picker — memberships come from `<MembershipsProvider>`
 *     seeded by `app/layout.tsx`, so the chevron is fully interactive
 *     while the body still streams).
 *   - `<Suspense fallback={<DashboardBodySkeleton />}>` around the
 *     heavy-data branch.
 *
 * The async child `LeagueDashboardContents` awaits the existing
 * 7-call `Promise.all` and renders `<Dashboard noHeader />` —
 * Dashboard itself has been taught to skip its built-in Header when
 * this prop is set, so the page-level shell Header is the only Header
 * rendered on this path.
 *
 * `touchUserDefaultLeague` stays inside the async child (it's already
 * `waitUntil`-wrapped, so it can't block streaming either way; keeping
 * it co-located with the bundle keeps the page shell pure).
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

  return (
    <>
      {/* v1.99.0 — shell Header. Title falls back to the brand default
          ("T9L '26 春") because the cached `getLeagueFlags` read still
          lives inside the suspended bundle; awaiting it here would
          delay the shell flush by the same ~150-300 ms it saves. The
          LeagueSwitcher chevron + pill bar are fully interactive
          immediately. */}
      <Header leagueTitle={null} hideStatsLink={false} />
      <Suspense fallback={<DashboardBodySkeleton />}>
        <LeagueDashboardContents slug={slug} leagueId={leagueId} />
      </Suspense>
    </>
  )
}

async function LeagueDashboardContents({
  slug,
  leagueId,
}: {
  slug: string
  leagueId: string
}) {
  // v1.85.0 — last-selected league tracker. Fire-and-forget write
  // (wrapped in `waitUntil` inside the helper) so the user's next
  // visit to the persona-aware apex (`/test`, swap-target `/`) lands
  // on the league they were last looking at. No-op for unauth and
  // non-member visitors. Resolves the session inline because we don't
  // already have it on this path.
  const session = await getServerSession(authOptions)
  touchUserDefaultLeague({
    userId: (session as { userId?: string | null } | null)?.userId ?? null,
    lineId: (session as { lineId?: string | null } | null)?.lineId ?? null,
    leagueId,
  })

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
      noHeader
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
      // v1.84.0 — banner gate now reads `visibility === 'PUBLIC_OPEN'`.
      recruiting={flags.visibility === 'PUBLIC_OPEN'}
      recruitingState={recruitingState}
      league={leagueRow ?? undefined}
      unpaidFee={unpaidFee ?? null}
      plannedRosterStats={plannedRosterStats ?? null}
      leagueDetails={leagueDetails ?? null}
      guests={data.guests}
    />
  )
}
