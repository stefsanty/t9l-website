import { prisma } from '../prisma'

/**
 * Orphan LINE logins for the admin "Assign Player" Flow B dropdown.
 *
 * An orphan is a `LineLogin` row whose `lineId` is not currently set on any
 * `Player.lineId`. Returned newest-first by `lastSeenAt` so the most recent
 * unmatched sign-ins surface at the top.
 *
 * Two-query in-memory filter rather than a SQL anti-join: the table sizes
 * (~53 players, similar # of LINE logins) make a JOIN noisier than the
 * round-trip cost, and Prisma's `NOT { in: [] }` pattern hits an edge case
 * when the array is empty (no players linked yet).
 */
export async function getOrphanLineLogins(): Promise<
  Array<{
    lineId: string
    name: string | null
    pictureUrl: string | null
    firstSeenAt: Date
    lastSeenAt: Date
  }>
> {
  const [linkedRows, allLogins] = await Promise.all([
    prisma.player.findMany({
      where: { lineId: { not: null } },
      select: { lineId: true },
    }),
    prisma.lineLogin.findMany({
      orderBy: { lastSeenAt: 'desc' },
      select: {
        lineId: true,
        name: true,
        pictureUrl: true,
        firstSeenAt: true,
        lastSeenAt: true,
      },
    }),
  ])
  const linked = new Set(
    linkedRows.map((p) => p.lineId).filter((x): x is string => !!x),
  )
  return allLogins.filter((l) => !linked.has(l.lineId))
}

/**
 * v1.10.0 / PR B — full LineLogin list with the player they're currently
 * linked to (if any). Drives the admin "Remap" dialog where the operator
 * may deliberately pick a currently-linked LINE user and move them to a
 * different player. Newest-first by `lastSeenAt`.
 */
export async function getAllLineLoginsWithLinkedPlayer(): Promise<
  Array<{
    lineId: string
    name: string | null
    pictureUrl: string | null
    firstSeenAt: Date
    lastSeenAt: Date
    // v1.33.0 (PR ε) — `Player.name` is now nullable. Linked-player join
    // surfaces this as `string | null` so admin UIs can render a placeholder
    // for pre-staged-but-not-yet-onboarded players.
    linkedPlayer: { id: string; name: string | null } | null
  }>
> {
  const [allLogins, linkedRows] = await Promise.all([
    prisma.lineLogin.findMany({
      orderBy: { lastSeenAt: 'desc' },
      select: {
        lineId: true,
        name: true,
        pictureUrl: true,
        firstSeenAt: true,
        lastSeenAt: true,
      },
    }),
    prisma.player.findMany({
      where: { lineId: { not: null } },
      select: { id: true, name: true, lineId: true },
    }),
  ])
  const playerByLineId = new Map<string, { id: string; name: string | null }>()
  for (const p of linkedRows) {
    if (p.lineId) playerByLineId.set(p.lineId, { id: p.id, name: p.name })
  }
  return allLogins.map((l) => ({
    ...l,
    linkedPlayer: playerByLineId.get(l.lineId) ?? null,
  }))
}

/**
 * v1.57.0 (PR 4 of route-shortening chain) — every User row in the
 * system, annotated with the auth providers that have signed in for
 * them, the Player they're bound to (if any), and the leagues that
 * Player is currently in.
 *
 * Drives the new `/admin/users` admin list. The list is global (not
 * per-league) because Users are a global concept — one User can play in
 * multiple leagues via a single Player. Filtering by league is a
 * client-side concern in the list component.
 *
 * Cardinality: bounded by the number of distinct sign-in identities
 * across the org. Today: ~32 LINE users + a handful of Google/email
 * users; expected ceiling: a few hundred. Single Prisma query with
 * relation includes is plenty.
 *
 * Provider list is derived from `Account.provider` rows — distinct +
 * sorted for stable display. Login dates come from the corresponding
 * `LineLogin.lastSeenAt` (LINE-specific; the non-LINE providers don't
 * have a parallel login-tracking table — Account row's update doesn't
 * track activity, only the binding moment).
 */
