'use server'

import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { waitUntil } from '@vercel/functions'
import { authOptions, getPlayerMappingFromDb } from '@/lib/auth'
import { revalidate } from '@/lib/revalidate'
import { SETTING_IDS, type DataSource, type WriteMode } from '@/lib/settings'
import {
  setMapping,
  deleteMapping,
  type PlayerMapping,
} from '@/lib/playerMappingStore'
import { seedGameWeek, deleteGameWeek as deleteGameWeekFromRedis } from '@/lib/rsvpStore'
import { parseJstDateTimeLocal, parseJstDateOnly } from '@/lib/jst'
import { linkPlayerToUser, unlinkPlayerFromUser } from '@/lib/identityLink'
import {
  generateInviteCode,
  computeInviteExpiry,
  buildInviteUrl,
  INVITE_DEFAULT_EXPIRY_DAYS,
  type InviteCsvRow,
} from '@/lib/inviteCodes'
import { headers } from 'next/headers'
import type { Prisma, PlayerPosition } from '@prisma/client'

/**
 * v1.13.0 — defer the Redis pre-warm off the admin response critical path.
 *
 * Mirror of the v1.8.0 inversion that ships the public hot paths
 * (`/api/assign-player`, `/api/rsvp`): Redis is a secondary store on the
 * admin path (admin pages re-read Prisma directly via the canonical
 * `revalidate` helper's path bust), so the pre-warm can run in
 * `waitUntil`. Drift on Redis failure surfaces in the structured log;
 * recoverable via `scripts/auditRedisVsPrisma.ts`.
 *
 * v1.26.0 — per-league key. `adminLinkLineToPlayer` operates within an
 * explicit leagueId so we pre-warm just that league's key. The other
 * leagues this lineId might be cached in are deliberately left alone —
 * an admin link in League X shouldn't churn League Y's cache.
 */
function deferSetMapping(
  op: 'admin-link' | 'admin-update' | 'admin-create',
  lineId: string,
  leagueId: string,
  mapping: PlayerMapping | null,
): void {
  waitUntil(
    setMapping(lineId, leagueId, mapping).catch((err) =>
      console.error(
        '[v1.13.0 DRIFT] kind=playerMapping op=%s lineId=%s leagueId=%s err=%o',
        op,
        lineId,
        leagueId,
        err,
      ),
    ),
  )
}

async function assertAdmin() {
  const session = await getServerSession(authOptions)
  if (!session?.isAdmin) throw new Error('Unauthorized')
}

// ── League ──────────────────────────────────────────────────────────────────

export async function createLeague(formData: FormData) {
  await assertAdmin()
  const name        = (formData.get('name')        as string).trim()
  const location    = (formData.get('location')    as string).trim()
  const description = (formData.get('description') as string | null)?.trim() || null
  const startDate   = formData.get('startDate')    as string
  const endDate     = formData.get('endDate')      as string | null
  const subdomain   = (formData.get('subdomain')   as string | null)?.trim() || null

  // League startDate/endDate are JST calendar dates (date-only `<input type="date">`).
  // Stored as UTC midnight; see lib/jst.ts.
  const league = await prisma.league.create({
    data: {
      name,
      location,
      description,
      subdomain,
      startDate: parseJstDateOnly(startDate),
      endDate:   endDate ? parseJstDateOnly(endDate) : null,
    },
  })

  revalidate({ domain: 'admin', paths: ['/admin'] })
  redirect(`/admin/leagues/${league.id}/schedule`)
}

export async function updateLeagueInfo(id: string, data: {
  name?:        string
  description?: string | null
  subdomain?:   string | null
  location?:    string
  startDate?:   string
  endDate?:     string | null
}) {
  await assertAdmin()
  await prisma.league.update({
    where: { id },
    data: {
      name:        data.name,
      description: data.description !== undefined ? (data.description || null) : undefined,
      subdomain:   data.subdomain   !== undefined ? (data.subdomain   || null) : undefined,
      location:    data.location,
      startDate:   data.startDate ? parseJstDateOnly(data.startDate) : undefined,
      endDate:     data.endDate !== undefined ? (data.endDate ? parseJstDateOnly(data.endDate) : null) : undefined,
    },
  })
  revalidate({ domain: 'admin', paths: [`/admin/leagues/${id}`, '/admin'] })
}

