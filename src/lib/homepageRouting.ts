/**
 * v1.85.0 — homepage redesign phase 1b/1c. Server-only persona detection
 * for the new persona-aware apex (currently mounted at `/test`; the
 * eventual swap moves it to `/`).
 *
 * Three personas:
 *
 *   - `directory`  — render the `<LeagueDirectory>` listing. Covers two
 *     audiences: unauthenticated visitors (no session at all) AND
 *     authenticated users with zero APPROVED memberships (a brand-new
 *     LINE/Google sign-in who hasn't applied anywhere yet). Both see the
 *     same surface because there's nothing to redirect them to.
 *
 *   - `single`     — exactly one APPROVED `PlayerLeagueMembership`. The
 *     route hands a slug back to the page, which then issues
 *     `redirect('/id/<slug>')`. We don't `redirect()` from inside this
 *     helper because the helper is also called from tests + the
 *     `<HomepageRouter>` server component; centralising the redirect
 *     makes the call site honest about its side effect.
 *
 *   - `multi`      — two or more APPROVED memberships. The page renders
 *     the multi-league hub (`<MultiLeagueHub>`) with the user's
 *     `defaultLeagueId` (or a deterministic fallback when null) as the
 *     active league.
 *
 * "APPROVED" here mirrors the read shape used in
 * `getRecruitingViewerState` and `getMembershipsForSession`: a PLM with
 * `applicationStatus === 'APPROVED'`, `toGameWeek === null` (still
 * current), and a non-null `leagueTeam` (real team assignment, not a
 * pre-approved-but-unteamed pending). PENDING applications and past
 * memberships do NOT count toward the persona threshold — a user with
 * one APPROVED + three PENDINGs still resolves to `single`.
 */

import { prisma } from '@/lib/prisma'
import { DEFAULT_LEAGUE_SLUG } from '@/lib/leagueSlug'

export interface ApprovedMembership {
  leagueId: string
  leagueName: string
  slug: string
}

export type HomepagePersona =
  | { kind: 'directory' }
  | { kind: 'single'; membership: ApprovedMembership }
  | {
      kind: 'multi'
      memberships: ApprovedMembership[]
      activeLeagueId: string
      defaultLeagueIdInDb: string | null
    }

interface ResolveInput {
  userId: string | null
  lineId: string | null
}

/**
 * Read the calling user's APPROVED memberships across all leagues + their
 * stored `User.defaultLeagueId`. Returns `[]` for unauthenticated callers
 * and for sessions whose userId/lineId don't resolve a Player row (e.g.
 * admin-credentials sessions, or grandfathered LINE sessions with no
 * Player.lineId backfill — same surface as the directory).
 *
 * Sorted alphabetically by league name to match the v1.83.0
 * `/account/player` per-league ordering. The deterministic ordering also
 * makes `memberships[0]` a stable fallback for the `multi` persona when
 * `User.defaultLeagueId` is null.
 */
export async function getApprovedMembershipsAndDefault(input: ResolveInput): Promise<{
  memberships: ApprovedMembership[]
  defaultLeagueId: string | null
}> {
  const { userId, lineId } = input
  if (!userId && !lineId) {
    return { memberships: [], defaultLeagueId: null }
  }

  // Resolve the canonical User row up front so we can read
  // `defaultLeagueId` AND its memberships in a single query. The lookup
  // accepts either identifier (mirrors `requireSelfPlayerSession` in
  // `account/player/actions.ts`) so legacy LINE-only sessions work.
  let user
  try {
    if (userId) {
      user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          defaultLeagueId: true,
          playerId: true,
        },
      })
    }
    if (!user && lineId) {
      user = await prisma.user.findUnique({
        where: { lineId },
        select: {
          id: true,
          defaultLeagueId: true,
          playerId: true,
        },
      })
    }
  } catch (err) {
    console.warn('[homepageRouting] user lookup failed; defaulting to directory:', err)
    return { memberships: [], defaultLeagueId: null }
  }

  if (!user) {
    return { memberships: [], defaultLeagueId: null }
  }

  // Resolve the Player row: prefer User.playerId (canonical post-α.5),
  // else fall back to Player.lineId for grandfathered sessions whose
  // User.playerId was never backfilled.
  let player
  try {
    if (user.playerId) {
      player = await prisma.player.findUnique({
        where: { id: user.playerId },
        select: {
          id: true,
          leagueAssignments: {
            where: {
              applicationStatus: 'APPROVED',
              toGameWeek: null,
              leagueTeamId: { not: null },
            },
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
    }
    if (!player && lineId) {
      player = await prisma.player.findFirst({
        where: { lineId },
        select: {
          id: true,
          leagueAssignments: {
            where: {
              applicationStatus: 'APPROVED',
              toGameWeek: null,
              leagueTeamId: { not: null },
            },
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
    }
  } catch (err) {
    console.warn('[homepageRouting] memberships lookup failed; defaulting to directory:', err)
    return { memberships: [], defaultLeagueId: user.defaultLeagueId ?? null }
  }

  if (!player) {
    return { memberships: [], defaultLeagueId: user.defaultLeagueId ?? null }
  }

  // Dedupe by leagueId — a player CAN technically have multiple PLM rows
  // in the same league (different teams across seasons) but we only want
  // ONE entry per league for routing purposes.
  const seen = new Map<string, ApprovedMembership>()
  for (const assignment of player.leagueAssignments) {
    if (!assignment.leagueTeam) continue
    const league = assignment.leagueTeam.league
    if (seen.has(league.id)) continue
    const slug = league.subdomain ?? (league.isDefault ? DEFAULT_LEAGUE_SLUG : null)
    if (!slug) continue
    seen.set(league.id, {
      leagueId: league.id,
      leagueName: league.name,
      slug,
    })
  }

  const memberships = Array.from(seen.values()).sort((a, b) =>
    a.leagueName.localeCompare(b.leagueName),
  )

  return {
    memberships,
    defaultLeagueId: user.defaultLeagueId ?? null,
  }
}

/**
 * Pure: classify the persona from a memberships list + stored default.
 * Split out so the routing helper composes from a DB read + this pure
 * decision, and so unit tests can pin the decision rules without mock-
 * heavy Prisma stubs.
 *
 * `defaultLeagueId` is honoured ONLY when it points at a league the
 * user is still APPROVED in. A stale defaultLeagueId (user removed from
 * that league) falls back to the alphabetical-first APPROVED membership
 * — same deterministic shape as a brand-new multi-league user.
 */
export function classifyPersona(args: {
  memberships: ApprovedMembership[]
  defaultLeagueId: string | null
}): HomepagePersona {
  const { memberships, defaultLeagueId } = args
  if (memberships.length === 0) {
    return { kind: 'directory' }
  }
  if (memberships.length === 1) {
    return { kind: 'single', membership: memberships[0] }
  }
  const stored = defaultLeagueId
    ? memberships.find((m) => m.leagueId === defaultLeagueId) ?? null
    : null
  const active = stored ?? memberships[0]
  return {
    kind: 'multi',
    memberships,
    activeLeagueId: active.leagueId,
    defaultLeagueIdInDb: defaultLeagueId,
  }
}

/**
 * Convenience — fetch + classify in one call. The page-level RSC uses
 * this; tests typically use the two helpers separately so they can pin
 * the decision rules without touching Prisma.
 */
export async function resolveHomepagePersona(
  input: ResolveInput,
): Promise<HomepagePersona> {
  const { memberships, defaultLeagueId } = await getApprovedMembershipsAndDefault(input)
  return classifyPersona({ memberships, defaultLeagueId })
}
