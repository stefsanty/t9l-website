'use server'

import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { waitUntil } from '@vercel/functions'
import { authOptions, getPlayerMappingFromDb } from '@/lib/auth'
import { revalidate } from '@/lib/revalidate'
import {
  setMapping,
  deleteMapping,
  type PlayerMapping,
} from '@/lib/playerMappingStore'
import { seedGameWeek, deleteGameWeek as deleteGameWeekFromRedis } from '@/lib/rsvpStore'
import { parseJstDateTimeLocal, parseJstDateOnly } from '@/lib/jst'
import { linkPlayerToUser, unlinkPlayerFromUser } from '@/lib/identityLink'
import {
  generateInviteCode,
  computeInviteExpiry,
  buildInviteUrl,
  buildInviteCreateData,
  INVITE_DEFAULT_EXPIRY_DAYS,
  type InviteCsvRow,
} from '@/lib/inviteCodes'
import { headers } from 'next/headers'
import type { PlayerPosition, GoalType } from '@prisma/client'
import { recomputeMatchScore } from '@/lib/matchScore'

/**
 * v1.13.0 — defer the Redis pre-warm off the admin response critical path.
 *
 * Mirror of the v1.8.0 inversion that ships the public hot paths
 * (`/api/assign-player`, `/api/rsvp`): Redis is a secondary store on the
 * admin path (admin pages re-read Prisma directly via the canonical
 * `revalidate` helper's path bust), so the pre-warm can run in
 * `waitUntil`. Drift on Redis failure surfaces in the structured log;
 * recoverable via `scripts/auditRedisVsPrisma.ts`.
 *
 * v1.26.0 — per-league key. `adminLinkLineToPlayer` operates within an
 * explicit leagueId so we pre-warm just that league's key. The other
 * leagues this lineId might be cached in are deliberately left alone —
 * an admin link in League X shouldn't churn League Y's cache.
 */
function deferSetMapping(
  op: 'admin-link' | 'admin-update' | 'admin-create',
  lineId: string,
  leagueId: string,
  mapping: PlayerMapping | null,
): void {
  waitUntil(
    setMapping(lineId, leagueId, mapping).catch((err) =>
      console.error(
        '[v1.13.0 DRIFT] kind=playerMapping op=%s lineId=%s leagueId=%s err=%o',
        op,
        lineId,
        leagueId,
        err,
      ),
    ),
  )
}

async function assertAdmin() {
  const session = await getServerSession(authOptions)
  if (!session?.isAdmin) throw new Error('Unauthorized')
}

// ── League ──────────────────────────────────────────────────────────────────

export async function createLeague(formData: FormData) {
  await assertAdmin()
  const name        = (formData.get('name')        as string).trim()
  const location    = (formData.get('location')    as string).trim()
  const description = (formData.get('description') as string | null)?.trim() || null
  const startDate   = formData.get('startDate')    as string
  const endDate     = formData.get('endDate')      as string | null
  const subdomain   = (formData.get('subdomain')   as string | null)?.trim() || null

  // v1.53.1 (PR 5 of the path-routing chain) — server-side reserved-word
  // + format validation. The slug becomes the URL path component
  // (canonical `/id/<slug>` post-v1.54.0; legacy `/league/<slug>` and
  // `/<slug>` redirect there). It must:
  //   - match [a-z0-9](-[a-z0-9]+)* between 3–30 chars
  //   - not collide with the recursive `id` reserved slug (post-v1.54.0
  //     the reserved set collapsed to just `id` — every other top-level
  //     platform route is now a sibling of `/id/`, not a parent)
  // The client-side check in CreateLeagueModal mirrors this logic for
  // immediate UX feedback; the server is the contract. Reject early
  // before hitting Prisma so the admin sees the specific failure reason.
  if (subdomain !== null) {
    const { validateLeagueSlug } = await import('@/lib/leagueSlug')
    const v = validateLeagueSlug(subdomain)
    if (!v.ok) {
      throw new Error(`Invalid league slug: ${v.reason}`)
    }
  }

  // League startDate/endDate are JST calendar dates (date-only `<input type="date">`).
  // Stored as UTC midnight; see lib/jst.ts.
  const league = await prisma.league.create({
    data: {
      name,
      location,
      description,
      subdomain,
      startDate: parseJstDateOnly(startDate),
      endDate:   endDate ? parseJstDateOnly(endDate) : null,
    },
  })

  revalidate({ domain: 'admin', paths: ['/admin'] })
  redirect(`/admin/leagues/${league.id}/schedule`)
}

export async function updateLeagueInfo(id: string, data: {
  name?:        string
  description?: string | null
  subdomain?:   string | null
  location?:    string
  startDate?:   string
  endDate?:     string | null
}) {
  await assertAdmin()

  // v1.53.1 — slug is "cannot be changed after creation" by convention,
  // but the API still accepts updates because admin may have left the
  // slug blank at create time and want to fill it in later. When the
  // slug IS being changed, validate it against the same rules
  // createLeague enforces. Empty-to-non-empty is allowed (filling in
  // a blank slot); non-empty-to-empty is allowed (clearing a slot).
  if (data.subdomain !== undefined && data.subdomain !== null && data.subdomain !== '') {
    const { validateLeagueSlug } = await import('@/lib/leagueSlug')
    const v = validateLeagueSlug(data.subdomain)
    if (!v.ok) {
      throw new Error(`Invalid league slug: ${v.reason}`)
    }
  }

  await prisma.league.update({
    where: { id },
    data: {
      name:        data.name,
      description: data.description !== undefined ? (data.description || null) : undefined,
      subdomain:   data.subdomain   !== undefined ? (data.subdomain   || null) : undefined,
      location:    data.location,
      startDate:   data.startDate ? parseJstDateOnly(data.startDate) : undefined,
      endDate:     data.endDate !== undefined ? (data.endDate ? parseJstDateOnly(data.endDate) : null) : undefined,
    },
  })
  revalidate({ domain: 'admin', paths: [`/admin/leagues/${id}`, '/admin'] })
}

export async function deleteLeague(id: string) {
  await assertAdmin()
  const completedMatches = await prisma.match.count({
    where: { leagueId: id, status: 'COMPLETED' },
  })
  if (completedMatches > 0) throw new Error('Cannot delete league with completed matches')
  await prisma.league.delete({ where: { id } })
  revalidate({ domain: 'admin', paths: ['/admin'] })
  redirect('/admin')
}

/**
 * v1.60.0 — per-league self-link toggle. Sets `League.allowSelfLink` to
 * the supplied boolean. Default for a new League is `true` (backward
 * compat); admins flip to `false` to disable the legacy `/assign-player`
 * open picker for THIS league only. Other leagues are unaffected.
 *
 * Validation: rejects non-boolean values defensively. The admin UI is
 * the affordance; this is the server contract.
 */
export async function setLeagueAllowSelfLink(leagueId: string, value: boolean) {
  await assertAdmin()
  if (typeof value !== 'boolean') {
    throw new Error('allowSelfLink must be a boolean')
  }
  await prisma.league.update({
    where: { id: leagueId },
    data: { allowSelfLink: value },
  })
  revalidate({
    domain: 'admin',
    paths: [`/admin/leagues/${leagueId}/settings`, `/admin/leagues/${leagueId}`, '/admin'],
  })
}

/**
 * v1.63.0 — per-league pre-season toggle. When true, the homepage swaps
 * the "Classic League Homepage" (NextMatchdayBanner + MatchdayAvailability
 * + RsvpBar) for `CompressedMatchdaySchedule`, and the `/stats` page is
 * hidden (header link removed; route redirects to home). Default false
 * preserves the existing experience.
 *
 * Validation: rejects non-boolean values defensively.
 */
export async function setLeaguePreseasonMode(leagueId: string, value: boolean) {
  await assertAdmin()
  if (typeof value !== 'boolean') {
    throw new Error('preseasonMode must be a boolean')
  }
  await prisma.league.update({
    where: { id: leagueId },
    data: { preseasonMode: value },
  })
  revalidate({
    domain: 'admin',
    paths: [`/admin/leagues/${leagueId}/settings`, `/admin/leagues/${leagueId}`, '/admin'],
  })
}

/**
 * v1.63.0 — per-league recruiting toggle. When true, surfaces a prominent
 * "RECRUITING NOW" banner at the top of the homepage. Independent of
 * `preseasonMode` — both can be on simultaneously. Default false.
 *
 * Validation: rejects non-boolean values defensively.
 */
export async function setLeagueRecruiting(leagueId: string, value: boolean) {
  await assertAdmin()
  if (typeof value !== 'boolean') {
    throw new Error('recruiting must be a boolean')
  }
  await prisma.league.update({
    where: { id: leagueId },
    data: { recruiting: value },
  })
  revalidate({
    domain: 'admin',
    paths: [`/admin/leagues/${leagueId}/settings`, `/admin/leagues/${leagueId}`, '/admin'],
  })
}

/**
 * v1.67.0 — planned-roster targets surfaced in the preseason stats panel.
 *
 * Sets `League.plannedPlayersPerTeam`, `plannedNumberOfTeams`, and
 * `registrationDeadline` atomically. All three accept null/undefined to
 * mean "leave unchanged" — the SettingsTab UI sends the full triple
 * together so this is mostly defensive.
 *
 * Validation:
 *   - both numerics must be non-negative integers (0 = "not set")
 *   - registrationDeadline accepts null (clear), undefined (leave),
 *     or a Date / parseable ISO string.
 *
 * Resolved deadline is stored as a UTC instant. Admin enters via
 * `<input type="date">` (JST calendar date) so we route through
 * `parseJstDateOnly` for that branch. ISO 8601 with timezone passes
 * through `new Date()` directly.
 */
