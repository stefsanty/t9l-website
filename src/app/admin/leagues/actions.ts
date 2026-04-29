'use server'

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions, getPlayerMappingFromDb } from '@/lib/auth'
import { revalidatePublicData } from '@/lib/revalidate'
import { SETTING_IDS, type DataSource, type WriteMode } from '@/lib/settings'
import { setMapping } from '@/lib/playerMappingStore'
import { seedGameWeek, deleteGameWeek as deleteGameWeekFromRedis } from '@/lib/rsvpStore'
import { parseJstDateTimeLocal, parseJstDateOnly } from '@/lib/jst'

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

  revalidatePublicData()
  revalidatePath('/admin')
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
  revalidatePublicData()
  revalidatePath(`/admin/leagues/${id}`)
  revalidatePath('/admin')
}

export async function deleteLeague(id: string) {
  await assertAdmin()
  const completedMatches = await prisma.match.count({
    where: { leagueId: id, status: 'COMPLETED' },
  })
  if (completedMatches > 0) throw new Error('Cannot delete league with completed matches')
  await prisma.league.delete({ where: { id } })
  revalidatePublicData()
  revalidatePath('/admin')
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
  revalidatePublicData()
  revalidatePath(`/admin/leagues/${leagueId}/schedule`)
}

export async function updateGameWeekVenue(id: string, leagueId: string, venueName: string) {
  await assertAdmin()
  if (!venueName.trim()) {
    await prisma.gameWeek.update({ where: { id }, data: { venueId: null } })
  } else {
    let venue = await prisma.venue.findFirst({ where: { name: { equals: venueName.trim(), mode: 'insensitive' } } })
    if (!venue) {
      venue = await prisma.venue.create({ data: { name: venueName.trim() } })
    }
    await prisma.gameWeek.update({ where: { id }, data: { venueId: venue.id } })
  }
  revalidatePublicData()
  revalidatePath(`/admin/leagues/${leagueId}/schedule`)
}

export async function updateGameWeek(id: string, leagueId: string, data: {
  startDate?: string
  endDate?:   string
  venueId?:   string | null
}) {
  await assertAdmin()
  await prisma.gameWeek.update({
    where: { id },
    data: {
      startDate: data.startDate ? parseJstDateOnly(data.startDate) : undefined,
      endDate:   data.endDate   ? parseJstDateOnly(data.endDate)   : undefined,
      venueId:   data.venueId !== undefined ? (data.venueId || null) : undefined,
    },
  })
  revalidatePublicData()
  revalidatePath(`/admin/leagues/${leagueId}/schedule`)
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
  revalidatePublicData()
  revalidatePath(`/admin/leagues/${leagueId}/schedule`)
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
  revalidatePublicData()
  revalidatePath(`/admin/leagues/${leagueId}/schedule`)
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
  revalidatePublicData()
  revalidatePath(`/admin/leagues/${leagueId}/schedule`)
}

export async function deleteMatch(id: string, leagueId: string) {
  await assertAdmin()
  await prisma.match.delete({ where: { id } })
  revalidatePublicData()
  revalidatePath(`/admin/leagues/${leagueId}/schedule`)
}

// ── Teams ────────────────────────────────────────────────────────────────────

export async function enrollTeam(leagueId: string, teamId: string) {
  await assertAdmin()
  await prisma.leagueTeam.create({ data: { leagueId, teamId } })
  revalidatePublicData()
  revalidatePath(`/admin/leagues/${leagueId}/teams`)
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
  revalidatePublicData()
  revalidatePath(`/admin/leagues/${leagueId}/teams`)
}

// ── Players ──────────────────────────────────────────────────────────────────

export async function assignPlayer(playerId: string, leagueTeamId: string, fromGameWeek: number) {
  await assertAdmin()
  await prisma.playerLeagueAssignment.create({
    data: { playerId, leagueTeamId, fromGameWeek },
  })
  const lt = await prisma.leagueTeam.findUnique({ where: { id: leagueTeamId }, select: { leagueId: true } })
  if (lt) {
    revalidatePublicData()
    revalidatePath(`/admin/leagues/${lt.leagueId}/players`)
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
  revalidatePublicData()
  revalidatePath(`/admin/leagues/${leagueId}/players`)
}

export async function removePlayerFromLeague(playerId: string, leagueId: string) {
  await assertAdmin()
  const leagueTeamIds = (
    await prisma.leagueTeam.findMany({ where: { leagueId }, select: { id: true } })
  ).map((lt) => lt.id)
  await prisma.playerLeagueAssignment.deleteMany({
    where: { playerId, leagueTeamId: { in: leagueTeamIds } },
  })
  revalidatePublicData()
  revalidatePath(`/admin/leagues/${leagueId}/players`)
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

  await prisma.$transaction([
    prisma.player.updateMany({
      where: { lineId, id: { not: playerId } },
      data: { lineId: null },
    }),
    prisma.player.update({
      where: { id: playerId },
      data: { lineId },
    }),
  ])

  // Pre-warm the JWT-callback mapping cache (PR 9) with the post-write
  // relation-include shape, so the next /api/auth/session for this lineId
  // hits cache rather than the cold Prisma findUnique. Re-uses the canonical
  // `getPlayerMappingFromDb` slug-stripping logic so the cached shape stays
  // identical to what the auth path would have computed itself.
  const fresh = await getPlayerMappingFromDb(lineId)
  await setMapping(lineId, fresh)

  revalidatePublicData()
  revalidatePath(`/admin/leagues/${leagueId}/players`)
}

// ── Settings (data source / write mode toggles) ──────────────────────────────

const VALID_DATA_SOURCES: DataSource[] = ['sheets', 'db']
const VALID_WRITE_MODES: WriteMode[] = ['sheets-only', 'dual', 'db-only']

/**
 * Flip the apex public site's source-of-truth between Google Sheets and DB.
 *
 * Cache buster path:
 *   1. updateTag('settings') invalidates getDataSource()'s 30s cache, so the
 *      next public-page render reads the new value
 *   2. revalidatePublicData() invalidates 'public-data' so the next render
 *      doesn't serve a stale getFromSheets() / getFromDb() result
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
  // updateTag is server-action only; revalidatePublicData uses it under the
  // hood. Tag chain: settings (own helper cache) + public-data (dispatcher).
  const { updateTag: _updateTag } = await import('next/cache')
  _updateTag('settings')
  revalidatePublicData()
  revalidatePath('/admin')
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
  const { updateTag: _updateTag } = await import('next/cache')
  _updateTag('settings')
  revalidatePublicData()
  revalidatePath('/admin')
}