export async function deleteLeague(id: string) {
  await assertAdmin()
  const completedMatches = await prisma.match.count({
    where: { leagueId: id, status: 'COMPLETED' },
  })
  if (completedMatches > 0) throw new Error('Cannot delete league with completed matches')
  await prisma.league.delete({ where: { id } })
  revalidate({ domain: 'admin', paths: ['/admin'] })
  redirect('/admin')
}

// ── GameWeek ────────────────────────────────────────────────────────────────

export async function createGameWeek(leagueId: string, data: {
  weekNumber: number
  startDate:  string
  endDate:    string
  venueId?:   string | null
}) {
  await assertAdmin()
  // GameWeek startDate/endDate come from `<input type="date">` (JST calendar
  // date stored as UTC midnight). See lib/jst.ts.
  const gw = await prisma.gameWeek.create({
    data: {
      leagueId,
      weekNumber: data.weekNumber,
      startDate:  parseJstDateOnly(data.startDate),
      endDate:    parseJstDateOnly(data.endDate),
      venueId:    data.venueId || null,
    },
  })
  // v1.7.0 — pre-warm the Redis RSVP hash with the `__seeded` sentinel so
  // the first dashboard read for this GW returns hit-with-empty instead of
  // miss-then-Prisma-fallthrough. Failure is swallowed by the store helper;
  // a missing seed self-heals on first read via the publicData backfill.
  await seedGameWeek(gw.id, gw.startDate)
  revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/schedule`] })
}

export async function updateGameWeek(id: string, leagueId: string, data: {
  startDate?: string | null
  endDate?:   string | null
  venueId?:   string | null
}) {
  await assertAdmin()
  // v1.31.0 — `startDate` / `endDate` may be `null` (admin clearing the date
  // → public site renders "TBD"). `undefined` means "field not in the patch
  // — leave it alone". Empty-string normalises to `null` so the date pill's
  // overlaid <input type="date"> can submit a cleared value.
  const startDate =
    data.startDate === undefined
      ? undefined
      : data.startDate
        ? parseJstDateOnly(data.startDate)
        : null
  const endDate =
    data.endDate === undefined
      ? undefined
      : data.endDate
        ? parseJstDateOnly(data.endDate)
        : null
  await prisma.gameWeek.update({
    where: { id },
    data: {
      startDate,
      endDate,
      venueId: data.venueId !== undefined ? (data.venueId || null) : undefined,
    },
  })
  revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/schedule`] })
}

export async function deleteGameWeek(id: string, leagueId: string) {
  await assertAdmin()
  const completedMatches = await prisma.match.count({
    where: { gameWeekId: id, status: 'COMPLETED' },
  })
  if (completedMatches > 0) throw new Error('Cannot delete matchday with completed matches')
  await prisma.gameWeek.delete({ where: { id } })
  // Cleanup-only: orphan Redis hashes would expire on their own (matchday +
  // 90d), but eager deletion keeps the namespace tidy.
  await deleteGameWeekFromRedis(id)
  revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/schedule`] })
}

// ── Match ────────────────────────────────────────────────────────────────────

export async function createMatch(gameWeekId: string, leagueId: string, data: {
  homeTeamId: string
  awayTeamId: string
  playedAt:   string
}) {
  await assertAdmin()
  // Match playedAt comes from `<input type="datetime-local">` (JST clock
  // string). Use parseJstDateTimeLocal — never `new Date(str)`, which on
  // Vercel (TZ=UTC) would skew JST 14:30 → UTC 14:30 (= JST 23:30).
  // See lib/jst.ts and CLAUDE.md "Time handling".
  await prisma.match.create({
    data: {
      leagueId,
      gameWeekId,
      homeTeamId: data.homeTeamId,
      awayTeamId: data.awayTeamId,
      playedAt:   parseJstDateTimeLocal(data.playedAt),
      status:     'SCHEDULED',
    },
  })
  revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/schedule`] })
}

