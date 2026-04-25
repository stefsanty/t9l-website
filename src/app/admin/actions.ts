'use server'

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

async function assertAdmin() {
  const session = await getServerSession(authOptions)
  if (!session?.isAdmin) throw new Error('Unauthorized')
}

// ── League ─────────────────────────────────────────────────────────────────────

export async function updateLeague(formData: FormData) {
  await assertAdmin()
  const id = formData.get('id') as string
  await prisma.league.update({
    where: { id },
    data: {
      name:      (formData.get('name')      as string) || undefined,
      court:     (formData.get('court')     as string) || null,
      dayOfWeek: (formData.get('dayOfWeek') as string) || null,
      season:    (formData.get('season')    as string) || null,
      status:    (formData.get('status')    as string) || 'active',
      logoUrl:   (formData.get('logoUrl')   as string) || null,
    },
  })
  revalidatePath('/admin/settings')
  revalidatePath('/admin')
}

// ── Players ────────────────────────────────────────────────────────────────────

export async function updatePlayer(formData: FormData) {
  await assertAdmin()
  const id      = formData.get('id')         as string
  const lineId  = (formData.get('lineId')    as string).trim() || null
  const picUrl  = (formData.get('pictureUrl') as string).trim() || null
  try {
    await prisma.player.update({
      where: { id },
      data: {
        name:       formData.get('name')       as string,
        lineId,
        role:       formData.get('role')       as string,
        pictureUrl: picUrl,
      },
    })
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('Unique constraint')) {
      throw new Error('A player with that LINE ID already exists.')
    }
    throw err
  }
  revalidatePath('/admin/players')
  revalidatePath(`/admin/players/${id}`)
}

export async function createPlayer(formData: FormData) {
  await assertAdmin()
  const name   = formData.get('name')   as string
  const lineId = (formData.get('lineId') as string).trim() || null
  const role   = (formData.get('role')   as string) || 'player'
  const teamId = (formData.get('teamId') as string) || null

  const player = await prisma.player.create({ data: { name, lineId, role } })
  if (teamId) {
    await prisma.playerTeam.create({
      data: { playerId: player.id, teamId, isActive: true },
    })
  }
  revalidatePath('/admin/players')
  redirect('/admin/players')
}

// ── Matches ────────────────────────────────────────────────────────────────────

export async function updateMatchScore(formData: FormData) {
  await assertAdmin()
  const id        = formData.get('matchId')   as string
  const homeScore = parseInt(formData.get('homeScore') as string, 10)
  const awayScore = parseInt(formData.get('awayScore') as string, 10)
  const hs = isNaN(homeScore) ? null : homeScore
  const as = isNaN(awayScore) ? null : awayScore
  await prisma.match.update({
    where: { id },
    data: {
      homeScore: hs,
      awayScore: as,
      status: hs !== null && as !== null ? 'finished' : 'scheduled',
    },
  })
  revalidatePath('/admin/matches')
  revalidatePath(`/admin/matches/${id}`)
}

export async function addGoal(formData: FormData) {
  await assertAdmin()
  const matchId    = formData.get('matchId')    as string
  const scorerId   = formData.get('scorerId')   as string
  const assisterId = (formData.get('assisterId') as string) || null
  await prisma.goal.create({
    data: { matchId, scorerId, assisterId: assisterId || null },
  })
  revalidatePath(`/admin/matches/${matchId}`)
  revalidatePath('/admin/matches')
}

export async function deleteGoal(formData: FormData) {
  await assertAdmin()
  const goalId  = formData.get('goalId')  as string
  const matchId = formData.get('matchId') as string
  await prisma.goal.delete({ where: { id: goalId } })
  revalidatePath(`/admin/matches/${matchId}`)
  revalidatePath('/admin/matches')
}
