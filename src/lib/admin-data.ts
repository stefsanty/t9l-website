import { prisma } from './prisma'

export async function getLeague() {
  return prisma.league.findFirst({ orderBy: { createdAt: 'asc' } })
}

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
