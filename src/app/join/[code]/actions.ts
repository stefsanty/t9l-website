'use server'

import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { revalidate } from '@/lib/revalidate'
import { validateInvite } from '@/lib/joinValidation'
import { linkUserToPlayer } from '@/lib/identityLink'
import type { Prisma } from '@prisma/client'

/**
 * v1.34.0 (PR ζ) — public redemption endpoint.
 *
 * For a given invite code:
 *   - PERSONAL invite: binds the calling user to `targetPlayerId`.
 *   - CODE invite: takes a `playerId` arg (selected by the user from
 *     the post-validation picker) and binds them to it.
 *
 * The transaction:
 *   1. Re-validates the invite (race-safe — the page-render check was
 *      best-effort; another user might have just consumed the last use).
 *   2. Validates the target Player belongs to this invite's league
 *      (CODE: requires the picked player to be in the league; PERSONAL:
 *      uses the invite's pinned target).
 *   3. Validates the target Player isn't already linked to another User
 *      (the @unique on Player.userId would catch it but a friendly
 *      error beats a Prisma 500).
 *   4. Sets `Player.userId = session.user.id`, mirrors `User.playerId`,
 *      and (when the user authed via LINE) sets `Player.lineId` for
 *      compat with the legacy resolver path. Google/email users land
 *      with `Player.lineId IS NULL` — the first time the codebase has
 *      a logged-in Player with no lineId. γ's Setting flag will
 *      eventually flip the read path so this works transparently.
 *   5. Sets `joinSource` on the existing PlayerLeagueAssignment for
 *      this player+league (or creates one if none exists — admins may
 *      have pre-staged a Player without an assignment).
 *   6. Sets `onboardingStatus`: COMPLETED if `LeagueInvite.skipOnboarding`,
 *      else NOT_YET (the form will flip it later).
 *   7. Increments `LeagueInvite.usedCount`.
 *
 * Returns `{ ok: true, onboardingStatus, redirectTo }` so the caller
 * (the route's signed-in branch) can navigate to either the welcome
 * page (skipOnboarding) or the onboarding form (not yet).
 *
 * Returns `{ ok: false, error }` on validation failures with a
 * user-facing message.
 */

export interface RedeemInviteInput {
  code: string
  /** For CODE invites: the player slot the user picked. Ignored for PERSONAL. */
  pickedPlayerId?: string | null
}

export type RedeemInviteResult =
  | {
      ok: true
      onboardingStatus: 'NOT_YET' | 'COMPLETED'
      redirectTo: string
      playerId: string
    }
  | { ok: false; error: string; code?: string }