export async function getAllUsersForAdmin(): Promise<
  Array<{
    id: string
    name: string | null
    email: string | null
    image: string | null
    pictureUrl: string | null
    lineId: string | null
    role: 'ADMIN' | 'VIEWER'
    createdAt: string
    providers: string[]
    linkedPlayer: {
      id: string
      name: string | null
      otherLeagues: string[]
    } | null
    lineLastSeenAt: string | null
    idFrontUrl: string | null
    idBackUrl: string | null
    idUploadedAt: string | null
    // v2.2.15 — attestation + reupload-request audit fields. Surfaced
    // on the admin Users list so each row's badges + toggle buttons
    // reflect current state.
    idCollectedExternally: boolean
    idCollectedExternallyAt: string | null
    idCollectedExternallyNotes: string | null
    idReuploadRequested: boolean
    idReuploadRequestedAt: string | null
    idReuploadRequestedNotes: string | null
  }>
> {
  const users = await prisma.user.findMany({
    orderBy: [{ createdAt: 'desc' }],
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      pictureUrl: true,
      lineId: true,
      role: true,
      createdAt: true,
      playerId: true,
      idFrontUrl: true,
      idBackUrl: true,
      idUploadedAt: true,
      idCollectedExternally: true,
      idCollectedExternallyAt: true,
      idCollectedExternallyNotes: true,
      idReuploadRequested: true,
      idReuploadRequestedAt: true,
      idReuploadRequestedNotes: true,
      accounts: { select: { provider: true } },
    },
  })

  // Two parallel side queries to enrich:
  //   - LineLogin.lastSeenAt by lineId (only LINE providers tracked)
  //   - Linked Player + their active league names
  const lineIds = users.map((u) => u.lineId).filter((x): x is string => !!x)
  const playerIds = users.map((u) => u.playerId).filter((x): x is string => !!x)

  const [lineLogins, linkedPlayers] = await Promise.all([
    lineIds.length > 0
      ? prisma.lineLogin.findMany({
          where: { lineId: { in: lineIds } },
          select: { lineId: true, lastSeenAt: true },
        })
      : Promise.resolve([] as Array<{ lineId: string; lastSeenAt: Date }>),
    playerIds.length > 0
      ? prisma.player.findMany({
          where: { id: { in: playerIds } },
          select: {
            id: true,
            name: true,
            leagueAssignments: {
              where: { toGameWeek: null },
              select: {
                leagueTeam: { select: { league: { select: { name: true } } } },
              },
            },
          },
        })
      : Promise.resolve(
          [] as Array<{
            id: string
            name: string | null
            leagueAssignments: Array<{ leagueTeam: { league: { name: string | null } } }>
          }>,
        ),
  ])

  const lastSeenByLineId = new Map<string, Date>()
  for (const ll of lineLogins) {
    lastSeenByLineId.set(ll.lineId, ll.lastSeenAt)
  }
  const playerById = new Map<
    string,
    { id: string; name: string | null; otherLeagues: string[] }
  >()
  for (const p of linkedPlayers) {
    const otherLeagues: string[] = []
    for (const a of p.leagueAssignments) {
      // v1.65.0 — `leagueTeam` is nullable post-membership-spec rework
      // (PENDING-application memberships have no team). Skip such rows
      // here; they're not relevant to the "other leagues" display.
      if (!a.leagueTeam) continue
      const name = a.leagueTeam.league.name
      if (name && !otherLeagues.includes(name)) otherLeagues.push(name)
    }
    playerById.set(p.id, { id: p.id, name: p.name, otherLeagues })
  }

  return users.map((u) => {
    const providers = Array.from(new Set(u.accounts.map((a) => a.provider))).sort()
    const lastSeen = u.lineId ? lastSeenByLineId.get(u.lineId) ?? null : null
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      image: u.image,
      pictureUrl: u.pictureUrl,
      lineId: u.lineId,
      role: u.role,
      createdAt: u.createdAt.toISOString(),
      providers,
      linkedPlayer: u.playerId ? playerById.get(u.playerId) ?? null : null,
      lineLastSeenAt: lastSeen ? lastSeen.toISOString() : null,
      idFrontUrl: u.idFrontUrl,
      idBackUrl: u.idBackUrl,
      idUploadedAt: u.idUploadedAt ? u.idUploadedAt.toISOString() : null,
      idCollectedExternally: u.idCollectedExternally,
      idCollectedExternallyAt: u.idCollectedExternallyAt
        ? u.idCollectedExternallyAt.toISOString()
        : null,
      idCollectedExternallyNotes: u.idCollectedExternallyNotes,
      idReuploadRequested: u.idReuploadRequested,
      idReuploadRequestedAt: u.idReuploadRequestedAt
        ? u.idReuploadRequestedAt.toISOString()
        : null,
      idReuploadRequestedNotes: u.idReuploadRequestedNotes,
    }
  })
}
