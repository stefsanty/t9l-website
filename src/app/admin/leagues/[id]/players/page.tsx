import {
  getLeaguePlayers,
  getOrphanLineLogins,
  getAllLineLoginsWithLinkedPlayer,
} from '@/lib/admin-data'
import PlayersTab from '@/components/admin/PlayersTab'

type Props = { params: Promise<{ id: string }> }

export default async function PlayersPage({ params }: Props) {
  const { id } = await params
  // v1.10.0 / PR B — `getLeaguePlayers` now returns a 4-tuple ending in
  // `lineLoginsByLineId`, and we additionally fetch the all-LINE-logins
  // list (orphans + linked-elsewhere) for the remap dialog. Both lists
  // serialize Date → ISO at the server/client boundary.
  const [
    [assignments, leagueTeams, gameWeeks, lineLoginsByLineId],
    orphansRaw,
    allLineLoginsRaw,
  ] = await Promise.all([
    getLeaguePlayers(id),
    getOrphanLineLogins(),
    getAllLineLoginsWithLinkedPlayer(),
  ])

  const playerMap = new Map<string, {
    id: string
    name: string
    lineId: string | null
    lineDisplayName: string | null
    linePictureUrl: string | null
    lineLastSeenAt: string | null
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
      const ll = a.player.lineId ? lineLoginsByLineId[a.player.lineId] : undefined
      playerMap.set(a.playerId, {
        id: a.player.id,
        name: a.player.name,
        lineId: a.player.lineId ?? null,
        lineDisplayName: ll?.name ?? null,
        linePictureUrl: ll?.pictureUrl ?? null,
        // `lastSeenAt` is already serialized to an ISO string inside
        // `getLeaguePlayers` (see admin-data.ts) — the function is wrapped in
        // `unstable_cache`, which JSON-round-trips its return value. Calling
        // `.toISOString()` here would crash post-cache. v1.17.1.
        lineLastSeenAt: ll?.lastSeenAt ?? null,
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

  const allLineLogins = allLineLoginsRaw.map((l) => ({
    lineId: l.lineId,
    name: l.name,
    pictureUrl: l.pictureUrl,
    firstSeenAt: l.firstSeenAt.toISOString(),
    lastSeenAt: l.lastSeenAt.toISOString(),
    linkedPlayer: l.linkedPlayer,
  }))

  return (
    <PlayersTab
      leagueId={id}
      players={players}
      leagueTeams={leagueTeams}
      maxGameWeek={maxGameWeek}
      orphans={orphans}
      allLineLogins={allLineLogins}
    />
  )
}
