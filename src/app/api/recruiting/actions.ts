'use server'

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { revalidate } from '@/lib/revalidate'

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
 * v1.67.2 — `recruitToLeagueWithOnboarding` removed.
 *
 * Pre-v1.67.2 this action created a synthetic PERSONAL `LeagueInvite`
 * with `usedCount = maxUses = 1` (pre-redeemed) plus an empty Player +
 * PLM(PENDING) all in one transaction, then routed the user to
 * `/join/<code>` expecting the page's existingBinding-detection branch
 * to forward them to `/onboarding`. Two bugs:
 *   1. `validateInvite` rejects `usedCount >= maxUses` as `'used-up'`
 *      BEFORE the existingBinding branch can fire — every State C
 *      user landed on "This invite has been used."
 *   2. The empty Player + PLM rows persisted regardless, leaving
 *      orphan PENDING applications in the admin view.
 *
 * v1.67.2 design: NO synthetic invite. NO Player or PLM upfront. The
 * State C CTA navigates to the new `/recruit/<slug>` route, which
 * renders an empty form. On submit, the existing `applyToLeague`
 * action (above) creates Player + PLM(PENDING) atomically with all
 * the data the user actually filled in. Same atomicity contract as
 * admin invites without any invite gymnastics.
 *
 * Operator follow-up: orphan rows from the v1.67.0 → v1.67.2 window
 * need a one-time cleanup pass. Surface in the PR description.
 */

/**
 * v1.68.0 — single-page registration with ID + optional profile picture.
 *
 * `registerToLeague(formData)` is the FormData equivalent of
 * `applyToLeague` for the State C path on `/recruit/[slug]`. It
 * collects name + position + idFront + idBack + (optional) profile
 * picture in one shot, uploads ID images (and the picture if present)
 * to Vercel Blob, and creates Player + PLM(PENDING) atomically with
 * every URL already populated. No multi-step wizard, no orphan rows
 * on click-and-bounce.
 *
 * Validation gates (reject before any Blob write):
 *   - Sign in required (rejects no-session)
 *   - Admin-credentials sessions rejected (no userId on session)
 *   - User must NOT already have a Player binding (recruit is the
 *     fresh-Player path; State D users redirect at the route layer)
 *   - League must exist + recruiting
 *   - Trimmed name required (≤100 chars)
 *   - idFront + idBack files required (server-side authoritative
 *     mirror of the client gate)
 *   - BLOB_READ_WRITE_TOKEN present — without it ID upload cannot
 *     proceed (no skip path; user-initiated registration treats ID
 *     as load-bearing per v1.68.0's brief)
 *
 * On any Blob upload failure mid-way: the upload promise rejects and
 * the action returns ok=false. Any prior successful uploads orphan
 * in Blob (no Player exists to track them); operator can sweep
 * unreferenced `register-pending/<userId>/...` paths periodically.
 * In practice retries will either succeed (re-uploading at a fresh
 * timestamped path) or land at the same orphan-Blob outcome — neither
 * corrupts the database state.
 */
