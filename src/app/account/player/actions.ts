'use server'

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { revalidate } from '@/lib/revalidate'
import { deleteMapping } from '@/lib/playerMappingStore'
import { PROFILE_PIC_ALLOWED_TYPES, PROFILE_PIC_MAX_BYTES } from './validation'

/**
 * v1.37.0 (PR ι) — user self-service "Change player details".
 *
 * Three actions:
 *
 *   1. updatePlayerSelf — name / position / preferences. Identical
 *      validation shape to /join/[code]/onboarding's submitOnboarding
 *      so the field semantics stay consistent across the two surfaces.
 *
 *   2. uploadPlayerProfilePicture — file upload to Vercel Blob.
 *      Replace-only: re-upload deletes the prior asset. Validates
 *      MIME (image/jpeg | image/png | image/webp) and size (≤5MB).
 *      Operator gate: requires `BLOB_READ_WRITE_TOKEN`. Without it,
 *      throws a friendly error so the form can surface "ask admin".
 *
 *   3. removePlayerProfilePicture — clears the column + DELs the Blob.
 *      Best-effort Blob delete (logged on failure); the column always
 *      clears so the UI doesn't dangle a stale URL.
 *
 * Auth gate: session must carry `userId` AND `playerId`. Admins
 * (admin-credentials sessions) have no playerId so they can't reach
 * this surface — they edit player rows via /admin/leagues/[id]/players.
 *
 * Why playerId-gated (not just session-gated): authenticated lurkers
 * (Google/email signed in but no LeagueInvite redeemed) have no Player
 * row to edit. The page renders a friendly "redeem your invite first"
 * message instead of a form.
 */

// v1.59.2 — `PROFILE_PIC_MAX_BYTES` and `PROFILE_PIC_ALLOWED_TYPES` moved
// to `./validation` because exporting non-async values from a `'use server'`
// file turns them into server-action proxies on the client (the values
// never reach the browser). See `validation.ts` for the full backstory.
// Re-exporting here would re-introduce the bug — DON'T.

interface AuthedSession {
  userId: string | null
  lineId: string | null
}

/**
 * v1.59.1 — gate loosened to accept either `userId` (canonical post-α.5)
 * OR `lineId` (legacy fallback for pre-v1.28.0 LINE sessions). Pre-v1.59.1
 * the gate threw "Admin sessions cannot edit" for any session without
 * `userId`, which incorrectly rejected grandfathered LINE users (and
 * LINE-auth admins like Stefan S whose role is orthogonal to player
 * binding). Admin role is NOT a gate here — it's about whether the
 * session can resolve to a linked Player row.
 *
 * Admin-credentials sessions (no userId, no lineId) still throw — they
 * have no auth-provider link to any Player and edit players via
 * /admin/leagues/[id]/players instead.
 *
 * The session.playerId presence check is dropped — the gate is now
 * "can we resolve a linked Player from `userId` or `lineId`," and that
 * resolution happens in `resolveOwnedPlayerId` below. session.playerId
 * can be stale post-admin-remap; userId/lineId stay canonical.
 */
async function requireSelfPlayerSession(): Promise<AuthedSession> {
  const session = await getServerSession(authOptions)
  if (!session) throw new Error('Sign in required')
  const userId = (session as { userId?: string | null }).userId ?? null
  // session.lineId is typed `string` (empty for admin-credentials).
  const lineId = session.lineId || null
  if (!userId && !lineId) {
    throw new Error('Admin sessions cannot edit player details')
  }
  return { userId, lineId }
}

/**
 * Resolve the calling user's Player row id by trying `userId` first
 * (canonical post-α.5 / v1.27.0 binding from PR β/v1.29.0 dual-write),
 * falling back to `lineId` (legacy pre-v1.28.0 binding). Both
 * identifiers are minted by the auth server, so either is a safe
 * lookup key.
 *
 * Looking up by session.playerId (slug) alone is unsafe — admin remap
 * can leave the slug stale relative to the canonical lineId/userId
 * binding. The userId/lineId pair always reflects the current binding.
 *
 * Returns the DB-prefixed Player.id on success; throws on mismatch.
 */
async function resolveOwnedPlayerId(session: AuthedSession): Promise<string> {
  let player: { id: string } | null = null
  if (session.userId) {
    player = await prisma.player.findUnique({
      where: { userId: session.userId },
      select: { id: true },
    })
  }
  if (!player && session.lineId) {
    player = await prisma.player.findUnique({
      where: { lineId: session.lineId },
      select: { id: true },
    })
  }
  if (!player) {
    throw new Error('No player linked to your account')
  }
  return player.id
}

export interface UpdatePlayerSelfInput {
  name: string
  position?: 'GK' | 'DF' | 'MF' | 'FW' | null
}

