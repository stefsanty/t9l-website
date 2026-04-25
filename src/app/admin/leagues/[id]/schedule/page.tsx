import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import ScheduleTab from '@/components/admin/ScheduleTab'

type Props = { params: Promise<{ id: string }> }

export default async function SchedulePage({ params }: Props) {
  const { id } = await params

  const [league, venues] = await Promise.all([
    prisma.league.findUnique({
      where: { id },
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
    prisma.venue.findMany({ orderBy: { name: 'asc' } }),
  ])

  if (!league) notFound()

  return (
    <ScheduleTab
      leagueId={id}
      gameWeeks={league.gameWeeks}
      leagueTeams={league.leagueTeams}
      venues={venues}
    />
  )
}
