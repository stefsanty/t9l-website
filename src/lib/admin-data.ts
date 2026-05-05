import { unstable_cache } from 'next/cache'
import { prisma } from './prisma'

/**
 * v1.58.0 (PR 5 of route-shortening chain) — `getAllLeagues` is the
 * single query behind the `/admin` dashboard tile grid. Pre-v1.58.0 it
 * used a flat `include: { matches: true, venue: true }` on every
 * gameWeek, fetching all ~15 fields of every Match row just to read
 * `match.status` (for the COMPLETED-everywhere check) and
 * `matches.length` (for the "X matches scheduled" copy).
 *
 * v1.58.0 trims to a minimal `select` projection — only the fields the
 * dashboard renders (League: id/name/subdomain/endDate; GameWeek:
 * weekNumber/startDate/venue.name; Match: status). Everything else
 * (homeScore/awayScore/playedAt/endedAt/scoreOverride/etc.) drops out.
 * Wire-payload + Prisma serialization both shrink proportionally.
 *
 * Cardinality: typical T9L instance has 1–2 leagues × 8 GWs × 3
 * matches = 24–48 Match rows pre-trim. The trim removes ~14
 * fields-per-row from the serialized payload. Magnitude small but
 * meaningful on cold-Neon-Vercel cold-lambda paths where every JSON
 * byte counts. The 30s `unstable_cache` TTL already absorbs warm-path
 * cost; this fix targets the cold cache miss.
 */
