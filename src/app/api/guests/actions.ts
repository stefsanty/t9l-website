'use server'

import { getServerSession } from 'next-auth'
import type { GuestType as PrismaGuestType, RsvpStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { revalidate } from '@/lib/revalidate'
import { getLeagueIdBySlug } from '@/lib/leagueSlugServer'
import { slugToTeamId, slugToPlayerId } from '@/lib/ids'
import { normalizePositions } from '@/lib/positions'
import { setRsvp } from '@/lib/rsvpStore'

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

/**
 * v1.95.0 — Admin-only RSVP override payload. When present + non-empty
 * the action enforces `session.isAdmin` (throws otherwise). Each entry
 * upserts the team member's Availability row with `overriddenById` +
 * `overriddenAt` set for audit; Redis canonical store is updated in
 * the same call so the read path surfaces the new status immediately.
 *
 * The user-facing /api/rsvp POST path is the inverse: when a player
 * RSVPs themselves, `overriddenById` / `overriddenAt` are cleared back
 * to NULL (the player took ownership back).
 */
export type AdminRsvpStatus = 'GOING' | 'UNDECIDED' | 'NOT_GOING' | null

export interface RsvpOverrideInput {
  /** Public slug (e.g. "ian-noseda"). NOT the prefixed DB id. */
  playerPublicId: string
  /** New status. `null` clears the row's `rsvp` field. */
  status: AdminRsvpStatus
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
  /** v1.95.0 — admin-only RSVP overrides. When present + non-empty the
   *  caller must be a session admin. Each entry must reference a player
   *  rostered on the given team in the given league. */
  rsvpOverrides?: RsvpOverrideInput[]
}

export interface SetMatchdayGuestsResult {
  ok: true
  count: number
  /** Number of Availability rows written by the admin-override path.
   *  Zero for non-admin callers and for admin saves with no overrides. */
  rsvpOverrideCount: number
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
    // startDate drives the Redis absolute-TTL math when rsvpOverrides
    // are applied. Selected unconditionally — single-row, negligible cost.
    select: { id: true, startDate: true },
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

  // v1.95.0 — admin-only RSVP overrides. Validated + resolved up front
  // (before the transaction) so any rejection happens before any DB write.
  // The admin gate is the strictest possible: explicit `session.isAdmin`
  // check, no fallthrough to lineId (this is an admin-orthogonal-UX-allowed
  // ADDITIVE admin capability layered on top of a user-facing modal, not
  // a user-facing path).
  type OverrideUpsert = {
    playerDbId: string
    playerPublicId: string
    rsvp: RsvpStatus | null
  }
  const overrideUpserts: OverrideUpsert[] = []
  const rawOverrides = input.rsvpOverrides ?? []
  if (rawOverrides.length > 0) {
    if (!session.isAdmin) {
      throw new Error('Unauthorized: RSVP overrides require admin')
    }
    // Resolve every override's player → DB id + verify the player is
    // rostered on THIS team in THIS league via PlayerLeagueMembership.
    // One findMany covers all overrides; reject if any row is missing.
    const dbIds = rawOverrides.map((o) => slugToPlayerId(o.playerPublicId))
    const memberships = await prisma.playerLeagueMembership.findMany({
      where: {
        leagueId,
        leagueTeamId: leagueTeam.id,
        playerId: { in: dbIds },
      },
      select: { playerId: true },
    })
    const validDbIds = new Set(memberships.map((m) => m.playerId))
    for (const o of rawOverrides) {
      const playerDbId = slugToPlayerId(o.playerPublicId)
      if (!validDbIds.has(playerDbId)) {
        throw new Error(
          `Player ${o.playerPublicId} is not on team ${input.teamPublicId} in this league`,
        )
      }
      if (
        o.status !== 'GOING' &&
        o.status !== 'UNDECIDED' &&
        o.status !== 'NOT_GOING' &&
        o.status !== null
      ) {
        throw new Error(`Invalid override status: ${String(o.status)}`)
      }
      overrideUpserts.push({
        playerDbId,
        playerPublicId: o.playerPublicId,
        rsvp: o.status,
      })
    }
  }

  // Replacement-by-set in one transaction: deleteMany existing then
  // createMany the new list. The unique-by-key shape from v1.91.0 is
  // replaced by this set-replacement semantic; both behave identically
  // from the caller's POV (submit a new state, it overwrites the prior).
  //
  // v1.95.0 — admin overrides bundled into the same transaction so a
  // partial-write surface is impossible. Each override upserts an
  // Availability row with the admin User as `overriddenById` + now() as
  // `overriddenAt`; `updatedAt` fires automatically.
  const overriddenAt = new Date()
  await prisma.$transaction([
    prisma.matchdayGuest.deleteMany({
      where: { gameWeekId: gameWeek.id, leagueTeamId: leagueTeam.id },
    }),
    ...(rows.length > 0
      ? [prisma.matchdayGuest.createMany({ data: rows })]
      : []),
    ...overrideUpserts.map((o) =>
      prisma.availability.upsert({
        where: {
          playerId_gameWeekId: {
            playerId: o.playerDbId,
            gameWeekId: gameWeek.id,
          },
        },
        create: {
          id: `av-${o.playerDbId}-${gameWeek.id}`,
          playerId: o.playerDbId,
          gameWeekId: gameWeek.id,
          rsvp: o.rsvp,
          overriddenById: userId,
          overriddenAt,
        },
        update: {
          rsvp: o.rsvp,
          overriddenById: userId,
          overriddenAt,
        },
      }),
    ),
  ])

  // v1.95.0 — propagate the override into the Redis-canonical RSVP store
  // so the public read path surfaces the new status immediately (the
  // dashboard reads Redis-direct, not Prisma; see docs/redis-state.md).
  // Silent variant: a Redis failure here leaves the durable Prisma
  // upsert intact, and the next read will fall through Prisma + warm
  // the cache. Per-override fire-and-forget; we still await Promise.all
  // so any thrown errors surface as warnings before the function returns.
  if (overrideUpserts.length > 0) {
    await Promise.all(
      overrideUpserts.map((o) =>
        setRsvp(gameWeek.id, gameWeek.startDate, o.playerPublicId, o.rsvp),
      ),
    )
  }

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

  return {
    ok: true,
    count: rows.length,
    rsvpOverrideCount: overrideUpserts.length,
  }
}

/**
 * v1.95.0 — Admin-only context fetch for the override section of the
 * Add Guests modal. Returns the roster of active (non-retired) team
 * members alongside their raw current Availability for the matchday.
 *
 * Why a separate fetch rather than threading through the modal props:
 * the public read path (`src/lib/rsvpMerge.ts`) deliberately collapses
 * NOT_GOING + missing signals to `null` in `availabilityStatuses`. The
 * admin override surface needs the full picture (including NOT_GOING)
 * so admins can see what state they're flipping. Keeping this on its
 * own action also avoids leaking NOT_GOING signals into the public
 * LeagueData payload that any reader sees.
 *
 * Read source: Prisma `Availability` (not Redis). The override section
 * is admin-domain — staleness on the order of seconds is fine, and
 * Prisma is the only store that carries the `overriddenById` audit
 * field. The user-facing read path stays Redis-canonical.
 */
export interface AdminRosterRsvpEntry {
  /** Public slug (e.g. "ian-noseda"). Stable across re-renders. */
  playerPublicId: string
  name: string
  /** Current persisted RSVP — including NOT_GOING. `null` = no row /
   *  row exists with rsvp=null. */
  currentRsvp: 'GOING' | 'UNDECIDED' | 'NOT_GOING' | null
  /** Last admin to override this row (if any), for display only. Null
   *  when no override is currently active OR when the player has
   *  re-RSVPed since the last override (which clears these fields). */
  overriddenById: string | null
  overriddenAt: string | null
}

export interface GetAdminRosterRsvpInput {
  leagueSlug: string
  matchdayPublicId: string
  teamPublicId: string
}

export interface GetAdminRosterRsvpResult {
  ok: true
  entries: AdminRosterRsvpEntry[]
}

export async function getAdminRosterRsvp(
  input: GetAdminRosterRsvpInput,
): Promise<GetAdminRosterRsvpResult> {
  const session = await getServerSession(authOptions)
  if (!session?.isAdmin) {
    throw new Error('Unauthorized: admin required')
  }

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

  // Roster: active (non-retired) APPROVED memberships on this team in
  // this league. Mirrors the dashboard's upcoming-matchday filter:
  // retired players shouldn't appear in availability pickers.
  const memberships = await prisma.playerLeagueMembership.findMany({
    where: {
      leagueId,
      leagueTeamId: leagueTeam.id,
      retiredAt: null,
      applicationStatus: 'APPROVED',
    },
    select: {
      player: { select: { id: true, name: true } },
    },
  })
  const players = memberships
    .map((m) => m.player)
    .filter((p): p is { id: string; name: string } => !!p)

  if (players.length === 0) {
    return { ok: true, entries: [] }
  }

  const availabilityRows = await prisma.availability.findMany({
    where: {
      gameWeekId: gameWeek.id,
      playerId: { in: players.map((p) => p.id) },
    },
    select: {
      playerId: true,
      rsvp: true,
      overriddenById: true,
      overriddenAt: true,
    },
  })
  const byPlayerDbId = new Map(
    availabilityRows.map((r) => [r.playerId, r] as const),
  )

  const entries: AdminRosterRsvpEntry[] = players
    .map((p) => {
      const a = byPlayerDbId.get(p.id)
      return {
        playerPublicId: p.id.startsWith('p-') ? p.id.slice(2) : p.id,
        name: p.name,
        currentRsvp: (a?.rsvp ?? null) as
          | 'GOING'
          | 'UNDECIDED'
          | 'NOT_GOING'
          | null,
        overriddenById: a?.overriddenById ?? null,
        overriddenAt: a?.overriddenAt ? a.overriddenAt.toISOString() : null,
      }
    })
    .sort((x, y) => x.name.localeCompare(y.name))

  return { ok: true, entries }
}
