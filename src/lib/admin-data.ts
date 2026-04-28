import { unstable_cache } from 'next/cache'
import { prisma } from './prisma'

export const getAllLeagues = unstable_cache(
  async () =>
    prisma.league.findMany({
      include: {
        gameWeeks: {
          include: { matches: true, venue: true },
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

export const getLeaguePlayers = unstable_cache(
  async (leagueId: string) =>
    Promise.all([
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
    ]),
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

export async function getLeague() {
  return prisma.league.findFirst({ orderBy: { createdAt: 'asc' } })
}

export const getLeagueBySubdomain = unstable_cache(
  async (subdomain: string) =>
    prisma.league.findUnique({
      where: { subdomain },
      include: {
        leagueTeams: {
          include: {
            team: true,
            playerAssignments: { include: { player: true } },
          },
        },
        gameWeeks: {
          include: {
            matches: {
              include: {
                homeTeam: { include: { team: true } },
                awayTeam: { include: { team: true } },
                goals: { include: { scoringTeam: true } },
              },
              orderBy: { playedAt: 'asc' },
            },
          },
          orderBy: { weekNumber: 'asc' },
        },
      },
    }),
  ['league-by-subdomain'],
  { revalidate: 60, tags: ['leagues'] },
)

export async function getAllTeams() {
  return prisma.team.findMany({ orderBy: { name: 'asc' } })
}

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

export async function getDashboardStats() {
  const [league, teamCount, playerCount, matchCount, goalCount, recentGoals] =
    await Promise.all([
      getLeague(),
      prisma.team.count(),
      prisma.player.count(),
      prisma.match.count(),
      prisma.goal.count(),
      prisma.goal.findMany({
        take: 10,
        orderBy: { id: 'desc' },
        include: {
          player: true,
          match: {
            include: {
              homeTeam: { include: { team: true } },
              awayTeam: { include: { team: true } },
            },
          },
        },
      }),
    ])
  return { league, teamCount, playerCount, matchCount, goalCount, recentGoals }
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
