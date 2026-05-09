import type { Metadata } from 'next'
import LeagueDirectory from '@/components/homepage/LeagueDirectory'
import { getDirectoryLeagues } from '@/lib/leagueDirectoryData'

/**
 * v1.85.0 — homepage redesign phase 1b. Dedicated directory URL.
 *
 * The same `<LeagueDirectory>` surface that `<HomepageRouter>` mounts
 * for the unauthenticated / no-memberships persona, also reachable via
 * a stable URL so it can be linked, bookmarked, and shared
 * independently of the persona-routing decision at `/test`.
 *
 * Authenticated users with memberships who hit this URL still see the
 * directory — the page deliberately doesn't redirect them away. The
 * directory IS a discovery surface, and an existing member may want to
 * browse other leagues without going through the apex hub.
 */
export const metadata: Metadata = {
  title: 'League Directory | T9L',
}

export default async function DirectoryPage() {
  const leagues = await getDirectoryLeagues()
  return <LeagueDirectory leagues={leagues} />
}
