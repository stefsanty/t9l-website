import { getLeaguePlayers } from '@/lib/admin-data'
import PlayersTab from '@/components/admin/PlayersTab'

type Props = { params: Promise<{ id: string }> }

export default async function PlayersPage({ params }: Props) {
  const { id } = await params
  const [assignments, leagueTeams, gameWeeks] = await getLeaguePlayers(id)

  const playerMap = new Map<string, {
    id: string
    name: string
    assignments: {
      id: string
      fromGameWeek: number
      toGameWeek: number | null
      leagueTeam: { id: string; team: { name: string } }
    }[]
  }>()

  for (const a of assignments) {
    const existing = playerMap.get(a.playerId)
    if (existing) {
      existing.assignments.push(a)
    } else {
      playerMap.set(a.playerId, {
        id: a.player.id,
        name: a.player.name,
        assignments: [a],
      })
    }
  }

  const players = Array.from(playerMap.values())
  const maxGameWeek = gameWeeks[0]?.weekNumber ?? 1

  return (
    <PlayersTab
      leagueId={id}
      players={players}
      leagueTeams={leagueTeams}
      maxGameWeek={maxGameWeek}
    />
  )
}