export async function updatePlayerSelf(input: UpdatePlayerSelfInput): Promise<void> {
  const session = await requireSelfPlayerSession()
  const playerId = await resolveOwnedPlayerId(session)

  const trimmedName = input.name.trim()
  if (!trimmedName) throw new Error('Name is required')
  if (trimmedName.length > 100) throw new Error('Name must be 100 characters or fewer')

  // v1.62.0 — `Player.onboardingPreferences` is no longer written here.
  // The column stays in the schema for compatibility (existing JSON data
  // is preserved). The form no longer captures preference fields.
  // v1.65.4 — position lives on PlayerLeagueMembership, not Player.
  // Update Player's identity (name) + PLM(s)' position in one transaction.
  await prisma.$transaction(async (tx) => {
    await tx.player.update({
      where: { id: playerId },
      data: {
        name: trimmedName,
      },
    })
    await tx.playerLeagueMembership.updateMany({
      where: { playerId, toGameWeek: null },
      data: { position: input.position ?? null },
    })
  })

  // v1.62.0 — invalidate the per-league Redis mapping store (v1.5.0
  // canonical store) for this LINE id so the next JWT callback re-reads
  // the fresh `playerName` from Prisma. Without this, the account-menu
  // dropdown keeps showing the old name until the 24h sliding TTL
  // expires. `deleteMapping(lineId)` (no leagueId arg) SCANs the
  // namespace and DELs every per-league entry — the right shape because
  // we don't know which league(s) the user is currently routed to.
  // Best-effort; failure here is silent (the next JWT callback will
  // still get the stale value but eventually self-heals).
  if (session.lineId) {
    await deleteMapping(session.lineId).catch((err) => {
      console.warn(
        '[account/player] deleteMapping failed for lineId=%s: %o',
        session.lineId,
        err,
      )
    })
  }

  revalidate({ domain: 'public', paths: ['/account/player'] })
}

/**
 * Validate and upload a profile picture File. Pure-ish: pulls
 * `@vercel/blob` lazily so unit tests don't need to mock the import
 * graph (and so the import only happens on the server-action path,
 * never at page render).
 *
 * Returns nothing on success — the caller redirects/refreshes via the
 * revalidatePath tag. Throws on validation failure with a user-facing
 * message; the FormData parse errors throw with technical messages
 * (caught and re-cast by the form component).
 */
export async function uploadPlayerProfilePicture(formData: FormData): Promise<void> {
  const session = await requireSelfPlayerSession()
  const playerId = await resolveOwnedPlayerId(session)

  const file = formData.get('picture')
  if (!(file instanceof File) || file.size === 0) {
    throw new Error('Pick an image file')
  }
  if (!PROFILE_PIC_ALLOWED_TYPES.includes(file.type as typeof PROFILE_PIC_ALLOWED_TYPES[number])) {
    throw new Error('Picture must be a JPEG, PNG, or WebP image')
  }
  if (file.size > PROFILE_PIC_MAX_BYTES) {
    throw new Error('Picture must be 5MB or smaller')
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('Profile picture upload is currently unavailable. Contact admin.')
  }

  const { put, del } = await import('@vercel/blob')

  // Read the prior URL so we can DEL it after the new write lands. We
  // do the put first so a Blob outage doesn't leave the user with no
  // picture; the prior asset only gets deleted on a successful new
  // upload.
  const prior = await prisma.player.findUnique({
    where: { id: playerId },
    select: { profilePictureUrl: true },
  })

  const ext = extOf(file.name) || mimeToExt(file.type)
  const path = `player-profile/${playerId}/${Date.now()}.${ext}`
  const result = await put(path, file, {
    access: 'public',
    addRandomSuffix: false,
    contentType: file.type,
  })

  await prisma.player.update({
    where: { id: playerId },
    data: { profilePictureUrl: result.url },
  })

  // Best-effort delete of the prior asset. A failure here just leaves
  // an orphan in Blob — no user-visible impact.
  if (prior?.profilePictureUrl && prior.profilePictureUrl !== result.url) {
    try {
      await del(prior.profilePictureUrl)
    } catch (err) {
      console.warn(
        '[account/player] failed to delete prior profile picture %s: %o',
        prior.profilePictureUrl,
        err,
      )
    }
  }

  revalidate({ domain: 'public', paths: ['/account/player'] })
}

export async function removePlayerProfilePicture(): Promise<void> {
  const session = await requireSelfPlayerSession()
  const playerId = await resolveOwnedPlayerId(session)

  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { profilePictureUrl: true },
  })

  await prisma.player.update({
    where: { id: playerId },
    data: { profilePictureUrl: null },
  })

  if (player?.profilePictureUrl && process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const { del } = await import('@vercel/blob')
      await del(player.profilePictureUrl)
    } catch (err) {
      console.warn(
        '[account/player] failed to delete profile picture %s: %o',
        player.profilePictureUrl,
        err,
      )
    }
  }

  revalidate({ domain: 'public', paths: ['/account/player'] })
}

function extOf(filename: string): string {
  const i = filename.lastIndexOf('.')
  if (i < 0) return ''
  return filename.slice(i + 1).toLowerCase().replace(/[^a-z0-9]/g, '')
}

function mimeToExt(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  return 'bin'
}
