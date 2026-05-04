import { notFound } from 'next/navigation'
import Dashboard from '@/components/Dashboard'
import { findNextMatchday } from '@/lib/stats'
import { getLeagueIdBySlug, normalizeLeagueSlug } from '@/lib/leagueSlug'
import { getPublicLeagueData } from '@/lib/publicData'

export const metadata = {
  title: 'League | T9L',
}

type Props = { params: Promise<{ slug: string }> }

/**
 * v1.50.0 (PR 1 of the path-routing chain) — short-alias dynamic route.
 * `/<slug>` is the user-friendly form of `/league/<slug>` (e.g. `/t9l`
 * for the default league instead of `/league/t9l`). Both forms render
 * the same `Dashboard` and resolve through the same `getLeagueIdBySlug`
 * helper.
 *
 * Next.js's static-segments-win-over-dynamic rule means this catch-all
 * never fires for `/admin`, `/auth`, `/join`, `/matchday`, `/api`,
 * `/account`, `/league`, `/schedule`, `/stats`, `/assign-player`,
 * `/auth-error`, or `/dev-login` — those have their own route files.
 * `getLeagueIdBySlug` additionally rejects reserved slugs at the data
 * layer (defense in depth) so a future top-level route never collides
 * with a malformed pre-existing League row that holds the same slug.
 *
 * 404s on:
 *   - reserved-word slug (rejected by `validateLeagueSlug`)
 *   - malformed slug (uppercase, non-alnum-non-hyphen, too short, etc.)
 *   - no League row matches the slug
 *
 * Apex `/` keeps its dedicated `app/page.tsx` — it renders the default
 * league directly without going through this slug-resolution path, so
 * the home URL is byte-equivalent before/after this PR.
 */
export default async function LeagueShortAliasPage({ params }: Props) {
  const { slug } = await params

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
    />
  )
}
