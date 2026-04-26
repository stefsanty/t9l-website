'use server'

import { prisma } from '@/lib/prisma'
import { revalidatePath, updateTag } from 'next/cache'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

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

  const league = await prisma.league.create({
    data: {
      name,
      location,
      description,
      subdomain,
      startDate: new Date(startDate),
      endDate:   endDate ? new Date(endDate) : null,
    },
  })

  updateTag('leagues')
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
      startDate:   data.startDate ? new Date(data.startDate) : undefined,
      endDate:     data.endDate !== undefined ? (data.endDate ? new Date(data.endDate) : null) : undefined,
    },
  })
  updateTag('leagues')
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
  updateTag('leagues')
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
  await prisma.gameWeek.create({
    data: {
      leagueId,
      weekNumber: data.weekNumber,
      startDate:  new Date(data.startDate),
      endDate:    new Date(data.endDate),
      venueId:    data.venueId || null,
    },
  })
  updateTag('leagues')
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
  updateTag('leagues')
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
      startDate: data.startDate ? new Date(data.startDate) : undefined,
      endDate:   data.endDate   ? new Date(data.endDate)   : undefined,
      venueId:   data.venueId !== undefined ? (data.venueId || null) : undefined,
    },
  })
  updateTag('leagues')
  revalidatePath(`/admin/leagues/${leagueId}/schedule`)
}

export async function deleteGameWeek(id: string, leagueId: string) {
  await assertAdmin()
  const completedMatches = await prisma.match.count({
    where: { gameWeekId: id, status: 'COMPLETED' },
  })
  if (completedMatches > 0) throw new Error('Cannot delete matchday with completed matches')
  await prisma.gameWeek.delete({ where: { id } })
  updateTag('leagues')
  revalidatePath(`/admin/leagues/${leagueId}/schedule`)
}

// ── Match ────────────────────────────────────────────────────────────────────

export async function createMatch(gameWeekId: string, leagueId: string, data: {
  homeTeamId: string
  awayTeamId: string
  playedAt:   string
}) {
  await assertAdmin()
  await prisma.match.create({
    data: {
      leagueId,
      gameWeekId,
      homeTeamId: data.homeTeamId,
      awayTeamId: data.awayTeamId,
      playedAt:   new Date(data.playedAt),
      status:     'SCHEDULED',
    },
  })
  updateTag('leagues')
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
  if (data.playedAt)                 updateData.playedAt   = new Date(data.playedAt)
  if (data.endedAt !== undefined)    updateData.endedAt    = data.endedAt ? new Date(data.endedAt) : null
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
  updateTag('leagues')
  revalidatePath(`/admin/leagues/${leagueId}/schedule`)
}

export async function deleteMatch(id: string, leagueId: string) {
  await assertAdmin()
  await prisma.match.delete({ where: { id } })
  updateTag('leagues')
  revalidatePath(`/admin/leagues/${leagueId}/schedule`)
}

// ── Teams ────────────────────────────────────────────────────────────────────

export async function enrollTeam(leagueId: string, teamId: string) {
  await assertAdmin()
  await prisma.leagueTeam.create({ data: { leagueId, teamId } })
  updateTag('leagues')
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
  updateTag('leagues')
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
    updateTag('leagues')
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
  updateTag('leagues')
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
  updateTag('leagues')
  revalidatePath(`/admin/leagues/${leagueId}/players`)
}
