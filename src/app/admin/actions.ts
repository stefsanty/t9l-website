'use server'

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session?.isAdmin) redirect('/')
}

export async function updateLeague(formData: FormData) {
  await requireAdmin()
  const id = formData.get('id') as string
  await prisma.league.update({
    where: { id },
    data: {
      name: formData.get('name') as string,
      court: (formData.get('court') as string) || null,
      dayOfWeek: (formData.get('dayOfWeek') as string) || null,
      season: (formData.get('season') as string) || null,
      status: formData.get('status') as string,
      logoUrl: (formData.get('logoUrl') as string) || null,
    },
  })
  revalidatePath('/admin/settings')
  revalidatePath('/')
}

export async function updatePlayer(formData: FormData) {
  await requireAdmin()
  const id = formData.get('id') as string
  await prisma.player.update({
    where: { id },
    data: {
      name: formData.get('name') as string,
      lineId: (formData.get('lineId') as string) || null,
      role: formData.get('role') as string,
      pictureUrl: (formData.get('pictureUrl') as string) || null,
    },
  })
  revalidatePath('/admin/players')
  revalidatePath(`/admin/players/${id}`)
}

export async function createPlayer(formData: FormData) {
  await requireAdmin()
  const teamId = formData.get('teamId') as string
  const player = await prisma.player.create({
    data: {
      name: formData.get('name') as string,
      lineId: (formData.get('lineId') as string) || null,
      role: (formData.get('role') as string) || 'player',
      pictureUrl: (formData.get('pictureUrl') as string) || null,
    },
  })
  if (teamId) {
    await prisma.playerTeam.create({
      data: {
        playerId: player.id,
        teamId,
        position: (formData.get('position') as string) || null,
      },
    })
  }
  revalidatePath('/admin/players')
  redirect('/admin/players')
}

export async function updateMatchScore(formData: FormData) {
  await requireAdmin()
  const matchId = formData.get('matchId') as string
  const homeScoreRaw = formData.get('homeScore') as string
  const awayScoreRaw = formData.get('awayScore') as string
  const homeScore = homeScoreRaw !== '' ? parseInt(homeScoreRaw, 10) : null
  const awayScore = awayScoreRaw !== '' ? parseInt(awayScoreRaw, 10) : null
  await prisma.match.update({
    where: { id: matchId },
    data: {
      homeScore,
      awayScore,
      status: homeScore !== null && awayScore !== null ? 'played' : 'scheduled',
    },
  })
  revalidatePath(`/admin/matches/${matchId}`)
  revalidatePath('/admin/matches')
  revalidatePath('/')
}

export async function addGoal(formData: FormData) {
  await requireAdmin()
  const matchId = formData.get('matchId') as string
  const scorerId = formData.get('scorerId') as string
  const assisterId = (formData.get('assisterId') as string) || null
  await prisma.goal.create({
    data: {
      matchId,
      scorerId,
      assisterId: assisterId || null,
    },
  })
  revalidatePath(`/admin/matches/${matchId}`)
  revalidatePath('/admin/matches')
  revalidatePath('/')
}

export async function deleteGoal(formData: FormData) {
  await requireAdmin()
  const goalId = formData.get('goalId') as string
  const goal = await prisma.goal.findUnique({ where: { id: goalId }, select: { matchId: true } })
  await prisma.goal.delete({ where: { id: goalId } })
  if (goal) {
    revalidatePath(`/admin/matches/${goal.matchId}`)
    revalidatePath('/admin/matches')
    revalidatePath('/')
  }
}
