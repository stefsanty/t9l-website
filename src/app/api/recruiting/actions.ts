'use server'

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { revalidate } from '@/lib/revalidate'
import { generateInviteCode, computeInviteExpiry } from '@/lib/inviteCodes'

/**
 * v1.64.0 / v1.65.1 — Application/recruiting workflow.
 *
 * `applyToLeague` is the public-facing apply action invoked by the
 * `RecruitingBanner` modal in two states:
 *
 *   - State C ('no_player') — authenticated user has no Player yet. We
 *     create a fresh Player + a new PlayerLeagueMembership(PENDING) for
 *     the target league. Player.userId is set per the v1.27.0 dual-
 *     write invariant. Legacy `Player.applicationStatus = PENDING` +
 *     `Player.applicationLeagueId = leagueId` are also set for
 *     stage-2 dual-write compat (read flip happens in v1.65.2).
 *
 *   - State D ('in_other_league') — authenticated user ALREADY has a
 *     Player (e.g. APPROVED in T9L) applying to a NEW league.
 *     **THE STATE D BUG FIX (v1.65.1):** create a NEW PLM(PENDING) for
 *     the existing Player in the new league. **Do NOT touch
 *     `Player.applicationStatus`** — that's a global field; flipping
 *     it would corrupt the existing-league admin's view of "this
 *     player is APPROVED". Instead we rely on the new
 *     `PlayerLeagueMembership.applicationStatus = PENDING` in the new
 *     league as the per-league source of truth. The admin of the new
 *     league sees the pending application via the v1.65.1 read path
 *     (which now unions the legacy Player.* check + the new PLM
 *     check); the admin of the existing league sees no change to the
 *     player's APPROVED state.
 *
 * Validation gates:
 *   - Sign in required (no anonymous applications). State E in the
 *     banner now toasts "Sign in to apply" rather than redirecting.
 *   - Admin-credentials sessions (no `userId`) cannot apply.
 *   - For State C: trimmed name required (≤ 100 chars). For State D:
 *     name is unused — the existing Player's name carries through.
 *   - Position is the v1.33.0 `PlayerPosition` enum or null.
 *   - LeagueId must resolve to a real League row.
 *   - For State D: the new PLM must not duplicate an existing PENDING
 *     PLM in the same league (idempotency on double-click).
 */

export interface ApplyToLeagueInput {
  leagueId: string
  // For State C: name is required. For State D: ignored (the existing
  // Player's name persists). The component sends an empty string when
  // it knows the user is in State D.
  name: string
  position?: 'GK' | 'DF' | 'MF' | 'FW' | null
}

export type ApplyToLeagueResult =
  | { ok: true; playerId: string; mode: 'fresh' | 'existing' }
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
    return { ok: false, error: 'Admin sessions cannot submit applications' }
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

  // ── State D — multi-league application path ──────────────────────────
  if (user.playerId) {
    const existingPlayerId = user.playerId

    // Idempotency guard — if the user already has a PLM in this league
    // (PENDING or APPROVED), don't create a duplicate. PENDING returns
    // ok with the existing playerId (banner re-renders to State B).
    const existingPlm = await prisma.playerLeagueMembership.findFirst({
      where: { playerId: existingPlayerId, leagueId: league.id },
      select: { id: true, applicationStatus: true },
    })
    if (existingPlm) {
      // Either APPROVED (already a member; admin should reject silently
      // since the user is in State A from the banner's perspective) or
      // PENDING (no-op double-submit). Both treat as success.
      return { ok: true, playerId: existingPlayerId, mode: 'existing' }
    }

    // Create a new PLM(PENDING) for the existing Player in the new
    // league. leagueTeamId stays null until admin assigns a team on
    // approval. **Do not touch Player.applicationStatus** — it's a
    // global field; v1.65.4 drops it. Per-league truth lives on the
    // new PLM.
    await prisma.playerLeagueMembership.create({
      data: {
        playerId: existingPlayerId,
        leagueTeamId: null,
        leagueId: league.id,
        fromGameWeek: 1,
        applicationStatus: 'PENDING',
        position: input.position ?? null,
        joinSource: 'SELF_SERVE',
        onboardingStatus: 'NOT_YET',
      },
    })

    revalidate({
      domain: 'admin',
      paths: [`/admin/leagues/${league.id}/players`],
    })
    revalidate({ domain: 'public' })

    return { ok: true, playerId: existingPlayerId, mode: 'existing' }
  }

  // ── State C — fresh Player + dual-write the User binding ─────────────
  const trimmedName = input.name.trim()
  if (!trimmedName) {
    return { ok: false, error: 'Your name is required' }
  }
  if (trimmedName.length > 100) {
    return { ok: false, error: 'Name must be 100 characters or fewer' }
  }

  // v1.65.4 — legacy `Player.applicationStatus` + `Player.applicationLeagueId`
  // are dropped from the schema. Position now lives only on the PLM. The
  // Player row is purely identity (name + lineId/userId + profile picture).
  const player = await prisma.$transaction(async (tx) => {
    const created = await tx.player.create({
      data: {
        name: trimmedName,
        userId: user.id,
        // Set Player.lineId for LINE users so the legacy resolver path
        // works through stage 3 (γ). Google/email users have lineId null.
        lineId: user.lineId ?? null,
      },
    })
    await tx.user.update({
      where: { id: user.id },
      data: { playerId: created.id },
    })
    // v1.65.1 — PLM(PENDING) for this league is the canonical source of
    // truth (v1.65.4 drops the legacy Player.* fields).
    await tx.playerLeagueMembership.create({
      data: {
        playerId: created.id,
        leagueTeamId: null,
        leagueId: league.id,
        fromGameWeek: 1,
        applicationStatus: 'PENDING',
        position: input.position ?? null,
        joinSource: 'SELF_SERVE',
        onboardingStatus: 'NOT_YET',
      },
    })
    return created
  })

  revalidate({
    domain: 'admin',
    paths: [`/admin/leagues/${league.id}/players`],
  })
  revalidate({ domain: 'public' })

  return { ok: true, playerId: player.id, mode: 'fresh' }
}