export async function redeemInvite(input: RedeemInviteInput): Promise<RedeemInviteResult> {
  const session = await getServerSession(authOptions)
  if (!session) {
    return { ok: false, error: 'You must sign in before redeeming an invite' }
  }
  const userId = (session as { userId?: string | null }).userId ?? null
  if (!userId) {
    // Admin-credentials sessions don't carry a User row — they can't
    // redeem invites. Fail loud rather than silently mis-bind.
    return { ok: false, error: 'Admin sessions cannot redeem player invites' }
  }
  const lineId = session.lineId ?? null

  if (!input.code) return { ok: false, error: 'Missing invite code' }

  const invite = await prisma.leagueInvite.findUnique({
    where: { code: input.code },
  })
  const validation = validateInvite(invite, { now: new Date() })
  if (validation.kind !== 'ok') {
    return { ok: false, error: messageForValidation(validation), code: validation.kind }
  }
  if (!invite) {
    // Unreachable given the kind === 'ok' guard above; satisfies the
    // type narrower for the rest of the function.
    return { ok: false, error: 'Invite not found' }
  }

  // Resolve the target Player.
  let targetPlayerId: string
  if (invite.kind === 'PERSONAL') {
    if (!invite.targetPlayerId) {
      return { ok: false, error: 'Personal invite is missing its target player' }
    }
    targetPlayerId = invite.targetPlayerId
  } else {
    if (!input.pickedPlayerId) {
      return { ok: false, error: 'Pick a player slot to claim' }
    }
    targetPlayerId = input.pickedPlayerId
  }

  // Re-fetch the target with the data we need for the transaction.
  const target = await prisma.player.findUnique({
    where: { id: targetPlayerId },
    select: { id: true, userId: true, lineId: true },
  })
  if (!target) return { ok: false, error: 'Target player not found' }
  if (target.userId && target.userId !== userId) {
    return { ok: false, error: 'This player slot is already claimed by someone else' }
  }

  // For CODE invites, also validate that the picked player belongs to
  // this invite's league via an existing PlayerLeagueAssignment in the
  // league. PERSONAL invites trust the admin-set `targetPlayerId`.
  if (invite.kind === 'CODE') {
    const inLeague = await prisma.playerLeagueAssignment.findFirst({
      where: {
        playerId: targetPlayerId,
        leagueTeam: { leagueId: invite.leagueId },
      },
      select: { id: true },
    })
    if (!inLeague) {
      return { ok: false, error: 'Picked player is not on this league’s roster' }
    }
  }

  const newOnboardingStatus = invite.skipOnboarding ? 'COMPLETED' : 'NOT_YET'
  const newJoinSource = invite.kind === 'PERSONAL' ? 'PERSONAL' : 'CODE'

  await prisma.$transaction(async (tx) => {
    // (a) Bind Player ↔ User. v1.39.0 (PR λ) routes BOTH branches
    // through the new generic `linkUserToPlayer` helper so the
    // invariant-clearing logic (clear stale Player.userId, clear stale
    // User.playerId pointer) runs uniformly for LINE and Google/email
    // flows alike. Pre-λ the non-LINE branch went around the helper
    // and could 500 with a Player.userId @unique violation when a
    // Google/email user rebound to a different Player. See
    // outputs/identity-unification-audit.md for the full audit.
    //
    // The optional `lineId` argument tells the helper whether to ALSO
    // set Player.lineId in the same transaction:
    //   - LINE branch: pass the session's lineId so legacy resolver
    //     (Setting('identity.read-source') === 'legacy') still works.
    //   - non-LINE branch: omit lineId so Player.lineId stays at
    //     whatever it was (typically null for a fresh redemption;
    //     pre-staged admin Players might carry a lineId already, in
    //     which case it's preserved).
    await linkUserToPlayer(tx, {
      userId,
      playerId: targetPlayerId,
      ...(lineId ? { lineId } : {}),
    })

    // (b) Mark / create the PlayerLeagueAssignment with onboardingStatus
    // + joinSource. Admin pre-stages may have already created one; if
    // not, create with fromGameWeek = 1 (the most-common default).
    const existingAssignment = await tx.playerLeagueAssignment.findFirst({
      where: {
        playerId: targetPlayerId,
        leagueTeam: { leagueId: invite.leagueId },
      },
      select: { id: true },
    })
    if (existingAssignment) {
      await tx.playerLeagueAssignment.update({
        where: { id: existingAssignment.id },
        data: {
          onboardingStatus: newOnboardingStatus,
          joinSource: newJoinSource,
        },
      })
    }
    // If no assignment exists for this player in this league: that's a
    // CODE-flavor invite path where the user picked an unlinked slot in
    // a league they're not yet rostered for. We don't auto-create the
    // assignment — that's an admin decision (which team to put them on).
    // The picker should already have filtered to in-league players, so
    // this branch shouldn't fire in practice; it's a defensive no-op.

    // (c) Increment usedCount. Don't update revokedAt — that's an admin
    // action; redemption uses the slot, doesn't burn it.
    await tx.leagueInvite.update({
      where: { id: invite.id },
      data: { usedCount: { increment: 1 } },
    })
  })

  revalidate({ domain: 'admin', paths: [`/admin/leagues/${invite.leagueId}/players`] })
  revalidate({ domain: 'public' })

  // Where does the user land?
  //   - skipOnboarding=true → /join/[code]/welcome
  //   - skipOnboarding=false → /join/[code]/onboarding (the form)
  // Both routes resolve the user's now-bound Player and render
  // accordingly. Using subroutes (not query params) keeps the URL
  // shareable / refreshable in case the user closes the tab mid-flow.
  const redirectTo = invite.skipOnboarding
    ? `/join/${invite.code}/welcome`
    : `/join/${invite.code}/onboarding`

  return {
    ok: true,
    onboardingStatus: newOnboardingStatus,
    redirectTo,
    playerId: targetPlayerId,
  }
}

