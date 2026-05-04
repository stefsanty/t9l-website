import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { DEFAULT_LEAGUE_SLUG } from '@/lib/leagueSlug'

export const metadata = {
  title: 'Matchday | T9L',
}

type Props = { params: Promise<{ id: string }> }

/**
 * v1.51.0 (PR 2 of the path-routing chain) — legacy matchday route.
 *
 * Pre-v1.51.0 this route rendered the per-matchday Dashboard directly,
 * resolving the league from the host header (subdomain logic).
 * v1.51.0 introduces the canonical path-based form
 * `/league/<slug>/md/<id>`; this legacy route now 308-redirects to it
 * so shared links (Slack, LINE chat, bookmarks) keep working.
 *
 * Resolution strategy:
 *   1. Take the URL matchday id (e.g. `md2`, `MD2`).
 *   2. Lowercase it (matchday ids are canonical lowercase).
 *   3. Find the GameWeek + League the matchday belongs to. We use the
 *      Prisma `gameWeek` table because the public matchday id format is
 *      `md<weekNumber>` per `dbToPublicLeagueData`. Look up by week
 *      number and pick the league whose subdomain (slug) is non-null —
 *      preferring the default league if multiple match (today there is
 *      only one league with public matchdays, so this is unambiguous).
 *   4. Compute the canonical URL `/league/<slug>/md/<id>`.
 *   5. `redirect()` (Next.js issues a 308 by default for server-side
 *      redirects in route handlers and pages).
 *
 * If the matchday cannot be resolved to a league with a slug, return
 * `notFound()` so the user gets the standard 404 page rather than a
 * silent fallback.
 *
 * The redirect is server-side (no client JS needed) so search engines
 * and link previews follow it transparently.
 */
export default async function LegacyMatchdayRedirect({ params }: Props) {
  const { id } = await params
  const idLower = id.toLowerCase()

  // Public matchday id format is `md<weekNumber>` (per
  // dbToPublicLeagueData.ts). Parse the week number out and look up
  // the matching GameWeek + League. There is no leakage risk here —
  // we're already inside a published-route handler.
  const match = idLower.match(/^md(\d+)$/)
  if (!match) {
    notFound()
  }
  const weekNumber = Number(match![1])

  // Find the GameWeek row for this week number across all leagues.
  // Today the prod prod surface has one league with public matchdays;
  // tomorrow with multi-league we prefer the default league's match
  // when there's a tie (legacy /matchday URLs were always default
  // pre-v1.51.0, so default is the conservative default).
  const gameWeeks = await prisma.gameWeek.findMany({
    where: { weekNumber },
    select: {
      leagueId: true,
      league: { select: { isDefault: true, subdomain: true } },
    },
  })

  if (gameWeeks.length === 0) notFound()

  // Prefer the default league when multiple matches; fall back to first.
  const preferred = gameWeeks.find((gw) => gw.league.isDefault) ?? gameWeeks[0]
  const slug = preferred.league.subdomain ?? DEFAULT_LEAGUE_SLUG

  redirect(`/league/${slug}/md/${idLower}`)
}
