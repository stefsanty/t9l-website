'use server'

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { waitUntil } from '@vercel/functions'
import { authOptions, getPlayerMappingFromDb } from '@/lib/auth'
import { revalidatePublicData } from '@/lib/revalidate'
import {
  deleteMapping,
  setMapping,
  type PlayerMapping,
} from '@/lib/playerMappingStore'
import { parseJstDateOnly } from '@/lib/jst'

/**
 * v1.13.0 — defer the Redis pre-warm off the admin response critical path.
 * Mirror of v1.8.0's public-hot-path inversion. See same helper in
 * `app/admin/leagues/actions.ts` for full rationale.
 */
function deferSetMapping(
  op: 'admin-update' | 'admin-create',
  lineId: string,
  mapping: PlayerMapping | null,
): void {
  waitUntil(
    setMapping(lineId, mapping).catch((err) =>
      console.error(
        '[v1.13.0 DRIFT] kind=playerMapping op=%s lineId=%s err=%o',
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

  // OLD lineId — the previous holder no longer maps to this player. Could in
  // principle be pre-warmed with null, but invalidate is the conservative
  // choice: the next request re-reads Prisma and self-heals, and the 60s TTL
  // guards against drift either way. (See PR 9.)
  if (priorLineId && priorLineId !== lineId) {
    await deleteMapping(priorLineId)
  }
  // NEW lineId — pre-warm with the post-write mapping so the just-linked
  // user's next /api/auth/session hits cache instead of the cold Prisma
  // relation-include. Uses the canonical slug-stripping helper for shape
  // parity with the JWT path. Deferred via `waitUntil` (v1.13.0) — admin
  // re-reads Prisma directly so the Redis pre-warm doesn't need to block.
  if (lineId && lineId !== priorLineId) {
    const fresh = await getPlayerMappingFromDb(lineId)
    deferSetMapping('admin-update', lineId, fresh)
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

  // If a lineId was supplied, pre-warm the JWT mapping cache (PR 9) with the
  // post-write shape so the LINE user's next session read hits cache rather
  // than re-running the cold Prisma findUnique that would otherwise replace
  // the prior null sentinel. createPlayer doesn't assign a LeagueTeam yet so
  // the resolved teamId is the empty string — same as what the JWT path would
  // compute itself for an unassigned player. Deferred via `waitUntil`
  // (v1.13.0) — see updatePlayer above.
  if (lineId) {
    const fresh = await getPlayerMappingFromDb(lineId)
    deferSetMapping('admin-create', lineId, fresh)
  }

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
