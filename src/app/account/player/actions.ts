'use server'

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { revalidate } from '@/lib/revalidate'
import { deleteMapping } from '@/lib/playerMappingStore'
import { PROFILE_PIC_ALLOWED_TYPES, PROFILE_PIC_MAX_BYTES } from './validation'
import {
  legacyPositionFromArray,
  normalizePositions,
  validatePreferredSecondary,
  type BallType,
} from '@/lib/positions'

/**
 * v1.83.0 — actions split for the multi-league redesign.
 *
 * Pre-v1.83.0 a single `updatePlayerSelf({ name, positions })` action
 * wrote the same submitted positions[] to EVERY active PLM (legacy
 * `updateMany({ playerId, toGameWeek: null })` then v1.82.0's per-row
 * loop). That made it impossible for a player to play GK in League A
 * and FW in League B.
 *
 * v1.83.0 splits this into two actions, each scoped:
 *
 *   1. `updatePlayerProfile({ name })` — player-level. Writes
 *      Player.name + User.name, busts the per-LINE Redis mapping
 *      cache, revalidates. Same auth/owner shape as before.
 *
 *   2. `updatePlayerLeague({ leagueId, positions, idShared })` —
 *      per-league. Owner gate: the membership must be (a) owned by the
 *      calling player and (b) `toGameWeek === null`. Validates
 *      `positions` against THAT league's `ballType` (a soccer membership
 *      can't accept FIXO; a futsal membership can't accept LB). Dual-
 *      writes the legacy `position` scalar so admin reads + the
 *      v1.66.0 fee resolver keep working.
 *
 * Picture upload/removal actions stay player-level (unchanged).
 *
 * Auth gate for both update actions:
 *   - No session → throws.
 *   - Admin-credentials session (no userId, no lineId) → throws.
 *   - Player not resolvable from userId/lineId → throws.
 * The owner gate for `updatePlayerLeague` adds: the leagueId must
 * resolve to ≥1 active PLM owned by the caller. Otherwise it throws
 * "No active membership in that league" (no silent no-op — fast fail
 * helps catch UI/server drift).
 */

interface AuthedSession {
  userId: string | null
  lineId: string | null
}

async function requireSelfPlayerSession(): Promise<AuthedSession> {
  const session = await getServerSession(authOptions)
  if (!session) throw new Error('Sign in required')
  const userId = (session as { userId?: string | null }).userId ?? null
  const lineId = session.lineId || null
  if (!userId && !lineId) {
    throw new Error('Admin sessions cannot edit player details')
  }
  return { userId, lineId }
}

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

export interface UpdatePlayerProfileInput {
  name: string
}

/**
 * v1.83.0 — replaces the player-level half of the old `updatePlayerSelf`.
 * Writes Player.name + User.name, busts the per-LINE Redis mapping
 * cache so the next JWT callback re-reads the fresh `playerName`,
 * revalidates the page.
 */
export async function updatePlayerProfile(
  input: UpdatePlayerProfileInput,
): Promise<void> {
  const session = await requireSelfPlayerSession()
  const playerId = await resolveOwnedPlayerId(session)

  const trimmedName = input.name.trim()
  if (!trimmedName) throw new Error('Name is required')
  if (trimmedName.length > 100) throw new Error('Name must be 100 characters or fewer')

  await prisma.$transaction(async (tx) => {
    await tx.player.update({
      where: { id: playerId },
      data: { name: trimmedName },
    })
    // v1.72.0 — sync User.name = Player.name for the linked User.
    await tx.user.updateMany({
      where: { playerId },
      data: { name: trimmedName },
    })
  })

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

export interface UpdatePlayerLeagueInput {
  leagueId: string
  /** @deprecated Use preferredPositions + secondaryPositions instead. */
  positions?: ReadonlyArray<string>
  preferredPositions?: ReadonlyArray<string>
  secondaryPositions?: ReadonlyArray<string>
  idShared?: boolean
}

/**
 * v1.83.0 — per-league membership update. The owner gate scopes the
 * write to active PLMs owned by the calling player in this league.
 *
 * Fields:
 *   - `positions` (optional) — validated against the league's ballType.
 *     Empty array clears positions. Omit to leave unchanged.
 *   - `idShared` (optional) — per-league consent for the player's
 *     uploaded ID being viewable by THIS league's admins. Omit to
 *     leave unchanged.
 *
 * If both are omitted the action is a no-op revalidate (no DB write).
 * The dual-write of legacy `position` happens only when `positions`
 * is specified; we don't want to clobber the legacy column when only
 * `idShared` is being toggled.
 */
export async function updatePlayerLeague(
  input: UpdatePlayerLeagueInput,
): Promise<void> {
  const session = await requireSelfPlayerSession()
  const playerId = await resolveOwnedPlayerId(session)

  if (!input.leagueId) throw new Error('leagueId is required')

  // Owner gate: scope the lookup to active PLMs owned by THIS player
  // in THIS league. Use findFirst to surface a clear error when the
  // player has no active membership in the requested league (vs. a
  // silent no-op via updateMany that masks UI/server drift).
  const target = await prisma.playerLeagueMembership.findFirst({
    where: { playerId, leagueId: input.leagueId, toGameWeek: null },
    select: {
      id: true,
      league: { select: { ballType: true } },
      leagueTeam: { select: { league: { select: { ballType: true } } } },
    },
  })
  if (!target) {
    throw new Error('No active membership in that league')
  }

  const ballType: BallType =
    (target.league?.ballType as BallType | undefined) ??
    (target.leagueTeam?.league.ballType as BallType | undefined) ??
    'SOCCER'

  const data: {
    positions?: string[]
    preferredPositions?: string[]
    secondaryPositions?: string[]
    position?: 'GK' | 'DF' | 'MF' | 'FW' | null
    idShared?: boolean
  } = {}

  const hasNewFields =
    input.preferredPositions !== undefined || input.secondaryPositions !== undefined
  const hasLegacyField = input.positions !== undefined

  if (hasNewFields) {
    const result = validatePreferredSecondary(
      input.preferredPositions,
      input.secondaryPositions,
      ballType,
    )
    if (!result.ok) throw new Error(result.error)
    data.preferredPositions = result.preferred
    data.secondaryPositions = result.secondary
    // Dual-write positions[] = concat(preferred, secondary) for backward compat
    data.positions = [...result.preferred, ...result.secondary]
    data.position = legacyPositionFromArray(result.preferred)
  } else if (hasLegacyField) {
    const validated = normalizePositions(input.positions!, ballType)
    data.positions = validated
    data.preferredPositions = validated
    data.secondaryPositions = []
    data.position = legacyPositionFromArray(validated)
  }

  if (input.idShared !== undefined) {
    data.idShared = input.idShared
  }

  if (Object.keys(data).length > 0) {
    // Scope the write the same way as the lookup so concurrent admin
    // writes can't sneak through (e.g. an admin marks the membership
    // INACTIVE between the lookup and the write — updateMany scoped to
    // toGameWeek === null still no-ops if the row no longer matches,
    // which is the right shape).
    await prisma.playerLeagueMembership.updateMany({
      where: { playerId, leagueId: input.leagueId, toGameWeek: null },
      data,
    })
  }

  revalidate({ domain: 'public', paths: ['/account/player'] })
}

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
