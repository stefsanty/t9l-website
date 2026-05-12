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
import { getLeaguePageBundle } from '@/lib/leaguePageData'
import { buildViewerKey } from '@/lib/dashboardCache'
import { getViewer } from '@/lib/viewer'
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
 * v1.99.0 — Suspense streaming. Outer page resolves slug → leagueId
 * (a single cached lookup, ~50 ms warm) and immediately flushes a
 * streaming shell (`<Header>` + `<Suspense>`). The heavy data fetch
 * lives in the async child `LeagueDashboardContents`; the shell
 * paints in ~14–22 ms (browser-measured) while the body streams in.
 *
 * v2.0.0 — Redis-backed dashboard cache. Pre-v2.0.0 the body-stream
 * time was the full Promise.all latency (3–6 s warm on real browser
 * measurements). The page now calls `getLeaguePageBundle(leagueId,
 * viewerKey)` which read-through caches the bundle under
 * `t9l:dash:v<version>:<leagueId>:<viewerKey>` with a 60 s TTL.
 * Repeat viewers render from a single Redis GET (~30–80 ms) instead
 * of re-running the 6-call Promise.all. Cache invalidates
 * automatically via the version-bump chained off
 * `revalidate({ domain })` — no per-call-site change needed.
 *
 * Note on v1.99.0's inline-Promise.all: the inline shape was
 * preserved in v1.99.0 to keep the existing per-call test pins
 * (v167_planned_roster, v166_player_payment, v175_league_details,
 * v184_homepage_phase1a, etc.) green. v2.0.0 migrates to
 * `getLeaguePageBundle` because the Redis cache needs ONE entry
 * point — those tests are updated to assert the new shape.
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
  // non-member visitors.
  //
  // v2.0.0 — viewer resolved up-front via `getViewer()` (v1.98.0
  // shared resolver, request-scoped via React `cache()`) so we can
  // derive a stable cache key for the bundle read. The
  // `touchUserDefaultLeague` call below still needs the raw session
  // (its existing waitUntil-wrapped DB write reads `session.userId`
  // / `session.lineId`); kept as a separate fetch but cheap because
  // it doesn't drive any rendering.
  const viewer = await getViewer()
  const session = viewer.hasSession
    ? await getServerSession(authOptions)
    : null
  touchUserDefaultLeague({
    userId: (session as { userId?: string | null } | null)?.userId ?? null,
    lineId: (session as { lineId?: string | null } | null)?.lineId ?? null,
    leagueId,
  })

  const viewerKey = buildViewerKey({
    userId: viewer.userId,
    lineId: viewer.lineId,
  })

  const bundle = await getLeaguePageBundle(leagueId, viewerKey)
  if (!bundle) {
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

  const nextMd = findNextMatchday(bundle.data.matchdays)

  return (
    <Dashboard
      noHeader
      teams={bundle.data.teams}
      players={bundle.data.players}
      matchdays={bundle.data.matchdays}
      goals={bundle.data.goals}
      availability={bundle.data.availability}
      availabilityStatuses={bundle.data.availabilityStatuses}
      played={bundle.data.played}
      nextMd={nextMd}
      leagueSlug={normalizeLeagueSlug(slug)}
      preseasonMode={bundle.flags.preseasonMode}
      // v1.84.0 — banner gate now reads `visibility === 'PUBLIC_OPEN'`.
      recruiting={bundle.flags.visibility === 'PUBLIC_OPEN'}
      recruitingState={bundle.recruitingState}
      league={bundle.league ?? undefined}
      unpaidFee={bundle.unpaidFee ?? null}
      plannedRosterStats={bundle.plannedRosterStats ?? null}
      leagueDetails={bundle.leagueDetails ?? null}
      guests={bundle.data.guests}
    />
  )
}
