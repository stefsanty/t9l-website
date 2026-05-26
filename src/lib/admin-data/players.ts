import { unstable_cache } from 'next/cache'
import { prisma } from '../prisma'

/**
 * Admin Players tab data fetch. As of v1.10.0 / PR B, returns a 4-tuple:
 * `[assignments, leagueTeams, gameWeeks, lineLoginsByLineId]`.
 *
 * `lineLoginsByLineId` is a Record keyed by `LineLogin.lineId` that the UI
 * uses to surface (a) the LINE display name, (b) the LINE picture URL, and
 * (c) `lastSeenAt` for every Player whose `lineId` matches a LineLogin row.
 * Fetched as a parallel query rather than a SQL relation include because
 * Prisma `Player.lineId` doesn't carry a foreign-key relation to LineLogin
 * (LineLogin is a sidecar audit table populated from the JWT callback —
 * see PR 6 / `lib/auth.ts#trackLineLogin`).
 *
 * `lastSeenAt` is serialized to an ISO string at this boundary because the
 * function is wrapped in `unstable_cache`, which JSON-round-trips its
 * return value. Calling `.toISOString()` on a value that has been through
 * that round-trip throws (it's already a string). Same shape of bug as
 * PR #44; v1.17.1 closes it at the source so consumers can't trip on it.
 */
export const getLeaguePlayers = unstable_cache(
  async (leagueId: string) => {
    const [
      assignments,
      leagueTeams,
      gameWeeks,
      allLineLogins,
      activeInvites,
      pendingMemberships,
      // v1.70.0 — ID images now live on User. Fetch every User with an
      // uploaded ID; we'll build a `Map<playerId, IdData>` keyed on
      // User.playerId so the page-level synthetic-row builder can
      // surface ID state per Player without a per-row join.
      // Cardinality is bounded by the total user population that has
      // uploaded an ID (small — ~50 today). The cache wraps this whole
      // function with a 30s TTL + 'leagues' tag, matching the rest of
      // the read path.
      idUsers,
    ] = await Promise.all([
      prisma.playerLeagueMembership.findMany({
        where: { leagueTeam: { leagueId } },
        include: {
          player: true,
          leagueTeam: { include: { team: true } },
        },
        orderBy: { player: { name: 'asc' } },
      }),
      prisma.leagueTeam.findMany({
        where: { leagueId },
        include: { team: true },
      }),
      prisma.gameWeek.findMany({
        where: { leagueId },
        select: { weekNumber: true },
        orderBy: { weekNumber: 'desc' },
        take: 1,
      }),
      prisma.lineLogin.findMany({
        select: {
          lineId: true,
          name: true,
          pictureUrl: true,
          lastSeenAt: true,
        },
      }),
      // v1.38.0 (PR κ) — active PERSONAL invites with a `targetPlayerId`,
      // for the new "Invited" sign-in-status badge. We pull the
      // population once and group by `targetPlayerId` in JS — Prisma's
      // groupBy doesn't fit the "non-revoked AND non-used-up AND
      // non-expired" predicate cleanly. Cardinality is bounded by the
      // roster size so the in-memory filter is cheap.
      prisma.leagueInvite.findMany({
        where: {
          leagueId,
          kind: 'PERSONAL',
          revokedAt: null,
          targetPlayerId: { not: null },
        },
        select: {
          targetPlayerId: true,
          code: true,
          expiresAt: true,
          maxUses: true,
          usedCount: true,
          skipOnboarding: true,
        },
        take: 5000,
      }),
      // v1.65.4 — pending applications targeting THIS league. The
      // legacy `Player.applicationStatus` + `Player.applicationLeagueId`
      // columns are dropped; pending state lives only on PLM. Reading
      // PLM.position so the admin Players tab surfaces the per-league
      // position even before approval.
      prisma.playerLeagueMembership.findMany({
        where: {
          leagueId,
          applicationStatus: 'PENDING',
        },
        include: { player: true },
        orderBy: { createdAt: 'desc' },
      }),
      // v1.70.0 — User-side ID columns. Keyed on User.playerId so the
      // page-level builder can look up ID state per Player.
      prisma.user.findMany({
        where: {
          playerId: { not: null },
          idUploadedAt: { not: null },
        },
        select: {
          id: true,
          playerId: true,
          idFrontUrl: true,
          idBackUrl: true,
          idUploadedAt: true,
        },
      }),
    ])
    const lineLoginsByLineId: Record<
      string,
      { name: string | null; pictureUrl: string | null; lastSeenAt: string }
    > = {}
    for (const ll of allLineLogins) {
      lineLoginsByLineId[ll.lineId] = {
        name: ll.name,
        pictureUrl: ll.pictureUrl,
        lastSeenAt: ll.lastSeenAt.toISOString(),
      }
    }
    // Group active invites by targetPlayerId. An invite is "active" iff
    // it hasn't been used up (usedCount < maxUses, or maxUses null) AND
    // hasn't expired (expiresAt > now, or expiresAt null) AND isn't
    // revoked (filtered upstream). Admin pre-staged PERSONAL invites
    // typically have `maxUses: 1` so any usedCount ≥ 1 means consumed.
    // Per-player at most one active PERSONAL invite can exist (the generate
    // action rejects a second one), so the first match wins.
    const now = Date.now()
    const activeInviteByPlayerId: Record<string, { code: string; expiresAt: string | null; skipOnboarding: boolean }> = {}
    for (const inv of activeInvites) {
      if (!inv.targetPlayerId) continue
      const usedUp = inv.maxUses !== null && inv.usedCount >= inv.maxUses
      if (usedUp) continue
      const expired = inv.expiresAt !== null && inv.expiresAt.getTime() <= now
      if (expired) continue
      if (!activeInviteByPlayerId[inv.targetPlayerId]) {
        activeInviteByPlayerId[inv.targetPlayerId] = {
          code: inv.code,
          expiresAt: inv.expiresAt ? inv.expiresAt.toISOString() : null,
          skipOnboarding: inv.skipOnboarding,
        }
      }
    }
    // v1.65.4 — pending applications come exclusively from PLM rows now.
    // The legacy Player.* source is gone; the merge step is unnecessary.
    // Surface as the same Player-shaped array consumers expect, with
    // `position` carried from the PLM row so the admin Players tab can
    // render the applicant's stated position before approval.
    const mergedPendingApplications = pendingMemberships.map((plm) => ({
      ...plm.player,
      // PLM-derived position attached for the page-level synthetic-row
      // builder; PlayerRow consumers read `player.position` post-v1.65.4
      // expecting the per-league position.
      position: plm.position,
      // v1.82.0 — multi-position from the PLM row.
      positions: plm.positions,
      // v1.93.0 — preferred + secondary split.
      preferredPositions: plm.preferredPositions,
      secondaryPositions: plm.secondaryPositions,
      // v1.80.0 — applicant comments from the PLM.
      comments: plm.comments,
    }))
    // v1.70.0 — `idDataByPlayerId` keyed on User.playerId. Date is
    // serialized to ISO string at this boundary because the function is
    // wrapped in `unstable_cache`, which JSON-round-trips its return
    // value (same v1.17.1 cache-Date trap defense as `lastSeenAt`).
    const idDataByPlayerId: Record<
      string,
      { userId: string; idFrontUrl: string | null; idBackUrl: string | null; idUploadedAt: string }
    > = {}
    for (const u of idUsers) {
      if (!u.playerId || !u.idUploadedAt) continue
      idDataByPlayerId[u.playerId] = {
        userId: u.id,
        idFrontUrl: u.idFrontUrl,
        idBackUrl: u.idBackUrl,
        idUploadedAt: u.idUploadedAt.toISOString(),
      }
    }
    return [
      assignments,
      leagueTeams,
      gameWeeks,
      lineLoginsByLineId,
      activeInviteByPlayerId,
      mergedPendingApplications,
      idDataByPlayerId,
    ] as const
  },
  ['league-players'],
  { revalidate: 30, tags: ['leagues'] },
)

