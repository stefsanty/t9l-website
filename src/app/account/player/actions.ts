'use server'

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { revalidate } from '@/lib/revalidate'
import type { Prisma } from '@prisma/client'

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

export const PROFILE_PIC_MAX_BYTES = 5 * 1024 * 1024
export const PROFILE_PIC_ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

interface AuthedSession {
  userId: string
  playerId: string
}

async function requireSelfPlayerSession(): Promise<AuthedSession> {
  const session = await getServerSession(authOptions)
  if (!session) throw new Error('Sign in required')
  const userId = (session as { userId?: string | null }).userId ?? null
  const playerId = session.playerId ?? null
  if (!userId) {
    throw new Error('Admin sessions cannot edit player details')
  }
  if (!playerId) {
    throw new Error('Redeem your league invite to set up your player profile')
  }
  return { userId, playerId }
}

/**
 * Resolve the calling user's Player row id from session.playerId, which
 * is the v1.5.0 slug shape (no `p-` prefix). DB rows carry the prefix —
 * but we cannot trust the slug alone; we MUST verify against
 * Player.userId so a session that's been tampered with (or carries a
 * stale playerId after admin remap) can't edit a row it no longer owns.
 *
 * Returns the DB-prefixed Player.id on success; throws on mismatch.
 */
async function resolveOwnedPlayerId(session: AuthedSession): Promise<string> {
  const player = await prisma.player.findUnique({
    where: { userId: session.userId },
    select: { id: true },
  })
  if (!player) {
    throw new Error('No player linked to your account')
  }
  return player.id
}

export interface UpdatePlayerSelfInput {
  name: string
  position?: 'GK' | 'DF' | 'MF' | 'FW' | null
  preferredLeagueTeamId?: string | null
  preferredTeammateIds?: string[]
  preferredTeammatesFreeText?: string | null
}

export async function updatePlayerSelf(input: UpdatePlayerSelfInput): Promise<void> {
  const session = await requireSelfPlayerSession()
  const playerId = await resolveOwnedPlayerId(session)

  const trimmedName = input.name.trim()
  if (!trimmedName) throw new Error('Name is required')
  if (trimmedName.length > 100) throw new Error('Name must be 100 characters or fewer')

  const preferences: Prisma.InputJsonValue = {
    preferredLeagueTeamId: input.preferredLeagueTeamId ?? null,
    preferredTeammateIds: input.preferredTeammateIds ?? [],
    preferredTeammatesFreeText: input.preferredTeammatesFreeText ?? null,
  }

  await prisma.player.update({
    where: { id: playerId },
    data: {
      name: trimmedName,
      position: input.position ?? null,
      onboardingPreferences: preferences,
    },
  })

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
