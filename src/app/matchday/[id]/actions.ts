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
 * v1.82.0 — cross-team scorers/assisters. Casual leagues let players
 * guest for other teams; the scorer/assister are no longer required to
 * be on a participating match team. Scope loosens to "any active member
 * of this league" (PlayerLeagueMembership with leagueTeamId set).
 * Beneficiary team is now passed from the form rather than derived from
 * the scorer's team — guest players break the implicit derivation.
 *
 * Re-evaluates every gate the page-level CTA enforces (defense in depth):
 *   1. session is set + has linked playerId (caller — any linked player)
 *   2. matchPublicId resolves to a Match in the caller's resolved league
 *   3. now (JST) >= earliest kickoff in the matchday
 *   4. beneficiaryTeamId is one of the match's two teams
 *   5. scorerPlayerSlug resolves to a real Player with an active league
 *      membership (any team, OR the league directly via leagueId)
 *   6. assister, when supplied, is also a league member and ≠ scorer
 *
 * Auto-approved per user's brief — `MatchEvent.createdById` records the
 * submitting User so admins can grep audit history in case of abuse.
 */
export async function submitOwnMatchEvent(input: {
  matchPublicId: string // e.g. "md3-m2"
  goalType: GoalType
  /**
   * v1.82.0 — beneficiary team (the one the goal counts for). Required
   * since cross-team scorers break the pre-v1.82.0 derivation. Must be
   * one of the match's two teams.
   */
  beneficiaryTeamId: string
  /**
   * v1.48.0 — public slug of the player who scored the goal. ANY player
   * in the resolved league. Pre-v1.48.0 this was forced to equal the
   * caller's session.playerId; that restriction is gone.
   *
   * v1.82.0 — no longer required to be on a participating match team;
   * any active league member is eligible (guest players in casual leagues).
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
  // v1.65.0 — leagueTeam nullable post-rework; only memberships with a
  // real team can submit goals. Pick the first such membership.
  const callerAssignment = callerPlayer.leagueAssignments.find((a) => a.leagueTeam !== null)
  if (!callerAssignment || !callerAssignment.leagueTeam) {
    throw new Error('Caller not assigned to a league')
  }
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

  // v1.82.0 — beneficiary is now an explicit input. Must be one of the
  // match's two teams. The implicit pre-v1.82.0 derivation (= scorer's
  // team for non-OG, opposite for OG) was correct only when the scorer
  // was a member of one of the match teams; cross-team scorers (guest
  // players) broke that, so the form has to send it explicitly.
  const beneficiaryTeamId = input.beneficiaryTeamId?.trim()
  if (!beneficiaryTeamId) throw new Error('Beneficiary team is required')
  if (beneficiaryTeamId !== match.homeTeamId && beneficiaryTeamId !== match.awayTeamId) {
    throw new Error('Beneficiary team is not part of this match')
  }

  // v1.48.0 / v1.82.0 — resolve scorer from form input. Must be a player
  // with an active league membership (any team, including teams not
  // playing in this match — casual leagues let players guest).
  const scorerSlug = input.scorerPlayerSlug?.trim()
  if (!scorerSlug) throw new Error('Scorer is required')
  const scorerId = slugToPlayerId(scorerSlug)
  const scorerAssignment = await prisma.playerLeagueMembership.findFirst({
    where: {
      playerId: scorerId,
      leagueId,
      leagueTeamId: { not: null },
    },
    select: { id: true },
  })
  if (!scorerAssignment) {
    throw new Error('Scorer is not a member of this league')
  }

  // Assister gate — must be a league member and ≠ scorer. v1.82.0 drops
  // the "must be on scorer's team" requirement (cross-team assists are
  // legal in casual leagues, same logic as the scorer change).
  const assisterPublicSlug = input.assisterPlayerSlug?.trim() || null
  let assisterId: string | null = null
  if (assisterPublicSlug) {
    const assisterCandidateId = slugToPlayerId(assisterPublicSlug)
    if (assisterCandidateId === scorerId) {
      throw new Error('Assister cannot be the scorer')
    }
    const assisterAssignment = await prisma.playerLeagueMembership.findFirst({
      where: {
        playerId: assisterCandidateId,
        leagueId,
        leagueTeamId: { not: null },
      },
      select: { id: true },
    })
    if (!assisterAssignment) {
      throw new Error('Assister is not a member of this league')
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
        beneficiaryTeamId,
        createdById: userId,
      },
      select: { id: true },
    })
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
