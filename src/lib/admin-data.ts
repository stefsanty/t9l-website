import { prisma } from '@/lib/prisma'

export async function getLeague() {
  return prisma.league.findFirst({ where: { status: 'active' } })
}

export async function getAllTeams() {
  return prisma.team.findMany({ orderBy: { name: 'asc' } })
}

export async function getAllPlayers() {
  return prisma.player.findMany({
    include: {
      playerTeams: {
        include: { team: true },
        where: { isActive: true },
      },
    },
    orderBy: { name: 'asc' },
  })
}

export async function getMatchesWithGoals() {
  return prisma.match.findMany({
    include: {
      homeTeam: true,
      awayTeam: true,
      goals: {
        include: {
          scorer: true,
          assister: true,
        },
      },
    },
    orderBy: [{ matchday: 'asc' }, { date: 'asc' }],
  })
}

export async function getMatch(id: string) {
  return prisma.match.findUnique({
    where: { id },
    include: {
      homeTeam: true,
      awayTeam: true,
      goals: {
        include: {
          scorer: true,
          assister: true,
        },
        orderBy: { id: 'asc' },
      },
      availability: {
        include: { player: true },
        orderBy: { player: { name: 'asc' } },
      },
    },
  })
}

export async function getDashboardStats() {
  const [league, teamCount, playerCount, matches, recentGoals] = await Promise.all([
    prisma.league.findFirst({ where: { status: 'active' } }),
    prisma.team.count(),
    prisma.player.count(),
    prisma.match.findMany({
      select: { id: true, status: true, homeScore: true, awayScore: true },
    }),
    prisma.goal.findMany({
      take: 5,
      orderBy: { id: 'desc' },
      include: {
        scorer: true,
        assister: true,
        match: {
          include: { homeTeam: true, awayTeam: true },
        },
      },
    }),
  ])

  const matchCount = matches.length
  const playedCount = matches.filter(
    m => m.homeScore !== null && m.awayScore !== null
  ).length

  return { league, teamCount, playerCount, matchCount, playedCount, recentGoals }
}
