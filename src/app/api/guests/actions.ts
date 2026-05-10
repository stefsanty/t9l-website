'use server'

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { revalidate } from '@/lib/revalidate'
import { getLeagueIdBySlug } from '@/lib/leagueSlugServer'
import { slugToTeamId } from '@/lib/ids'

/**
 * v1.91.0 — Add Guests feature.
 *
 * Records per-(matchday, team) guest counts. External guests are
 * non-T9L people; league guests are T9L users not on this team's roster.
 * Counts bump the team's "going" tally and synthesize positionless
 * "Guest" pseudo-players in the formation pitch (placed by the v1.89.1
 * pass 2.5 into back-most non-GK slots) and the list view.
 *
 * Permissions: any authenticated user. No admin or team-membership
 * gate — casual leagues let any user log who's bringing guests. We
 * record `createdById` for audit; re-submission overwrites the row's
 * counts and updates `createdById` + `updatedAt` to the latest
 * submitter (single row per (gameWeekId, leagueTeamId)).
 *
 * Authentication accepts EITHER `userId` OR `lineId` on the session,
 * mirroring the v1.80.10 / v1.59.1 pattern (grandfathered LINE sessions
 * predating v1.28.0 stage α.5 may carry only `lineId`).
 */

const MAX_COUNT_PER_FIELD = 50

export interface SetMatchdayGuestEntryInput {
  /** League subdomain (e.g. "t9l", "kanto-spring"). Resolved server-side. */
  leagueSlug: string
  /** Public matchday id ("md1", "md2", ...). Parsed to weekNumber + resolved within the league. */
  matchdayPublicId: string
  /** Public team slug (e.g. "mariners-fc"). Resolved within the league. */
  teamPublicId: string
  /** Non-negative integer ≤ MAX_COUNT_PER_FIELD. */
  externalCount: number
  /** Non-negative integer ≤ MAX_COUNT_PER_FIELD. */
  leagueCount: number
}

export interface SetMatchdayGuestEntryResult {
  ok: true
  externalCount: number
  leagueCount: number
}

function parseMatchdayPublicId(matchdayPublicId: string): number | null {
  const m = matchdayPublicId.match(/^md(\d+)$/)
  if (!m) return null
  const wk = parseInt(m[1], 10)
  if (!Number.isFinite(wk) || wk < 1) return null
  return wk
}

function validateCount(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a number`)
  if (!Number.isInteger(value)) throw new Error(`${label} must be an integer`)
  if (value < 0) throw new Error(`${label} must be ≥ 0`)
  if (value > MAX_COUNT_PER_FIELD) {
    throw new Error(`${label} must be ≤ ${MAX_COUNT_PER_FIELD}`)
  }
  return value
}

export async function setMatchdayGuestEntry(
  input: SetMatchdayGuestEntryInput,
): Promise<SetMatchdayGuestEntryResult> {
  const session = await getServerSession(authOptions)
  if (!session) throw new Error('Sign in to add guests')

  // Auth: gate on auth state, not on `session.isAdmin` (per the v1.67.0
  // admin-orthogonal-UX rule). v1.80.10 / v1.59.1 pattern: accept either
  // `userId` OR `lineId` to cover grandfathered LINE sessions whose JWT
  // predates v1.28.0 stage α.5 (lineId set, userId never populated).
  // Admin sign-in via OAuth (LINE/Google/email) carries the relevant
  // identifier and works through this gate; `admin-credentials` sessions
  // (no User row, no JWT identifier) get rejected — those are intended
  // for /admin/* anyway.
  const sessionUserId = session.userId
  const sessionLineId = session.lineId
  let userId: string | null = null
  if (sessionUserId) {
    const u = await prisma.user.findUnique({
      where: { id: sessionUserId },
      select: { id: true },
    })
    userId = u?.id ?? null
  }
  if (!userId && sessionLineId) {
    const u = await prisma.user.findUnique({
      where: { lineId: sessionLineId },
      select: { id: true },
    })
    userId = u?.id ?? null
  }
  if (!userId) throw new Error('Sign in to add guests')

  const externalCount = validateCount(input.externalCount, 'External guests')
  const leagueCount = validateCount(input.leagueCount, 'League guests')

  const weekNumber = parseMatchdayPublicId(input.matchdayPublicId)
  if (weekNumber === null) {
    throw new Error(`Invalid matchdayPublicId: ${input.matchdayPublicId}`)
  }

  const leagueId = await getLeagueIdBySlug(input.leagueSlug)
  if (!leagueId) throw new Error(`League not found: ${input.leagueSlug}`)

  const gameWeek = await prisma.gameWeek.findFirst({
    where: { leagueId, weekNumber },
    select: { id: true },
  })
  if (!gameWeek) throw new Error(`Matchday MD${weekNumber} not in league`)

  const teamDbId = slugToTeamId(input.teamPublicId)
  const leagueTeam = await prisma.leagueTeam.findFirst({
    where: { leagueId, teamId: teamDbId },
    select: { id: true },
  })
  if (!leagueTeam) {
    throw new Error(`Team ${input.teamPublicId} not in this league`)
  }

  await prisma.matchdayGuestEntry.upsert({
    where: {
      gameWeekId_leagueTeamId: {
        gameWeekId: gameWeek.id,
        leagueTeamId: leagueTeam.id,
      },
    },
    create: {
      gameWeekId: gameWeek.id,
      leagueTeamId: leagueTeam.id,
      externalCount,
      leagueCount,
      createdById: userId,
    },
    update: {
      externalCount,
      leagueCount,
      createdById: userId,
    },
  })

  revalidate({
    domain: 'public',
    paths: [
      `/id/${input.leagueSlug}`,
      `/id/${input.leagueSlug}/md/${input.matchdayPublicId}`,
      `/league/${input.leagueSlug}`,
      `/league/${input.leagueSlug}/md/${input.matchdayPublicId}`,
      `/matchday/${input.matchdayPublicId}`,
    ],
  })

  return { ok: true, externalCount, leagueCount }
}