export async function updateLeaguePlannedRoster(input: {
  leagueId: string
  plannedPlayersPerTeam: number
  plannedNumberOfTeams: number
  // 'YYYY-MM-DD' (JST date), full ISO, null to clear, or undefined to leave.
  registrationDeadline?: string | null
}): Promise<void> {
  await assertAdmin()
  if (!input.leagueId) throw new Error('leagueId is required')
  if (!Number.isInteger(input.plannedPlayersPerTeam) || input.plannedPlayersPerTeam < 0) {
    throw new Error('plannedPlayersPerTeam must be a non-negative integer')
  }
  if (!Number.isInteger(input.plannedNumberOfTeams) || input.plannedNumberOfTeams < 0) {
    throw new Error('plannedNumberOfTeams must be a non-negative integer')
  }

  // Resolve registrationDeadline:
  //   null              → clear column
  //   undefined         → leave unchanged (no field in update)
  //   'YYYY-MM-DD'      → parseJstDateOnly (JST calendar date)
  //   full ISO          → new Date()
  const data: {
    plannedPlayersPerTeam: number
    plannedNumberOfTeams: number
    registrationDeadline?: Date | null
  } = {
    plannedPlayersPerTeam: input.plannedPlayersPerTeam,
    plannedNumberOfTeams: input.plannedNumberOfTeams,
  }
  if (input.registrationDeadline === null) {
    data.registrationDeadline = null
  } else if (typeof input.registrationDeadline === 'string') {
    const trimmed = input.registrationDeadline.trim()
    if (!trimmed) {
      data.registrationDeadline = null
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      data.registrationDeadline = parseJstDateOnly(trimmed)
    } else {
      const parsed = new Date(trimmed)
      if (Number.isNaN(parsed.getTime())) {
        throw new Error('registrationDeadline is not a valid date')
      }
      data.registrationDeadline = parsed
    }
  }

  await prisma.league.update({
    where: { id: input.leagueId },
    data,
  })

  revalidate({
    domain: 'admin',
    paths: [
      `/admin/leagues/${input.leagueId}/settings`,
      `/admin/leagues/${input.leagueId}`,
      '/admin',
    ],
  })
  revalidate({ domain: 'public' })
}

// ── GameWeek ────────────────────────────────────────────────────────────────

export async function createGameWeek(leagueId: string, data: {
  weekNumber: number
  startDate:  string
  endDate:    string
  venueId?:   string | null
}) {
  await assertAdmin()
  // GameWeek startDate/endDate come from `<input type="date">` (JST calendar
  // date stored as UTC midnight). See lib/jst.ts.
  const gw = await prisma.gameWeek.create({
    data: {
      leagueId,
      weekNumber: data.weekNumber,
      startDate:  parseJstDateOnly(data.startDate),
      endDate:    parseJstDateOnly(data.endDate),
      venueId:    data.venueId || null,
    },
  })
  // v1.7.0 — pre-warm the Redis RSVP hash with the `__seeded` sentinel so
  // the first dashboard read for this GW returns hit-with-empty instead of
  // miss-then-Prisma-fallthrough. Failure is swallowed by the store helper;
  // a missing seed self-heals on first read via the publicData backfill.
  await seedGameWeek(gw.id, gw.startDate)
  revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/schedule`] })
}

/**
 * v1.67.3 — One-click "Add matchday".
 *
 * Pre-v1.67.3 the admin Schedule tab "Add matchday" button opened a modal
 * form requiring date + venue before the GameWeek would be created. The
 * v1.31.0 schema relaxation made `GameWeek.startDate`/`endDate` nullable;
 * date and venue are now editable inline via the existing per-row pill
 * editors. So the up-front form was redundant friction.
 *
 * This action takes a single `leagueId`, computes `weekNumber = max + 1`,
 * and creates a GameWeek with `startDate` / `endDate` / `venueId` all null.
 * The admin then fills details inline. Same Redis pre-warm + revalidate
 * shape as `createGameWeek`.
 */
export async function adminAddMatchday(leagueId: string) {
  await assertAdmin()
  const last = await prisma.gameWeek.findFirst({
    where: { leagueId },
    orderBy: { weekNumber: 'desc' },
    select: { weekNumber: true },
  })
  const weekNumber = (last?.weekNumber ?? 0) + 1
  const gw = await prisma.gameWeek.create({
    data: {
      leagueId,
      weekNumber,
      startDate: null,
      endDate: null,
      venueId: null,
    },
  })
  // seedGameWeek handles a null startDate per v1.31.0 — falls back to
  // `now() + 90d` for the absolute TTL when the matchday date is TBD.
  await seedGameWeek(gw.id, gw.startDate)
  revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/schedule`] })
}

export async function updateGameWeek(id: string, leagueId: string, data: {
  startDate?: string | null
  endDate?:   string | null
  venueId?:   string | null
}) {
  await assertAdmin()
  // v1.31.0 — `startDate` / `endDate` may be `null` (admin clearing the date
  // → public site renders "TBD"). `undefined` means "field not in the patch
  // — leave it alone". Empty-string normalises to `null` so the date pill's
  // overlaid <input type="date"> can submit a cleared value.
  const startDate =
    data.startDate === undefined
      ? undefined
      : data.startDate
        ? parseJstDateOnly(data.startDate)
        : null
  const endDate =
    data.endDate === undefined
      ? undefined
      : data.endDate
        ? parseJstDateOnly(data.endDate)
        : null
  await prisma.gameWeek.update({
    where: { id },
    data: {
      startDate,
      endDate,
      venueId: data.venueId !== undefined ? (data.venueId || null) : undefined,
    },
  })
  revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/schedule`] })
}

export async function deleteGameWeek(id: string, leagueId: string) {
  await assertAdmin()
  const completedMatches = await prisma.match.count({
    where: { gameWeekId: id, status: 'COMPLETED' },
  })
  if (completedMatches > 0) throw new Error('Cannot delete matchday with completed matches')
  await prisma.gameWeek.delete({ where: { id } })
  // Cleanup-only: orphan Redis hashes would expire on their own (matchday +
  // 90d), but eager deletion keeps the namespace tidy.
  await deleteGameWeekFromRedis(id)
  revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/schedule`] })
}

// ── Match ────────────────────────────────────────────────────────────────────

export async function createMatch(gameWeekId: string, leagueId: string, data: {
  homeTeamId: string
  awayTeamId: string
  playedAt:   string
}) {
  await assertAdmin()
  // Match playedAt comes from `<input type="datetime-local">` (JST clock
  // string). Use parseJstDateTimeLocal — never `new Date(str)`, which on
  // Vercel (TZ=UTC) would skew JST 14:30 → UTC 14:30 (= JST 23:30).
  // See lib/jst.ts and CLAUDE.md "Time handling".
  await prisma.match.create({
    data: {
      leagueId,
      gameWeekId,
      homeTeamId: data.homeTeamId,
      awayTeamId: data.awayTeamId,
      playedAt:   parseJstDateTimeLocal(data.playedAt),
      status:     'SCHEDULED',
    },
  })
  revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/schedule`] })
}

export async function updateMatch(id: string, leagueId: string, data: {
  homeScore?:  number
  awayScore?:  number
  playedAt?:   string
  endedAt?:    string | null
  homeTeamId?: string
  awayTeamId?: string
  status?:     string
}) {
  await assertAdmin()
  const updateData: Record<string, unknown> = {}
  if (data.homeScore  !== undefined) updateData.homeScore  = data.homeScore
  if (data.awayScore  !== undefined) updateData.awayScore  = data.awayScore
  // playedAt + endedAt are JST clock strings — parse with the JST helper.
  if (data.playedAt)                 updateData.playedAt   = parseJstDateTimeLocal(data.playedAt)
  if (data.endedAt !== undefined)    updateData.endedAt    = data.endedAt ? parseJstDateTimeLocal(data.endedAt) : null
  if (data.homeTeamId)               updateData.homeTeamId = data.homeTeamId
  if (data.awayTeamId)               updateData.awayTeamId = data.awayTeamId
  if (data.status) {
    updateData.status = data.status
    if (data.status === 'COMPLETED' && data.homeScore !== undefined && data.awayScore !== undefined) {
      updateData.homeScore = data.homeScore
      updateData.awayScore = data.awayScore
    }
  }
  await prisma.match.update({ where: { id }, data: updateData })
  revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/schedule`] })
}

export async function deleteMatch(id: string, leagueId: string) {
  await assertAdmin()
  await prisma.match.delete({ where: { id } })
  revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/schedule`] })
}

// ── Teams ────────────────────────────────────────────────────────────────────

export async function enrollTeam(leagueId: string, teamId: string) {
  await assertAdmin()
  await prisma.leagueTeam.create({ data: { leagueId, teamId } })
  revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/teams`] })
}

