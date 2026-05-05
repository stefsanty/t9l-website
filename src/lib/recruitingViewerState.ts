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

  const userId = (session as { userId?: string | null }).userId ?? null
  if (!userId) {
    // Admin-credentials session — no Player binding, treat as
    // "no_player" so the banner doesn't show admin-only chrome to a
    // viewer who can't actually apply.
    return { kind: 'no_player' }
  }

  try {
    // User and Player are connected via `User.playerId` + `Player.userId`
    // (1:1 mirrored unique columns from v1.27.0 / α). Neither side
    // declares an `@relation` FK in the schema (per CLAUDE.md: stage Δ
    // converts one direction; today they're independent). So we walk
    // userId → Player.userId rather than via a relation include.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, playerId: true },
    })
    if (!user || !user.playerId) {
      return { kind: 'no_player' }
    }

    const player = await prisma.player.findUnique({
      where: { userId: user.id },
      select: {
        id: true,
        applicationStatus: true,
        applicationLeagueId: true,
        leagueAssignments: {
          where: {
            leagueTeam: { leagueId },
            toGameWeek: null,
          },
          select: {
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
      // Mirror drift — User.playerId points at a Player that doesn't
      // resolve via Player.userId. Treat as no_player so the user can
      // re-apply; the admin Players tab can flag the drift separately.
      return { kind: 'no_player' }
    }

    if (
      player.applicationStatus === 'PENDING' &&
      player.applicationLeagueId === leagueId
    ) {
      return { kind: 'pending_this' }
    }

    // v1.65.0 — `leagueTeam` is nullable on PlayerLeagueMembership post-rework.
    // The Prisma `where: { leagueTeam: { leagueId } }` filter implicitly
    // excludes null-leagueTeam rows, but TS can't narrow that. Filter
    // defensively so State A only fires for memberships with real teams.
    const activeAssignment =
      player.leagueAssignments.find((a) => a.leagueTeam !== null) ?? null
    if (
      player.applicationStatus === 'APPROVED' &&
      activeAssignment &&
      activeAssignment.leagueTeam
    ) {
      return {
        kind: 'approved_this',
        team: {
          id: activeAssignment.leagueTeam.team.id,
          name: activeAssignment.leagueTeam.team.name,
          logoUrl: activeAssignment.leagueTeam.team.logoUrl,
        },
      }
    }

    // Has Player but no PLA in this league (or pending application
    // targeting a DIFFERENT league). State D.
    return { kind: 'in_other_league' }
  } catch (err) {
    console.warn('[recruitingViewerState] read failed; defaulting unauth:', err)
    return { kind: 'unauthenticated' }
  }
}
