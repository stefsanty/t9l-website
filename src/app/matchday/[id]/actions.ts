'use server'

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { revalidate } from '@/lib/revalidate'
import { recomputeMatchScore } from '@/lib/matchScore'
import { evaluateSelfReportGate } from '@/lib/playerSelfReportGate'
import { parseMatchPublicId } from '@/lib/matchPublicId'
import { slugToPlayerId } from '@/lib/ids'
import type { GoalType } from '@prisma/client'

const VALID_GOAL_TYPES = new Set<GoalType>([
  'OPEN_PLAY',
  'SET_PIECE',
  'PENALTY',
  'OWN_GOAL',
])

/**
 * v1.46.0 (epic match events PR ζ) — player submits a goal.
 *
 * v1.48.0 — open attribution: ANY logged-in linked player can submit a
 * goal for ANY player. Pre-v1.48.0 the scorer was forced to equal the
 * calling user's bound player (the form locked it; the action enforced
 * it). The user's product brief opens this up — the submitter and the
 * scorer can differ. `MatchEvent.createdById` records the SUBMITTING user
 * for audit; `scorerId` is now driven by the form input. Admin CRUD
 * (PR γ) handles cleanup if abuse appears.
 *
 * Re-evaluates every gate the page-level CTA enforces (defense in depth):
 *   1. session is set + has linked playerId (caller — any linked player)
 *   2. matchPublicId resolves to a Match in the caller's resolved league
 *   3. now (JST) >= earliest kickoff in the matchday
 *   4. scorerPlayerSlug resolves to a real Player with an assignment in
 *      one of the match's two teams (cross-league rejection AND not on
 *      the participating teams = reject)
 *   5. for OWN_GOAL the beneficiary is the OPPOSITE of the scorer's team
 *   6. assister, when supplied, must be on the scorer's team and ≠ scorer
 *
 * Auto-approved per user's brief — `MatchEvent.createdById` records the
 * submitting User so admins can grep audit history in case of abuse.
 */
export async function submitOwnMatchEvent(input: {
  matchPublicId: string // e.g. "md3-m2"
  goalType: GoalType
  /**
   * v1.48.0 — public slug of the player who scored the goal. ANY player
   * in the resolved league. Pre-v1.48.0 this was forced to equal the
   * caller's session.playerId; that restriction is gone.
   */
  scorerPlayerSlug: string
  assisterPlayerSlug?: string | null
  minute?: number | null
}): Promise<{ id: string }> {
  const session = await getServerSession(authOptions)
  const userId = session?.userId
  const callerPlayerSlug = session?.playerId

  if (!session || !userId) throw new Error('Not signed in')
  if (!callerPlayerSlug) throw new Error('No linked player on this account')
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

  // Resolve match. The matchPublicId is `md<wk>-m<idx+1>` from the
  // public adapter. We need to find the real DB Match.id by joining
  // through GameWeek.weekNumber and the playedAt-asc ordering used by
  // dbToPublicLeagueData.
  const m = parseMatchPublicId(input.matchPublicId)
  if (!m) throw new Error(`Invalid matchPublicId: ${input.matchPublicId}`)

  // Resolve the caller's league via their linked Player → assignment.
  // (The callerPlayerSlug determines the league context; we don't trust
  // form input for league selection.)
  const callerPlayerId = slugToPlayerId(callerPlayerSlug)
  const callerPlayer = await prisma.player.findUnique({
    where: { id: callerPlayerId },
    include: {
      leagueAssignments: {
        include: { leagueTeam: true },
      },
    },
  })
  if (!callerPlayer) throw new Error('Caller player not found')
  const callerAssignment = callerPlayer.leagueAssignments[0]
  if (!callerAssignment) throw new Error('Caller not assigned to a league')
  const leagueId = callerAssignment.leagueTeam.leagueId

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

  // Kickoff gate (matchday-level — earliest kickoff across all matches).
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

  // v1.48.0 — resolve scorer from form input. Must exist + have an
  // assignment on one of the match's two teams in the SAME league.
  const scorerSlug = input.scorerPlayerSlug?.trim()
  if (!scorerSlug) throw new Error('Scorer is required')
  const scorerId = slugToPlayerId(scorerSlug)
  const scorerAssignment = await prisma.playerLeagueAssignment.findFirst({
    where: {
      playerId: scorerId,
      leagueTeamId: { in: [match.homeTeamId, match.awayTeamId] },
    },
    select: { leagueTeamId: true },
  })
  if (!scorerAssignment) {
    throw new Error('Scorer is not on either of the match teams')
  }
  const scorerLeagueTeamId = scorerAssignment.leagueTeamId

  // Beneficiary derived from goalType.
  const beneficiaryTeamId =
    input.goalType === 'OWN_GOAL'
      ? scorerLeagueTeamId === match.homeTeamId
        ? match.awayTeamId
        : match.homeTeamId
      : scorerLeagueTeamId

  // Assister gate — must be on the scorer's team and ≠ scorer.
  const assisterPublicSlug = input.assisterPlayerSlug?.trim() || null
  let assisterId: string | null = null
  if (assisterPublicSlug) {
    const assisterCandidateId = slugToPlayerId(assisterPublicSlug)
    if (assisterCandidateId === scorerId) {
      throw new Error('Assister cannot be the scorer')
    }
    const assisterAssignment = await prisma.playerLeagueAssignment.findFirst({
      where: {
        playerId: assisterCandidateId,
        leagueTeamId: scorerLeagueTeamId,
      },
      select: { id: true },
    })
    if (!assisterAssignment) {
      throw new Error("Assister must be on the scorer's team")
    }
    assisterId = assisterCandidateId
  }

  const created = await prisma.$transaction(async (tx) => {
    const ev = await tx.matchEvent.create({
      data: {
        matchId: match.id,
        kind: 'GOAL',
        goalType: input.goalType,
        scorerId,
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

// v1.47.0 — `parseMatchPublicId` moved to `src/lib/matchPublicId.ts`. Kept
// out of this file because Next 16's strict server-action contract rejects
// non-async exports from `'use server'` modules — the v1.46.0 prod build
// failed for this exact reason. Tests import from the new location.
