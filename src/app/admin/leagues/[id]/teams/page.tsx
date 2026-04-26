import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import TeamsTab from '@/components/admin/TeamsTab'

type Props = { params: Promise<{ id: string }> }

export default async function TeamsPage({ params }: Props) {
  const { id } = await params

  const [leagueTeams, allTeams] = await Promise.all([
    prisma.leagueTeam.findMany({
      where: { leagueId: id },
      include: {
        team: true,
        playerAssignments: { include: { player: true } },
        homeMatches: true,
        awayMatches: true,
      },
    }),
    prisma.team.findMany({ orderBy: { name: 'asc' } }),
  ])

  return (
    <TeamsTab
      leagueId={id}
      leagueTeams={leagueTeams}
      allTeams={allTeams}
    />
  )
}
