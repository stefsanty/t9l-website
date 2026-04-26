import { getLeagueStats } from '@/lib/admin-data'
import StatsTab from '@/components/admin/StatsTab'

type Props = { params: Promise<{ id: string }> }

export default async function StatsPage({ params }: Props) {
  const { id } = await params
  const [goals, matches, leagueTeams, gameWeeks] = await getLeagueStats(id)

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
