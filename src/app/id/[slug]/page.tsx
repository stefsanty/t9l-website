import type { Metadata } from 'next'
import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { getServerSession } from 'next-auth'
import Header from '@/components/Header'
import LeagueBannersBlock from '@/components/LeagueBannersBlock'
import LeagueBannersSkeleton from '@/components/LeagueBannersSkeleton'
import LeagueMatchdayContent from '@/components/LeagueMatchdayContent'
import LeagueMatchdayContentSkeleton from '@/components/LeagueMatchdayContentSkeleton'
import SuccessConfirmationGate from '@/components/SuccessConfirmationGate'
import { authOptions } from '@/lib/auth'
import { getLeagueIdBySlug } from '@/lib/leagueSlugServer'
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
 * v1.99.0 — Suspense streaming (single boundary). Pre-v1.99.0 the whole
 * page rendered as one async function that awaited a 7-call
 * `Promise.all` BEFORE flushing any HTML. v1.99.0 hoisted the shell
 * `<Header>` and wrapped the bundle in a single `<Suspense>` so the
 * header + LeagueSwitcher chevron painted in ~50 ms while the bundle
 * resolved over the next 4-6 s warm / 10 s cold. User feedback:
 * with one `<Suspense>` the whole body still flips in one go and a
 * single `animate-pulse` skeleton was easy to miss.
 *
 * v2.1.0 — multi-boundary streaming. The body is now split into two
 * independent Suspense regions that paint as soon as THEIR data
 * resolves:
 *
 *   1. `<LeagueBannersBlock>` (fast wave) — five lightweight reads
 *      (cached `getLeagueFlags` / `getLeagueDetails`,
 *      request-scoped `getRecruitingViewerState`, lean
 *      `getUnpaidFeeBannerData` + `getPlannedRosterStats`). Skeleton
 *      paints with a `<LoadingSpinner>` so the user sees an
 *      unmistakeable rotating cue alongside the pulse.
 *
 *   2. `<LeagueMatchdayContent>` (slow wave) — wraps the
 *      `getPublicLeagueData` Redis fanout. Owns the matchday
 *      `selectedMatchdayId` state + RsvpBar. Skeleton mirrors the
 *      ClassicLeagueHomepage footprint with a centred spinner inside
 *      the matchday card.
 *
 * The page-level `<Header>` (with the live `<LeagueSwitcher>`
 * chevron + interactive pill bar — memberships come from
 * `<MembershipsProvider>` seeded by `app/layout.tsx`) is still hoisted
 * above all Suspense boundaries so it paints with the slug → leagueId
 * resolution (~50 ms warm). `touchUserDefaultLeague` runs at the page
 * level (it's `waitUntil`-wrapped, can't block streaming) and
 * `<SuccessConfirmationGate>` sits at the bottom of the shell.
 *
 * The `.animate-in` fade wrapper from `<Dashboard>` is intentionally
 * NOT used here: the Suspense fallback → resolved swap is the visual
 * transition for each section, and `.animate-in`'s `transform`
 * keyframe would establish a containing block for `<RsvpBar>`'s
 * `position: fixed` bottom anchor (the v1.63.1 bug). RsvpBar lives
 * inside the matchday client component as a sibling of the matchday
 * surface, with no transformed ancestor between it and the viewport.
 *
 * Behaviorally identical to v1.99.0: 404s on slug format / reserved
 * recursive guard / missing League row; same DataUnavailable surface
 * on Prisma blip; same metadata.
 */
export default async function LeagueByIdPage({ params }: Props) {
  const { slug } = await params

  const leagueId = await getLeagueIdBySlug(slug)
  if (!leagueId) notFound()

  // v2.2.13 — fetch URL-scoped league fields so the header title +
  // self-link button reflect THIS league, not the session's default
  // league. Pre-v2.2.13 the page passed `leagueTitle={null}`, which
  // forced Header to its hardcoded fallback ("T9L '26 春"), and the
  // self-link button read `session.allowSelfLink` — computed in the JWT
  // callback against `getDefaultLeagueId()` (the default tenant), not
  // the URL slug. Mirrors the v2.2.5 cross-league scoping pattern.
  const leagueForHeader = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { name: true, abbreviation: true, allowSelfLink: true },
  })
  const headerTitle =
    leagueForHeader?.abbreviation ?? leagueForHeader?.name ?? null
  const headerAllowSelfLink = leagueForHeader?.allowSelfLink ?? true

  // v1.85.0 — last-selected league tracker. Fire-and-forget write
  // (wrapped in `waitUntil` inside the helper). v2.1.0 — moved to the
  // page-level (was inside the v1.99.0 LeagueDashboardContents child)
  // so it doesn't sit behind either Suspense boundary. Cheap path —
  // short-circuits when the league is already the user's default.
  const session = await getServerSession(authOptions)
  touchUserDefaultLeague({
    userId: (session as { userId?: string | null } | null)?.userId ?? null,
    lineId: (session as { lineId?: string | null } | null)?.lineId ?? null,
    leagueId,
  })

  return (
    <>
      <Header
        leagueTitle={headerTitle}
        hideStatsLink={false}
        allowSelfLinkOverride={headerAllowSelfLink}
      />
      <div className="flex flex-col min-h-dvh pb-0 max-w-lg mx-auto bg-background selection:bg-vibrant-pink selection:text-white">
        <main className="flex-1 px-4 relative z-10 pt-12 pb-2">
          <div data-testid="dashboard-body" className="pt-2">
            <Suspense fallback={<LeagueBannersSkeleton />}>
              <LeagueBannersBlock leagueId={leagueId} leagueSlug={slug} />
            </Suspense>
            <Suspense fallback={<LeagueMatchdayContentSkeleton />}>
              <LeagueMatchdayContent leagueId={leagueId} slug={slug} />
            </Suspense>
          </div>
        </main>
        <footer className="mt-3 mb-0 text-center px-4 pb-2">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-fg-low">
            © 2026 Tennozu 9-Aside League • Tokyo
          </p>
        </footer>
      </div>
      <SuccessConfirmationGate />
    </>
  )
}