/**
 * v1.67.0 — State C full onboarding entry point.
 *
 * Pre-v1.67.0 the State C recruiting CTA opened `ApplyToLeagueModal` with
 * a simplified intake (name + position only). The user wants State C to
 * use the SAME flow as admin-initiated invites — including ID upload,
 * full intake form, the welcome page — without requiring an admin to
 * actually issue an invite.
 *
 * Approach: create a synthetic per-user PERSONAL `LeagueInvite` whose
 * `targetPlayerId` is a freshly-created Player bound to the calling
 * User. Mark the invite already-redeemed (`usedCount = maxUses = 1`) so
 * it can never be redeemed by anyone else, and set a short expiry so
 * stale ones decay. The `/join/[code]` page's signed-in-already-bound
 * resolver detects the binding (Player.userId === session.userId) and
 * routes the user straight into `/join/[code]/onboarding` (since
 * `Player.name` is null, that's where the resolver sends them).
 *
 * From there the user follows the canonical onboarding flow:
 *   onboarding form (name + position) → id-upload → welcome.
 *
 * Identical UX to PERSONAL invite redemption, but no admin had to
 * create it.
 *
 * Validation:
 *   - Sign in required (admin-credentials sessions rejected).
 *   - User must have NO existing Player (true State C). Pre-existing
 *     Player → return error directing them through the existing
 *     `applyToLeague` State D path.
 *   - League must exist and be recruiting.
 *
 * Side effects, all inside one transaction:
 *   - Create Player { name: null, userId, lineId? }
 *   - Update User.playerId
 *   - Create PLM { playerId, leagueId, fromGameWeek: 1,
 *                  applicationStatus: PENDING, joinSource: SELF_SERVE,
 *                  onboardingStatus: NOT_YET, position: null }
 *   - Create LeagueInvite { kind: PERSONAL, targetPlayerId: player.id,
 *                           code, leagueId, skipOnboarding: false,
 *                           maxUses: 1, usedCount: 1 (pre-redeemed),
 *                           expiresAt: now + 7 days }
 *
 * Returns the invite code so the client can `router.push('/join/<code>')`.
 * Retries on `P2002` unique-collision (the 12-char alphabet has ~58
 * bits of entropy; collisions are vanishingly rare but defensive).
 */

export type RecruitToLeagueWithOnboardingResult =
  | { ok: true; code: string; playerId: string }
  | { ok: false; error: string }

export async function recruitToLeagueWithOnboarding(input: {
  leagueId: string
}): Promise<RecruitToLeagueWithOnboardingResult> {
  const session = await getServerSession(authOptions)
  if (!session) {
    return { ok: false, error: 'Sign in required' }
  }
  const userId = (session as { userId?: string | null }).userId ?? null
  if (!userId) {
    return { ok: false, error: 'Admin sessions cannot submit applications' }
  }

  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: { id: true, recruiting: true, name: true },
  })
  if (!league) return { ok: false, error: 'League not found' }
  if (!league.recruiting) {
    return { ok: false, error: 'This league is not currently recruiting' }
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, playerId: true, lineId: true },
  })
  if (!user) return { ok: false, error: 'User not found' }
  if (user.playerId) {
    // True State D — the user already has a Player and should go through
    // the existing simplified `applyToLeague` flow instead.
    return {
      ok: false,
      error: 'You already have a player profile. Use the existing apply flow.',
    }
  }

  // Generate the invite code with collision retry.
  const MAX_RETRIES = 5
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const code = generateInviteCode()
    try {
      const result = await prisma.$transaction(async (tx) => {
        const player = await tx.player.create({
          data: {
            // name stays null — onboarding form will set it.
            userId: user.id,
            lineId: user.lineId ?? null,
          },
        })
        await tx.user.update({
          where: { id: user.id },
          data: { playerId: player.id },
        })
        await tx.playerLeagueMembership.create({
          data: {
            playerId: player.id,
            leagueTeamId: null,
            leagueId: league.id,
            fromGameWeek: 1,
            applicationStatus: 'PENDING',
            joinSource: 'SELF_SERVE',
            onboardingStatus: 'NOT_YET',
            position: null,
          },
        })
        // Synthetic PERSONAL invite, pre-redeemed so it can't be reused.
        // The /join/[code] resolver will detect the bound user and route
        // straight into /onboarding because Player.name is null.
        await tx.leagueInvite.create({
          data: {
            code,
            kind: 'PERSONAL',
            leagueId: league.id,
            targetPlayerId: player.id,
            createdById: user.id,
            expiresAt: computeInviteExpiry(new Date(), 7),
            maxUses: 1,
            usedCount: 1,
            skipOnboarding: false,
          },
        })
        return { code, playerId: player.id }
      })

      revalidate({
        domain: 'admin',
        paths: [`/admin/leagues/${league.id}/players`],
      })
      revalidate({ domain: 'public' })

      return { ok: true, code: result.code, playerId: result.playerId }
    } catch (err) {
      // Detect Prisma unique-collision on `code` and retry; otherwise
      // propagate.
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code?: string }).code === 'P2002'
      ) {
        continue
      }
      console.error('[recruitToLeagueWithOnboarding] failed:', err)
      return { ok: false, error: 'Failed to start application. Please try again.' }
    }
  }
  return { ok: false, error: 'Could not generate a unique invite code. Please try again.' }
}
