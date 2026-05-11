'use server'

import { getServerSession } from 'next-auth'
import type { GuestType as PrismaGuestType } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { revalidate } from '@/lib/revalidate'
import { getLeagueIdBySlug } from '@/lib/leagueSlugServer'
import { slugToTeamId } from '@/lib/ids'
import { normalizePositions } from '@/lib/positions'

/**
 * v1.93.0 — Guest feature rework. Replaces the v1.91.0
 * `setMatchdayGuestEntry` (two-integer count upsert) with a per-row
 * "replacement-by-set" action: each call deletes the existing
 * MatchdayGuest rows for (gameWeekId, leagueTeamId) and inserts the
 * submitted list inside one transaction.
 *
 * Permissions: any authenticated user. No admin or team-membership
 * gate — casual leagues let any user log who's bringing guests. Audit
 * trail via `createdById` (set to current userId on every row in
 * every call; the v1.91.0 audit semantic was "last submitter", which
 * row-shaped guests preserve naturally — every replacement re-stamps).
 *
 * Authentication accepts EITHER `userId` OR `lineId` on the session,
 * mirroring the v1.80.10 / v1.59.1 pattern (grandfathered LINE sessions
 * predating v1.28.0 stage α.5 may carry only `lineId`).
 */

const MAX_GUESTS_PER_TEAM = 50

export interface GuestRowInput {
  /** EXTERNAL = non-T9L people; LEAGUE = T9L users from another team. */
  type: 'EXTERNAL' | 'LEAGUE'
  /** Position codes — validated server-side against league's ballType vocab. */
  positions: string[]
}

export interface SetMatchdayGuestsInput {
  /** League subdomain (e.g. "t9l", "kanto-spring"). Resolved server-side. */
  leagueSlug: string
  /** Public matchday id ("md1", "md2", ...). Parsed to weekNumber. */
  matchdayPublicId: string
  /** Public team slug (e.g. "mariners-fc"). Resolved within the league. */
  teamPublicId: string
  /** Rows in submission order. Replacement-by-set: this list FULLY replaces
   *  any existing MatchdayGuest rows for (matchday, team). */
  guests: GuestRowInput[]
}

export interface SetMatchdayGuestsResult {
  ok: true
  count: number
}

function parseMatchdayPublicId(matchdayPublicId: string): number | null {
  const m = matchdayPublicId.match(/^md(\d+)$/)
  if (!m) return null
  const wk = parseInt(m[1], 10)
  if (!Number.isFinite(wk) || wk < 1) return null
  return wk
}

export async function setMatchdayGuests(
  input: SetMatchdayGuestsInput,
): Promise<SetMatchdayGuestsResult> {
  const session = await getServerSession(authOptions)
  if (!session) throw new Error('Sign in to add guests')

  // Auth: gate on auth state, not on `session.isAdmin` (per the v1.67.0
  // admin-orthogonal-UX rule). v1.80.10 / v1.59.1 pattern: accept either
  // `userId` OR `lineId` to cover grandfathered LINE sessions whose JWT
  // predates v1.28.0 stage α.5 (lineId set, userId never populated).
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

  if (!Array.isArray(input.guests)) {
    throw new Error('guests must be an array')
  }
  if (input.guests.length > MAX_GUESTS_PER_TEAM) {
    throw new Error(`At most ${MAX_GUESTS_PER_TEAM} guests per team`)
  }

  const weekNumber = parseMatchdayPublicId(input.matchdayPublicId)
  if (weekNumber === null) {
    throw new Error(`Invalid matchdayPublicId: ${input.matchdayPublicId}`)
  }

  const leagueId = await getLeagueIdBySlug(input.leagueSlug)
  if (!leagueId) throw new Error(`League not found: ${input.leagueSlug}`)

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { ballType: true },
  })
  if (!league) throw new Error(`League not found: ${input.leagueSlug}`)

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

  // Validate each row's type + positions (per league's ballType vocab).
  // We re-assign displayOrder server-side per type — the modal "delete row 2"
  // path would otherwise leave gaps, which would make labels skip ("Ext Guest 1,
  // Ext Guest 3"). Rebuild from submission order: 0..N-1 per type-section.
  const externalCounter = { i: 0 }
  const leagueCounter = { i: 0 }
  type CreateData = {
    gameWeekId: string
    leagueTeamId: string
    type: PrismaGuestType
    positions: string[]
    displayOrder: number
    createdById: string
  }
  const rows: CreateData[] = []
  for (const raw of input.guests) {
    if (raw.type !== 'EXTERNAL' && raw.type !== 'LEAGUE') {
      throw new Error(`Invalid guest type: ${String(raw.type)}`)
    }
    let positions: string[]
    try {
      positions = normalizePositions(raw.positions ?? [], league.ballType)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid positions'
      throw new Error(msg)
    }
    const order =
      raw.type === 'EXTERNAL'
        ? externalCounter.i++
        : leagueCounter.i++
    rows.push({
      gameWeekId: gameWeek.id,
      leagueTeamId: leagueTeam.id,
      type: raw.type,
      positions,
      displayOrder: order,
      createdById: userId,
    })
  }

  // Replacement-by-set in one transaction: deleteMany existing then
  // createMany the new list. The unique-by-key shape from v1.91.0 is
  // replaced by this set-replacement semantic; both behave identically
  // from the caller's POV (submit a new state, it overwrites the prior).
  await prisma.$transaction([
    prisma.matchdayGuest.deleteMany({
      where: { gameWeekId: gameWeek.id, leagueTeamId: leagueTeam.id },
    }),
    ...(rows.length > 0
      ? [prisma.matchdayGuest.createMany({ data: rows })]
      : []),
  ])

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

  return { ok: true, count: rows.length }
}