export async function updateMatch(id: string, leagueId: string, data: {
  homeScore?:  number
  awayScore?:  number
  playedAt?:   string
  endedAt?:    string | null
  homeTeamId?: string
  awayTeamId?: string
  status?:     string
}) {
  await assertAdmin()
  const updateData: Record<string, unknown> = {}
  if (data.homeScore  !== undefined) updateData.homeScore  = data.homeScore
  if (data.awayScore  !== undefined) updateData.awayScore  = data.awayScore
  // playedAt + endedAt are JST clock strings — parse with the JST helper.
  if (data.playedAt)                 updateData.playedAt   = parseJstDateTimeLocal(data.playedAt)
  if (data.endedAt !== undefined)    updateData.endedAt    = data.endedAt ? parseJstDateTimeLocal(data.endedAt) : null
  if (data.homeTeamId)               updateData.homeTeamId = data.homeTeamId
  if (data.awayTeamId)               updateData.awayTeamId = data.awayTeamId
  if (data.status) {
    updateData.status = data.status
    if (data.status === 'COMPLETED' && data.homeScore !== undefined && data.awayScore !== undefined) {
      updateData.homeScore = data.homeScore
      updateData.awayScore = data.awayScore
    }
  }
  await prisma.match.update({ where: { id }, data: updateData })
  revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/schedule`] })
}

export async function deleteMatch(id: string, leagueId: string) {
  await assertAdmin()
  await prisma.match.delete({ where: { id } })
  revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/schedule`] })
}

// ── Teams ────────────────────────────────────────────────────────────────────

export async function enrollTeam(leagueId: string, teamId: string) {
  await assertAdmin()
  await prisma.leagueTeam.create({ data: { leagueId, teamId } })
  revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/teams`] })
}

export async function removeTeamFromLeague(leagueTeamId: string, leagueId: string) {
  await assertAdmin()
  const completedMatches = await prisma.match.count({
    where: {
      status: 'COMPLETED',
      OR: [{ homeTeamId: leagueTeamId }, { awayTeamId: leagueTeamId }],
    },
  })
  if (completedMatches > 0) throw new Error('Cannot remove team with completed matches')
  await prisma.leagueTeam.delete({ where: { id: leagueTeamId } })
  revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/teams`] })
}

// ── Players ──────────────────────────────────────────────────────────────────

export async function assignPlayer(playerId: string, leagueTeamId: string, fromGameWeek: number) {
  await assertAdmin()
  await prisma.playerLeagueAssignment.create({
    data: { playerId, leagueTeamId, fromGameWeek },
  })
  const lt = await prisma.leagueTeam.findUnique({ where: { id: leagueTeamId }, select: { leagueId: true } })
  if (lt) {
    revalidate({ domain: 'admin', paths: [`/admin/leagues/${lt.leagueId}/players`] })
  }
}

export async function transferPlayer(
  playerId: string,
  fromLeagueTeamId: string,
  toLeagueTeamId: string,
  fromGameWeek: number,
  leagueId: string,
) {
  await assertAdmin()
  await prisma.$transaction(async (tx) => {
    await tx.playerLeagueAssignment.updateMany({
      where: { playerId, leagueTeamId: fromLeagueTeamId, toGameWeek: null },
      data: { toGameWeek: fromGameWeek - 1 },
    })
    await tx.playerLeagueAssignment.create({
      data: { playerId, leagueTeamId: toLeagueTeamId, fromGameWeek },
    })
  })
  revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/players`] })
}

export async function removePlayerFromLeague(playerId: string, leagueId: string) {
  await assertAdmin()
  const leagueTeamIds = (
    await prisma.leagueTeam.findMany({ where: { leagueId }, select: { id: true } })
  ).map((lt) => lt.id)
  await prisma.playerLeagueAssignment.deleteMany({
    where: { playerId, leagueTeamId: { in: leagueTeamIds } },
  })
  revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/players`] })
}

