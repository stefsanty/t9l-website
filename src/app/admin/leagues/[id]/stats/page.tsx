import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import StatsTab from '@/components/admin/StatsTab'

type Props = { params: Promise<{ id: string }> }

export default async function StatsPage({ params }: Props) {
  const { id } = await params

  const [goals, matches, leagueTeams, gameWeeks] = await Promise.all([
    prisma.goal.findMany({
      where: { match: { leagueId: id } },
      include: {
        player: true,
        scoringTeam: { include: { team: true } },
        match: { include: { gameWeek: true } },
        assist: { include: { player: true } },
      },
    }),
    prisma.match.findMany({
      where: { leagueId: id },
      include: { gameWeek: { select: { weekNumber: true } } },
    }),
    prisma.leagueTeam.findMany({
      where: { leagueId: id },
      include: { team: true },
    }),
    prisma.gameWeek.findMany({
      where: { leagueId: id },
      select: { weekNumber: true },
      orderBy: { weekNumber: 'desc' },
      take: 1,
    }),
  ])

  const gameWeekCount = gameWeeks[0]?.weekNumber ?? 0

  return (
    <StatsTab
      leagueId={id}
      goals={goals}
      matches={matches}
      leagueTeams={leagueTeams}
      gameWeekCount={gameWeekCount}
    />
  )
}
