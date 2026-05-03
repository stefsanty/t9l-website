'use server'

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { revalidate } from '@/lib/revalidate'
import { recomputeMatchScore } from '@/lib/matchScore'
import { evaluateSelfReportGate } from '@/lib/playerSelfReportGate'
import { slugToPlayerId } from '@/lib/ids'
import type { GoalType } from '@prisma/client'

const VALID_GOAL_TYPES = new Set<GoalType>([
  'OPEN_PLAY',
  'SET_PIECE',
  'PENALTY',
  'OWN_GOAL',
])

/**
 * v1.46.0 (epic match events PR ζ) — player submits their own goal.
 *
 * Re-evaluates every gate the page-level CTA enforces (defense in depth):
 *   1. session is set + has playerId
 *   2. matchId belongs to the supplied matchdayPublicId in the resolved
 *      league (we read the public matchdayPublicId and matchPublicId
 *      coming from the page, then look up the actual DB ids via the same
 *      shape `dbToPublicLeagueData` produces — `md<weekNumber>` and
 *      `<mdId>-m<idx+1>`)
 *   3. now (JST) >= earliest kickoff in the matchday
 *   4. scorer is the calling user's bound player (we set scorerId from
 *      the session, never from the form input)
 *   5. for non-OG: the player's team must be participating in this match
 *      (i.e. one of homeTeamId/awayTeamId)
 *   6. for OG: the player's team is the team conceding (own goal benefits
 *      the OPPOSITE side, which the form computes from goalType)
 *   7. assister, when supplied, must be on the player's own team and ≠ scorer
 *
 * Auto-approved per user's brief — `MatchEvent.createdById` records the
 * submitting User for audit if abuse is reported later.
 */
export async function submitOwnMatchEvent(input: {
  matchPublicId: string // e.g. "md3-m2"
  goalType: GoalType
  assisterPlayerSlug?: string | null
  minute?: number | null
}): Promise<{ id: string }> {
  const session = await getServerSession(authOptions)
  const userId = session?.userId
  const playerSlug = session?.playerId

  if (!session || !userId) throw new Error('Not signed in')
  if (!playerSlug) throw new Error('No linked player on this account')
  if (!VALID_GOAL_TYPES.has(input.goalType)) {
    throw new Error(`Invalid goalType: ${input.goalType}`)
  }
  if (
    input.minute !== undefined &&
    input.minute !== null &&
    (input.minute < 0 || input.minute > 200)
  ) {
    throw new Error('minute out of range')
  }

  // Resolve the canonical Player.id from the session's public slug.
  const playerId = slugToPlayerId(playerSlug)

  // Resolve match. The matchPublicId is `md<wk>-m<idx+1>` from the
  // public adapter. We need to find the real DB Match.id by joining
  // through GameWeek.weekNumber and the playedAt-asc ordering used by
  // dbToPublicLeagueData.
  const m = parseMatchPublicId(input.matchPublicId)
  if (!m) throw new Error(`Invalid matchPublicId: ${input.matchPublicId}`)

  // We need the user's league to scope. Read the player's current league
  // assignment to find the canonical leagueId.
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: {
      leagueAssignments: {
        include: { leagueTeam: true },
      },
    },
  })
  if (!player) throw new Error('Player not found')
  // Pick any active assignment; for v1 a player can only have one
  // current league anyway. Multi-league refinement in future PRs.
  const myAssignment = player.leagueAssignments[0]
  if (!myAssignment) throw new Error('Player not assigned to a league')
  const leagueId = myAssignment.leagueTeam.leagueId
  const myLeagueTeamId = myAssignment.leagueTeamId

  // Find the matchday + match within this league.
  const gameWeek = await prisma.gameWeek.findFirst({
    where: { leagueId, weekNumber: m.weekNumber },
    include: {
      matches: {
        orderBy: { playedAt: 'asc' },
        select: { id: true, homeTeamId: true, awayTeamId: true, playedAt: true },
      },
    },
  })
  if (!gameWeek) throw new Error(`Matchday MD${m.weekNumber} not in league`)
  const match = gameWeek.matches[m.matchIndex]
  if (!match) throw new Error(`Match ${input.matchPublicId} not found`)

  // Kickoff gate.
  const kickoffMs = gameWeek.matches.map((mm) => mm.playedAt.getTime())
  const gate = evaluateSelfReportGate({
    hasSession: true,
    hasLinkedPlayer: true,
    matchKickoffs: gameWeek.matches.map((mm) => mm.playedAt),
    now: new Date(),
  })
  if (gate !== 'OPEN') {
    if (gate === 'BEFORE_KICKOFF') {
      throw new Error('Submission opens at kickoff')
    }
    throw new Error(`Cannot submit (${gate})`)
  }
  void kickoffMs // helper variable preserved for clarity; unused after gate

  // Player's team must be participating in this match.
  const teamIds = new Set([match.homeTeamId, match.awayTeamId])
  if (!teamIds.has(myLeagueTeamId)) {
    throw new Error('Your team is not playing in this match')
  }

  // Beneficiary derived from goalType.
  const beneficiaryTeamId =
    input.goalType === 'OWN_GOAL'
      ? myLeagueTeamId === match.homeTeamId
        ? match.awayTeamId
        : match.homeTeamId
      : myLeagueTeamId

  // Assister gate.
  const assisterPublicSlug = input.assisterPlayerSlug?.trim() || null
  let assisterId: string | null = null
  if (assisterPublicSlug) {
    const assisterCandidateId = slugToPlayerId(assisterPublicSlug)
    if (assisterCandidateId === playerId) {
      throw new Error('Assister cannot be the scorer')
    }
    // Must be on the player's own team (we don't allow cross-team
    // assists on self-report — real cross-team assists don't happen,
    // and OG with assist is too rare to bother with for v1).
    const assisterAssignment = await prisma.playerLeagueAssignment.findFirst({
      where: { playerId: assisterCandidateId, leagueTeamId: myLeagueTeamId },
      select: { id: true },
    })
    if (!assisterAssignment) {
      throw new Error('Assister must be on your team')
    }
    assisterId = assisterCandidateId
  }

  const created = await prisma.$transaction(async (tx) => {
    const ev = await tx.matchEvent.create({
      data: {
        matchId: match.id,
        kind: 'GOAL',
        goalType: input.goalType,
        scorerId: playerId,
        assisterId,
        minute: input.minute ?? null,
        createdById: userId,
      },
      select: { id: true },
    })
    void beneficiaryTeamId // beneficiary is implicit via scorer's team + goalType
    await recomputeMatchScore(tx, match.id)
    return ev
  })

  revalidate({
    domain: 'admin',
    paths: [
      `/matchday/${m.matchdayPublicId}`,
      `/admin/leagues/${leagueId}/stats`,
    ],
  })
  return created
}

/**
 * Parses `md3-m2` → `{ weekNumber: 3, matchIndex: 1, matchdayPublicId: 'md3' }`.
 * Returns null on shape mismatch.
 */
export function parseMatchPublicId(
  matchPublicId: string,
): { weekNumber: number; matchIndex: number; matchdayPublicId: string } | null {
  const match = matchPublicId.match(/^md(\d+)-m(\d+)$/)
  if (!match) return null
  const weekNumber = parseInt(match[1], 10)
  const matchNumber = parseInt(match[2], 10)
  if (!Number.isFinite(weekNumber) || weekNumber < 1) return null
  if (!Number.isFinite(matchNumber) || matchNumber < 1) return null
  return {
    weekNumber,
    matchIndex: matchNumber - 1,
    matchdayPublicId: `md${weekNumber}`,
  }
}
