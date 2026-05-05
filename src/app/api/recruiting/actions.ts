'use server'

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { revalidate } from '@/lib/revalidate'

/**
 * v1.64.0 — Application/recruiting workflow.
 *
 * `applyToLeague` is the public-facing apply action invoked by the
 * `RecruitingBanner` modal in two states:
 *   - State C — authenticated user has no Player yet. We create a fresh
 *     Player with `applicationStatus = PENDING` and bind it to the
 *     User (sets both `Player.userId` and `User.playerId` per the v1.27.0
 *     dual-write invariant).
 *   - State D — authenticated user already has a Player (in a different
 *     league) and is applying to THIS league. v1.64.0 is intentionally
 *     simple: we just throw a friendly error directing them to contact
 *     the admin. The PR description punts the multi-league per-Player
 *     application flow to "expand to per-league later" — wiring it now
 *     would require a `PlayerLeagueMembership.applicationStatus` mirror
 *     plus an admin UI to surface PLA-level pending state.
 *
 * The application is identified per-league via `Player.applicationLeagueId`
 * so the admin Players tab for that league can surface pending applications
 * without scanning every Player row.
 *
 * Validation gates:
 *   - Sign in required (no anonymous applications — the `RecruitingBanner`
 *     unauthenticated state E routes to `/auth/signin` first).
 *   - Admin-credentials sessions (no `userId`) cannot apply (admins manage
 *     players via the admin UI).
 *   - Trimmed name required (≤ 100 chars; mirrors `submitOnboarding`).
 *   - Position is the v1.33.0 `PlayerPosition` enum or null.
 *   - LeagueId must resolve to a real League row (defense in depth — the
 *     banner only renders when `recruiting === true` for that league, but
 *     the action shouldn't trust the client).
 */

export interface ApplyToLeagueInput {
  leagueId: string
  name: string
  position?: 'GK' | 'DF' | 'MF' | 'FW' | null
}

export type ApplyToLeagueResult =
  | { ok: true; playerId: string }
  | { ok: false; error: string }

export async function applyToLeague(
  input: ApplyToLeagueInput,
): Promise<ApplyToLeagueResult> {
  const session = await getServerSession(authOptions)
  if (!session) {
    return { ok: false, error: 'Sign in required' }
  }
  const userId = (session as { userId?: string | null }).userId ?? null
  if (!userId) {
    // Admin-credentials session — no Player binding makes sense.
    return { ok: false, error: 'Admin sessions cannot submit applications' }
  }

  const trimmedName = input.name.trim()
  if (!trimmedName) {
    return { ok: false, error: 'Your name is required' }
  }
  if (trimmedName.length > 100) {
    return { ok: false, error: 'Name must be 100 characters or fewer' }
  }

  // Verify the league exists and accepts applications.
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: { id: true, recruiting: true, name: true },
  })
  if (!league) {
    return { ok: false, error: 'League not found' }
  }
  if (!league.recruiting) {
    return { ok: false, error: 'This league is not currently recruiting' }
  }

  // Check whether the user already has a Player binding.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, playerId: true, lineId: true },
  })
  if (!user) {
    return { ok: false, error: 'User not found' }
  }

  if (user.playerId) {
    // State D — multi-league application. Punted in v1.64.0.
    return {
      ok: false,
      error:
        'You already have a player profile. Contact the league admin to add you to this league.',
    }
  }

  // State C — fresh Player + dual-write the User binding. Mirror of
  // `linkUserToPlayer` but creating the Player in the same transaction.
  const player = await prisma.$transaction(async (tx) => {
    const created = await tx.player.create({
      data: {
        name: trimmedName,
        position: input.position ?? null,
        userId: user.id,
        // Set Player.lineId for LINE users so the legacy resolver path
        // works through stage 3 (γ). Google/email users have lineId null.
        lineId: user.lineId ?? null,
        applicationStatus: 'PENDING',
        applicationLeagueId: league.id,
      },
    })
    await tx.user.update({
      where: { id: user.id },
      data: { playerId: created.id },
    })
    return created
  })

  // Bust caches so the admin Players tab shows the new pending application
  // immediately and the public homepage refreshes the user's RecruitingBanner
  // state from "no_player" to "pending_this".
  revalidate({
    domain: 'admin',
    paths: [`/admin/leagues/${league.id}/players`],
  })
  revalidate({ domain: 'public' })

  return { ok: true, playerId: player.id }
}
