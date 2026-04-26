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

// Shared `include` for the public LeaguePublicView. Subdomain and default-
// league lookups must return identical structure so the rendered template is
// the same regardless of which path served the request.
const PUBLIC_LEAGUE_INCLUDE = {
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
} as const

export const getLeagueBySubdomain = unstable_cache(
  async (subdomain: string) =>
    prisma.league.findUnique({
      where: { subdomain },
      include: PUBLIC_LEAGUE_INCLUDE,
    }),
  ['league-by-subdomain'],
  { revalidate: 60, tags: ['leagues'] },
)

// Default league served at the apex domain. Falls back to the oldest league
// if nothing is explicitly flagged, so a fresh DB still renders something.
export const getDefaultLeague = unstable_cache(
  async () =>
    (await prisma.league.findFirst({
      where: { isDefault: true },
      include: PUBLIC_LEAGUE_INCLUDE,
    })) ??
    prisma.league.findFirst({
      orderBy: { createdAt: 'asc' },
      include: PUBLIC_LEAGUE_INCLUDE,
    }),
  ['default-league'],
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
