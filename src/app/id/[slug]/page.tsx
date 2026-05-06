import { notFound } from 'next/navigation'
import Dashboard from '@/components/Dashboard'
import { findNextMatchday } from '@/lib/stats'
import { getLeagueIdBySlug, normalizeLeagueSlug } from '@/lib/leagueSlug'
import { getPublicLeagueData } from '@/lib/publicData'
import { getLeagueFlags } from '@/lib/leagueFlags'
import { getRecruitingViewerState } from '@/lib/recruitingViewerState'
import { getUnpaidFeeBannerData } from '@/lib/unpaidFeeBanner'
import { prisma } from '@/lib/prisma'

export const metadata = {
  title: 'League | T9L',
}

type Props = { params: Promise<{ slug: string }> }

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
  try {
    ;[data, flags, recruitingState, leagueRow, unpaidFee] = await Promise.all([
      getPublicLeagueData(leagueId),
      getLeagueFlags(leagueId),
      getRecruitingViewerState(leagueId),
      prisma.league.findUnique({
        where: { id: leagueId },
        select: { id: true, name: true },
      }),
      // v1.66.0 — unpaid-fee banner data; null when banner stays hidden.
      getUnpaidFeeBannerData(leagueId),
    ])
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
    />
  )
}
