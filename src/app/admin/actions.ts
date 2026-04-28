'use server'

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { revalidatePublicData } from '@/lib/revalidate'
import { invalidate as invalidateMappingCache } from '@/lib/playerMappingCache'

async function assertAdmin() {
  const session = await getServerSession(authOptions)
  if (!session?.isAdmin) throw new Error('Unauthorized')
}

// ── League ─────────────────────────────────────────────────────────────────────

export async function updateLeague(formData: FormData) {
  await assertAdmin()
  const id           = formData.get('id')        as string
  const startDateStr = formData.get('startDate') as string
  const endDateStr   = formData.get('endDate')   as string
  await prisma.league.update({
    where: { id },
    data: {
      name:      (formData.get('name')     as string) || undefined,
      location:  (formData.get('location') as string) || '',
      startDate: startDateStr ? new Date(startDateStr) : undefined,
      endDate:   endDateStr   ? new Date(endDateStr)   : null,
    },
  })
  revalidatePath('/admin/settings')
  revalidatePath('/admin')
  revalidatePublicData()
}

// ── Players ────────────────────────────────────────────────────────────────────

export async function updatePlayer(formData: FormData) {
  await assertAdmin()
  const id     = formData.get('id')          as string
  const lineId = (formData.get('lineId')     as string).trim() || null
  const picUrl = (formData.get('pictureUrl') as string).trim() || null

  // Read the prior lineId so we can invalidate both old and new in the JWT
  // mapping cache (PR 8). If the admin reassigns or clears the LINE link,
  // both the previously-cached mapping and any null cached for the new value
  // need to go.
  const prior = await prisma.player.findUnique({
    where: { id },
    select: { lineId: true },
  })
  const priorLineId = prior?.lineId ?? null

  await prisma.player.update({
    where: { id },
    data: {
      name:       formData.get('name') as string,
      lineId,
      pictureUrl: picUrl,
    },
  })

  if (priorLineId && priorLineId !== lineId) {
    await invalidateMappingCache(priorLineId)
  }
  if (lineId && lineId !== priorLineId) {
    await invalidateMappingCache(lineId)
  }

  revalidatePath('/admin/players')
  revalidatePath(`/admin/players/${id}`)
  revalidatePublicData()
}

export async function createPlayer(formData: FormData) {
  await assertAdmin()
  const name   = formData.get('name')    as string
  const lineId = (formData.get('lineId') as string).trim() || null

  // TODO: team assignment requires selecting a LeagueTeam (not a bare Team)
  await prisma.player.create({ data: { name, lineId } })

  // If a lineId was supplied, the JWT mapping cache may hold a null sentinel
  // for it (the LINE user logged in pre-Player-creation). Drop it so the next
  // session read sees the new Player.
  if (lineId) await invalidateMappingCache(lineId)

  revalidatePath('/admin/players')
  revalidatePublicData()
  redirect('/admin/players')
}

// ── Matches ────────────────────────────────────────────────────────────────────

export async function updateMatchScore(formData: FormData) {
  await assertAdmin()
  const id        = formData.get('matchId')   as string
  const homeScore = parseInt(formData.get('homeScore') as string, 10)
  const awayScore = parseInt(formData.get('awayScore') as string, 10)
  await prisma.match.update({
    where: { id },
    data: {
      homeScore: isNaN(homeScore) ? 0 : homeScore,
      awayScore: isNaN(awayScore) ? 0 : awayScore,
      status: 'COMPLETED',
    },
  })
  revalidatePath('/admin/matches')
  revalidatePath(`/admin/matches/${id}`)
  revalidatePublicData()
}

export async function addGoal(formData: FormData) {
  await assertAdmin()
  const matchId       = formData.get('matchId')       as string
  const playerId      = formData.get('playerId')      as string
  const scoringTeamId = formData.get('scoringTeamId') as string
  const assisterId    = (formData.get('assisterId')   as string) || null

  const goal = await prisma.goal.create({
    data: { matchId, playerId, scoringTeamId },
  })

  if (assisterId) {
    await prisma.assist.create({
      data: { matchId, playerId: assisterId, goalId: goal.id },
    })
  }

  revalidatePath(`/admin/matches/${matchId}`)
  revalidatePath('/admin/matches')
  revalidatePublicData()
}

export async function deleteGoal(formData: FormData) {
  await assertAdmin()
  const goalId  = formData.get('goalId')  as string
  const matchId = formData.get('matchId') as string
  // Goal→Assist has no cascade; delete assist first to satisfy the FK constraint
  await prisma.assist.deleteMany({ where: { goalId } })
  await prisma.goal.delete({ where: { id: goalId } })
  revalidatePath(`/admin/matches/${matchId}`)
  revalidatePath('/admin/matches')
  revalidatePublicData()
}