export async function removeTeamFromLeague(leagueTeamId: string, leagueId: string) {
  await assertAdmin()
  const completedMatches = await prisma.match.count({
    where: {
      status: 'COMPLETED',
      OR: [{ homeTeamId: leagueTeamId }, { awayTeamId: leagueTeamId }],
    },
  })
  if (completedMatches > 0) throw new Error('Cannot remove team with completed matches')
  await prisma.leagueTeam.delete({ where: { id: leagueTeamId } })
  revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/teams`] })
}

// ── Players ──────────────────────────────────────────────────────────────────

export async function assignPlayer(playerId: string, leagueTeamId: string, fromGameWeek: number) {
  await assertAdmin()
  // v1.34.0 (PR ζ) — admin-driven assignment carries `joinSource: ADMIN`.
  await prisma.playerLeagueMembership.create({
    data: { playerId, leagueTeamId, fromGameWeek, joinSource: 'ADMIN' },
  })
  const lt = await prisma.leagueTeam.findUnique({ where: { id: leagueTeamId }, select: { leagueId: true } })
  if (lt) {
    revalidate({ domain: 'admin', paths: [`/admin/leagues/${lt.leagueId}/players`] })
  }
}

export async function transferPlayer(
  playerId: string,
  fromLeagueTeamId: string,
  toLeagueTeamId: string,
  fromGameWeek: number,
  leagueId: string,
) {
  await assertAdmin()
  await prisma.$transaction(async (tx) => {
    await tx.playerLeagueMembership.updateMany({
      where: { playerId, leagueTeamId: fromLeagueTeamId, toGameWeek: null },
      data: { toGameWeek: fromGameWeek - 1 },
    })
    await tx.playerLeagueMembership.create({
      data: { playerId, leagueTeamId: toLeagueTeamId, fromGameWeek },
    })
  })
  revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/players`] })
}

export async function removePlayerFromLeague(playerId: string, leagueId: string) {
  await assertAdmin()
  const leagueTeamIds = (
    await prisma.leagueTeam.findMany({ where: { leagueId }, select: { id: true } })
  ).map((lt) => lt.id)
  await prisma.playerLeagueMembership.deleteMany({
    where: { playerId, leagueTeamId: { in: leagueTeamIds } },
  })
  revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/players`] })
}

/**
 * Flow B (PR 6): admin links an orphan LINE login to a Player record.
 *
 * Atomic: clear `lineId` from any other Player that currently holds it (the
 * @unique constraint would otherwise block the write), then set on the
 * target. updateMany rather than findFirst+update keeps the no-prior-holder
 * case as a no-op instead of throwing.
 *
 * The lineId belonging to a different Player should be vanishingly rare
 * (LINE IDs are stable per user), but this guards against the case where
 * the operator is moving a LINE link from one Player record to another
 * after a roster correction.
 */
export async function adminLinkLineToPlayer(input: {
  playerId: string
  lineId: string
  leagueId: string
}) {
  await assertAdmin()
  const { playerId, lineId, leagueId } = input
  if (!playerId || !lineId) throw new Error('playerId and lineId are required')

  // v1.10.0 / PR B — read the TARGET player's prior lineId so we can
  // clean up its Redis mapping after the remap. Without this, if admin
  // remaps lineId X from player A to player B (where B already had
  // lineId Y), Y would remain in Redis pointing at B. Y becomes orphan
  // but the Redis entry doesn't decay until the 24h sliding TTL.
  const targetBefore = await prisma.player.findUnique({
    where: { id: playerId },
    select: { lineId: true },
  })
  const targetPriorLineId = targetBefore?.lineId ?? null

  // v1.29.0 (stage β) — single transaction covers the legacy Player.lineId
  // mutation AND the new User.playerId / Player.userId dual-write. Atomic:
  // either both land or neither.
  await prisma.$transaction(async (tx) => {
    await tx.player.updateMany({
      where: { lineId, id: { not: playerId } },
      data: { lineId: null },
    })
    await tx.player.update({
      where: { id: playerId },
      data: { lineId },
    })
    // Populate User.playerId / Player.userId for the new binding. No-op
    // (with warning) if no User exists for this lineId yet — admin
    // pre-staging via Flow B before the user has authenticated post-α.5.
    await linkPlayerToUser(tx, { playerId, lineId })
    // If the admin remap just clobbered a different lineId from the
    // target player, that prior lineId is now orphan from this player's
    // perspective. Clear its User-side back-pointer too so the User row
    // doesn't stale-claim a Player it's no longer bound to.
    if (targetPriorLineId && targetPriorLineId !== lineId) {
      await unlinkPlayerFromUser(tx, { lineId: targetPriorLineId })
    }
  })

  // Pre-warm the JWT-callback mapping cache (PR 9) with the post-write
  // relation-include shape, so the next /api/auth/session for this lineId
  // hits cache rather than the cold Prisma findUnique. v1.26.0 — pass the
  // leagueId to both the Prisma resolver (so the right per-league
  // assignment is picked) AND the cache write (per-league key).
  const fresh = await getPlayerMappingFromDb(lineId, leagueId)
  deferSetMapping('admin-link', lineId, leagueId, fresh)

  // If we just clobbered a prior lineId on the target player, also clear
  // its Redis mapping — that LINE user is now an orphan from this player's
  // perspective and a stale Redis hit would resolve them to the wrong
  // player on their next session refresh. v1.26.0 — clear across ALL
  // leagues the prior lineId might be cached in (admin remap is a
  // global change to the lineId-to-Player binding, not specific to this
  // league).
  if (targetPriorLineId && targetPriorLineId !== lineId) {
    await deleteMapping(targetPriorLineId)
  }

  revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/players`] })
}

/**
 * v1.10.0 / PR B — admin clears the LINE link from a Player record.
 *
 * Inverse of `adminLinkLineToPlayer`: sets `Player.lineId = null` and
 * invalidates the Redis mapping for the cleared lineId so the LINE user
 * is treated as orphan on their next JWT callback (and surfaces in the
 * `getOrphanLineLogins()` list, which is the dropdown the admin uses to
 * re-link them somewhere else).
 *
 * No-op if the player has no lineId (returns silently rather than
 * throwing — admin clicking "Unlink" twice should be safe).
 */
export async function adminClearLineLink(input: {
  playerId: string
  leagueId: string
}) {
  await assertAdmin()
  const { playerId, leagueId } = input
  if (!playerId) throw new Error('playerId is required')

  const before = await prisma.player.findUnique({
    where: { id: playerId },
    select: { lineId: true },
  })
  if (!before?.lineId) return // already unlinked

  // v1.29.0 (stage β) — single transaction clears legacy Player.lineId
  // AND the new User.playerId / Player.userId pointer.
  await prisma.$transaction(async (tx) => {
    await tx.player.update({
      where: { id: playerId },
      data: { lineId: null },
    })
    if (before.lineId) {
      await unlinkPlayerFromUser(tx, { lineId: before.lineId })
    }
  })

  // Invalidate the Redis mapping rather than `setMapping(lineId, leagueId, null)` —
  // the v1.5.0 store treats `null` as a sentinel for "known orphan" but
  // `deleteMapping` is the cleaner reset (next read returns miss → Prisma
  // fallthrough → write back per the v1.26.0 policy, identical observable
  // behavior). v1.26.0 — pass the explicit leagueId so we only invalidate
  // THIS league's per-key entry; the user remains linked in any other
  // leagues they have assignments in.
  await deleteMapping(before.lineId, leagueId)

  revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/players`] })
}

/**
 * v1.20.0 — admin renames a Player record from the league Players tab.
 *
 * Trims, requires non-empty, caps at 100 chars (no DB-level limit on
 * `Player.name` — String column — but a sane client/server cap prevents
 * the field from being abused as a free-form text dump). Admin-only via
 * `assertAdmin`. Cache invalidation via `revalidate({ domain: 'admin' })`
 * which busts both `public-data` + `leagues` tags AND the per-league
 * admin path — the player name is reachable from `dbToPublicLeagueData`,
 * so the public dashboard re-derives on next render.
 */
export async function adminUpdatePlayerName(input: {
  playerId: string
  leagueId: string
  name: string
}): Promise<void> {
  await assertAdmin()
  const { playerId, leagueId } = input
  if (!playerId) throw new Error('playerId is required')

  const trimmed = input.name?.trim() ?? ''
  if (!trimmed) throw new Error('Player name is required')
  if (trimmed.length > 100) throw new Error('Player name must be 100 characters or fewer')

  await prisma.$transaction(async (tx) => {
    await tx.player.update({
      where: { id: playerId },
      data: { name: trimmed },
    })
    // v1.72.0 — sync User.name = Player.name for the linked User, if any.
    await tx.user.updateMany({
      where: { playerId },
      data: { name: trimmed },
    })
  })

  revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/players`] })
}

/**
 * v1.41.0 — admin sets / clears `Player.position` directly from the
 * Players-tab edit panel.
 *
 * Pre-v1.41.0 the only paths that wrote `Player.position` were:
 *   - `adminCreatePlayer` (PR ε) on initial admin pre-stage
 *   - `submitOnboarding` (PR ζ) when the user fills the onboarding form
 *
 * The admin had no surface to fix a mistyped position or fill in a slot
 * the user left blank — they had to flip onboardingStatus back via PR θ
 * and ask the user to redo the form. This action closes that gap.
 *
 * Accepts the four enum literals (GK / DF / MF / FW) or null to clear.
 * Unknown strings are coerced to null defensively (mirrors PR ε's
 * behavior in `adminCreatePlayer`). The Prisma column is
 * `PlayerPosition?` so null is a first-class value.
 */