function messageForValidation(v: ReturnType<typeof validateInvite>): string {
  switch (v.kind) {
    case 'ok':
      return ''
    case 'not-found':
      return 'We don’t recognise this invite code. Check for typos.'
    case 'expired':
      return `This invite expired on ${v.expiredAt.toLocaleDateString()}. Ask the league admin for a new one.`
    case 'revoked':
      return 'This invite has been revoked. Ask the league admin for a new one.'
    case 'used-up':
      return `This invite has been used the maximum number of times (${v.maxUses}).`
    case 'wrong-league':
      return 'This invite is not for the league you’re trying to join.'
  }
}

/**
 * v1.34.0 (PR ζ) — submit the onboarding form. Called by the
 * `/join/[code]/onboarding` page after the user has been bound by
 * `redeemInvite`.
 *
 * Updates Player.name / Player.position / Player.onboardingPreferences,
 * flips the assignment's onboardingStatus to COMPLETED. Idempotent —
 * resubmitting just rewrites the same fields.
 *
 * Validates the calling User is bound to the Player (defense in depth;
 * the route only renders the form for the bound user). Throws on
 * mismatch rather than silently writing — that would let a session
 * with no playerId edit any Player row.
 */
export interface SubmitOnboardingInput {
  code: string
  playerId: string
  name: string
  position?: 'GK' | 'DF' | 'MF' | 'FW' | null
  preferredLeagueTeamId?: string | null
  preferredTeammateIds?: string[]
  preferredTeammatesFreeText?: string | null
}

export async function submitOnboarding(input: SubmitOnboardingInput): Promise<void> {
  const session = await getServerSession(authOptions)
  if (!session) throw new Error('Sign in required')
  const userId = (session as { userId?: string | null }).userId ?? null
  if (!userId) throw new Error('Admin sessions cannot submit onboarding')

  const trimmedName = input.name.trim()
  if (!trimmedName) throw new Error('Your name is required')
  if (trimmedName.length > 100) throw new Error('Name must be 100 characters or fewer')

  // Verify the user is bound to this player.
  const player = await prisma.player.findUnique({
    where: { id: input.playerId },
    select: { id: true, userId: true },
  })
  if (!player) throw new Error('Player not found')
  if (player.userId !== userId) {
    throw new Error('You are not linked to this player slot')
  }

  // Verify the invite resolves to a league we can update the assignment for.
  const invite = await prisma.leagueInvite.findUnique({
    where: { code: input.code },
    select: { leagueId: true },
  })
  if (!invite) throw new Error('Invite not found')

  const preferences: Prisma.InputJsonValue = {
    preferredLeagueTeamId: input.preferredLeagueTeamId ?? null,
    preferredTeammateIds: input.preferredTeammateIds ?? [],
    preferredTeammatesFreeText: input.preferredTeammatesFreeText ?? null,
  }

  // v1.35.0 (PR η) — onboarding form completion no longer flips
  // `onboardingStatus` to COMPLETED. The ID-upload step does that. Form
  // submission only persists the form data and routes to the next step.
  await prisma.$transaction(async (tx) => {
    await tx.player.update({
      where: { id: input.playerId },
      data: {
        name: trimmedName,
        position: input.position ?? null,
        onboardingPreferences: preferences,
      },
    })
    // No onboardingStatus update — that flips in submitIdUpload (or
    // skipIdUpload when BLOB is unconfigured). The form-completed state
    // is "you've named yourself but still owe an ID."
  })

  revalidate({ domain: 'admin', paths: [`/admin/leagues/${invite.leagueId}/players`] })
  revalidate({ domain: 'public' })
  redirect(`/join/${input.code}/id-upload`)
}

/**
 * v1.35.0 (PR η) — finalize onboarding by uploading front + back ID
 * images to Vercel Blob, then flipping the assignment's
 * `onboardingStatus` to COMPLETED.
 *
 * Files arrive via FormData (the only way browsers can stream binary
 * to a server action without base64 round-trip overhead). Each file is
 * uploaded to a stable path keyed on the player's id so a re-upload
 * overwrites the prior asset rather than leaving an orphan in Blob.
 *
 * Admin can purge later via `adminPurgePlayerId` (in admin actions),
 * which DELs both Blob objects and nulls the three columns.
 *
 * Operator-side gate: requires `BLOB_READ_WRITE_TOKEN`. Without it,
 * the route renders a skip flow that calls `skipIdUpload` instead.
 */