export async function registerToLeague(formData: FormData): Promise<ApplyToLeagueResult> {
  const session = await getServerSession(authOptions)
  if (!session) {
    return { ok: false, error: 'Sign in required' }
  }
  const userId = (session as { userId?: string | null }).userId ?? null
  if (!userId) {
    return { ok: false, error: 'Admin sessions cannot submit applications' }
  }

  const leagueId = formData.get('leagueId')
  if (typeof leagueId !== 'string' || !leagueId) {
    return { ok: false, error: 'Missing leagueId' }
  }
  const rawName = formData.get('name')
  if (typeof rawName !== 'string') {
    return { ok: false, error: 'Your name is required' }
  }
  const trimmedName = rawName.trim()
  if (!trimmedName) {
    return { ok: false, error: 'Your name is required' }
  }
  if (trimmedName.length > 100) {
    return { ok: false, error: 'Name must be 100 characters or fewer' }
  }
  const rawPosition = formData.get('position')
  const position = normalizePosition(typeof rawPosition === 'string' ? rawPosition : null)

  const idFront = formData.get('idFront')
  const idBack = formData.get('idBack')
  if (!(idFront instanceof File) || idFront.size === 0) {
    return { ok: false, error: 'Front of ID is required' }
  }
  if (!(idBack instanceof File) || idBack.size === 0) {
    return { ok: false, error: 'Back of ID is required' }
  }
  const profilePicture = formData.get('profilePicture')
  const hasProfilePicture =
    profilePicture instanceof File && profilePicture.size > 0
      ? (profilePicture as File)
      : null

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return {
      ok: false,
      error: 'ID upload is currently unavailable. Contact the league admin.',
    }
  }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
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
    // State D — recruit page redirects these users away. If they POST
    // here directly, route them to the no-files `applyToLeague` path
    // by responding with a clear error. (Don't silently re-key the
    // request; State D never needs to upload ID via this surface.)
    return {
      ok: false,
      error: 'You already have a player. Use the apply button on the league page.',
    }
  }

  // Upload ID + (optional) profile picture in parallel BEFORE the
  // transaction. Any Blob failure short-circuits before DB writes —
  // partial uploads orphan but no Player rows leak.
  const { put } = await import('@vercel/blob')
  const ts = Date.now()
  const uploads: Promise<{ url: string }>[] = [
    put(`register-pending/${user.id}/id-front-${ts}.${extOf(idFront.name)}`, idFront, {
      access: 'public',
      addRandomSuffix: false,
      contentType: idFront.type || 'application/octet-stream',
    }),
    put(`register-pending/${user.id}/id-back-${ts}.${extOf(idBack.name)}`, idBack, {
      access: 'public',
      addRandomSuffix: false,
      contentType: idBack.type || 'application/octet-stream',
    }),
  ]
  if (hasProfilePicture) {
    uploads.push(
      put(`register-pending/${user.id}/profile-${ts}.${extOf(hasProfilePicture.name)}`, hasProfilePicture, {
        access: 'public',
        addRandomSuffix: false,
        contentType: hasProfilePicture.type || 'application/octet-stream',
      }),
    )
  }
  let frontResult: { url: string }
  let backResult: { url: string }
  let picResult: { url: string } | null = null
  try {
    const results = await Promise.all(uploads)
    frontResult = results[0]
    backResult = results[1]
    picResult = hasProfilePicture ? results[2] : null
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Upload failed',
    }
  }

  // Atomic transaction: Player + User.playerId mirror + PLM(PENDING)
  // with every URL populated up-front. Onboarding is COMPLETE — the
  // user filled everything in one shot, no follow-up step.
  const player = await prisma.$transaction(async (tx) => {
    const created = await tx.player.create({
      data: {
        name: trimmedName,
        userId: user.id,
        lineId: user.lineId ?? null,
        idFrontUrl: frontResult.url,
        idBackUrl: backResult.url,
        idUploadedAt: new Date(),
        profilePictureUrl: picResult?.url ?? null,
      },
    })
    await tx.user.update({
      where: { id: user.id },
      data: { playerId: created.id },
    })
    await tx.playerLeagueMembership.create({
      data: {
        playerId: created.id,
        leagueTeamId: null,
        leagueId: league.id,
        fromGameWeek: 1,
        applicationStatus: 'PENDING',
        position,
        joinSource: 'SELF_SERVE',
        // v1.68.0 — onboarding is COMPLETED at registration time
        // because every required field (name + ID front + back) is
        // captured in the same submit. No follow-up /onboarding or
        // /id-upload step needed.
        onboardingStatus: 'COMPLETED',
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

function normalizePosition(raw: string | null): 'GK' | 'DF' | 'MF' | 'FW' | null {
  if (raw === 'GK' || raw === 'DF' || raw === 'MF' || raw === 'FW') return raw
  return null
}

function extOf(filename: string): string {
  const i = filename.lastIndexOf('.')
  if (i < 0) return 'bin'
  return filename.slice(i + 1).toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'
}