export async function adminUpdatePlayerPosition(input: {
  playerId: string
  leagueId: string
  position: 'GK' | 'DF' | 'MF' | 'FW' | null
}): Promise<void> {
  await assertAdmin()
  const { playerId, leagueId } = input
  if (!playerId) throw new Error('playerId is required')

  const allowed = new Set(['GK', 'DF', 'MF', 'FW'])
  const next = input.position && allowed.has(input.position) ? input.position : null

  // v1.65.4 — position now lives on PlayerLeagueMembership, not on
  // Player. Update every PLM for this player in this league (typically
  // one — the active assignment; players rarely have multiple PLMs in
  // the same league at once).
  await prisma.playerLeagueMembership.updateMany({
    where: { playerId, leagueId },
    data: { position: next },
  })

  revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/players`] })
}

// ── Onboarding reset (PR θ / v1.36.0) ───────────────────────────────────────

/**
 * v1.36.0 (PR θ of the onboarding chain) — admin flips a player's
 * onboarding state back to NOT_YET so the user is redirected through
 * the onboarding flow on their next visit.
 *
 * Preserves all existing data:
 *   - Player.name / position / onboardingPreferences are NOT cleared.
 *     User.idFrontUrl / idBackUrl / idUploadedAt (post-v1.70.0) are
 *     also NOT cleared. The user re-enters the form pre-filled with
 *     whatever they previously submitted (PR ζ's onboarding form
 *     already handles that idempotent case via the page-level fetch).
 *   - Player.userId / lineId are NOT cleared. The User remains bound;
 *     the only change is the assignment-level NOT_YET flag, which
 *     redirects them through `/join/[code]/onboarding` next time they
 *     visit the redemption URL. (Admin needs to share the URL with
 *     them — the welcome page already surfaces the league admin
 *     contact email per ζ.)
 *
 * Per the brainstorm brief §4 of the onboarding flow design: admin
 * notifies the user verbally that they need to redo onboarding. There
 * is no automatic notification.
 *
 * Why league-scoped (not global):
 *   - `onboardingStatus` lives on `PlayerLeagueMembership`, not on
 *     `Player`. A user can be in N leagues and the reset is per-league
 *     (the brainstorm called this out — different leagues have
 *     different onboarding requirements, e.g. ID retention).
 *   - The league context is needed for the cache-bust path anyway.
 *
 * No-op (no error) when the assignment is already NOT_YET — admins
 * clicking the button twice doesn't error out.
 */
export async function adminResetOnboarding(input: {
  playerId: string
  leagueId: string
}): Promise<void> {
  await assertAdmin()
  if (!input.playerId) throw new Error('playerId is required')
  if (!input.leagueId) throw new Error('leagueId is required')

  // Verify the player has an assignment in this league. Without this
  // check, a leagueId mismatch would silently update zero rows.
  const assignment = await prisma.playerLeagueMembership.findFirst({
    where: {
      playerId: input.playerId,
      leagueTeam: { leagueId: input.leagueId },
    },
    select: { id: true, onboardingStatus: true },
  })
  if (!assignment) {
    throw new Error('Player has no assignment in this league')
  }
  if (assignment.onboardingStatus === 'NOT_YET') {
    return // already reset; idempotent no-op
  }

  await prisma.playerLeagueMembership.update({
    where: { id: assignment.id },
    data: { onboardingStatus: 'NOT_YET' },
  })

  revalidate({ domain: 'admin', paths: [`/admin/leagues/${input.leagueId}/players`] })
}

// ── Player ID upload management (PR η / v1.35.0) ────────────────────────────

/**
 * v1.35.0 (PR η) — admin purges a player's uploaded ID. DELs both
 * Vercel Blob assets if `BLOB_READ_WRITE_TOKEN` is set, then nulls all
 * three Player columns regardless. The Blob delete is best-effort
 * (logged on failure) — what matters is that the columns clear so the
 * UI no longer surfaces stale URLs and the next onboarding round-trip
 * (after admin uses the θ "Reset onboarding" action) can re-upload.
 *
 * No-op when the player has no ID uploaded (idempotent).
 */
export async function adminPurgePlayerId(input: {
  playerId: string
  leagueId: string
}): Promise<void> {
  await assertAdmin()
  if (!input.playerId) throw new Error('playerId is required')

  // v1.70.0 — ID images live on User now (per-person identity proof).
  // Resolve the linked User via Player.userId; reject if the player has
  // no User binding (no ID could exist).
  const player = await prisma.player.findUnique({
    where: { id: input.playerId },
    select: { id: true, userId: true },
  })
  if (!player) throw new Error('Player not found')
  if (!player.userId) {
    return // unlinked Player; no User row holds an ID for this slot.
  }

  const user = await prisma.user.findUnique({
    where: { id: player.userId },
    select: { id: true, idFrontUrl: true, idBackUrl: true },
  })
  if (!user) return // shouldn't happen with a valid userId; defensive.
  if (!user.idFrontUrl && !user.idBackUrl) {
    return // already purged / never uploaded
  }

  // Best-effort Blob deletion. Token absent → skip (admin still wants
  // the columns nulled so the UI doesn't dangle stale URLs).
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const { del } = await import('@vercel/blob')
      const urls = [user.idFrontUrl, user.idBackUrl].filter(
        (u): u is string => !!u,
      )
      if (urls.length > 0) await del(urls)
    } catch (err) {
      console.warn('[adminPurgePlayerId] Blob del failed: %o', err)
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      idFrontUrl: null,
      idBackUrl: null,
      idUploadedAt: null,
    },
  })

  revalidate({ domain: 'admin', paths: [`/admin/leagues/${input.leagueId}/players`] })
}

// ── Application/recruiting workflow (v1.64.0) ───────────────────────────────

/**
 * v1.64.0 — Approve a pending application Player.
 *
 * Atomically:
 *   1. Verifies the Player exists with `applicationStatus = PENDING`.
 *   2. Verifies the supplied `leagueTeamId` belongs to the supplied
 *      `leagueId` (cross-league isolation).
 *   3. Flips `applicationStatus` to APPROVED, clears `applicationLeagueId`.
 *   4. Creates a new `PlayerLeagueMembership` with the chosen team,
 *      `joinSource: 'SELF_SERVE'` (the user applied themselves),
 *      `onboardingStatus: 'COMPLETED'` (no separate redemption step
 *      since the user provided name + position during application).
 *   5. Busts admin + public caches.
 *
 * Idempotency: throws if the player is already APPROVED rather than
 * silently no-op'ing — admin shouldn't be able to "double-approve" by
 * accident; the row should be gone from the pending list after the
 * first click.
 */
export async function adminApproveApplication(input: {
  playerId: string
  leagueId: string
  leagueTeamId: string
  fromGameWeek?: number
}): Promise<void> {
  await assertAdmin()
  if (!input.playerId) throw new Error('playerId is required')
  if (!input.leagueId) throw new Error('leagueId is required')
  if (!input.leagueTeamId) throw new Error('leagueTeamId is required')

  // v1.65.4 — Player.applicationStatus + Player.applicationLeagueId are
  // dropped. The PENDING signal lives only on PlayerLeagueMembership.
  // v1.65.1's legacy-v1.64.0 fallback branch is gone; pending applications
  // are exclusively PLM rows from v1.65.4 onward.
  const player = await prisma.player.findUnique({
    where: { id: input.playerId },
    select: { id: true },
  })
  if (!player) throw new Error('Player not found')

  const pendingPlm = await prisma.playerLeagueMembership.findFirst({
    where: {
      playerId: input.playerId,
      leagueId: input.leagueId,
      applicationStatus: 'PENDING',
    },
    select: { id: true },
  })
  if (!pendingPlm) {
    throw new Error('Player is not a pending application')
  }

  const leagueTeam = await prisma.leagueTeam.findUnique({
    where: { id: input.leagueTeamId },
    select: { id: true, leagueId: true },
  })
  if (!leagueTeam) throw new Error('Team not found')
  if (leagueTeam.leagueId !== input.leagueId) {
    throw new Error('Team does not belong to this league')
  }

  const fromGameWeek = input.fromGameWeek && input.fromGameWeek > 0 ? input.fromGameWeek : 1

  // Flip the existing PENDING PLM to APPROVED + assign team in one update.
  await prisma.playerLeagueMembership.update({
    where: { id: pendingPlm.id },
    data: {
      leagueTeamId: input.leagueTeamId,
      applicationStatus: 'APPROVED',
      fromGameWeek,
      onboardingStatus: 'COMPLETED',
    },
  })

  revalidate({ domain: 'admin', paths: [`/admin/leagues/${input.leagueId}/players`] })
  revalidate({ domain: 'public' })
}

/**
 * v1.64.0 / v1.65.1 — Reject a pending application.
 *
 * v1.64.0 behavior: delete the Player entirely (since the data was supplied
 * by an unverified user with no other footprint).
 *
 * v1.65.1 update — multi-league applicants exist now (State D). The reject
 * action MUST NOT delete the Player if they have ANY APPROVED PLM in another
 * league (otherwise rejecting Stefan's Shinjuku application would also kill
 * his T9L membership). Three branches:
 *
 *   1. v1.65.1 State D (PLM(PENDING) for this league + APPROVED PLM elsewhere):
 *      delete only the PLM(PENDING). Player + other-league PLMs survive.
 *   2. v1.65.1 State C (PLM(PENDING) for this league + Player.applicationStatus=PENDING
 *      AND no APPROVED PLM anywhere): delete the PLM AND the Player (legacy
 *      v1.64.0 behavior — fresh applicant with no other footprint).
 *   3. v1.64.0 legacy PENDING applicant (no PLM yet, just Player.applicationStatus=PENDING
 *      and applicationLeagueId=this leagueId): delete the Player (matches v1.64.0).
 *
 * In all three branches, `User.playerId` is cleared if the Player is being
 * deleted (v1.27.0 dual-write invariant).
 */
export async function adminRejectApplication(input: {
  playerId: string
  leagueId: string
}): Promise<void> {
  await assertAdmin()
  if (!input.playerId) throw new Error('playerId is required')
  if (!input.leagueId) throw new Error('leagueId is required')

  // v1.65.4 — Player.applicationStatus + Player.applicationLeagueId are
  // dropped. PENDING signal lives only on PLM. Two reject branches:
  //   (1) approvedElsewhere truthy → delete only the PLM (State D).
  //   (2) approvedElsewhere null → delete the Player (fresh applicant).
  const player = await prisma.player.findUnique({
    where: { id: input.playerId },
    select: { id: true, userId: true },
  })
  if (!player) throw new Error('Player not found')

  const pendingPlm = await prisma.playerLeagueMembership.findFirst({
    where: {
      playerId: input.playerId,
      leagueId: input.leagueId,
      applicationStatus: 'PENDING',
    },
    select: { id: true },
  })
  if (!pendingPlm) {
    throw new Error('Player is not a pending application for this league')
  }

  // Check for ANY APPROVED PLM elsewhere — preserves the Player record
  // for State D applicants whose Player exists across multiple leagues.
  const approvedElsewhere = await prisma.playerLeagueMembership.findFirst({
    where: {
      playerId: input.playerId,
      applicationStatus: 'APPROVED',
    },
    select: { id: true },
  })

  await prisma.$transaction(async (tx) => {
    await tx.playerLeagueMembership.delete({ where: { id: pendingPlm.id } })

    if (approvedElsewhere) {
      // State D — Player survives along with their other-league PLMs.
      return
    }

    // No other-league APPROVED PLM — Player is a fresh applicant. Delete
    // them entirely (clears User.playerId first to avoid dangling FK).
    if (player.userId) {
      await tx.user.update({
        where: { id: player.userId },
        data: { playerId: null },
      })
    }
    await tx.player.delete({ where: { id: input.playerId } })
  })

  revalidate({ domain: 'admin', paths: [`/admin/leagues/${input.leagueId}/players`] })
  revalidate({ domain: 'public' })
}

// ── Invite generation (PR ε / v1.33.0) ──────────────────────────────────────

const VALID_POSITIONS: readonly PlayerPosition[] = ['GK', 'DF', 'MF', 'FW']

function normalizePosition(input: string | null | undefined): PlayerPosition | null {
  if (!input) return null
  const upper = input.trim().toUpperCase()
  return (VALID_POSITIONS as readonly string[]).includes(upper)
    ? (upper as PlayerPosition)
    : null
}

/**
 * v1.33.0 (PR ε) — admin pre-stages a Player row inside a league. All three
 * profile fields (name / position / leagueTeamId) are OPTIONAL so an admin
 * can hold a roster slot before knowing who's filling it. The user
 * eventually fills name/position via the upcoming `/join/[code]` onboarding
 * flow (PR ζ); team assignment can be added later via the existing
 * Transfer panel.
 *
 * Returns the created `Player.id` so the caller (Add Player dialog) can
 * immediately offer a "Generate invite" follow-up without re-fetching.
 *
 * `fromGameWeek` defaults to 1 when an assignment is created without one
 * (the most common case — admin pre-stages the slot at the start of the
 * season). Subsequent transfers create new `PlayerLeagueMembership` rows
 * with the right `fromGameWeek`.
 *
 * Cache invalidation: `revalidate({ domain: 'admin' })` busts the public
 * `LeagueData` blob too (Player records flow into `dbToPublicLeagueData`),
 * so the public Squad list reflects the new row on the next render. The
 * v1.33.0 adapter coerces null name → "TBD" so a nameless pre-staged
 * Player doesn't crash any public component.
 */
export async function adminCreatePlayer(input: {
  leagueId: string
  name?: string | null
  position?: string | null
  leagueTeamId?: string | null
  fromGameWeek?: number | null
}): Promise<{ id: string }> {
  await assertAdmin()
  const { leagueId } = input
  if (!leagueId) throw new Error('leagueId is required')

  const trimmedName = input.name?.trim() ?? ''
  const name = trimmedName === '' ? null : trimmedName
  if (name && name.length > 100) {
    throw new Error('Player name must be 100 characters or fewer')
  }
  const position = normalizePosition(input.position)
  const leagueTeamId = input.leagueTeamId?.trim() || null
  const fromGameWeek = input.fromGameWeek && input.fromGameWeek > 0
    ? Math.floor(input.fromGameWeek)
    : 1

  // If an assignment is requested, the leagueTeam must belong to this league
  // (else admin in League A could pre-stage a player on a team in League B).
  if (leagueTeamId) {
    const lt = await prisma.leagueTeam.findUnique({
      where: { id: leagueTeamId },
      select: { leagueId: true },
    })
    if (!lt || lt.leagueId !== leagueId) {
      throw new Error('leagueTeamId does not belong to this league')
    }
  }

  // v1.65.4 — position lives on PlayerLeagueMembership, not Player.
  // Player.create payload is identity-only (name + lineId/userId/profile
  // picture). Position is set on the PLM row when an assignment exists.
  const created = await prisma.$transaction(async (tx) => {
    const player = await tx.player.create({
      data: {
        name,
      },
    })
    if (leagueTeamId) {
      await tx.playerLeagueMembership.create({
        // v1.34.0 (PR ζ) — tag admin-created assignments with `joinSource: ADMIN`
        // so audit / abuse-mitigation queries can distinguish them from
        // CODE / PERSONAL / SELF_SERVE rows.
        data: {
          playerId: player.id,
          leagueTeamId,
          leagueId,
          fromGameWeek,
          joinSource: 'ADMIN',
          position,
        },
      })
    }
    return player
  })

  revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/players`] })
  return { id: created.id }
}

