'use server'

import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { waitUntil } from '@vercel/functions'
import { authOptions } from '@/lib/auth'
import { revalidate } from '@/lib/revalidate'
import { deleteMapping } from '@/lib/playerMappingStore'
import { parseJstDateOnly } from '@/lib/jst'

/**
 * v1.26.0 — admin write paths that don't operate within a single league
 * context (`updatePlayer`, `createPlayer`) use this to invalidate the
 * per-league cache for `lineId` across every league it might be cached
 * in. Lazy-fill on next read per league. SCAN protocol bounded by the
 * actual per-(leagueId, lineId) cardinality (typically <5 keys).
 */
function deferDeleteMappingAcrossLeagues(
  op: 'admin-update' | 'admin-update-prior',
  lineId: string,
): void {
  waitUntil(
    deleteMapping(lineId).catch((err) =>
      console.error(
        '[v1.26.0 DRIFT] kind=playerMapping op=%s lineId=%s err=%o',
        op,
        lineId,
        err,
      ),
    ),
  )
}

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
      startDate: startDateStr ? parseJstDateOnly(startDateStr) : undefined,
      endDate:   endDateStr   ? parseJstDateOnly(endDateStr)   : null,
    },
  })
  revalidate({ domain: 'admin', paths: ['/admin/settings', '/admin'] })
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

  // v1.26.0 — `updatePlayer` operates on a global `Player` record without a
  // single league context (the player may be in N leagues via
  // PlayerLeagueAssignment). Both the OLD and NEW lineId need their
  // per-league caches invalidated across every league they might be cached
  // in. Lazy-fill on next read per league via the v1.26.0 miss policy —
  // first JWT callback per (leagueId, lineId) hits Prisma + writes back.
  if (priorLineId && priorLineId !== lineId) {
    deferDeleteMappingAcrossLeagues('admin-update-prior', priorLineId)
  }
  if (lineId && lineId !== priorLineId) {
    deferDeleteMappingAcrossLeagues('admin-update', lineId)
  }

  revalidate({ domain: 'admin', paths: ['/admin/players', `/admin/players/${id}`] })
}

export async function createPlayer(formData: FormData) {
  await assertAdmin()
  const name   = formData.get('name')    as string
  const lineId = (formData.get('lineId') as string).trim() || null

  // TODO: team assignment requires selecting a LeagueTeam (not a bare Team)
  await prisma.player.create({ data: { name, lineId } })

  // v1.26.0 — `createPlayer` creates a Player with no league assignment, so
  // there's no per-league cache to pre-warm. If the lineId previously held a
  // null sentinel in some league's cache, invalidate across all leagues so
  // the next read picks up the new mapping (still teamId="" until an
  // assignment is created, but with the new playerId).
  if (lineId) {
    deferDeleteMappingAcrossLeagues('admin-update', lineId)
  }

  revalidate({ domain: 'admin', paths: ['/admin/players'] })
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
  revalidate({ domain: 'admin', paths: ['/admin/matches', `/admin/matches/${id}`] })
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

  revalidate({ domain: 'admin', paths: [`/admin/matches/${matchId}`, '/admin/matches'] })
}

export async function deleteGoal(formData: FormData) {
  await assertAdmin()
  const goalId  = formData.get('goalId')  as string
  const matchId = formData.get('matchId') as string
  // Goal→Assist has no cascade; delete assist first to satisfy the FK constraint
  await prisma.assist.deleteMany({ where: { goalId } })
  await prisma.goal.delete({ where: { id: goalId } })
  revalidate({ domain: 'admin', paths: [`/admin/matches/${matchId}`, '/admin/matches'] })
}
