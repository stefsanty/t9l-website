import {
  getLeaguePlayers,
  getOrphanLineLogins,
  getAllLineLoginsWithLinkedPlayer,
  getLinkablePlayersForLeague,
  getPlayerOtherLeaguesForLeague,
  getLeagueSettings,
} from '@/lib/admin-data'
import PlayersTab from '@/components/admin/PlayersTab'
import { resolvePlayerFee } from '@/lib/playerFee'

type Props = { params: Promise<{ id: string }> }

export default async function PlayersPage({ params }: Props) {
  const { id } = await params
  // v1.10.0 / PR B — `getLeaguePlayers` returns a tuple of admin-page
  // payload pieces. v1.38.0 (PR κ) added `activeInviteCountByPlayerId`
  // as the 5th element so the new "Invited" sign-in-status badge can
  // render without a separate fetch. v1.70.0 added `idDataByPlayerId`
  // so ID upload state surfaces post-Player→User migration.
  const [
    [
      assignments,
      leagueTeams,
      gameWeeks,
      lineLoginsByLineId,
      activeInviteByPlayerId,
      pendingApplications,
      idDataByPlayerId,
    ],
    orphansRaw,
    allLineLoginsRaw,
    linkableCandidates,
    otherLeaguesByPlayerId,
    // v1.66.0 — League settings include defaultFee + positionFees so the
    // admin Players tab can resolve effectiveFee per row.
    leagueSettings,
  ] = await Promise.all([
    getLeaguePlayers(id),
    getOrphanLineLogins(),
    getAllLineLoginsWithLinkedPlayer(),
    getLinkablePlayersForLeague(id),
    getPlayerOtherLeaguesForLeague(id),
    getLeagueSettings(id),
  ])

  // v1.66.0 — fee-resolution context for resolvePlayerFee. defaults to
  // 0/empty when getLeagueSettings returns null (catastrophic config),
  // so resolved fee is 0 and the "Mark paid" UI doesn't surface a
  // misleading number.
  const feeLeague = {
    defaultFee: leagueSettings?.defaultFee ?? 0,
    positionFees: leagueSettings?.positionFees ?? [],
  }

  const playerMap = new Map<string, {
    id: string
    // v1.33.0 (PR ε) — `Player.name` is now nullable. Admin-side surfaces
    // (PlayersTab) render a "Unnamed" placeholder for null values and let
    // admins edit via the existing PillEditor; pre-staged players for
    // PR ζ onboarding flow start with name=null until the user fills.
    name: string | null
    // v1.33.0 — `Player.position` is now `PlayerPosition?` enum; surfaced
    // here as `string | null` so the client component is DB-shape-agnostic.
    // v1.82.0 — DEPRECATED in favour of `positions[]`; still surfaced
    // for backward-compat with read sites that haven't been updated.
    position: string | null
    // v1.82.0 — multi-position canonical field. Empty array == "no
    // position recorded".
    positions: string[]
    // v1.93.0 — preferred + secondary split surfaced for the admin
    // Edit panel's split-picker. Falls back to positions[] when the
    // PLM has not been re-saved since v1.86.0 (legacy dual-write).
    preferredPositions: string[]
    secondaryPositions: string[]
    // v1.37.0 (PR ι) — user-uploaded profile picture (Vercel Blob URL).
    profilePictureUrl: string | null
    // Legacy LINE-CDN mirror written on /assign-player link.
    pictureUrl: string | null
    // v1.38.0 (PR κ) — User binding from PR β / v1.29.0 dual-write.
    // Drives the "Signed up" sign-in status badge.
    userId: string | null
    // v1.85.0 — active PERSONAL invite pre-bound to this player (not
    // revoked, not used up, not expired). Drives the "Invited" badge
    // when userId is null; code/expiresAt/skipOnboarding let the admin
    // re-display the existing invite without regenerating.
    activeInvite: { code: string; expiresAt: string | null; skipOnboarding: boolean } | null
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
    // v1.66.0 — payment status surface from the active PLM. Optional
    // here because pending-application synthetic rows don't have an
    // active PLM with payment state (admin assigns + flips on approval).
    paidStatus?: 'PAID' | 'UNPAID'
    effectiveFee?: number
    feeOverride?: number | null
    membershipId?: string
    // v1.80.0 — applicant comments from the PLM.
    comments?: string | null
    assignments: {
      id: string
      fromGameWeek: number
      toGameWeek: number | null
      leagueTeam: { id: string; team: { name: string } }
      // v1.36.0 (PR θ) — surface the assignment's onboarding state so
      // PlayersTab can conditionally render the "Reset onboarding" button.
      onboardingStatus: 'NOT_YET' | 'COMPLETED'
      // v1.87.0 — per-league retirement marker. ISO string when retired;
      // null when active. Drives the "Retire from league" / "Unretire"
      // kebab item + the row-level RETIRED pill.
      retiredAt: string | null
    }[]
  }>()

  for (const a of assignments) {
    // v1.65.0 — leagueTeam is nullable post-rework; the Prisma query's
    // `where: { leagueTeam: { leagueId } }` filter implicitly excludes
    // null-leagueTeam rows but TS can't narrow that. PENDING-application
    // memberships from v1.65.1+ come through `pendingApplications` below.
    if (!a.leagueTeam) continue
    // v1.87.0 — flatten retiredAt to ISO string | null for the
    // cache-safe client payload (mirrors the v1.17.1 pattern used for
    // lastSeenAt / idUploadedAt). The cache JSON-round-trips Dates so
    // `a.retiredAt` is actually a string at runtime even though TS
    // infers Date from the Prisma model — coerce defensively.
    const rawRetiredAt = a.retiredAt as unknown
    const retiredAtIso =
      rawRetiredAt instanceof Date
        ? rawRetiredAt.toISOString()
        : typeof rawRetiredAt === 'string' && rawRetiredAt.length > 0
          ? rawRetiredAt
          : null
    const aWithTeam = {
      ...(a as typeof a & { leagueTeam: NonNullable<typeof a.leagueTeam> }),
      retiredAt: retiredAtIso,
    }
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
        // v1.82.0 — also propagate the canonical positions[] array.
        // v1.93.0 — propagate the preferred/secondary split.
        position: a.position ?? null,
        positions: a.positions ?? [],
        preferredPositions: a.preferredPositions ?? [],
        secondaryPositions: a.secondaryPositions ?? [],
        profilePictureUrl: a.player.profilePictureUrl ?? null,
        pictureUrl: a.player.pictureUrl ?? null,
        userId: a.player.userId ?? null,
        activeInvite: activeInviteByPlayerId[a.player.id] ?? null,
        // v1.70.0 — ID images live on User now. `idDataByPlayerId` is
        // already-keyed-on-Player.id by the admin-data builder, with
        // `idUploadedAt` already serialized to an ISO string at the
        // cache boundary (defensive against the v1.17.1 cache-Date trap).
        idFrontUrl: idDataByPlayerId[a.player.id]?.idFrontUrl ?? null,
        idBackUrl: idDataByPlayerId[a.player.id]?.idBackUrl ?? null,
        idUploadedAt: idDataByPlayerId[a.player.id]?.idUploadedAt ?? null,
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
        // v1.66.0 — payment status for the active PLM. effectiveFee
        // resolves through the canonical resolver — feeOverride > position
        // match > defaultFee.
        paidStatus: a.paidStatus,
        effectiveFee: resolvePlayerFee(
          { position: a.position, feeOverride: a.feeOverride },
          feeLeague,
        ),
        feeOverride: a.feeOverride,
        membershipId: a.id,
        // v1.80.0 — comments from the PLM row.
        comments: a.comments ?? null,
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
      // v1.82.0 — multi-position from the PLM row.
      positions: p.positions ?? [],
      // v1.93.0 — preferred + secondary split.
      preferredPositions: p.preferredPositions ?? [],
      secondaryPositions: p.secondaryPositions ?? [],
      profilePictureUrl: p.profilePictureUrl ?? null,
      pictureUrl: p.pictureUrl ?? null,
      userId: p.userId ?? null,
      activeInvite: activeInviteByPlayerId[p.id] ?? null,
      // v1.70.0 — ID images live on User; pendingApplications still
      // surfaces them via the same lookup as APPROVED rows.
      idFrontUrl: idDataByPlayerId[p.id]?.idFrontUrl ?? null,
      idBackUrl: idDataByPlayerId[p.id]?.idBackUrl ?? null,
      idUploadedAt: idDataByPlayerId[p.id]?.idUploadedAt ?? null,
      lineId: p.lineId ?? null,
      lineDisplayName: ll?.name ?? null,
      linePictureUrl: ll?.pictureUrl ?? null,
      lineLastSeenAt: ll?.lastSeenAt ?? null,
      otherLeagues: otherLeaguesByPlayerId[p.id] ?? [],
      // v1.65.4 — Player no longer carries applicationStatus; the
      // synthetic-row builder hardcodes 'PENDING' since the
      // pending-applications source returns only PLM(PENDING) rows.
      applicationStatus: 'PENDING',
      // v1.80.0 — comments from the PLM row (propagated via mergedPendingApplications).
      comments: p.comments ?? null,
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
      ballType={leagueSettings?.ballType ?? null}
    />
  )
}