/**
 * Flow B (PR 6): admin links an orphan LINE login to a Player record.
 *
 * Atomic: clear `lineId` from any other Player that currently holds it (the
 * @unique constraint would otherwise block the write), then set on the
 * target. updateMany rather than findFirst+update keeps the no-prior-holder
 * case as a no-op instead of throwing.
 *
 * The lineId belonging to a different Player should be vanishingly rare
 * (LINE IDs are stable per user), but this guards against the case where
 * the operator is moving a LINE link from one Player record to another
 * after a roster correction.
 */
export async function adminLinkLineToPlayer(input: {
  playerId: string
  lineId: string
  leagueId: string
}) {
  await assertAdmin()
  const { playerId, lineId, leagueId } = input
  if (!playerId || !lineId) throw new Error('playerId and lineId are required')

  // v1.10.0 / PR B — read the TARGET player's prior lineId so we can
  // clean up its Redis mapping after the remap. Without this, if admin
  // remaps lineId X from player A to player B (where B already had
  // lineId Y), Y would remain in Redis pointing at B. Y becomes orphan
  // but the Redis entry doesn't decay until the 24h sliding TTL.
  const targetBefore = await prisma.player.findUnique({
    where: { id: playerId },
    select: { lineId: true },
  })
  const targetPriorLineId = targetBefore?.lineId ?? null

  // v1.29.0 (stage β) — single transaction covers the legacy Player.lineId
  // mutation AND the new User.playerId / Player.userId dual-write. Atomic:
  // either both land or neither.
  await prisma.$transaction(async (tx) => {
    await tx.player.updateMany({
      where: { lineId, id: { not: playerId } },
      data: { lineId: null },
    })
    await tx.player.update({
      where: { id: playerId },
      data: { lineId },
    })
    // Populate User.playerId / Player.userId for the new binding. No-op
    // (with warning) if no User exists for this lineId yet — admin
    // pre-staging via Flow B before the user has authenticated post-α.5.
    await linkPlayerToUser(tx, { playerId, lineId })
    // If the admin remap just clobbered a different lineId from the
    // target player, that prior lineId is now orphan from this player's
    // perspective. Clear its User-side back-pointer too so the User row
    // doesn't stale-claim a Player it's no longer bound to.
    if (targetPriorLineId && targetPriorLineId !== lineId) {
      await unlinkPlayerFromUser(tx, { lineId: targetPriorLineId })
    }
  })

  // Pre-warm the JWT-callback mapping cache (PR 9) with the post-write
  // relation-include shape, so the next /api/auth/session for this lineId
  // hits cache rather than the cold Prisma findUnique. v1.26.0 — pass the
  // leagueId to both the Prisma resolver (so the right per-league
  // assignment is picked) AND the cache write (per-league key).
  const fresh = await getPlayerMappingFromDb(lineId, leagueId)
  deferSetMapping('admin-link', lineId, leagueId, fresh)

  // If we just clobbered a prior lineId on the target player, also clear
  // its Redis mapping — that LINE user is now an orphan from this player's
  // perspective and a stale Redis hit would resolve them to the wrong
  // player on their next session refresh. v1.26.0 — clear across ALL
  // leagues the prior lineId might be cached in (admin remap is a
  // global change to the lineId-to-Player binding, not specific to this
  // league).
  if (targetPriorLineId && targetPriorLineId !== lineId) {
    await deleteMapping(targetPriorLineId)
  }

  revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/players`] })
}

/**
 * v1.10.0 / PR B — admin clears the LINE link from a Player record.
 *
 * Inverse of `adminLinkLineToPlayer`: sets `Player.lineId = null` and
 * invalidates the Redis mapping for the cleared lineId so the LINE user
 * is treated as orphan on their next JWT callback (and surfaces in the
 * `getOrphanLineLogins()` list, which is the dropdown the admin uses to
 * re-link them somewhere else).
 *
 * No-op if the player has no lineId (returns silently rather than
 * throwing — admin clicking "Unlink" twice should be safe).
 */
export async function adminClearLineLink(input: {
  playerId: string
  leagueId: string
}) {
  await assertAdmin()
  const { playerId, leagueId } = input
  if (!playerId) throw new Error('playerId is required')

  const before = await prisma.player.findUnique({
    where: { id: playerId },
    select: { lineId: true },
  })
  if (!before?.lineId) return // already unlinked

  // v1.29.0 (stage β) — single transaction clears legacy Player.lineId
  // AND the new User.playerId / Player.userId pointer.
  await prisma.$transaction(async (tx) => {
    await tx.player.update({
      where: { id: playerId },
      data: { lineId: null },
    })
    if (before.lineId) {
      await unlinkPlayerFromUser(tx, { lineId: before.lineId })
    }
  })

  // Invalidate the Redis mapping rather than `setMapping(lineId, leagueId, null)` —
  // the v1.5.0 store treats `null` as a sentinel for "known orphan" but
  // `deleteMapping` is the cleaner reset (next read returns miss → Prisma
  // fallthrough → write back per the v1.26.0 policy, identical observable
  // behavior). v1.26.0 — pass the explicit leagueId so we only invalidate
  // THIS league's per-key entry; the user remains linked in any other
  // leagues they have assignments in.
  await deleteMapping(before.lineId, leagueId)

  revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/players`] })
}

