import { getLeaguePlayers, getOrphanLineLogins } from '@/lib/admin-data'
import PlayersTab from '@/components/admin/PlayersTab'

type Props = { params: Promise<{ id: string }> }

export default async function PlayersPage({ params }: Props) {
  const { id } = await params
  const [[assignments, leagueTeams, gameWeeks], orphansRaw] = await Promise.all([
    getLeaguePlayers(id),
    getOrphanLineLogins(),
  ])

  const playerMap = new Map<string, {
    id: string
    name: string
    lineId: string | null
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
        lineId: a.player.lineId ?? null,
        assignments: [a],
      })
    }
  }

  const players = Array.from(playerMap.values())
  const maxGameWeek = gameWeeks[0]?.weekNumber ?? 1

  // Serialize Date → ISO string for the client component boundary.
  const orphans = orphansRaw.map((o) => ({
    lineId: o.lineId,
    name: o.name,
    pictureUrl: o.pictureUrl,
    firstSeenAt: o.firstSeenAt.toISOString(),
    lastSeenAt: o.lastSeenAt.toISOString(),
  }))

  return (
    <PlayersTab
      leagueId={id}
      players={players}
      leagueTeams={leagueTeams}
      maxGameWeek={maxGameWeek}
      orphans={orphans}
    />
  )
}
