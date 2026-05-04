import { notFound } from 'next/navigation'
import Dashboard from '@/components/Dashboard'
import { findNextMatchday } from '@/lib/stats'
import { getLeagueIdBySlug, normalizeLeagueSlug } from '@/lib/leagueSlug'
import { getPublicLeagueData } from '@/lib/publicData'

export const metadata = {
  title: 'Matchday | T9L',
}

type Props = { params: Promise<{ slug: string; id: string }> }

/**
 * v1.51.0 (PR 2 of the path-routing chain) — canonical per-matchday
 * route under the path-based scheme: `/league/<slug>/md/<id>` resolves
 * the league + the matchday in one go and renders the unified
 * `Dashboard` with `initialMatchdayId` pre-selecting the URL matchday
 * (mirrors v1.48.0's homepage convergence: the matchday page IS the
 * Dashboard, not a separate layout). Subsequent navigation (banner
 * swipe / arrow / dot) is local state — the URL is the entry point,
 * not a continuous source of truth.
 *
 * Pre-v1.51.0 the only matchday route was `/matchday/<id>`, which
 * resolved the league via the host header (subdomain logic). v1.51.0
 * makes the legacy route a 308-redirect to this canonical path so old
 * shared links (Slack, LINE chat, bookmarks) keep working.
 *
 * 404s when:
 *   - slug fails format/reserved validation (delegated to `getLeagueIdBySlug`)
 *   - no League row matches the slug
 *   - the matchday id (case-insensitive) doesn't match any matchday in
 *     the resolved league
 */
export default async function LeagueMatchdayPage({ params }: Props) {
  const { slug, id } = await params

  const leagueId = await getLeagueIdBySlug(slug)
  if (!leagueId) notFound()

  let data
  try {
    data = await getPublicLeagueData(leagueId)
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

  // v1.49.1 — case-insensitive matchday-id match. Matchday ids are canonical
  // lowercase (`md1`, `md2`, ...) per `dbToPublicLeagueData`. Users sharing
  // links may type or paste with capital letters (`/league/t9l/md/MD2`,
  // `/league/t9l/md/Md2`); normalize both sides.
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
    />
  )
}