/**
 * v1.20.0 — admin renames a Player record from the league Players tab.
 *
 * Trims, requires non-empty, caps at 100 chars (no DB-level limit on
 * `Player.name` — String column — but a sane client/server cap prevents
 * the field from being abused as a free-form text dump). Admin-only via
 * `assertAdmin`. Cache invalidation via `revalidate({ domain: 'admin' })`
 * which busts both `public-data` + `leagues` tags AND the per-league
 * admin path — the player name is reachable from `dbToPublicLeagueData`,
 * so the public dashboard re-derives on next render.
 */
export async function adminUpdatePlayerName(input: {
  playerId: string
  leagueId: string
  name: string
}): Promise<void> {
  await assertAdmin()
  const { playerId, leagueId } = input
  if (!playerId) throw new Error('playerId is required')

  const trimmed = input.name?.trim() ?? ''
  if (!trimmed) throw new Error('Player name is required')
  if (trimmed.length > 100) throw new Error('Player name must be 100 characters or fewer')

  await prisma.player.update({
    where: { id: playerId },
    data: { name: trimmed },
  })

  revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/players`] })
}

// ── Invite generation (PR ε / v1.33.0) ──────────────────────────────────────

const VALID_POSITIONS: readonly PlayerPosition[] = ['GK', 'DF', 'MF', 'FW']

function normalizePosition(input: string | null | undefined): PlayerPosition | null {
  if (!input) return null
  const upper = input.trim().toUpperCase()
  return (VALID_POSITIONS as readonly string[]).includes(upper)
    ? (upper as PlayerPosition)
    : null
}

/**
 * v1.33.0 (PR ε) — admin pre-stages a Player row inside a league. All three
 * profile fields (name / position / leagueTeamId) are OPTIONAL so an admin
 * can hold a roster slot before knowing who's filling it. The user
 * eventually fills name/position via the upcoming `/join/[code]` onboarding
 * flow (PR ζ); team assignment can be added later via the existing
 * Transfer panel.
 *
 * Returns the created `Player.id` so the caller (Add Player dialog) can
 * immediately offer a "Generate invite" follow-up without re-fetching.
 *
 * `fromGameWeek` defaults to 1 when an assignment is created without one
 * (the most common case — admin pre-stages the slot at the start of the
 * season). Subsequent transfers create new `PlayerLeagueAssignment` rows
 * with the right `fromGameWeek`.
 *
 * Cache invalidation: `revalidate({ domain: 'admin' })` busts the public
 * `LeagueData` blob too (Player records flow into `dbToPublicLeagueData`),
 * so the public Squad list reflects the new row on the next render. The
 * v1.33.0 adapter coerces null name → "TBD" so a nameless pre-staged
 * Player doesn't crash any public component.
 */
export async function adminCreatePlayer(input: {
  leagueId: string
  name?: string | null
  position?: string | null
  leagueTeamId?: string | null
  fromGameWeek?: number | null
}): Promise<{ id: string }> {
  await assertAdmin()
  const { leagueId } = input
  if (!leagueId) throw new Error('leagueId is required')

  const trimmedName = input.name?.trim() ?? ''
  const name = trimmedName === '' ? null : trimmedName
  if (name && name.length > 100) {
    throw new Error('Player name must be 100 characters or fewer')
  }
  const position = normalizePosition(input.position)
  const leagueTeamId = input.leagueTeamId?.trim() || null
  const fromGameWeek = input.fromGameWeek && input.fromGameWeek > 0
    ? Math.floor(input.fromGameWeek)
    : 1

  // If an assignment is requested, the leagueTeam must belong to this league
  // (else admin in League A could pre-stage a player on a team in League B).
  if (leagueTeamId) {
    const lt = await prisma.leagueTeam.findUnique({
      where: { id: leagueTeamId },
      select: { leagueId: true },
    })
    if (!lt || lt.leagueId !== leagueId) {
      throw new Error('leagueTeamId does not belong to this league')
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    const player = await tx.player.create({
      data: {
        name,
        position,
      },
    })
    if (leagueTeamId) {
      await tx.playerLeagueAssignment.create({
        data: { playerId: player.id, leagueTeamId, fromGameWeek },
      })
    }
    return player
  })

  revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/players`] })
  return { id: created.id }
}

