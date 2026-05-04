import { notFound } from 'next/navigation'
import Dashboard from '@/components/Dashboard'
import { findNextMatchday } from '@/lib/stats'
import { getLeagueIdBySlug } from '@/lib/leagueSlug'
import { getPublicLeagueData } from '@/lib/publicData'

export const metadata = {
  title: 'League | T9L',
}

type Props = { params: Promise<{ slug: string }> }

/**
 * v1.50.0 (PR 1 of the path-routing chain) — explicit per-league entry
 * point. `/league/[slug]` resolves the slug to a `League.id` via
 * `getLeagueIdBySlug` (which enforces format + reserved-word validation
 * before hitting the DB) and renders the same `Dashboard` the apex serves.
 *
 * Pre-v1.50.0 the league context for a request came from the host header
 * (`getLeagueIdFromRequest()`); v1.22.0–v1.26.0 wired multi-tenant via
 * subdomains. v1.50.0 starts the migration to path-based routing — the
 * apex `/` keeps rendering the default league (no redirect — the user
 * decided the apex IS an alias for the default league), `/league/[slug]`
 * is the canonical per-league URL, and `/[slug]` is the short alias for
 * any non-reserved slug. PR 4 (v1.53.0) tears down the subdomain
 * infrastructure once all callers have migrated.
 *
 * 404s when the slug is reserved, malformed, or doesn't match a League
 * row. The apex's "Data unavailable" surface is reused for transient
 * Prisma failures so admins get the same operational shape regardless of
 * how the league was reached.
 */
export default async function LeagueBySlugPage({ params }: Props) {
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
    />
  )
}
