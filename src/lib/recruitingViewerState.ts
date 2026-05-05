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
import { getPlayerDataReadSource } from '@/lib/settings'

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

    // v1.65.1 — read path UNION: per-league truth lives on PlayerLeagueMembership
    // (canonical from v1.65.4), but legacy Player.applicationStatus +
    // Player.applicationLeagueId are still populated for v1.64.0 PENDING
    // applicants and dual-written for State C in v1.65.1. EITHER signal
    // qualifies for pending_this or approved_this; the resolver checks
    // both and reports the resolved-per-league state.
    const player = await prisma.player.findUnique({
      where: { userId: user.id },
      select: {
        id: true,
        applicationStatus: true,
        applicationLeagueId: true,
        leagueAssignments: {
          // Pull every membership for this league so we can check both
          // PENDING (no team) and APPROVED (with team). The where-filter
          // covers the new direct `leagueId` column AND the legacy
          // `leagueTeam.leagueId` so v1.65.0 backfilled rows + v1.65.1
          // dual-written rows + v1.65.1 PENDING-no-team rows all match.
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
    if (!player) {
      // Mirror drift — User.playerId points at a Player that doesn't
      // resolve via Player.userId. Treat as no_player so the user can
      // re-apply; the admin Players tab can flag the drift separately.
      return { kind: 'no_player' }
    }

    // v1.65.2 — read-source flag dispatch.
    //   - 'legacy' (default): UNION read (v1.65.1 shape) — checks both
    //     `Player.applicationStatus` legacy fields AND PLM signals.
    //   - 'plm': PLM-only read — ignores legacy Player.* fields. Used
    //     after v1.65.3 default flip + v1.65.4 cleanup.
    //
    // The legacy default keeps v1.65.1's exact behavior. The 'plm' branch
    // simulates the post-v1.65.4 world for parity testing + early-rollout
    // operator flips.
    const readSource = await getPlayerDataReadSource()

    // ── State A check ─ APPROVED PLM with a real team in this league ─
    // (highest priority — admin already approved this player here)
    const approvedPlm = player.leagueAssignments.find(
      (a) =>
        a.applicationStatus === 'APPROVED' &&
        a.toGameWeek === null &&
        a.leagueTeam !== null,
    )
    // Legacy v1.64.0 fallback ONLY active under 'legacy' source: APPROVED
    // on Player AND any active PLM with team in this league. The 'plm'
    // path doesn't consult Player.applicationStatus.
    const legacyApprovedActive =
      readSource === 'legacy' &&
      player.applicationStatus === 'APPROVED' &&
      player.leagueAssignments.find(
        (a) => a.toGameWeek === null && a.leagueTeam !== null,
      )
    const stateAAssignment = approvedPlm ?? legacyApprovedActive ?? null
    if (stateAAssignment && stateAAssignment.leagueTeam) {
      return {
        kind: 'approved_this',
        team: {
          id: stateAAssignment.leagueTeam.team.id,
          name: stateAAssignment.leagueTeam.team.name,
          logoUrl: stateAAssignment.leagueTeam.team.logoUrl,
        },
      }
    }

    // ── State B check ─ PENDING PLM in this league OR legacy Player.* memo ─
    const pendingPlm = player.leagueAssignments.find(
      (a) => a.applicationStatus === 'PENDING',
    )
    // Legacy Player.* memo only honored under 'legacy' source.
    const legacyPending =
      readSource === 'legacy' &&
      player.applicationStatus === 'PENDING' &&
      player.applicationLeagueId === leagueId
    if (pendingPlm || legacyPending) {
      return { kind: 'pending_this' }
    }

    // Has Player but no PLM in this league (or PENDING for a different
    // league via the legacy Player.* memo, which doesn't apply here).
    // State D — the user can submit a State-D simplified application
    // via the v1.65.1 banner.
    return { kind: 'in_other_league' }
  } catch (err) {
    console.warn('[recruitingViewerState] read failed; defaulting unauth:', err)
    return { kind: 'unauthenticated' }
  }
}