/**
 * v1.33.0 (PR ε) — pure helper exported for the admin generation pipeline
 * AND the unit suite. Builds the canonical input shape for
 * `prisma.leagueInvite.create({ data: ... })` from a code, target, and
 * options. Pulled out so we can pin the exact field set without
 * standing up a real DB.
 */
export function buildInviteCreateData(args: {
  leagueId: string
  targetPlayerId: string | null
  code: string
  expiresAt: Date | null
  skipOnboarding: boolean
  createdById: string | null
}): Prisma.LeagueInviteUncheckedCreateInput {
  return {
    leagueId: args.leagueId,
    code: args.code,
    kind: args.targetPlayerId ? 'PERSONAL' : 'CODE',
    targetPlayerId: args.targetPlayerId,
    createdById: args.createdById,
    expiresAt: args.expiresAt,
    maxUses: args.targetPlayerId ? 1 : null, // PERSONAL invites are single-use
    skipOnboarding: args.skipOnboarding,
  }
}

/**
 * v1.33.0 (PR ε) — admin generates a single PERSONAL invite for a target
 * Player. Returns the canonical row + the absolute redemption URL so the
 * caller can render the copy/QR surface immediately without an extra
 * fetch.
 *
 * Validation:
 *   - `targetPlayerId` must reference an existing Player with NO existing
 *     `lineId` AND no other un-revoked, un-expired PERSONAL invite already
 *     pointing at it. This prevents an admin accidentally double-issuing
 *     codes that race for the same slot. CODE-flavor invites and revoked
 *     / expired invites don't block.
 *   - `expiresAt` defaults to now + 7 days; an explicit `null` means no
 *     expiry (admin opt-out).
 *
 * Code generation retries up to 5 times on `@unique` collision. The
 * 28^12 alphabet makes a real collision vanishingly rare; the retry is
 * defensive against a worst-case insertion under concurrent admin use.
 */
