'use server'

import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { waitUntil } from '@vercel/functions'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { revalidate } from '@/lib/revalidate'
import { validateInvite } from '@/lib/joinValidation'
import { linkUserToPlayer } from '@/lib/identityLink'
import { deleteMapping } from '@/lib/playerMappingStore'
import { sendMail } from '@/lib/email'
import { applicationReceivedEmail } from '@/lib/emailTemplates'
import {
  legacyPositionFromArray,
  normalizePositions,
  validatePreferredSecondary,
  type BallType,
} from '@/lib/positions'

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
 *   5. Sets `joinSource` on the existing PlayerLeagueMembership for
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
  const sessionUserId = (session as { userId?: string | null }).userId ?? null
  // session.lineId is typed `string` (empty string for admin-credentials).
  const sessionLineId = session.lineId || null
  if (!sessionUserId && !sessionLineId) {
    // v1.80.11 — admin-orthogonal-UX rule. Mirrors v1.80.10 in
    // `api/recruiting/actions.ts`. Admin-credentials shared-password
    // sessions (no userId, no lineId) can't redeem; LINE-auth admins
    // and grandfathered LINE sessions (whose JWT predates v1.28.0
    // stage α.5) flow through identically via the lineId fallback.
    return { ok: false, error: 'Sign in with a player account to redeem this invite' }
  }

  if (!input.code) return { ok: false, error: 'Missing invite code' }

  // v1.80.11 — resolve the calling User row by `userId` first
  // (canonical post-α.5 / v1.27.0 binding), falling back to `lineId`
  // (legacy pre-v1.28.0 LINE sessions; LINE-auth admins whose role is
  // orthogonal to player binding). Mirrors v1.80.10 in
  // `api/recruiting/actions.ts`.
  let user: { id: string; lineId: string | null } | null = null
  if (sessionUserId) {
    user = await prisma.user.findUnique({
      where: { id: sessionUserId },
      select: { id: true, lineId: true },
    })
  }
  if (!user && sessionLineId) {
    user = await prisma.user.findUnique({
      where: { lineId: sessionLineId },
      select: { id: true, lineId: true },
    })
  }
  if (!user) {
    return { ok: false, error: 'User not found' }
  }
  const userId = user.id
  // Use the canonical User.lineId (not session.lineId) when telling
  // `linkUserToPlayer` to also stamp Player.lineId. For Google/email
  // sign-ins the User row's lineId is null and the helper will skip
  // the Player.lineId write.
  const lineId = user.lineId

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
  // this invite's league via an existing PlayerLeagueMembership in the
  // league. PERSONAL invites trust the admin-set `targetPlayerId`.
  if (invite.kind === 'CODE') {
    const inLeague = await prisma.playerLeagueMembership.findFirst({
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

    // (b) Mark / create the PlayerLeagueMembership with onboardingStatus
    // + joinSource. Admin pre-stages may have already created one; if
    // not, create with fromGameWeek = 1 (the most-common default).
    const existingAssignment = await tx.playerLeagueMembership.findFirst({
      where: {
        playerId: targetPlayerId,
        leagueTeam: { leagueId: invite.leagueId },
      },
      select: { id: true },
    })
    if (existingAssignment) {
      await tx.playerLeagueMembership.update({
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
  //   - skipOnboarding=true → /join/[code]/welcome (terminal — user is
  //     now a member; v1.81.2 appends `?submitted=redeemInvite` so the
  //     welcome page mounts the post-submit success popup).
  //   - skipOnboarding=false → /join/[code]/onboarding (continuation
  //     form via `completeOnboardingWithId`; no popup at this step —
  //     it fires after the user completes the form).
  // Using subroutes (not query params) keeps the URL shareable /
  // refreshable in case the user closes the tab mid-flow.
  const redirectTo = invite.skipOnboarding
    ? `/join/${invite.code}/welcome?submitted=redeemInvite`
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
  /**
   * v1.82.0 — multi-position. Validated server-side against the
   * league's `ballType` vocabulary. Empty array clears positions for
   * this player's active membership(s) in the league.
   */
  positions?: ReadonlyArray<string>
}

export async function submitOnboarding(input: SubmitOnboardingInput): Promise<void> {
  const session = await getServerSession(authOptions)
  if (!session) throw new Error('Sign in required')
  const sessionUserId = (session as { userId?: string | null }).userId ?? null
  // session.lineId is typed `string` (empty string for admin-credentials).
  const sessionLineId = session.lineId || null
  if (!sessionUserId && !sessionLineId) {
    // v1.80.11 — admin-orthogonal-UX rule. Mirrors v1.80.10. Sessions
    // with neither identifier (admin-credentials shared-password) get
    // a neutral message; LINE-auth admins flow through via lineId.
    throw new Error('Sign in with a player account to complete onboarding')
  }
  // Resolve the calling User row by userId first, falling back to
  // lineId (legacy LINE sessions / LINE-auth admins).
  let user: { id: string; lineId: string | null } | null = null
  if (sessionUserId) {
    user = await prisma.user.findUnique({
      where: { id: sessionUserId },
      select: { id: true, lineId: true },
    })
  }
  if (!user && sessionLineId) {
    user = await prisma.user.findUnique({
      where: { lineId: sessionLineId },
      select: { id: true, lineId: true },
    })
  }
  if (!user) throw new Error('User not found')
  const userId = user.id
  const lineId = user.lineId

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
  // v1.82.0 — also pull `ballType` for position-vocabulary validation.
  const invite = await prisma.leagueInvite.findUnique({
    where: { code: input.code },
    select: { leagueId: true, league: { select: { ballType: true } } },
  })
  if (!invite) throw new Error('Invite not found')

  // v1.82.0 — validate positions against the league's vocabulary.
  // `normalizePositions` throws on cross-format codes; let the error
  // propagate (consistent with the rest of this action's error shape).
  const validatedPositions = normalizePositions(
    input.positions,
    invite.league?.ballType as BallType | null,
  )
  const legacyPosition = legacyPositionFromArray(validatedPositions)

  // v1.35.0 (PR η) — onboarding form completion no longer flips
  // `onboardingStatus` to COMPLETED. The ID-upload step does that. Form
  // submission only persists the form data and routes to the next step.
  // v1.62.0 — `Player.onboardingPreferences` is no longer written. The
  // column stays in the schema for compatibility but the form no longer
  // captures preference fields.
  // v1.65.4 — position lives on PlayerLeagueMembership, not Player.
  // v1.82.0 — dual-write positions[] + legacy enum.
  // v1.86.0 — also dual-write preferredPositions; secondaryPositions stays [].
  await prisma.$transaction(async (tx) => {
    await tx.player.update({
      where: { id: input.playerId },
      data: {
        name: trimmedName,
      },
    })
    await tx.playerLeagueMembership.updateMany({
      where: { playerId: input.playerId, toGameWeek: null },
      data: {
        positions: validatedPositions,
        preferredPositions: validatedPositions,
        secondaryPositions: [],
        position: legacyPosition,
      },
    })
    // No onboardingStatus update — that flips in submitIdUpload (or
    // skipIdUpload when BLOB is unconfigured). The form-completed state
    // is "you've named yourself but still owe an ID."
  })

  // v1.62.0 — invalidate the per-league Redis mapping store so the next
  // JWT callback re-reads the fresh `playerName`. Mirror of the same
  // shape in `updatePlayerSelf` — without it, the account menu would
  // show the old name (or, for a new redemption, "" / empty) until the
  // 24h sliding TTL expires. Best-effort.
  if (lineId) {
    await deleteMapping(lineId).catch((err) => {
      console.warn(
        '[join] deleteMapping failed for lineId=%s: %o',
        lineId,
        err,
      )
    })
  }

  revalidate({ domain: 'admin', paths: [`/admin/leagues/${invite.leagueId}/players`] })
  revalidate({ domain: 'public' })
  redirect(`/join/${input.code}/id-upload`)
  // submitOnboarding is dead code — no caller in src/ imports it.
  // Pre-v1.68.0 multi-step flow, replaced by completeOnboardingWithId.
  // Surfaced as a deletion candidate in v1.81.2; left wired here so the
  // function still typechecks until the cleanup PR.
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
  const sessionUserId = (session as { userId?: string | null }).userId ?? null
  // session.lineId is typed `string` (empty string for admin-credentials).
  const sessionLineId = session.lineId || null
  if (!sessionUserId && !sessionLineId) {
    // v1.80.11 — admin-orthogonal-UX rule. Mirrors v1.80.10.
    throw new Error('Sign in with a player account to complete onboarding')
  }
  // Resolve the calling User row by userId first, falling back to lineId.
  let user: { id: string } | null = null
  if (sessionUserId) {
    user = await prisma.user.findUnique({
      where: { id: sessionUserId },
      select: { id: true },
    })
  }
  if (!user && sessionLineId) {
    user = await prisma.user.findUnique({
      where: { lineId: sessionLineId },
      select: { id: true },
    })
  }
  if (!user) throw new Error('User not found')
  const userId = user.id

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
  // v2.2.8 — `addRandomSuffix: true` so the Blob path is not
  // guessable from playerId + upload timestamp. Reads now go through
  // the authenticated `/api/admin/id-image/[userId]/[side]` proxy, so
  // bearer-URL exposure is no longer the access-control mechanism.
  const [frontResult, backResult] = await Promise.all([
    put(`player-id/${playerId}/front-${Date.now()}.${extOf(front.name)}`, front, {
      access: 'public',
      addRandomSuffix: true,
      contentType: front.type || 'application/octet-stream',
    }),
    put(`player-id/${playerId}/back-${Date.now()}.${extOf(back.name)}`, back, {
      access: 'public',
      addRandomSuffix: true,
      contentType: back.type || 'application/octet-stream',
    }),
  ])

  await prisma.$transaction(async (tx) => {
    // v1.70.0 — ID images now live on User (per-person identity proof,
    // not per-league). Caller is the bound User; write directly.
    await tx.user.update({
      where: { id: userId },
      data: {
        idFrontUrl: frontResult.url,
        idBackUrl: backResult.url,
        idUploadedAt: new Date(),
      },
    })
    await tx.playerLeagueMembership.updateMany({
      where: {
        playerId,
        leagueTeam: { leagueId: invite.leagueId },
      },
      data: { onboardingStatus: 'COMPLETED' },
    })
  })

  revalidate({ domain: 'admin', paths: [`/admin/leagues/${invite.leagueId}/players`] })
  // v1.81.2 — append `?submitted=submitIdUpload` so the welcome page's
  // <SuccessConfirmationGate> mounts the post-submit popup.
  redirect(`/join/${code}/welcome?submitted=submitIdUpload`)
}

function extOf(filename: string): string {
  const i = filename.lastIndexOf('.')
  if (i < 0) return 'bin'
  return filename.slice(i + 1).toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'
}

/**
 * v1.68.0 — single-page onboarding with name + position + ID + optional
 * profile picture in one submit.
 *
 * v1.71.1 — files now upload client-direct to Vercel Blob via
 * `@vercel/blob/client#upload`; this action receives the resulting
 * URLs (a few KB) instead of FormData multipart. The Vercel platform
 * 4.5MB body cap rejected oversize multipart uploads at the edge with
 * HTTP 413 BEFORE the function ran — see the upload-token route at
 * `src/app/api/blob/upload-token/route.ts` for the full rationale.
 *
 * Defense in depth: the upload-token route gates on session.userId +
 * pathname prefix, and this action re-validates the URLs land under
 * `/player-id/<playerId>/` (ID) and `/player-profile/<playerId>/`
 * (picture) on Vercel Blob via `isOwnedBlobUrl`.
 *
 * Validation gates:
 *   - Sign in required + bound user (admin sessions rejected)
 *   - Caller User must be linked to the supplied playerId (defense
 *     in depth — the route only renders the form for the bound user)
 *   - Trimmed name required (≤100 chars)
 *   - All three URLs (when present) must hostname under
 *     `*.public.blob.vercel-storage.com` AND pathname under the
 *     player-keyed prefix
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EMAIL_MAX_LENGTH = 254

export interface CompleteOnboardingWithIdInput {
  code: string
  playerId: string
  name: string
  /**
   * v1.78.0 — required. Validated server-side (regex + ≤254 chars).
   * Conditionally written to `User.email` only if the User row's email
   * is currently null (mirrors `registerToLeague`). The `@unique`
   * constraint on `User.email` may surface a Prisma `P2002` if the
   * submitted address belongs to a different User; that surfaces as a
   * friendly error.
   */
  email: string
  /**
   * v1.82.0 — multi-position. Validated server-side against the
   * league's `ballType` vocabulary.
   * @deprecated v1.93.0 — prefer `preferredPositions` + `secondaryPositions`.
   */
  positions?: ReadonlyArray<string>
  /** v1.93.0 — preferred positions (≤ 3). */
  preferredPositions?: ReadonlyArray<string>
  /** v1.93.0 — secondary positions (uncapped, disjoint from preferred). */
  secondaryPositions?: ReadonlyArray<string>
  idFrontUrl: string
  idBackUrl: string
  profilePictureUrl?: string | null
  /** v1.80.0 — optional free-text comments for the admin. Trimmed before storage. */
  comments?: string | null
}

export async function completeOnboardingWithId(
  input: CompleteOnboardingWithIdInput,
): Promise<void> {
  const session = await getServerSession(authOptions)
  if (!session) throw new Error('Sign in required')
  const sessionUserId = (session as { userId?: string | null }).userId ?? null
  // session.lineId is typed `string` (empty string for admin-credentials).
  const sessionLineId = session.lineId || null
  if (!sessionUserId && !sessionLineId) {
    // v1.80.11 — admin-orthogonal-UX rule. Mirrors v1.80.10.
    throw new Error('Sign in with a player account to complete onboarding')
  }
  // v1.80.11 — resolve User row by userId first, falling back to
  // lineId. Selecting `email` here folds the v1.78.0 lookup at
  // L536-539 into the same query.
  let user: { id: string; lineId: string | null; email: string | null } | null = null
  if (sessionUserId) {
    user = await prisma.user.findUnique({
      where: { id: sessionUserId },
      select: { id: true, lineId: true, email: true },
    })
  }
  if (!user && sessionLineId) {
    user = await prisma.user.findUnique({
      where: { lineId: sessionLineId },
      select: { id: true, lineId: true, email: true },
    })
  }
  if (!user) throw new Error('User not found')
  const userId = user.id
  const lineId = user.lineId

  if (!input.code) throw new Error('Missing invite code')
  if (!input.playerId) throw new Error('Missing playerId')
  const trimmedName = input.name.trim()
  if (!trimmedName) throw new Error('Your name is required')
  if (trimmedName.length > 100) throw new Error('Name must be 100 characters or fewer')

  // v1.78.0 — email is required. Trimmed + lowercased before validation
  // and storage so case differences don't bypass the unique constraint.
  const trimmedEmail = input.email.trim().toLowerCase()
  if (!trimmedEmail) throw new Error('Email is required')
  if (trimmedEmail.length > EMAIL_MAX_LENGTH) throw new Error('Email is too long')
  if (!EMAIL_REGEX.test(trimmedEmail)) {
    throw new Error('Please enter a valid email address')
  }

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
    // v1.79.0 — `league.name` is needed for the application-received
    // email queued below. Cheap join (LeagueInvite → League is 1:1).
    // v1.82.0 — also pull `ballType` for position-vocabulary validation.
    // v1.93.0 — also pull `idRequired` so the ID gate honours the
    // per-league setting (server-side trust; the form prop is hint-only).
    select: {
      leagueId: true,
      league: { select: { name: true, ballType: true, idRequired: true } },
    },
  })
  if (!invite) throw new Error('Invite not found')

  const idPrefix = `/player-id/${input.playerId}/`
  const picPrefix = `/player-profile/${input.playerId}/`
  if (invite.league?.idRequired ?? true) {
    if (!isOwnedBlobUrl(input.idFrontUrl, idPrefix)) {
      throw new Error('Front of ID is required')
    }
    if (!isOwnedBlobUrl(input.idBackUrl, idPrefix)) {
      throw new Error('Back of ID is required')
    }
  }
  if (input.profilePictureUrl && !isOwnedBlobUrl(input.profilePictureUrl, picPrefix)) {
    throw new Error('profilePictureUrl is not for this player')
  }

  // v1.82.0 — validate positions against the league's vocabulary.
  // v1.93.0 — preferred + secondary split with cap on preferred.
  const usingNewShape =
    input.preferredPositions !== undefined ||
    input.secondaryPositions !== undefined
  const positionsResult = validatePreferredSecondary(
    usingNewShape ? input.preferredPositions ?? [] : input.positions ?? [],
    usingNewShape ? input.secondaryPositions ?? [] : [],
    invite.league?.ballType as BallType | null,
  )
  if (!positionsResult.ok) {
    throw new Error(positionsResult.error)
  }
  const validatedPreferred = positionsResult.preferred
  const validatedSecondary = positionsResult.secondary
  const legacyPosition = legacyPositionFromArray(validatedPreferred)

  // v1.78.0 — only WRITE the submitted email if `User.email` is currently
  // null. Mirrors `registerToLeague` — verified pre-existing addresses
  // (Google or magic-link sign-in) are not silently overwritten.
  // v1.80.11 — User row already resolved at the top of the function
  // (selecting `email`); no extra round-trip needed.
  const shouldWriteEmail = !user.email

  try {
    await prisma.$transaction(async (tx) => {
      // v1.70.0 — Player.name + profilePictureUrl stay on Player; ID
      // images move to User (per-person identity proof). Caller is the
      // bound User; write directly.
      await tx.player.update({
        where: { id: input.playerId },
        data: {
          name: trimmedName,
          ...(input.profilePictureUrl
            ? { profilePictureUrl: input.profilePictureUrl }
            : {}),
        },
      })
      await tx.user.update({
        where: { id: userId },
        data: {
          // v1.93.0 — only persist ID-upload columns when the league
          // required ID. When `league.idRequired === false` the form
          // sends empty URLs; we leave the columns unchanged.
          ...((invite.league?.idRequired ?? true)
            ? {
                idFrontUrl: input.idFrontUrl,
                idBackUrl: input.idBackUrl,
                idUploadedAt: new Date(),
              }
            : {}),
          // v1.78.0 — conditionally write email; do not overwrite a
          // pre-existing verified address.
          ...(shouldWriteEmail ? { email: trimmedEmail } : {}),
        },
      })
      // v1.82.0 — dual-write positions[] + legacy enum.
      // v1.86.0 — preferredPositions / secondaryPositions populated
      // independently when the new shape is supplied.
      // v1.93.0 — `positions[]` mirrors preferred (matches the v1.93.0
      // convention that positions[] = preferred for legacy single-array
      // readers).
      await tx.playerLeagueMembership.updateMany({
        where: { playerId: input.playerId, toGameWeek: null },
        data: {
          positions: validatedPreferred,
          preferredPositions: validatedPreferred,
          secondaryPositions: validatedSecondary,
          position: legacyPosition,
        },
      })
      await tx.playerLeagueMembership.updateMany({
        where: {
          playerId: input.playerId,
          leagueTeam: { leagueId: invite.leagueId },
        },
        data: {
          onboardingStatus: 'COMPLETED',
          // v1.80.0 — persist trimmed comments; null when blank/omitted.
          comments: input.comments?.trim() || null,
        },
      })
    })
  } catch (err) {
    // v1.78.0 — Prisma P2002 = unique-constraint violation. Most common
    // cause on this write path is a `User.email` collision with another
    // account.
    if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
      throw new Error(
        'This email is already linked to another account. Sign in with that account, or use a different email.',
      )
    }
    throw err
  }

  if (lineId) {
    await deleteMapping(lineId).catch((err) => {
      console.warn(
        '[join] deleteMapping failed for lineId=%s: %o',
        lineId,
        err,
      )
    })
  }

  revalidate({ domain: 'admin', paths: [`/admin/leagues/${invite.leagueId}/players`] })
  revalidate({ domain: 'public' })

  // v1.79.0 — fire-and-forget application-received email. Same shape as
  // `registerToLeague`: `waitUntil` keeps SMTP latency off the response
  // critical path; failures are logged for operator grep but never block
  // the redirect.
  waitUntil(
    sendMail({
      to: trimmedEmail,
      ...applicationReceivedEmail({
        leagueName: invite.league.name,
        playerName: trimmedName,
      }),
    }).then((result) => {
      if (result.status !== 'sent') {
        console.error(
          '[v1.79.0 EMAIL] kind=applicant-received path=completeOnboardingWithId status=%s reason=%s',
          result.status,
          result.reason,
        )
      }
    }),
  )

  // v1.81.2 — append `?submitted=completeOnboardingWithId` so the welcome
  // page's <SuccessConfirmationGate> mounts the post-submit popup.
  redirect(`/join/${input.code}/welcome?submitted=completeOnboardingWithId`)
}

function isOwnedBlobUrl(url: string, expectedPrefix: string): boolean {
  try {
    const u = new URL(url)
    if (!u.hostname.endsWith('.public.blob.vercel-storage.com')) return false
    return u.pathname.includes(expectedPrefix)
  } catch {
    return false
  }
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
  const sessionUserId = (session as { userId?: string | null }).userId ?? null
  // session.lineId is typed `string` (empty string for admin-credentials).
  const sessionLineId = session.lineId || null
  if (!sessionUserId && !sessionLineId) {
    // v1.80.11 — admin-orthogonal-UX rule. Mirrors v1.80.10.
    throw new Error('Sign in with a player account to complete onboarding')
  }
  // Resolve the calling User row by userId first, falling back to lineId.
  let user: { id: string } | null = null
  if (sessionUserId) {
    user = await prisma.user.findUnique({
      where: { id: sessionUserId },
      select: { id: true },
    })
  }
  if (!user && sessionLineId) {
    user = await prisma.user.findUnique({
      where: { lineId: sessionLineId },
      select: { id: true },
    })
  }
  if (!user) throw new Error('User not found')
  const userId = user.id

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

  await prisma.playerLeagueMembership.updateMany({
    where: {
      playerId: input.playerId,
      leagueTeam: { leagueId: invite.leagueId },
    },
    data: { onboardingStatus: 'COMPLETED' },
  })

  revalidate({ domain: 'admin', paths: [`/admin/leagues/${invite.leagueId}/players`] })
  // v1.81.2 — append `?submitted=skipIdUpload` so the welcome page's
  // <SuccessConfirmationGate> mounts the post-submit popup.
  redirect(`/join/${input.code}/welcome?submitted=skipIdUpload`)
}