/**
 * v1.57.0 (PR 4 of route-shortening chain) — admin unbinds a User from
 * its linked Player. Clears `User.playerId` AND mirrors the clear on
 * `Player.userId` (the v1.27.0 dual-write invariant). Idempotent —
 * safe to call on an already-unlinked User.
 *
 * Use case: surface on the new `/admin/users` list. Lets ops detach
 * a duplicate User row (e.g. someone signed in with both LINE and
 * Google and wants to consolidate to one auth path) without the
 * destructive delete-User-row flow.
 *
 * Does NOT delete the User or the Player — both remain. The Player
 * stays available for re-linking via the existing PlayersTab Remap /
 * AssignLine flows. The User survives so its Account rows + audit
 * trail (e.g. createdById on MatchEvent) stay intact.
 *
 * The legacy `Player.lineId` mirror is left as-is — that's the
 * pre-v1.27.0 store and stage 4 (Δ) drops it. Touching it from this
 * action would couple PR 4 to identity-rework stage 4 timing.
 */
export async function adminUnlinkUserFromPlayer(input: {
  userId: string
}): Promise<void> {
  await assertAdmin()
  const { userId } = input
  if (!userId) throw new Error('userId is required')

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, playerId: true, authAccountName: true },
    })
    if (!user) throw new Error('User not found')
    if (user.playerId === null) {
      // Already unlinked — no-op. Idempotent contract.
      return
    }
    // v1.72.0 — restore User.name = authAccountName on unlink.
    await tx.user.update({
      where: { id: userId },
      data: {
        playerId: null,
        name: user.authAccountName ?? null,
      },
    })
    await tx.player.updateMany({
      where: { userId },
      data: { userId: null },
    })
  })

  revalidate({ domain: 'admin', paths: ['/admin/users'] })
}

/**
 * v1.56.0 (PR 3 of route-shortening chain) — admin attaches an existing
 * global Player to this league's roster.
 *
 * Use case: a user already has a Player record (e.g. they joined T9L's
 * default league via PR ζ invite redemption — so `Player.userId` is set,
 * `LineLogin` exists, profile picture mirrored, etc.). A new league
 * spinning up wants the same human on its roster, but with a different
 * team / start week. Pre-v1.56.0 the only path was `adminCreatePlayer`,
 * which always creates a NEW global Player record — leading to duplicate
 * Players-per-human across leagues.
 *
 * Distinct from `transferPlayer` (which moves a player from team A to
 * team B WITHIN a single league) and `adminCreatePlayer` (which creates
 * a fresh Player). This action takes an existing Player and creates ONE
 * new `PlayerLeagueMembership` row pointing into the supplied league.
 *
 * Validation:
 *   - Player must exist
 *   - leagueTeam must belong to leagueId (cross-league isolation)
 *   - Player must NOT already have an active assignment in this league
 *     (no double-roster — a player can only be on one team per league at
 *     a time; admins use `transferPlayer` to move between teams)
 *   - fromGameWeek defaults to 1 if not supplied or invalid
 *
 * The created assignment is tagged `joinSource: 'ADMIN'` (same as
 * `adminCreatePlayer`'s pre-stage flow — both are admin-driven roster
 * adds; the `joinSource` audit doesn't distinguish between "create new
 * Player" vs "link existing Player" because the Player itself isn't
 * being modified).
 */
