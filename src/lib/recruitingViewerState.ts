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
 */
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export type RecruitingViewerState =
  | { kind: 'unauthenticated' }
  | { kind: 'no_player' }
  | { kind: 'pending_this' }
  | {
      kind: 'approved_this'
      team: { id: string; name: string; logoUrl: string | null }
    }
  | { kind: 'in_other_league' }

export async function getRecruitingViewerState(
  leagueId: string,
): Promise<RecruitingViewerState> {
  const session = await getServerSession(authOptions)
  if (!session) return { kind: 'unauthenticated' }

  // v1.67.0 — admin-orthogonal resolution. The viewer state is computed
  // purely from auth + Player linkage + PLM rows. Admin role is NOT a
  // gate. This mirrors the architectural rule "admin role is orthogonal
  // to user-facing UX": an admin who's a Player+PLM in this league sees
  // State A exactly like a non-admin would; an admin with no Player
  // sees State C (recruiting CTA) exactly like a non-admin would.
  //
  // Resolution strategy:
  //   1. Try by session.userId (canonical post-α.5 / PR β path).
  //   2. Fall back to session.lineId via legacy Player.lineId — covers
  //      sessions whose User.playerId was never backfilled (pre-β rows)
  //      or any drift between User.playerId and Player.userId.
  //   3. If neither resolves (admin-credentials sessions, or genuinely
  //      no Player), return 'no_player' — same surface a non-admin
  //      regular-but-unlinked viewer would see.
  const userId = (session as { userId?: string | null }).userId ?? null
  const lineId = (session as { lineId?: string | null }).lineId ?? null

  if (!userId && !lineId) {
    // No public-side identifier (e.g. admin-credentials login). Treat
    // as no_player — they have no Player linkage to surface State A
    // for, and they CAN apply if they want to (the State C CTA is
    // semantically correct for someone with no Player).
    return { kind: 'no_player' }
  }

  try {
    // Try userId path first (canonical), fall back to lineId.
    let player: {
      id: string
      leagueAssignments: Array<{
        applicationStatus: string
        toGameWeek: number | null
        leagueTeam: { team: { id: string; name: string; logoUrl: string | null } } | null
      }>
    } | null = null
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, playerId: true },
      })
      if (user?.playerId) {
        player = await prisma.player.findUnique({
          where: { userId: user.id },
          select: {
            id: true,
            leagueAssignments: {
              where: {
                OR: [
                  { leagueId },
                  { leagueTeam: { leagueId } },
                ],
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
      }
    }
    // Fallback: lineId-keyed lookup. Covers the drift case where
    // User.playerId was never backfilled.
    if (!player && lineId) {
      player = await prisma.player.findUnique({
        where: { lineId },
        select: {
          id: true,
          leagueAssignments: {
            where: {
              OR: [
                { leagueId },
                { leagueTeam: { leagueId } },
              ],
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
    }
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
          id: approvedPlm.leagueTeam.team.id,
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
