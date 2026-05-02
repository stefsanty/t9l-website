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
    // v1.33.0 (PR ε) — `Player.name` is now nullable. Admin-side surfaces
    // (PlayersTab) render a "Unnamed" placeholder for null values and let
    // admins edit via the existing PillEditor; pre-staged players for
    // PR ζ onboarding flow start with name=null until the user fills.
    name: string | null
    // v1.33.0 — `Player.position` is now `PlayerPosition?` enum; surfaced
    // here as `string | null` so the client component is DB-shape-agnostic.
    position: string | null
    // v1.35.0 (PR η) — uploaded ID URLs + timestamp. Null when no upload yet.
    idFrontUrl: string | null
    idBackUrl: string | null
    idUploadedAt: string | null  // ISO string (cache-safe; same pattern as lineLastSeenAt)
    lineId: string | null
    lineDisplayName: string | null
    linePictureUrl: string | null
    lineLastSeenAt: string | null
    assignments: {
      id: string
      fromGameWeek: number
      toGameWeek: number | null
      leagueTeam: { id: string; team: { name: string } }
      // v1.36.0 (PR θ) — surface the assignment's onboarding state so
      // PlayersTab can conditionally render the "Reset onboarding" button.
      onboardingStatus: 'NOT_YET' | 'COMPLETED'
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
        position: a.player.position ?? null,
        // v1.35.0 (PR η) — surface ID upload state. Date → ISO string at
        // the boundary (matches lineLastSeenAt's cache-safe pattern).
        idFrontUrl: a.player.idFrontUrl ?? null,
        idBackUrl: a.player.idBackUrl ?? null,
        // v1.35.0 — defensive against the v1.17.1 cache-Date trap:
        // `getLeaguePlayers` is wrapped in `unstable_cache`, which
        // JSON-round-trips its return value, so a Date may arrive as a
        // string post-cache. Coerce both shapes via String() — works on
        // both Date (toString → cache-friendly) and pre-stringified ISO.
        idUploadedAt: a.player.idUploadedAt
          ? a.player.idUploadedAt instanceof Date
            ? a.player.idUploadedAt.toISOString()
            : String(a.player.idUploadedAt)
          : null,
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
