import { prisma } from '@/lib/prisma'
import { DEFAULT_LEAGUE_SLUG } from '@/lib/leagueSlug'

export type Membership = {
  leagueId: string
  name: string
  slug: string
  isCurrent: boolean
}

/**
 * v1.59.0 — server-side memberships resolver.
 *
 * Pre-v1.59.0 the league switcher (header chevron + account-menu entry) lazy-
 * loaded memberships via `/api/me/memberships` on first dropdown open. For a
 * multi-league user, this meant: page paints with no chevron → component mounts,
 * fires fetch → ~300ms-1s round-trip → chevron appears. The user-reported lag is
 * exactly that gap.
 *
 * v1.59.0 hoists the fetch into the root layout so memberships are available
 * synchronously on first paint. The membership list is small (typically 1-3
 * rows per user; bounded by roster size) and the query is a single Prisma
 * `findFirst` with a nested include. It runs server-side in parallel with the
 * existing `getServerSession` call in the layout (Next.js's RSC waterfall is
 * already paying for that round-trip), so total TTFB is unchanged.
 *
 * Auth resolution mirrors `/api/me/memberships` (which stays in place as a
 * fallback for clients that need to refresh on demand):
 *   1. `userId` (canonical post-α.5)
 *   2. `lineId` → `Player.lineId` (legacy fallback)
 *
 * Returns `[]` for unauthenticated, unlinked, or admin-credentials sessions.
 */
export async function getMembershipsForSession(args: {
  userId: string | null
  lineId: string | null
  currentLeagueId: string | null
}): Promise<Membership[]> {
  const playerLookup = args.userId
    ? { userId: args.userId }
    : args.lineId
      ? { lineId: args.lineId }
      : null

  if (!playerLookup) return []

  let player
  try {
    player = await prisma.player.findFirst({
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
  } catch (err) {
    console.warn('[memberships] Prisma findFirst failed; returning empty:', err)
    return []
  }

  if (!player) return []

  const seen = new Map<string, Membership>()
  for (const assignment of player.leagueAssignments) {
    // v1.65.0 — leagueTeam nullable post-rework; PENDING applicants without
    // a team don't surface in the league switcher (no league to switch to).
    if (!assignment.leagueTeam) continue
    const league = assignment.leagueTeam.league
    if (seen.has(league.id)) continue
    const slug = league.subdomain ?? (league.isDefault ? DEFAULT_LEAGUE_SLUG : null)
    if (!slug) continue
    seen.set(league.id, {
      leagueId: league.id,
      name: league.name,
      slug,
      isCurrent: args.currentLeagueId === league.id,
    })
  }

  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name))
}