export async function getAllPlayers() {
  return prisma.player.findMany({
    include: {
      leagueAssignments: {
        include: { leagueTeam: { include: { team: true } } },
      },
    },
    orderBy: { name: 'asc' },
  })
}

/**
 * v1.56.0 (PR 3 of route-shortening chain) — for every Player on THIS
 * league's roster, return the names of OTHER active leagues they're
 * also in. Empty array when this is the player's only league.
 *
 * Drives the per-row "Also in: <league names>" differentiation cue on
 * PlayersTab so admins can tell at-a-glance which roster slots are
 * cross-league (the human plays in multiple leagues) vs league-staged
 * (the human only exists for this league's purposes).
 *
 * Not part of `getLeaguePlayers` because that function is cached under
 * the `leagues` tag with a 30s TTL — adding cross-league data would
 * either require a finer-grained cache key (one per leagueId) or
 * accept that any league-scoped admin write busts every league's view.
 * Surfacing this as a separate, uncached query keeps the cache
 * footprint lean; admin writes already revalidate `domain: 'admin'`
 * which busts the leagues tag.
 */
export async function getPlayerOtherLeaguesForLeague(leagueId: string): Promise<
  Record<string, string[]>
> {
  // Fetch every active assignment for every player who has at least one
  // active assignment in THIS league. Group by playerId, exclude
  // assignments under this league, return the league names.
  const playersInThisLeague = await prisma.playerLeagueMembership.findMany({
    where: { toGameWeek: null, leagueTeam: { leagueId } },
    select: { playerId: true },
  })
  const playerIds = Array.from(new Set(playersInThisLeague.map((a) => a.playerId)))
  if (playerIds.length === 0) return {}

  const otherAssignments = await prisma.playerLeagueMembership.findMany({
    where: {
      playerId: { in: playerIds },
      toGameWeek: null,
      leagueTeam: { leagueId: { not: leagueId } },
    },
    select: {
      playerId: true,
      leagueTeam: { select: { league: { select: { name: true } } } },
    },
  })

  const result: Record<string, string[]> = {}
  for (const a of otherAssignments) {
    // v1.65.0 — defensive null-check; `leagueTeam` is nullable post-rework.
    // The query's `where: { leagueTeam: { leagueId: { not: leagueId } } }`
    // implicitly filters out null-leagueTeam rows, but TS can't narrow that.
    if (!a.leagueTeam) continue
    const name = a.leagueTeam.league.name
    if (!name) continue
    const existing = result[a.playerId] ?? []
    if (!existing.includes(name)) {
      existing.push(name)
      result[a.playerId] = existing
    }
  }
  return result
}

