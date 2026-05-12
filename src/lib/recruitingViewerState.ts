/**
 * v1.64.0 — Compute the recruiting-banner viewer state for a given
 * league. Resolves the calling user's session, looks up their Player
 * binding (if any), and returns one of five discriminated states that
 * the `RecruitingBanner` client component renders accordingly.
 *
 * State semantics:
 *   - 'unauthenticated' (E): no session — banner CTA routes to sign-in.
 *   - 'no_player' (C): authenticated but `User.playerId` is null —
 *      banner CTA opens the apply form modal.
 *   - 'pending_this' (B): authenticated, has a Player with
 *      `applicationStatus = PENDING` AND `applicationLeagueId` matches
 *      THIS league — banner shows "your application is being reviewed."
 *   - 'approved_this' (A): authenticated, has a Player with
 *      `applicationStatus = APPROVED` AND an active `PlayerLeagueMembership`
 *      in THIS league — banner shows "you are in <league>! your team is X".
 *   - 'in_other_league' (D): authenticated, has a Player but no PLA in
 *      THIS league — banner shows the recruiting CTA but the click
 *      surfaces a "contact admin" message in v1.64.0 (per the PR brief:
 *      "Pick simpler — gate at Player level for v1, expand to per-league
 *      later").
 *
 * Called from page-level RSCs (apex `/`, `/id/<slug>`, etc.) that already
 * resolve `leagueId`. Threads the result through Dashboard as a prop so
 * the client RecruitingBanner can render without an extra round-trip.
 *
 * Defaults to 'unauthenticated' on Prisma failure (defense — the banner
 * just shows the recruiting CTA, signing in is harmless).
 *
 * v1.98.0 — session + user + player resolution moved into shared
 * `getViewer()` (request-scoped via React `cache()`). This function
 * now only runs the per-league `player.leagueAssignments` query that
 * is genuinely scoped to the leagueId arg. The previous duplicate
 * `getServerSession + user.findUnique + player.findUnique` pre-amble
 * is gone — on a typical multi-league hub render, the viewer is
 * already resolved by `<HomepageRouter>` so this call is just one
 * additional Prisma round-trip for the league-scoped leagueAssignments.
 */
import { prisma } from '@/lib/prisma'
import { teamIdToSlug } from '@/lib/ids'
import { getViewer } from '@/lib/viewer'

export type RecruitingViewerState =
  | { kind: 'unauthenticated' }
  | { kind: 'no_player' }
  | { kind: 'pending_this' }
  | {
      kind: 'approved_this'
      /**
       * `team.id` is the public slug form (no `t-` prefix), matching the
       * `Team.id` shape in `LeagueData.teams` produced by
       * `dbToPublicLeagueData`. This makes `recruitingState.team.id`
       * directly comparable against `teams[i].id` in client consumers
       * (e.g. UserTeamBadge → pickUserTeam). v1.73.1 introduced this
       * field with the raw DB id which broke that comparison; v1.73.2
       * fixes the contract here at the source.
       */
      team: { id: string; name: string; logoUrl: string | null }
    }
  | { kind: 'in_other_league' }

export async function getRecruitingViewerState(
  leagueId: string,
): Promise<RecruitingViewerState> {
  const viewer = await getViewer()
  // No session at all → unauthenticated banner CTA. Matches the pre-
  // v1.98.0 surface — the helper used to call getServerSession itself
  // and return this exact kind when null.
  if (!viewer.hasSession) {
    return { kind: 'unauthenticated' }
  }

  // v1.67.0 — admin-orthogonal resolution. The viewer state is computed
  // purely from auth + Player linkage + PLM rows. Admin role is NOT a
  // gate. This mirrors the architectural rule "admin role is orthogonal
  // to user-facing UX": an admin who's a Player+PLM in this league sees
  // State A exactly like a non-admin would; an admin with no Player
  // sees State C (recruiting CTA) exactly like a non-admin would.
  if (!viewer.player) {
    // Either no User row resolved, or User has no linked Player. Same
    // surface — recruiting CTA pointing at the apply modal.
    return { kind: 'no_player' }
  }

  try {
    const player = await prisma.player.findUnique({
      where: { id: viewer.player.id },
      select: {
        leagueAssignments: {
          where: {
            OR: [{ leagueId }, { leagueTeam: { leagueId } }],
          },
          select: {
            applicationStatus: true,
            toGameWeek: true,
            leagueTeam: {
              select: {
                team: { select: { id: true, name: true, logoUrl: true } },
              },
            },
          },
        },
      },
    })
    if (!player) {
      return { kind: 'no_player' }
    }

    // ── State A check ─ APPROVED PLM with a real team in this league ─
    const approvedPlm = player.leagueAssignments.find(
      (a) =>
        a.applicationStatus === 'APPROVED' &&
        a.toGameWeek === null &&
        a.leagueTeam !== null,
    )
    if (approvedPlm && approvedPlm.leagueTeam) {
      return {
        kind: 'approved_this',
        team: {
          id: teamIdToSlug(approvedPlm.leagueTeam.team.id),
          name: approvedPlm.leagueTeam.team.name,
          logoUrl: approvedPlm.leagueTeam.team.logoUrl,
        },
      }
    }

    // ── State B check ─ PENDING PLM in this league ─
    const pendingPlm = player.leagueAssignments.find(
      (a) => a.applicationStatus === 'PENDING',
    )
    if (pendingPlm) {
      return { kind: 'pending_this' }
    }

    // Has Player but no PLM in this league. State D — the user can
    // submit a State-D simplified application via the recruiting banner.
    return { kind: 'in_other_league' }
  } catch (err) {
    console.warn('[recruitingViewerState] read failed; defaulting unauth:', err)
    return { kind: 'unauthenticated' }
  }
}