export async function submitIdUpload(formData: FormData): Promise<void> {
  const session = await getServerSession(authOptions)
  if (!session) throw new Error('Sign in required')
  const userId = (session as { userId?: string | null }).userId ?? null
  if (!userId) throw new Error('Admin sessions cannot submit onboarding')

  const code = formData.get('code') as string | null
  const playerId = formData.get('playerId') as string | null
  const front = formData.get('idFront') as File | null
  const back = formData.get('idBack') as File | null

  if (!code) throw new Error('Missing invite code')
  if (!playerId) throw new Error('Missing playerId')
  if (!front || !(front instanceof File) || front.size === 0) {
    throw new Error('Front of ID is required')
  }
  if (!back || !(back instanceof File) || back.size === 0) {
    throw new Error('Back of ID is required')
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('ID upload is currently unavailable. Use the Skip option to continue.')
  }

  // Verify the user is bound to this player (defense in depth).
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { id: true, userId: true },
  })
  if (!player) throw new Error('Player not found')
  if (player.userId !== userId) {
    throw new Error('You are not linked to this player slot')
  }

  const invite = await prisma.leagueInvite.findUnique({
    where: { code },
    select: { leagueId: true },
  })
  if (!invite) throw new Error('Invite not found')

  const { put } = await import('@vercel/blob')
  // Upload-or-overwrite at stable paths so a re-upload doesn't orphan
  // the prior asset. `addRandomSuffix: false` is required for the path
  // to be stable (default is true).
  const [frontResult, backResult] = await Promise.all([
    put(`player-id/${playerId}/front-${Date.now()}.${extOf(front.name)}`, front, {
      access: 'public',
      addRandomSuffix: false,
      contentType: front.type || 'application/octet-stream',
    }),
    put(`player-id/${playerId}/back-${Date.now()}.${extOf(back.name)}`, back, {
      access: 'public',
      addRandomSuffix: false,
      contentType: back.type || 'application/octet-stream',
    }),
  ])

  await prisma.$transaction(async (tx) => {
    await tx.player.update({
      where: { id: playerId },
      data: {
        idFrontUrl: frontResult.url,
        idBackUrl: backResult.url,
        idUploadedAt: new Date(),
      },
    })
    await tx.playerLeagueAssignment.updateMany({
      where: {
        playerId,
        leagueTeam: { leagueId: invite.leagueId },
      },
      data: { onboardingStatus: 'COMPLETED' },
    })
  })

  revalidate({ domain: 'admin', paths: [`/admin/leagues/${invite.leagueId}/players`] })
  redirect(`/join/${code}/welcome`)
}

function extOf(filename: string): string {
  const i = filename.lastIndexOf('.')
  if (i < 0) return 'bin'
  return filename.slice(i + 1).toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'
}

/**
 * v1.35.0 (PR η) — operator-gate fallback when `BLOB_READ_WRITE_TOKEN`
 * is missing. Skips the actual ID upload but still flips
 * `onboardingStatus` to COMPLETED so the user isn't permanently stuck.
 * Admin will collect ID separately (out-of-band).
 *
 * Also reachable from a "Skip for now" affordance on the upload page
 * even when BLOB IS configured — handles the edge case where the user
 * doesn't have their ID handy at sign-up time. Admin sees `idUploadedAt
 * IS NULL` in the player list and follows up.
 */
export async function skipIdUpload(input: { code: string; playerId: string }): Promise<void> {
  const session = await getServerSession(authOptions)
  if (!session) throw new Error('Sign in required')
  const userId = (session as { userId?: string | null }).userId ?? null
  if (!userId) throw new Error('Admin sessions cannot submit onboarding')

  const player = await prisma.player.findUnique({
    where: { id: input.playerId },
    select: { id: true, userId: true },
  })
  if (!player) throw new Error('Player not found')
  if (player.userId !== userId) {
    throw new Error('You are not linked to this player slot')
  }

  const invite = await prisma.leagueInvite.findUnique({
    where: { code: input.code },
    select: { leagueId: true },
  })
  if (!invite) throw new Error('Invite not found')

  await prisma.playerLeagueAssignment.updateMany({
    where: {
      playerId: input.playerId,
      leagueTeam: { leagueId: invite.leagueId },
    },
    data: { onboardingStatus: 'COMPLETED' },
  })

  revalidate({ domain: 'admin', paths: [`/admin/leagues/${invite.leagueId}/players`] })
  redirect(`/join/${input.code}/welcome`)
}