/**
 * v1.56.0 (PR 3 of route-shortening chain) — global Players that are
 * NOT currently on this league's roster, annotated with the OTHER
 * leagues they're in.
 *
 * Drives the admin "Link existing player" dialog: the operator wants
 * to attach a known Player (e.g. someone who joined T9L's default
 * league via PR ζ invite) to a different league's roster without
 * creating a duplicate Player record.
 *
 * "Currently on this league's roster" = at least one
 * `PlayerLeagueMembership` with `toGameWeek: null` (active) under one
 * of this league's `LeagueTeam` rows.
 *
 * Players with NO active assignment in ANY league are surfaced too —
 * they're often pre-staged Players from `adminCreatePlayer` whose
 * default-league assignment was archived (toGameWeek set), or
 * truly-orphaned Players from data quality issues. The dialog can
 * still attach them to this league.
 *
 * Each row's `otherLeagues` field lists the league names where the
 * player has an active assignment, so the operator gets context like
 * "Stefan Santos · also in T9L 2026 Spring" before clicking Link.
 *
 * Cardinality: bounded by the number of distinct Players across the
 * org (today: ~50; expected ceiling: a few hundred). Single-query
 * with Prisma include — same shape as `getAllPlayers` plus the
 * filtering the dialog needs.
 */
export async function getLinkablePlayersForLeague(leagueId: string): Promise<
  Array<{
    id: string
    name: string | null
    position: string | null
    /** v1.82.0 — multi-position from the source assignment. */
    positions: string[]
    profilePictureUrl: string | null
    pictureUrl: string | null
    userId: string | null
    lineId: string | null
    // Names of OTHER leagues where the player has an active assignment.
    // Empty array if this is the player's first roster slot ever.
    otherLeagues: string[]
  }>
> {
  // Two parallel queries: (1) every Player + every active assignment +
  // its league name; (2) the set of player ids already on this league.
  // Then filter (1) by NOT-IN (2) and project the otherLeagues list.
  const [players, currentLeagueAssignments] = await Promise.all([
    prisma.player.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        profilePictureUrl: true,
        pictureUrl: true,
        userId: true,
        lineId: true,
        // v1.65.4 — pull leagueAssignments with position so we can
        // surface the player's last-known position when listing them
        // as a candidate for linking into a new league.
        leagueAssignments: {
          select: {
            position: true,
            // v1.82.0 — pull positions[] for the linkable-player surface.
            positions: true,
            toGameWeek: true,
            leagueTeam: { select: { league: { select: { id: true, name: true } } } },
          },
        },
      },
    }),
    prisma.playerLeagueMembership.findMany({
      where: {
        toGameWeek: null,
        leagueTeam: { leagueId },
      },
      select: { playerId: true },
    }),
  ])

  const inThisLeague = new Set(currentLeagueAssignments.map((a) => a.playerId))
  return players
    .filter((p) => !inThisLeague.has(p.id))
    .map((p) => {
      const sourceAssignment =
        p.leagueAssignments.find((a) => a.toGameWeek === null) ??
        p.leagueAssignments[0] ??
        null
      // v1.82.0 — multi-position. Prefer positions[]; fall back to
      // legacy single-string for memberships that haven't been re-saved.
      const positions = sourceAssignment?.positions?.length
        ? [...sourceAssignment.positions]
        : sourceAssignment?.position
          ? [sourceAssignment.position]
          : []
      return {
      id: p.id,
      name: p.name,
      // v1.65.4 — position lives on PLM. Pick the position from the
      // most-recent active assignment; null when no assignments. This
      // is the "linkable existing player" surface so showing their
      // last-known position is the useful signal.
      position: sourceAssignment?.position ?? null,
      positions,
      profilePictureUrl: p.profilePictureUrl,
      pictureUrl: p.pictureUrl,
      userId: p.userId,
      lineId: p.lineId,
      otherLeagues: p.leagueAssignments
        // v1.65.0 — defensive null-filter for nullable leagueTeam.
        .map((a) => a.leagueTeam?.league.name ?? null)
        .filter((name): name is string => !!name),
      }
    })
}
