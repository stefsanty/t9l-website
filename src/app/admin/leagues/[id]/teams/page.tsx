import { getLeagueTeams } from '@/lib/admin-data'
import TeamsTab from '@/components/admin/TeamsTab'

type Props = { params: Promise<{ id: string }> }

export default async function TeamsPage({ params }: Props) {
  const { id } = await params
  const [leagueTeams, allTeams] = await getLeagueTeams(id)

  return (
    <TeamsTab
      leagueId={id}
      leagueTeams={leagueTeams}
      allTeams={allTeams}
    />
  )
}