export const getAllLeagues = unstable_cache(
  async () =>
    prisma.league.findMany({
      select: {
        id: true,
        name: true,
        subdomain: true,
        endDate: true,
        gameWeeks: {
          select: {
            weekNumber: true,
            startDate: true,
            venue: { select: { name: true } },
            matches: { select: { status: true } },
          },
          orderBy: { weekNumber: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ['all-leagues'],
  { revalidate: 30, tags: ['leagues'] },
)

export const getLeagueSchedule = unstable_cache(
  async (leagueId: string) =>
    prisma.league.findUnique({
      where: { id: leagueId },
      include: {
        leagueTeams: { include: { team: true } },
        gameWeeks: {
          include: {
            venue: true,
            matches: {
              include: {
                homeTeam: { include: { team: true } },
                awayTeam: { include: { team: true } },
              },
              orderBy: { playedAt: 'asc' },
            },
          },
          orderBy: { weekNumber: 'asc' },
        },
      },
    }),
  ['league-schedule'],
  { revalidate: 30, tags: ['leagues'] },
)

export const getLeagueTeams = unstable_cache(
  async (leagueId: string) =>
    Promise.all([
      prisma.leagueTeam.findMany({
        where: { leagueId },
        include: {
          team: true,
          playerAssignments: { include: { player: true } },
          homeMatches: true,
          awayMatches: true,
        },
      }),
      prisma.team.findMany({ orderBy: { name: 'asc' } }),
    ]),
  ['league-teams'],
  { revalidate: 30, tags: ['leagues'] },
)

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
    const [assignments, leagueTeams, gameWeeks, allLineLogins, activeInvites, pendingApplications] = await Promise.all([
      prisma.playerLeagueAssignment.findMany({
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
          expiresAt: true,
          maxUses: true,
          usedCount: true,
        },
      }),
      // v1.64.0 — pending applications targeting THIS league. These
      // Player rows have NO PlayerLeagueAssignment yet (admin creates
      // one on approval) so the existing `assignments` query above
      // wouldn't surface them. The page-level merger appends these as
      // synthetic rows with empty `assignments`, and PlayersTab renders
      // an "Application" status badge + Approve/Reject kebab items.
      prisma.player.findMany({
        where: {
          applicationLeagueId: leagueId,
          applicationStatus: 'PENDING',
        },
        orderBy: { createdAt: 'desc' },
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
    const now = Date.now()
    const activeInviteCountByPlayerId: Record<string, number> = {}
    for (const inv of activeInvites) {
      if (!inv.targetPlayerId) continue
      const usedUp = inv.maxUses !== null && inv.usedCount >= inv.maxUses
      if (usedUp) continue
      const expired = inv.expiresAt !== null && inv.expiresAt.getTime() <= now
      if (expired) continue
      activeInviteCountByPlayerId[inv.targetPlayerId] =
        (activeInviteCountByPlayerId[inv.targetPlayerId] ?? 0) + 1
    }
    return [
      assignments,
      leagueTeams,
      gameWeeks,
      lineLoginsByLineId,
      activeInviteCountByPlayerId,
      pendingApplications,
    ] as const
  },
  ['league-players'],
  { revalidate: 30, tags: ['leagues'] },
)

export const getLeagueStats = unstable_cache(
  async (leagueId: string) =>
    Promise.all([
      prisma.goal.findMany({
        where: { match: { leagueId } },
        include: {
          player: true,
          scoringTeam: { include: { team: true } },
          match: { include: { gameWeek: true } },
          assist: { include: { player: true } },
        },
      }),
      prisma.match.findMany({
        where: { leagueId },
        include: { gameWeek: { select: { weekNumber: true } } },
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
    ]),
  ['league-stats'],
  { revalidate: 30, tags: ['leagues'] },
)

/**
 * v1.43.0 (PR γ) — admin Events tab data fetch.
 *
 * Returns the data the new events-first StatsTab needs:
 *   - events:      every MatchEvent for the league with scorer + assister names
 *   - matches:     every Match with home/away team labels + gameweek number
 *   - leagueTeams: each team in the league with its current roster
 *                  (for the admin editor's smart pickers — scorer filtered to
 *                  beneficiary team, assister too, etc.)
 *   - gameWeekMax: highest week number, for the matchday filter chips
 *
 * Cached under a separate tag from `getLeagueStats` so the cache-bust path
 * for event writes (`revalidate({ domain: 'admin' })` busts the `leagues` tag)
 * can pick this up.
 */
export const getLeagueEvents = unstable_cache(
  async (leagueId: string) => {
    const [events, matches, leagueTeams, gameWeeks] = await Promise.all([
      prisma.matchEvent.findMany({
        where: { match: { leagueId } },
        include: {
          scorer: { select: { id: true, name: true } },
          assister: { select: { id: true, name: true } },
          match: {
            include: {
              gameWeek: { select: { weekNumber: true } },
              homeTeam: { include: { team: true } },
              awayTeam: { include: { team: true } },
            },
          },
        },
        orderBy: [
          { match: { gameWeek: { weekNumber: 'desc' } } },
          { minute: 'asc' },
          { createdAt: 'asc' },
        ],
      }),
      prisma.match.findMany({
        where: { leagueId },
        include: {
          gameWeek: { select: { weekNumber: true } },
          homeTeam: { include: { team: true } },
          awayTeam: { include: { team: true } },
        },
        orderBy: [
          { gameWeek: { weekNumber: 'desc' } },
          { playedAt: 'asc' },
        ],
      }),
      prisma.leagueTeam.findMany({
        where: { leagueId },
        include: {
          team: true,
          playerAssignments: {
            include: { player: { select: { id: true, name: true } } },
          },
        },
      }),
      prisma.gameWeek.findMany({
        where: { leagueId },
        select: { weekNumber: true },
        orderBy: { weekNumber: 'desc' },
        take: 1,
      }),
    ])
    return [events, matches, leagueTeams, gameWeeks[0]?.weekNumber ?? 0] as const
  },
  ['league-events'],
  { revalidate: 30, tags: ['leagues'] },
)

export const getLeagueSettings = unstable_cache(
  async (leagueId: string) =>
    prisma.league.findUnique({ where: { id: leagueId } }),
  ['league-settings'],
  { revalidate: 30, tags: ['leagues'] },
)

export const getAllVenues = unstable_cache(
  async () => prisma.venue.findMany({ orderBy: { name: 'asc' } }),
  ['all-venues'],
  { revalidate: 30, tags: ['leagues'] },
)

/**
 * Admin Venues page (v1.18.0). Same shape as `getAllVenues` plus usage
 * counts so the operator can see which venues are still referenced before
 * attempting a delete. `gameWeekCount` and `matchCount` are computed in
 * memory from a single `findMany` with `_count` on both relations.
 */
export const getAllVenuesWithUsage = unstable_cache(
  async () => {
    const venues = await prisma.venue.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { gameWeeks: true, matches: true } },
      },
    })
    return venues.map((v) => ({
      id: v.id,
      name: v.name,
      address: v.address,
      city: v.city,
      notes: v.notes,
      url: v.url,
      courtSize: v.courtSize,
      gameWeekCount: v._count.gameWeeks,
      matchCount: v._count.matches,
    }))
  },
  ['all-venues-with-usage'],
  { revalidate: 30, tags: ['leagues'] },
)

export async function getLeague() {
  return prisma.league.findFirst({ orderBy: { createdAt: 'asc' } })
}

// `getLeagueBySubdomain` was removed in v1.25.0 — its only caller was the
// now-deleted `LeaguePublicView`. Subdomain rendering now goes through
// `Dashboard` fed by `getPublicLeagueData(leagueId)`, where the leagueId
// comes from `lib/getLeagueFromHost.ts#getLeagueIdFromRequest()`.

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

export async function getMatchesWithGoals() {
  return prisma.match.findMany({
    include: {
      gameWeek: true,
      homeTeam: { include: { team: true } },
      awayTeam: { include: { team: true } },
      goals: { include: { player: true, assist: { include: { player: true } } } },
    },
    orderBy: [{ gameWeek: { weekNumber: 'asc' } }, { id: 'asc' }],
  })
}

export async function getMatch(id: string) {
  return prisma.match.findUnique({
    where: { id },
    include: {
      gameWeek: true,
      homeTeam: { include: { team: true } },
      awayTeam: { include: { team: true } },
      goals: { include: { player: true, assist: { include: { player: true } } } },
    },
  })
}

/**
 * Orphan LINE logins for the admin "Assign Player" Flow B dropdown.
 *
 * An orphan is a `LineLogin` row whose `lineId` is not currently set on any
 * `Player.lineId`. Returned newest-first by `lastSeenAt` so the most recent
 * unmatched sign-ins surface at the top.
 *
 * Two-query in-memory filter rather than a SQL anti-join: the table sizes
 * (~53 players, similar # of LINE logins) make a JOIN noisier than the
 * round-trip cost, and Prisma's `NOT { in: [] }` pattern hits an edge case
 * when the array is empty (no players linked yet).
 */
export async function getOrphanLineLogins(): Promise<
  Array<{
    lineId: string
    name: string | null
    pictureUrl: string | null
    firstSeenAt: Date
    lastSeenAt: Date
  }>
> {
  const [linkedRows, allLogins] = await Promise.all([
    prisma.player.findMany({
      where: { lineId: { not: null } },
      select: { lineId: true },
    }),
    prisma.lineLogin.findMany({
      orderBy: { lastSeenAt: 'desc' },
      select: {
        lineId: true,
        name: true,
        pictureUrl: true,
        firstSeenAt: true,
        lastSeenAt: true,
      },
    }),
  ])
  const linked = new Set(
    linkedRows.map((p) => p.lineId).filter((x): x is string => !!x),
  )
  return allLogins.filter((l) => !linked.has(l.lineId))
}

/**
 * v1.10.0 / PR B — full LineLogin list with the player they're currently
 * linked to (if any). Drives the admin "Remap" dialog where the operator
 * may deliberately pick a currently-linked LINE user and move them to a
 * different player. Newest-first by `lastSeenAt`.
 */
export async function getAllLineLoginsWithLinkedPlayer(): Promise<
  Array<{
    lineId: string
    name: string | null
    pictureUrl: string | null
    firstSeenAt: Date
    lastSeenAt: Date
    // v1.33.0 (PR ε) — `Player.name` is now nullable. Linked-player join
    // surfaces this as `string | null` so admin UIs can render a placeholder
    // for pre-staged-but-not-yet-onboarded players.
    linkedPlayer: { id: string; name: string | null } | null
  }>
> {
  const [allLogins, linkedRows] = await Promise.all([
    prisma.lineLogin.findMany({
      orderBy: { lastSeenAt: 'desc' },
      select: {
        lineId: true,
        name: true,
        pictureUrl: true,
        firstSeenAt: true,
        lastSeenAt: true,
      },
    }),
    prisma.player.findMany({
      where: { lineId: { not: null } },
      select: { id: true, name: true, lineId: true },
    }),
  ])
  const playerByLineId = new Map<string, { id: string; name: string | null }>()
  for (const p of linkedRows) {
    if (p.lineId) playerByLineId.set(p.lineId, { id: p.id, name: p.name })
  }
  return allLogins.map((l) => ({
    ...l,
    linkedPlayer: playerByLineId.get(l.lineId) ?? null,
  }))
}

/**
 * v1.57.0 (PR 4 of route-shortening chain) — every User row in the
 * system, annotated with the auth providers that have signed in for
 * them, the Player they're bound to (if any), and the leagues that
 * Player is currently in.
 *
 * Drives the new `/admin/users` admin list. The list is global (not
 * per-league) because Users are a global concept — one User can play in
 * multiple leagues via a single Player. Filtering by league is a
 * client-side concern in the list component.
 *
 * Cardinality: bounded by the number of distinct sign-in identities
 * across the org. Today: ~32 LINE users + a handful of Google/email
 * users; expected ceiling: a few hundred. Single Prisma query with
 * relation includes is plenty.
 *
 * Provider list is derived from `Account.provider` rows — distinct +
 * sorted for stable display. Login dates come from the corresponding
 * `LineLogin.lastSeenAt` (LINE-specific; the non-LINE providers don't
 * have a parallel login-tracking table — Account row's update doesn't
 * track activity, only the binding moment).
 */
export async function getAllUsersForAdmin(): Promise<
  Array<{
    id: string
    name: string | null
    email: string | null
    image: string | null
    pictureUrl: string | null
    lineId: string | null
    role: 'ADMIN' | 'VIEWER'
    createdAt: string
    providers: string[]
    linkedPlayer: {
      id: string
      name: string | null
      otherLeagues: string[]
    } | null
    lineLastSeenAt: string | null
  }>
> {
  const users = await prisma.user.findMany({
    orderBy: [{ createdAt: 'desc' }],
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      pictureUrl: true,
      lineId: true,
      role: true,
      createdAt: true,
      playerId: true,
      accounts: { select: { provider: true } },
    },
  })

  // Two parallel side queries to enrich:
  //   - LineLogin.lastSeenAt by lineId (only LINE providers tracked)
  //   - Linked Player + their active league names
  const lineIds = users.map((u) => u.lineId).filter((x): x is string => !!x)
  const playerIds = users.map((u) => u.playerId).filter((x): x is string => !!x)

  const [lineLogins, linkedPlayers] = await Promise.all([
    lineIds.length > 0
      ? prisma.lineLogin.findMany({
          where: { lineId: { in: lineIds } },
          select: { lineId: true, lastSeenAt: true },
        })
      : Promise.resolve([] as Array<{ lineId: string; lastSeenAt: Date }>),
    playerIds.length > 0
      ? prisma.player.findMany({
          where: { id: { in: playerIds } },
          select: {
            id: true,
            name: true,
            leagueAssignments: {
              where: { toGameWeek: null },
              select: {
                leagueTeam: { select: { league: { select: { name: true } } } },
              },
            },
          },
        })
      : Promise.resolve(
          [] as Array<{
            id: string
            name: string | null
            leagueAssignments: Array<{ leagueTeam: { league: { name: string | null } } }>
          }>,
        ),
  ])

  const lastSeenByLineId = new Map<string, Date>()
  for (const ll of lineLogins) {
    lastSeenByLineId.set(ll.lineId, ll.lastSeenAt)
  }
  const playerById = new Map<
    string,
    { id: string; name: string | null; otherLeagues: string[] }
  >()
  for (const p of linkedPlayers) {
    const otherLeagues: string[] = []
    for (const a of p.leagueAssignments) {
      const name = a.leagueTeam.league.name
      if (name && !otherLeagues.includes(name)) otherLeagues.push(name)
    }
    playerById.set(p.id, { id: p.id, name: p.name, otherLeagues })
  }

  return users.map((u) => {
    const providers = Array.from(new Set(u.accounts.map((a) => a.provider))).sort()
    const lastSeen = u.lineId ? lastSeenByLineId.get(u.lineId) ?? null : null
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      image: u.image,
      pictureUrl: u.pictureUrl,
      lineId: u.lineId,
      role: u.role,
      createdAt: u.createdAt.toISOString(),
      providers,
      linkedPlayer: u.playerId ? playerById.get(u.playerId) ?? null : null,
      lineLastSeenAt: lastSeen ? lastSeen.toISOString() : null,
    }
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
  const playersInThisLeague = await prisma.playerLeagueAssignment.findMany({
    where: { toGameWeek: null, leagueTeam: { leagueId } },
    select: { playerId: true },
  })
  const playerIds = Array.from(new Set(playersInThisLeague.map((a) => a.playerId)))
  if (playerIds.length === 0) return {}

  const otherAssignments = await prisma.playerLeagueAssignment.findMany({
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
 * `PlayerLeagueAssignment` with `toGameWeek: null` (active) under one
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
        position: true,
        profilePictureUrl: true,
        pictureUrl: true,
        userId: true,
        lineId: true,
        leagueAssignments: {
          where: { toGameWeek: null },
          select: {
            leagueTeam: { select: { league: { select: { id: true, name: true } } } },
          },
        },
      },
    }),
    prisma.playerLeagueAssignment.findMany({
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
    .map((p) => ({
      id: p.id,
      name: p.name,
      position: p.position,
      profilePictureUrl: p.profilePictureUrl,
      pictureUrl: p.pictureUrl,
      userId: p.userId,
      lineId: p.lineId,
      otherLeagues: p.leagueAssignments
        .map((a) => a.leagueTeam.league.name)
        .filter((name): name is string => !!name),
    }))
}