export async function adminGenerateInvite(input: {
  leagueId: string
  targetPlayerId: string
  skipOnboarding?: boolean
  expiresAt?: Date | null // omit = +7 days; null = no expiry
}): Promise<{
  id: string
  code: string
  expiresAt: Date | null
  skipOnboarding: boolean
  joinUrl: string
}> {
  await assertAdmin()
  const { leagueId, targetPlayerId } = input
  if (!leagueId) throw new Error('leagueId is required')
  if (!targetPlayerId) throw new Error('targetPlayerId is required')

  const skipOnboarding = !!input.skipOnboarding
  const expiresAt =
    input.expiresAt === undefined
      ? computeInviteExpiry(new Date(), INVITE_DEFAULT_EXPIRY_DAYS)
      : input.expiresAt

  // Validate target: exists and has no LINE binding (a player already linked
  // doesn't need an invite — admin should re-bind via the existing remap flow).
  const target = await prisma.player.findUnique({
    where: { id: targetPlayerId },
    select: { id: true, lineId: true },
  })
  if (!target) throw new Error('Target player not found')
  if (target.lineId) throw new Error('Target player is already linked to a LINE user')

  // Block a second active PERSONAL invite for the same player. Active =
  // not revoked AND (expiresAt null OR expiresAt > now).
  const now = new Date()
  const existing = await prisma.leagueInvite.findFirst({
    where: {
      leagueId,
      targetPlayerId,
      kind: 'PERSONAL',
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
  })
  if (existing) {
    throw new Error('An active personal invite already exists for this player')
  }

  // Resolve host for the redemption URL. Subdomain-aware so an invite
  // generated from `tamachi.t9l.me/admin/...` produces a tamachi-hosted
  // join link. Falls back to the request Host header when NEXTAUTH_URL
  // is missing the subdomain (e.g. localhost dev where NEXTAUTH_URL is
  // `http://localhost:3000`). PR ζ ships the redemption route; for now
  // the URL is a placeholder destination but the SHAPE is locked.
  const reqHeaders = await headers()
  const host = reqHeaders.get('host') ?? new URL(process.env.NEXTAUTH_URL ?? 'https://t9l.me').host

  // Retry on @unique collision; tiny probability but defensive.
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateInviteCode()
    try {
      const session = await getServerSession(authOptions)
      const createdById = (session as { userId?: string | null } | null)?.userId ?? null
      const created = await prisma.leagueInvite.create({
        data: buildInviteCreateData({
          leagueId,
          targetPlayerId,
          code,
          expiresAt,
          skipOnboarding,
          createdById,
        }),
      })
      revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/players`] })
      return {
        id: created.id,
        code: created.code,
        expiresAt: created.expiresAt,
        skipOnboarding: created.skipOnboarding,
        joinUrl: buildInviteUrl(host, created.code),
      }
    } catch (err) {
      // Prisma 5 throws PrismaClientKnownRequestError with code P2002 on
      // unique constraint failure. Retry; bubble anything else.
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code?: string }).code === 'P2002'
      ) {
        lastErr = err
        continue
      }
      throw err
    }
  }
  throw new Error(
    `Failed to generate a unique invite code after 5 attempts: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  )
}

/**
 * v1.33.0 (PR ε) — bulk variant. Generates one PERSONAL invite per
 * targetPlayerId and returns a list ready for CSV export. Skips (does
 * not throw on) targets that fail validation — the result includes a
 * per-row `error` field so the caller can render a partial-success UI.
 *
 * Cache invalidation runs ONCE at the end (not per-row) — the admin
 * Players tab re-render shows the new invite badges in a single tick.
 */
export async function adminGenerateInvitesBulk(input: {
  leagueId: string
  targetPlayerIds: string[]
  skipOnboarding?: boolean
  expiresAt?: Date | null
}): Promise<{
  results: Array<{
    playerId: string
    playerName: string | null
    ok: boolean
    code: string | null
    expiresAt: Date | null
    skipOnboarding: boolean
    joinUrl: string | null
    error: string | null
  }>
  csv: string
}> {
  await assertAdmin()
  const { leagueId, targetPlayerIds } = input
  if (!leagueId) throw new Error('leagueId is required')
  if (!Array.isArray(targetPlayerIds) || targetPlayerIds.length === 0) {
    throw new Error('targetPlayerIds must be a non-empty array')
  }
  if (targetPlayerIds.length > 100) {
    throw new Error('Bulk invite generation is capped at 100 targets per call')
  }

  // Resolve player names up front for the result + CSV (the Player rows
  // may have null names — PR ε allows pre-staged anonymous slots).
  const players = await prisma.player.findMany({
    where: { id: { in: targetPlayerIds } },
    select: { id: true, name: true, lineId: true },
  })
  const playerById = new Map(players.map((p) => [p.id, p]))

  const results: Array<{
    playerId: string
    playerName: string | null
    ok: boolean
    code: string | null
    expiresAt: Date | null
    skipOnboarding: boolean
    joinUrl: string | null
    error: string | null
  }> = []

  // Sequential, not parallel — bulk-generate-1000-at-once would slam the
  // DB and amplify any P2002 retry storms. The admin UI gates this at 100
  // anyway; sequential keeps the latency budget bounded and predictable.
  for (const playerId of targetPlayerIds) {
    const target = playerById.get(playerId)
    if (!target) {
      results.push({
        playerId,
        playerName: null,
        ok: false,
        code: null,
        expiresAt: null,
        skipOnboarding: !!input.skipOnboarding,
        joinUrl: null,
        error: 'Player not found',
      })
      continue
    }
    if (target.lineId) {
      results.push({
        playerId,
        playerName: target.name,
        ok: false,
        code: null,
        expiresAt: null,
        skipOnboarding: !!input.skipOnboarding,
        joinUrl: null,
        error: 'Player already linked to LINE',
      })
      continue
    }
    try {
      const invite = await adminGenerateInvite({
        leagueId,
        targetPlayerId: playerId,
        skipOnboarding: input.skipOnboarding,
        expiresAt: input.expiresAt,
      })
      results.push({
        playerId,
        playerName: target.name,
        ok: true,
        code: invite.code,
        expiresAt: invite.expiresAt,
        skipOnboarding: invite.skipOnboarding,
        joinUrl: invite.joinUrl,
        error: null,
      })
    } catch (err) {
      results.push({
        playerId,
        playerName: target.name,
        ok: false,
        code: null,
        expiresAt: null,
        skipOnboarding: !!input.skipOnboarding,
        joinUrl: null,
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  // adminGenerateInvite already revalidated per-call. The bulk wrapper
  // doesn't need an additional bust — but if every row failed validation
  // (no DB writes happened), the per-call revalidate didn't fire either.
  // That's fine: nothing changed, no need to bust.

  const csvRows: InviteCsvRow[] = results
    .filter((r): r is typeof r & { ok: true; code: string; joinUrl: string; expiresAt: Date | null } =>
      r.ok && !!r.code && !!r.joinUrl,
    )
    .map((r) => ({
      playerId: r.playerId,
      playerName: r.playerName ?? '',
      code: r.code,
      joinUrl: r.joinUrl,
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : '',
      skipOnboarding: r.skipOnboarding,
    }))

  // Lazy import keeps `buildInviteCsv` out of this module's surface.
  const { buildInviteCsv } = await import('@/lib/inviteCodes')
  const csv = buildInviteCsv(csvRows)

  return { results, csv }
}

// ── Settings (data source / write mode toggles) ──────────────────────────────

const VALID_DATA_SOURCES: DataSource[] = ['sheets', 'db']
const VALID_WRITE_MODES: WriteMode[] = ['sheets-only', 'dual', 'db-only']

/**
 * Flip the apex public site's source-of-truth between Google Sheets and DB.
 *
 * The `settings` domain busts both the settings cache (which `getDataSource`
 * sits behind) and the public-data cache (so the next render serves the new
 * source). See `lib/revalidate.ts`.
 */
export async function setDataSource(value: DataSource) {
  await assertAdmin()
  if (!VALID_DATA_SOURCES.includes(value)) {
    throw new Error(`Invalid data source: ${value}`)
  }
  await prisma.setting.upsert({
    where: { id: SETTING_IDS.publicDataSource },
    create: {
      id: SETTING_IDS.publicDataSource,
      category: 'public',
      key: 'dataSource',
      leagueId: null,
      value,
    },
    update: { value },
  })
  revalidate({ domain: 'settings', paths: ['/admin'] })
}

/**
 * Flip the RSVP write mode. `dual` is the safe default during cutover.
 * `db-only` retires the Sheets write entirely.
 */
export async function setWriteMode(value: WriteMode) {
  await assertAdmin()
  if (!VALID_WRITE_MODES.includes(value)) {
    throw new Error(`Invalid write mode: ${value}`)
  }
  await prisma.setting.upsert({
    where: { id: SETTING_IDS.publicWriteMode },
    create: {
      id: SETTING_IDS.publicWriteMode,
      category: 'public',
      key: 'writeMode',
      leagueId: null,
      value,
    },
    update: { value },
  })
  revalidate({ domain: 'settings', paths: ['/admin'] })
}
