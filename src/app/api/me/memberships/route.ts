import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { DEFAULT_LEAGUE_SLUG } from '@/lib/leagueSlug'

/**
 * v1.52.0 (PR 3 of the path-routing chain) — returns the signed-in
 * user's league memberships for the header league switcher + the
 * account-menu "Switch league" entry.
 *
 * Auth resolution (in priority order):
 *   1. session.userId (canonical post-stage-α.5 / v1.28.0+)
 *   2. session.lineId → Player.lineId (legacy fallback)
 *
 * Returns `{ memberships: [{ leagueId, name, slug, isCurrent }] }` —
 * dedup'd by leagueId (a player with multiple PlayerLeagueAssignments
 * across timespans in the same league surfaces as one row). Sorted by
 * league name. The `slug` is the path slug (today: `League.subdomain`,
 * may be renamed to `slug` in PR 4); falls back to
 * `DEFAULT_LEAGUE_SLUG` for the default league when its subdomain
 * column is null. `isCurrent` is true for the league the session was
 * resolved against (session.leagueId).
 *
 * Returns 200 with `{ memberships: [] }` for unauthenticated, unlinked,
 * or admin-credentials sessions — the league switcher just hides the
 * dropdown when the list is empty or has fewer than 2 entries.
 *
 * Lazy-loaded by the client component on dropdown open, NOT included
 * in every JWT callback — keeps the auth hot path tight.
 */
export async function GET() {
  const session = await getServerSession(authOptions)

  if (!session) {
    return NextResponse.json({ memberships: [] })
  }

  const playerLookup = session.userId
    ? { userId: session.userId }
    : session.lineId
      ? { lineId: session.lineId }
      : null

  if (!playerLookup) {
    return NextResponse.json({ memberships: [] })
  }

  const player = await prisma.player.findFirst({
    where: playerLookup,
    select: {
      leagueAssignments: {
        select: {
          leagueTeam: {
            select: {
              league: {
                select: {
                  id: true,
                  name: true,
                  subdomain: true,
                  isDefault: true,
                },
              },
            },
          },
        },
      },
    },
  })

  if (!player) {
    return NextResponse.json({ memberships: [] })
  }

  const seen = new Map<
    string,
    { leagueId: string; name: string; slug: string; isCurrent: boolean }
  >()

  for (const assignment of player.leagueAssignments) {
    const league = assignment.leagueTeam.league
    if (seen.has(league.id)) continue
    const slug = league.subdomain ?? (league.isDefault ? DEFAULT_LEAGUE_SLUG : null)
    if (!slug) continue
    seen.set(league.id, {
      leagueId: league.id,
      name: league.name,
      slug,
      isCurrent: session.leagueId === league.id,
    })
  }

  const memberships = Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name))

  return NextResponse.json({ memberships })
}
