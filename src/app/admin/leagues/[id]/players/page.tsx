import {
  getLeaguePlayers,
  getOrphanLineLogins,
  getAllLineLoginsWithLinkedPlayer,
  getLinkablePlayersForLeague,
  getPlayerOtherLeaguesForLeague,
} from '@/lib/admin-data'
import PlayersTab from '@/components/admin/PlayersTab'

type Props = { params: Promise<{ id: string }> }

export default async function PlayersPage({ params }: Props) {
  const { id } = await params
  // v1.10.0 / PR B — `getLeaguePlayers` returns a tuple of admin-page
  // payload pieces. v1.38.0 (PR κ) added `activeInviteCountByPlayerId`
  // as the 5th element so the new "Invited" sign-in-status badge can
  // render without a separate fetch.
  const [
    [assignments, leagueTeams, gameWeeks, lineLoginsByLineId, activeInviteCountByPlayerId, pendingApplications],
    orphansRaw,
    allLineLoginsRaw,
    linkableCandidates,
    otherLeaguesByPlayerId,
  ] = await Promise.all([
    getLeaguePlayers(id),
    getOrphanLineLogins(),
    getAllLineLoginsWithLinkedPlayer(),
    // v1.56.0 (PR 3 of route-shortening chain) — global Players NOT
    // currently on this league's roster, with the names of other
    // leagues they're in. Drives the LinkExistingPlayerDialog.
    getLinkablePlayersForLeague(id),
    // v1.56.0 — for every player ON this league's roster, the names of
    // OTHER active leagues they're in. Drives the per-row "Also in:
    // <league>" differentiation cue on PlayersTab.
    getPlayerOtherLeaguesForLeague(id),
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
    // v1.37.0 (PR ι) — user-uploaded profile picture (Vercel Blob URL).
    profilePictureUrl: string | null
    // Legacy LINE-CDN mirror written on /assign-player link.
    pictureUrl: string | null
    // v1.38.0 (PR κ) — User binding from PR β / v1.29.0 dual-write.
    // Drives the "Signed up" sign-in status badge.
    userId: string | null
    // v1.38.0 — count of active PERSONAL invites pre-bound to this
    // player (not revoked, not used up, not expired). Drives the
    // "Invited" badge when userId is null.
    activeInviteCount: number
    // v1.35.0 (PR η) — uploaded ID URLs + timestamp. Null when no upload yet.
    idFrontUrl: string | null
    idBackUrl: string | null
    idUploadedAt: string | null  // ISO string (cache-safe; same pattern as lineLastSeenAt)
    lineId: string | null
    lineDisplayName: string | null
    linePictureUrl: string | null
    lineLastSeenAt: string | null
    // v1.56.0 (PR 3 of route-shortening chain) — names of OTHER leagues
    // where this player has an active assignment. Empty when this is
    // the player's only league. Drives the per-row "Also in: <league>"
    // differentiation cue.
    otherLeagues: string[]
    // v1.64.0 — application status. APPROVED is the steady state for
    // every existing Player; PENDING means the user submitted a
    // recruiting application via the homepage banner and is awaiting
    // admin review. PlayersTab renders a status badge for PENDING + adds
    // Approve/Reject kebab items.
    applicationStatus: 'APPROVED' | 'PENDING'
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
    // v1.65.0 — leagueTeam is nullable post-rework; the Prisma query's
    // `where: { leagueTeam: { leagueId } }` filter implicitly excludes
    // null-leagueTeam rows but TS can't narrow that. PENDING-application
    // memberships from v1.65.1+ come through `pendingApplications` below.
    if (!a.leagueTeam) continue
    const aWithTeam = a as typeof a & { leagueTeam: NonNullable<typeof a.leagueTeam> }
    const existing = playerMap.get(a.playerId)
    if (existing) {
      existing.assignments.push(aWithTeam)
    } else {
      const ll = a.player.lineId ? lineLoginsByLineId[a.player.lineId] : undefined
      playerMap.set(a.playerId, {
        id: a.player.id,
        name: a.player.name,
        // v1.65.4 — position now lives on PLM, not Player. Read from the
        // PLM row (a.position) directly.
        position: a.position ?? null,
        profilePictureUrl: a.player.profilePictureUrl ?? null,
        pictureUrl: a.player.pictureUrl ?? null,
        userId: a.player.userId ?? null,
        activeInviteCount: activeInviteCountByPlayerId[a.player.id] ?? 0,
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
        otherLeagues: otherLeaguesByPlayerId[a.player.id] ?? [],
        // v1.65.4 — applicationStatus is now per-PLM. APPROVED memberships
        // (no synthetic-row applicants reach this loop) get APPROVED.
        applicationStatus: a.applicationStatus,
        assignments: [aWithTeam],
      })
    }
  }

  // v1.65.4 — append pending applications as synthetic player rows.
  // PLM(PENDING) rows have leagueTeamId=null (the admin assigns a team
  // on approval), so they don't appear in the assignments-driven loop
  // above (which filtered to non-null leagueTeam). PlayersTab renders
  // these with empty `assignments` (currentTeam → null) plus the
  // PENDING status badge.
  //
  // `pendingApplications` here is shaped as a Player row with `position`
  // attached from the PLM (see admin-data.ts merge step). Position is
  // PLM-derived so the admin sees the applicant's stated position.
  for (const p of pendingApplications) {
    if (playerMap.has(p.id)) continue // safety: a pending player should not also have an APPROVED PLM
    const ll = p.lineId ? lineLoginsByLineId[p.lineId] : undefined
    playerMap.set(p.id, {
      id: p.id,
      name: p.name,
      position: p.position ?? null,
      profilePictureUrl: p.profilePictureUrl ?? null,
      pictureUrl: p.pictureUrl ?? null,
      userId: p.userId ?? null,
      activeInviteCount: activeInviteCountByPlayerId[p.id] ?? 0,
      idFrontUrl: p.idFrontUrl ?? null,
      idBackUrl: p.idBackUrl ?? null,
      idUploadedAt: p.idUploadedAt
        ? p.idUploadedAt instanceof Date
          ? p.idUploadedAt.toISOString()
          : String(p.idUploadedAt)
        : null,
      lineId: p.lineId ?? null,
      lineDisplayName: ll?.name ?? null,
      linePictureUrl: ll?.pictureUrl ?? null,
      lineLastSeenAt: ll?.lastSeenAt ?? null,
      otherLeagues: otherLeaguesByPlayerId[p.id] ?? [],
      // v1.65.4 — Player no longer carries applicationStatus; the
      // synthetic-row builder hardcodes 'PENDING' since the
      // pending-applications source returns only PLM(PENDING) rows.
      applicationStatus: 'PENDING',
      assignments: [],
    })
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
      linkableCandidates={linkableCandidates}
    />
  )
}