export async function adminLinkExistingPlayer(input: {
  leagueId: string
  playerId: string
  leagueTeamId: string
  fromGameWeek?: number | null
}): Promise<{ assignmentId: string }> {
  await assertAdmin()
  const { leagueId, playerId, leagueTeamId } = input
  if (!leagueId) throw new Error('leagueId is required')
  if (!playerId) throw new Error('playerId is required')
  if (!leagueTeamId) throw new Error('leagueTeamId is required')

  const fromGameWeek = input.fromGameWeek && input.fromGameWeek > 0
    ? Math.floor(input.fromGameWeek)
    : 1

  // Player exists?
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { id: true },
  })
  if (!player) throw new Error('Player not found')

  // leagueTeam belongs to this league? (cross-league isolation —
  // mirrors `adminCreatePlayer` and the match-event actions)
  const lt = await prisma.leagueTeam.findUnique({
    where: { id: leagueTeamId },
    select: { leagueId: true },
  })
  if (!lt || lt.leagueId !== leagueId) {
    throw new Error('leagueTeamId does not belong to this league')
  }

  // Already on this league's roster? Block double-roster — admin should
  // use `transferPlayer` to move between teams within the same league.
  const existingAssignment = await prisma.playerLeagueMembership.findFirst({
    where: {
      playerId,
      leagueTeam: { leagueId },
      toGameWeek: null, // active (open-ended) assignment
    },
    select: { id: true },
  })
  if (existingAssignment) {
    throw new Error('Player is already on this league\'s roster (use Transfer to change teams)')
  }

  const created = await prisma.playerLeagueMembership.create({
    data: { playerId, leagueTeamId, fromGameWeek, joinSource: 'ADMIN' },
    select: { id: true },
  })

  revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/players`] })
  return { assignmentId: created.id }
}

/**
 * v1.56.0 — bulk variant of `adminLinkExistingPlayer`. Takes a list of
 * `{ playerId, leagueTeamId }` items (one per row of the bulk dialog)
 * and runs them sequentially. Returns per-row results so the caller
 * can surface partial-failure feedback.
 *
 * Sequential rather than parallel because Prisma transactions on a
 * pooled connection don't always parallelize cleanly under typical
 * Vercel serverless conditions, and the bulk size is bounded (~10s of
 * players per batch). Each row's create is independent — a failure on
 * row 5 doesn't affect rows 1-4 or row 6.
 */
export async function adminLinkExistingPlayersBulk(input: {
  leagueId: string
  items: Array<{ playerId: string; leagueTeamId: string }>
  fromGameWeek?: number | null
}): Promise<{
  results: Array<{ playerId: string; ok: true; assignmentId: string } | { playerId: string; ok: false; error: string }>
}> {
  await assertAdmin()
  const { leagueId, items } = input
  if (!leagueId) throw new Error('leagueId is required')
  if (items.length === 0) return { results: [] }
  if (items.length > 100) throw new Error('Cap of 100 items per bulk-link batch')

  const fromGameWeek = input.fromGameWeek ?? 1

  const results: Array<
    { playerId: string; ok: true; assignmentId: string } | { playerId: string; ok: false; error: string }
  > = []
  for (const item of items) {
    try {
      const { assignmentId } = await adminLinkExistingPlayer({
        leagueId,
        playerId: item.playerId,
        leagueTeamId: item.leagueTeamId,
        fromGameWeek,
      })
      results.push({ playerId: item.playerId, ok: true, assignmentId })
    } catch (err) {
      results.push({
        playerId: item.playerId,
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to link',
      })
    }
  }

  // adminLinkExistingPlayer revalidates per-call; one final bust ensures
  // the players page reflects the full batch state on next render.
  revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/players`] })
  return { results }
}

/**
 * v1.33.0 (PR ε) — admin generates a single PERSONAL invite for a target
 * Player. Returns the canonical row + the absolute redemption URL so the
 * caller can render the copy/QR surface immediately without an extra
 * fetch.
 *
 * Validation:
 *   - `targetPlayerId` must reference an existing Player with NO existing
 *     `lineId` AND no other un-revoked, un-expired PERSONAL invite already
 *     pointing at it. This prevents an admin accidentally double-issuing
 *     codes that race for the same slot. CODE-flavor invites and revoked
 *     / expired invites don't block.
 *   - `expiresAt` defaults to now + 7 days; an explicit `null` means no
 *     expiry (admin opt-out).
 *
 * Code generation retries up to 5 times on `@unique` collision. The
 * 28^12 alphabet makes a real collision vanishingly rare; the retry is
 * defensive against a worst-case insertion under concurrent admin use.
 */
