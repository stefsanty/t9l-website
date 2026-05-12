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
import { getViewer } from '@/lib/viewer'

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
  /**
   * v1.93.0 — optional caller-provided override (typically
   * `searchParams.league` from the apex page). When supplied AND the id
   * matches an APPROVED membership, it wins over `User.defaultLeagueId`
   * for the active-league pick. When the value doesn't match any
   * membership, it's silently ignored — the resolver falls back to the
   * stored default, then to alphabetical-first. The classifier never
   * trusts an unverified id, so a malicious URL parameter cannot pin
   * the user to a league they aren't in.
   */
  preferredLeagueId?: string | null
  /**
   * v1.97.5 — optional caller-provided cookie value (typically read
   * from `t9l_default_league` via `cookies()` in `<HomepageRouter>`).
   * Sits between `preferredLeagueId` (URL) and `User.defaultLeagueId`
   * (DB) in the priority chain. The cookie write is fire-and-forget
   * from the LeagueSwitcher pill-click; this read path picks it up on
   * the next render to skip a Prisma round-trip on cold loads.
   * Validated against memberships the same way `preferredLeagueId` is
   * — an unknown / stale / tampered value silently falls through.
   */
  cookieLeagueId?: string | null
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

  // v1.98.0 — session + user + player resolution lives in shared
  // `getViewer()` (request-scoped via React `cache()`). The previous
  // duplicate `prisma.user.findUnique` (selecting `defaultLeagueId: true`
  // + `playerId: true`) is gone — viewer carries both fields. Tests
  // assert this selection happens in `src/lib/viewer.ts` now.
  const viewer = await getViewer()
  const user = viewer.user
  if (!user) {
    return { memberships: [], defaultLeagueId: null }
  }

  // Per-league leagueAssignments query — genuinely scoped to the
  // current viewer's player so still runs once per render. The shape
  // (applicationStatus APPROVED + toGameWeek null + leagueTeamId not
  // null) is the v1.85.0 semantic that distinguishes "real teammate"
  // from "pending application".
  let player
  try {
    if (viewer.player) {
      player = await prisma.player.findUnique({
        where: { id: viewer.player.id },
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
  /**
   * v1.93.0 — optional active-league override. See the doc on
   * `ResolveInput.preferredLeagueId` for the priority order and the
   * unverified-input guarantee. When omitted the classifier behaves
   * identically to v1.85.0.
   */
  preferredLeagueId?: string | null
  /**
   * v1.97.5 — optional cookie-backed preference. See
   * `ResolveInput.cookieLeagueId` for the contract. Wins over the DB
   * `defaultLeagueId` when both are present and both validate against
   * memberships, so a returning visitor lands on whichever league
   * they last clicked rather than whatever the DB happens to hold.
   */
  cookieLeagueId?: string | null
}): HomepagePersona {
  const {
    memberships,
    defaultLeagueId,
    preferredLeagueId = null,
    cookieLeagueId = null,
  } = args
  if (memberships.length === 0) {
    return { kind: 'directory' }
  }
  if (memberships.length === 1) {
    return { kind: 'single', membership: memberships[0] }
  }
  // Priority: explicit preferredLeagueId (URL `?league=` from the
  // switcher) → cookie (`t9l_default_league`, v1.97.5) → stored
  // `User.defaultLeagueId` → alphabetical-first membership. Each
  // branch validates against the memberships list, so an unknown id
  // (URL tampering or stale stored default or stale cookie) silently
  // falls through to the next layer.
  const preferred = preferredLeagueId
    ? memberships.find((m) => m.leagueId === preferredLeagueId) ?? null
    : null
  const cookied = cookieLeagueId
    ? memberships.find((m) => m.leagueId === cookieLeagueId) ?? null
    : null
  const stored = defaultLeagueId
    ? memberships.find((m) => m.leagueId === defaultLeagueId) ?? null
    : null
  const active = preferred ?? cookied ?? stored ?? memberships[0]
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
  const { memberships, defaultLeagueId } = await getApprovedMembershipsAndDefault({
    userId: input.userId,
    lineId: input.lineId,
  })
  return classifyPersona({
    memberships,
    defaultLeagueId,
    preferredLeagueId: input.preferredLeagueId ?? null,
    cookieLeagueId: input.cookieLeagueId ?? null,
  })
}