export async function adminGenerateInvite(input: {
  leagueId: string
  targetPlayerId: string
  skipOnboarding?: boolean
  expiresAt?: Date | null // omit = +7 days; null = no expiry
}): Promise<{
  id: string
  code: string
  expiresAt: Date | null
  skipOnboarding: boolean
  joinUrl: string
}> {
  await assertAdmin()
  const { leagueId, targetPlayerId } = input
  if (!leagueId) throw new Error('leagueId is required')
  if (!targetPlayerId) throw new Error('targetPlayerId is required')

  const skipOnboarding = !!input.skipOnboarding
  const expiresAt =
    input.expiresAt === undefined
      ? computeInviteExpiry(new Date(), INVITE_DEFAULT_EXPIRY_DAYS)
      : input.expiresAt

  // Validate target: exists and has no LINE binding (a player already linked
  // doesn't need an invite — admin should re-bind via the existing remap flow).
  const target = await prisma.player.findUnique({
    where: { id: targetPlayerId },
    select: { id: true, lineId: true },
  })
  if (!target) throw new Error('Target player not found')
  if (target.lineId) throw new Error('Target player is already linked to a LINE user')

  // Block a second active PERSONAL invite for the same player. Active =
  // not revoked AND (expiresAt null OR expiresAt > now).
  const now = new Date()
  const existing = await prisma.leagueInvite.findFirst({
    where: {
      leagueId,
      targetPlayerId,
      kind: 'PERSONAL',
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
  })
  if (existing) {
    throw new Error('An active personal invite already exists for this player')
  }

  // Resolve host for the redemption URL. Subdomain-aware so an invite
  // generated from `tamachi.t9l.me/admin/...` produces a tamachi-hosted
  // join link. Falls back to the request Host header when NEXTAUTH_URL
  // is missing the subdomain (e.g. localhost dev where NEXTAUTH_URL is
  // `http://localhost:3000`). PR ζ ships the redemption route; for now
  // the URL is a placeholder destination but the SHAPE is locked.
  const reqHeaders = await headers()
  const host = reqHeaders.get('host') ?? new URL(process.env.NEXTAUTH_URL ?? 'https://t9l.me').host

  // Retry on @unique collision; tiny probability but defensive.
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateInviteCode()
    try {
      const session = await getServerSession(authOptions)
      const createdById = (session as { userId?: string | null } | null)?.userId ?? null
      const created = await prisma.leagueInvite.create({
        data: buildInviteCreateData({
          leagueId,
          targetPlayerId,
          code,
          expiresAt,
          skipOnboarding,
          createdById,
        }),
      })
      revalidate({ domain: 'admin', paths: [`/admin/leagues/${leagueId}/players`] })
      return {
        id: created.id,
        code: created.code,
        expiresAt: created.expiresAt,
        skipOnboarding: created.skipOnboarding,
        joinUrl: buildInviteUrl(host, created.code),
      }
    } catch (err) {
      // Prisma 5 throws PrismaClientKnownRequestError with code P2002 on
      // unique constraint failure. Retry; bubble anything else.
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code?: string }).code === 'P2002'
      ) {
        lastErr = err
        continue
      }
      throw err
    }
  }
  throw new Error(
    `Failed to generate a unique invite code after 5 attempts: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  )
}

/**
 * v1.33.0 (PR ε) — bulk variant. Generates one PERSONAL invite per
 * targetPlayerId and returns a list ready for CSV export. Skips (does
 * not throw on) targets that fail validation — the result includes a
 * per-row `error` field so the caller can render a partial-success UI.
 *
 * Cache invalidation runs ONCE at the end (not per-row) — the admin
 * Players tab re-render shows the new invite badges in a single tick.
 */
export async function adminGenerateInvitesBulk(input: {
  leagueId: string
  targetPlayerIds: string[]
  skipOnboarding?: boolean
  expiresAt?: Date | null
}): Promise<{
  results: Array<{
    playerId: string
    playerName: string | null
    ok: boolean
    code: string | null
    expiresAt: Date | null
    skipOnboarding: boolean
    joinUrl: string | null
    error: string | null
  }>
  csv: string
}> {
  await assertAdmin()
  const { leagueId, targetPlayerIds } = input
  if (!leagueId) throw new Error('leagueId is required')
  if (!Array.isArray(targetPlayerIds) || targetPlayerIds.length === 0) {
    throw new Error('targetPlayerIds must be a non-empty array')
  }
  if (targetPlayerIds.length > 100) {
    throw new Error('Bulk invite generation is capped at 100 targets per call')
  }

  // Resolve player names up front for the result + CSV (the Player rows
  // may have null names — PR ε allows pre-staged anonymous slots).
  const players = await prisma.player.findMany({
    where: { id: { in: targetPlayerIds } },
    select: { id: true, name: true, lineId: true },
  })
  const playerById = new Map(players.map((p) => [p.id, p]))

  const results: Array<{
    playerId: string
    playerName: string | null
    ok: boolean
    code: string | null
    expiresAt: Date | null
    skipOnboarding: boolean
    joinUrl: string | null
    error: string | null
  }> = []

  // Sequential, not parallel — bulk-generate-1000-at-once would slam the
  // DB and amplify any P2002 retry storms. The admin UI gates this at 100
  // anyway; sequential keeps the latency budget bounded and predictable.
  for (const playerId of targetPlayerIds) {
    const target = playerById.get(playerId)
    if (!target) {
      results.push({
        playerId,
        playerName: null,
        ok: false,
        code: null,
        expiresAt: null,
        skipOnboarding: !!input.skipOnboarding,
        joinUrl: null,
        error: 'Player not found',
      })
      continue
    }
    if (target.lineId) {
      results.push({
        playerId,
        playerName: target.name,
        ok: false,
        code: null,
        expiresAt: null,
        skipOnboarding: !!input.skipOnboarding,
        joinUrl: null,
        error: 'Player already linked to LINE',
      })
      continue
    }
    try {
      const invite = await adminGenerateInvite({
        leagueId,
        targetPlayerId: playerId,
        skipOnboarding: input.skipOnboarding,
        expiresAt: input.expiresAt,
      })
      results.push({
        playerId,
        playerName: target.name,
        ok: true,
        code: invite.code,
        expiresAt: invite.expiresAt,
        skipOnboarding: invite.skipOnboarding,
        joinUrl: invite.joinUrl,
        error: null,
      })
    } catch (err) {
      results.push({
        playerId,
        playerName: target.name,
        ok: false,
        code: null,
        expiresAt: null,
        skipOnboarding: !!input.skipOnboarding,
        joinUrl: null,
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  // adminGenerateInvite already revalidated per-call. The bulk wrapper
  // doesn't need an additional bust — but if every row failed validation
  // (no DB writes happened), the per-call revalidate didn't fire either.
  // That's fine: nothing changed, no need to bust.

  const csvRows: InviteCsvRow[] = results
    .filter((r): r is typeof r & { ok: true; code: string; joinUrl: string; expiresAt: Date | null } =>
      r.ok && !!r.code && !!r.joinUrl,
    )
    .map((r) => ({
      playerId: r.playerId,
      playerName: r.playerName ?? '',
      code: r.code,
      joinUrl: r.joinUrl,
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : '',
      skipOnboarding: r.skipOnboarding,
    }))

  // Lazy import keeps `buildInviteCsv` out of this module's surface.
  const { buildInviteCsv } = await import('@/lib/inviteCodes')
  const csv = buildInviteCsv(csvRows)

  return { results, csv }
}

// ── MatchEvent CRUD (PR γ / v1.43.0) ───────────────────────────────────────

const VALID_GOAL_TYPES = new Set<GoalType>([
  'OPEN_PLAY',
  'SET_PIECE',
  'PENALTY',
  'OWN_GOAL',
])

/**
 * v1.43.0 (PR γ) — admin creates a MatchEvent row.
 *
 * Validation gates (server-side, defense in depth — the picker UI is the
 * affordance, not the contract):
 *   1. session is admin
 *   2. matchId belongs to the supplied leagueId (cross-league isolation)
 *   3. goalType is one of the four enum literals
 *   4. scorerId resolves to a Player on the BENEFICIARY team's roster:
 *        - non-OG: scorer must be on the beneficiary team
 *        - OG: scorer must be on the OPPOSING team (since OG benefits the
 *          opposite side and is scored by a player conceding to themselves)
 *   5. assisterId, when supplied, must resolve to a Player on the
 *      beneficiary team's roster, and must not equal scorerId
 *
 * `beneficiaryTeamId` is the LeagueTeam.id that the goal counts toward —
 * passed explicitly so the action doesn't have to re-derive it from the
 * goal type + match teams (the client already knows; pass it through).
 *
 * Wraps the insert + recompute in a Prisma transaction so a recompute
 * failure doesn't leave a phantom event in the cache state.
 */
export async function adminCreateMatchEvent(input: {
  matchId: string
  leagueId: string
  goalType: GoalType
  beneficiaryTeamId: string
  scorerId: string
  assisterId?: string | null
  minute?: number | null
}): Promise<{ id: string }> {
  await assertAdmin()
  const session = await getServerSession(authOptions)
  const userId = session?.userId ?? null

  const { matchId, leagueId, goalType, beneficiaryTeamId, scorerId } = input
  if (!matchId) throw new Error('matchId is required')
  if (!leagueId) throw new Error('leagueId is required')
  if (!scorerId) throw new Error('scorerId is required')
  if (!beneficiaryTeamId) throw new Error('beneficiaryTeamId is required')
  if (!VALID_GOAL_TYPES.has(goalType)) {
    throw new Error(`Invalid goalType: ${goalType}`)
  }
  if (
    input.minute !== undefined &&
    input.minute !== null &&
    (input.minute < 0 || input.minute > 200)
  ) {
    throw new Error('minute out of range')
  }
  const assisterId = input.assisterId ?? null
  if (assisterId && assisterId === scorerId) {
    throw new Error('Assister cannot be the scorer')
  }

  // Cross-league + match-team isolation: confirm the match exists in the
  // league, and that beneficiaryTeamId is one of its teams.
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: { id: true, leagueId: true, homeTeamId: true, awayTeamId: true },
  })
  if (!match || match.leagueId !== leagueId) {
    throw new Error('Match not found in this league')
  }
  if (
    beneficiaryTeamId !== match.homeTeamId &&
    beneficiaryTeamId !== match.awayTeamId
  ) {
    throw new Error('beneficiaryTeamId is not part of this match')
  }
  const opposingTeamId =
    beneficiaryTeamId === match.homeTeamId ? match.awayTeamId : match.homeTeamId

  // Confirm scorer is on the right team for the goalType.
  // - For non-OG: scorer must be on beneficiaryTeamId.
  // - For OG: scorer must be on opposingTeamId.
  const requiredScorerTeamId =
    goalType === 'OWN_GOAL' ? opposingTeamId : beneficiaryTeamId
  const scorerOnTeam = await prisma.playerLeagueMembership.findFirst({
    where: { playerId: scorerId, leagueTeamId: requiredScorerTeamId },
    select: { id: true },
  })
  if (!scorerOnTeam) {
    throw new Error(
      goalType === 'OWN_GOAL'
        ? 'Scorer (own goal) must be on the OPPOSING team'
        : 'Scorer must be on the beneficiary team',
    )
  }

  // Assister, when supplied, must be on the beneficiary team.
  if (assisterId) {
    const assisterOnTeam = await prisma.playerLeagueMembership.findFirst({
      where: { playerId: assisterId, leagueTeamId: beneficiaryTeamId },
      select: { id: true },
    })
    if (!assisterOnTeam) {
      throw new Error('Assister must be on the beneficiary team')
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    const ev = await tx.matchEvent.create({
      data: {
        matchId,
        kind: 'GOAL',
        goalType,
        scorerId,
        assisterId,
        minute: input.minute ?? null,
        createdById: userId,
      },
      select: { id: true },
    })
    await recomputeMatchScore(tx, matchId)
    return ev
  })

  revalidate({
    domain: 'admin',
    paths: [
      `/admin/leagues/${leagueId}/stats`,
      `/admin/leagues/${leagueId}/schedule`,
      `/admin/matches/${matchId}`,
    ],
  })
  return created
}

/**
 * v1.43.0 (PR γ) — admin updates a MatchEvent row.
 *
 * Same validation contract as `adminCreateMatchEvent`. Recomputes the
 * affected match's score. v1 does NOT allow changing `matchId` (admins
 * delete + re-create if they made a wrong-match mistake) — keeps the
 * recompute scoped to a single match.
 */
export async function adminUpdateMatchEvent(input: {
  eventId: string
  leagueId: string
  goalType: GoalType
  beneficiaryTeamId: string
  scorerId: string
  assisterId?: string | null
  minute?: number | null
}): Promise<void> {
  await assertAdmin()
  const { eventId, leagueId, goalType, beneficiaryTeamId, scorerId } = input
  if (!eventId) throw new Error('eventId is required')
  if (!VALID_GOAL_TYPES.has(goalType)) {
    throw new Error(`Invalid goalType: ${goalType}`)
  }
  const assisterId = input.assisterId ?? null
  if (assisterId && assisterId === scorerId) {
    throw new Error('Assister cannot be the scorer')
  }
  if (
    input.minute !== undefined &&
    input.minute !== null &&
    (input.minute < 0 || input.minute > 200)
  ) {
    throw new Error('minute out of range')
  }

  const existing = await prisma.matchEvent.findUnique({
    where: { id: eventId },
    select: { id: true, matchId: true },
  })
  if (!existing) throw new Error('Event not found')

  const match = await prisma.match.findUnique({
    where: { id: existing.matchId },
    select: { id: true, leagueId: true, homeTeamId: true, awayTeamId: true },
  })
  if (!match || match.leagueId !== leagueId) {
    throw new Error('Match not found in this league')
  }
  if (
    beneficiaryTeamId !== match.homeTeamId &&
    beneficiaryTeamId !== match.awayTeamId
  ) {
    throw new Error('beneficiaryTeamId is not part of this match')
  }
  const opposingTeamId =
    beneficiaryTeamId === match.homeTeamId ? match.awayTeamId : match.homeTeamId
  const requiredScorerTeamId =
    goalType === 'OWN_GOAL' ? opposingTeamId : beneficiaryTeamId

  const scorerOnTeam = await prisma.playerLeagueMembership.findFirst({
    where: { playerId: scorerId, leagueTeamId: requiredScorerTeamId },
    select: { id: true },
  })
  if (!scorerOnTeam) {
    throw new Error(
      goalType === 'OWN_GOAL'
        ? 'Scorer (own goal) must be on the OPPOSING team'
        : 'Scorer must be on the beneficiary team',
    )
  }
  if (assisterId) {
    const assisterOnTeam = await prisma.playerLeagueMembership.findFirst({
      where: { playerId: assisterId, leagueTeamId: beneficiaryTeamId },
      select: { id: true },
    })
    if (!assisterOnTeam) {
      throw new Error('Assister must be on the beneficiary team')
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.matchEvent.update({
      where: { id: eventId },
      data: {
        goalType,
        scorerId,
        assisterId,
        minute: input.minute ?? null,
      },
    })
    await recomputeMatchScore(tx, existing.matchId)
  })

  revalidate({
    domain: 'admin',
    paths: [
      `/admin/leagues/${leagueId}/stats`,
      `/admin/leagues/${leagueId}/schedule`,
      `/admin/matches/${existing.matchId}`,
    ],
  })
}

/**
 * v1.43.0 (PR γ) — admin deletes a MatchEvent row.
 */
export async function adminDeleteMatchEvent(input: {
  eventId: string
  leagueId: string
}): Promise<void> {
  await assertAdmin()
  const { eventId, leagueId } = input
  if (!eventId) throw new Error('eventId is required')

  const existing = await prisma.matchEvent.findUnique({
    where: { id: eventId },
    select: { id: true, matchId: true, match: { select: { leagueId: true } } },
  })
  if (!existing) throw new Error('Event not found')
  if (existing.match.leagueId !== leagueId) {
    throw new Error('Event not found in this league')
  }

  await prisma.$transaction(async (tx) => {
    await tx.matchEvent.delete({ where: { id: eventId } })
    await recomputeMatchScore(tx, existing.matchId)
  })

  revalidate({
    domain: 'admin',
    paths: [
      `/admin/leagues/${leagueId}/stats`,
      `/admin/leagues/${leagueId}/schedule`,
      `/admin/matches/${existing.matchId}`,
    ],
  })
}

/**
 * v1.43.0 (PR γ) — admin sets `Match.scoreOverride`. Pass `null` to clear.
 * Does NOT touch the cache columns; `recomputeMatchScore` keeps populating
 * those from events so flipping the override on/off doesn't lose history.
 */
export async function adminSetMatchScoreOverride(input: {
  matchId: string
  leagueId: string
  override: string | null
}): Promise<void> {
  await assertAdmin()
  const { matchId, leagueId } = input
  if (!matchId) throw new Error('matchId is required')

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: { leagueId: true },
  })
  if (!match || match.leagueId !== leagueId) {
    throw new Error('Match not found in this league')
  }
  const next = input.override?.trim() || null

  await prisma.match.update({
    where: { id: matchId },
    data: { scoreOverride: next },
  })

  revalidate({
    domain: 'admin',
    paths: [
      `/admin/leagues/${leagueId}/stats`,
      `/admin/leagues/${leagueId}/schedule`,
      `/admin/matches/${matchId}`,
    ],
  })
}

// ── v1.66.0 — Player payment system ─────────────────────────────────────────

/**
 * v1.66.0 — Update league fee settings: defaultFee + positionFees rows.
 *
 * Admin-only. Replaces the league's positionFees set with the supplied
 * array (delete-and-recreate inside a transaction so the operation is
 * atomic). Empty input.positionFees clears all per-position rows;
 * defaultFee stays.
 *
 * Validation:
 *   - assertAdmin
 *   - league exists
 *   - defaultFee is a non-negative integer
 *   - each positionFee.position is a non-empty trimmed string ≤ 32 chars
 *   - each positionFee.fee is a non-negative integer
 *   - position values are unique within input
 */
export async function updateLeagueFeeSettings(input: {
  leagueId: string
  defaultFee: number
  positionFees: Array<{ position: string; fee: number }>
}): Promise<void> {
  await assertAdmin()
  if (!input.leagueId) throw new Error('leagueId is required')
  if (!Number.isInteger(input.defaultFee) || input.defaultFee < 0) {
    throw new Error('defaultFee must be a non-negative integer')
  }

  // Normalize position rows: trim, drop empties, dedup by position.
  const normalized: { position: string; fee: number }[] = []
  const seen = new Set<string>()
  for (const row of input.positionFees) {
    const position = row.position.trim()
    if (!position) continue
    if (position.length > 32) {
      throw new Error('position must be 32 characters or fewer')
    }
    if (!Number.isInteger(row.fee) || row.fee < 0) {
      throw new Error('fee must be a non-negative integer')
    }
    if (seen.has(position)) {
      throw new Error(`duplicate position: ${position}`)
    }
    seen.add(position)
    normalized.push({ position, fee: row.fee })
  }

  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: { id: true },
  })
  if (!league) throw new Error('League not found')

  await prisma.$transaction(async (tx) => {
    await tx.league.update({
      where: { id: input.leagueId },
      data: { defaultFee: input.defaultFee },
    })
    await tx.leaguePositionFee.deleteMany({ where: { leagueId: input.leagueId } })
    if (normalized.length > 0) {
      await tx.leaguePositionFee.createMany({
        data: normalized.map((p) => ({
          leagueId: input.leagueId,
          position: p.position,
          fee: p.fee,
        })),
      })
    }
  })

  revalidate({
    domain: 'admin',
    paths: [
      `/admin/leagues/${input.leagueId}`,
      `/admin/leagues/${input.leagueId}/players`,
    ],
  })
  revalidate({ domain: 'public' })
}

/**
 * v1.66.0 — Toggle paid status on a single PlayerLeagueMembership.
 *
 * Sets paidAt to now() when flipping to PAID; nulls it when flipping
 * to UNPAID. Admin-only. IDOR-validated: the membership must belong to
 * the supplied league.
 */
export async function updateMembershipPaidStatus(input: {
  membershipId: string
  leagueId: string
  status: 'PAID' | 'UNPAID'
}): Promise<void> {
  await assertAdmin()
  if (!input.membershipId) throw new Error('membershipId is required')
  if (!input.leagueId) throw new Error('leagueId is required')
  if (input.status !== 'PAID' && input.status !== 'UNPAID') {
    throw new Error('status must be PAID or UNPAID')
  }

  // IDOR — verify membership belongs to this league via direct leagueId
  // (v1.65.0) OR via leagueTeam.leagueId (legacy backfilled rows).
  const plm = await prisma.playerLeagueMembership.findUnique({
    where: { id: input.membershipId },
    select: {
      leagueId: true,
      leagueTeam: { select: { leagueId: true } },
    },
  })
  if (!plm) throw new Error('Membership not found')
  const plmLeagueId = plm.leagueId ?? plm.leagueTeam?.leagueId ?? null
  if (plmLeagueId !== input.leagueId) {
    throw new Error('Membership does not belong to this league')
  }

  await prisma.playerLeagueMembership.update({
    where: { id: input.membershipId },
    data: {
      paidStatus: input.status,
      paidAt: input.status === 'PAID' ? new Date() : null,
    },
  })

  revalidate({
    domain: 'admin',
    paths: [`/admin/leagues/${input.leagueId}/players`],
  })
  revalidate({ domain: 'public' })
}

/**
 * v1.66.0 — Bulk-update paid status across multiple memberships.
 *
 * Same semantics as `updateMembershipPaidStatus` — paidAt = now() on
 * PAID, null on UNPAID. Capped at 200 memberships per call to bound
 * the transaction. IDOR-validated per-row: every supplied
 * membershipId must belong to the supplied league.
 */
export async function bulkUpdatePaidStatus(input: {
  membershipIds: string[]
  leagueId: string
  status: 'PAID' | 'UNPAID'
}): Promise<void> {
  await assertAdmin()
  if (!input.leagueId) throw new Error('leagueId is required')
  if (input.status !== 'PAID' && input.status !== 'UNPAID') {
    throw new Error('status must be PAID or UNPAID')
  }
  if (input.membershipIds.length === 0) return
  if (input.membershipIds.length > 200) {
    throw new Error('Cannot update more than 200 memberships at once')
  }

  // IDOR — all supplied memberships must belong to this league.
  const memberships = await prisma.playerLeagueMembership.findMany({
    where: { id: { in: input.membershipIds } },
    select: {
      id: true,
      leagueId: true,
      leagueTeam: { select: { leagueId: true } },
    },
  })
  if (memberships.length !== input.membershipIds.length) {
    throw new Error('One or more memberships not found')
  }
  for (const m of memberships) {
    const plmLeagueId = m.leagueId ?? m.leagueTeam?.leagueId ?? null
    if (plmLeagueId !== input.leagueId) {
      throw new Error('One or more memberships do not belong to this league')
    }
  }

  await prisma.playerLeagueMembership.updateMany({
    where: { id: { in: input.membershipIds } },
    data: {
      paidStatus: input.status,
      paidAt: input.status === 'PAID' ? new Date() : null,
    },
  })

  revalidate({
    domain: 'admin',
    paths: [`/admin/leagues/${input.leagueId}/players`],
  })
  revalidate({ domain: 'public' })
}

/**
 * v1.66.0 — Set or clear a per-membership fee override.
 *
 * `feeOverride: null` clears the override (membership falls back to
 * resolved fee from position/default). `feeOverride: number` must be
 * a non-negative integer.
 */
export async function updateMembershipFeeOverride(input: {
  membershipId: string
  leagueId: string
  feeOverride: number | null
}): Promise<void> {
  await assertAdmin()
  if (!input.membershipId) throw new Error('membershipId is required')
  if (!input.leagueId) throw new Error('leagueId is required')
  if (input.feeOverride !== null) {
    if (!Number.isInteger(input.feeOverride) || input.feeOverride < 0) {
      throw new Error('feeOverride must be a non-negative integer or null')
    }
  }

  // IDOR — verify membership belongs to this league.
  const plm = await prisma.playerLeagueMembership.findUnique({
    where: { id: input.membershipId },
    select: {
      leagueId: true,
      leagueTeam: { select: { leagueId: true } },
    },
  })
  if (!plm) throw new Error('Membership not found')
  const plmLeagueId = plm.leagueId ?? plm.leagueTeam?.leagueId ?? null
  if (plmLeagueId !== input.leagueId) {
    throw new Error('Membership does not belong to this league')
  }

  await prisma.playerLeagueMembership.update({
    where: { id: input.membershipId },
    data: { feeOverride: input.feeOverride },
  })

  revalidate({
    domain: 'admin',
    paths: [`/admin/leagues/${input.leagueId}/players`],
  })
  revalidate({ domain: 'public' })
}
