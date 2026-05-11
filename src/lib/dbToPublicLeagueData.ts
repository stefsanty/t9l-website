import { prisma } from './prisma'
import { formatJstDate, formatJstTime } from './jst'
import { PLAYER_ID_PREFIX, playerIdToSlug, teamIdToSlug } from './ids'
import { resolveDisplayScore } from './matchScore'

// v1.88.0 — Guest pseudo-players seeded by the v1.46.x Sheets backfill
// have ids `p-guest` (legacy single) or `p-guest-<lt-id>` (per-team).
// They are no longer rostered post-v1.88.0; events that referenced
// them have been migrated to `isGuestScorer=true`. Filter them out of
// any public read until `scripts/v188CleanupGuestPseudoPlayers.ts`
// runs and removes the rows entirely.
function isGuestPseudoPlayerId(id: string): boolean {
  return id.startsWith(`${PLAYER_ID_PREFIX}guest`)
}
import type {
  Team,
  Player,
  Match,
  Matchday,
  Goal,
  LeagueData,
  MatchdayGuestCounts,
} from '@/types'

/**
 * Internal metadata co-cached with the public LeagueData blob: the DB-side
 * GameWeek list (id + weekNumber + startDate) the RSVP merge in
 * `lib/publicData.ts#getRsvpData` needs. Co-cached here rather than via a
 * separate `getDefaultLeagueGameWeeks` query so the two reads share a single
 * Prisma round-trip. v1.14.0 dedupe.
 */
export type GameWeekMeta = {
  id: string
  weekNumber: number
  startDate: Date | null
}

export type DbToPublicLeagueDataResult = {
  data: LeagueData
  gameWeeks: GameWeekMeta[]
}

const EMPTY_RESULT: DbToPublicLeagueDataResult = {
  data: {
    teams: [],
    players: [],
    matchdays: [],
    goals: [],
    availability: {},
    availabilityStatuses: {},
    played: {},
    guestCounts: {},
  },
  gameWeeks: [],
}

/**
 * Adapter: read a League's data from Postgres via Prisma and reshape into the
 * public `LeagueData` contract that consumer components expect.
 *
 * v1.23.0 — accepts optional `leagueId`. When supplied, fetches that specific
 * league. When omitted, falls back to the league flagged `isDefault: true`
 * (T9L 2026 Spring on prod) — preserves pre-v1.23.0 behavior.
 * If neither match is found, returns empty data.
 *
 * v1.7.0 — Static fields only. The returned `availability`,
 * `availabilityStatuses`, and `played` are always empty objects; the live
 * RSVP signals are merged in from Redis at the dispatcher in
 * `lib/publicData.ts#getPublicLeagueData`. Consumers see the same shape;
 * the construction path is split.
 *
 * v1.14.0 — Returns `{ data, gameWeeks }`. The GameWeek list metadata is the
 * bridge between Redis (keys by `gameWeekId`) and the public matchday id
 * shape (`md<weekNumber>`); co-cached here so the RSVP merge doesn't need a
 * separate Prisma query (`getDefaultLeagueGameWeeks` was deleted in v1.14.0).
 *
 * Notes on contract preservation (regression-prone areas — see CLAUDE.md "Important Notes"):
 *  - Match.kickoff / Match.fullTime are JST "HH:MM" strings, not ISO timestamps.
 *  - Team/Player ids in the public shape are slugs ("mariners-fc", "ian-noseda"),
 *    matching what `slugify()` produces in `lib/data.ts` (and the slug helpers in `lib/ids.ts`).
 *    DB ids carry "t-"/"p-" prefixes.
 *  - Goal.scorer / Goal.assister are player NAMES (not ids) — stats.ts indexes by name.
 *  - sittingOutTeamId is derived (the team in the league that doesn't appear in any
 *    of this matchday's matches), not stored in DB.
 */
export async function dbToPublicLeagueData(
  leagueId?: string,
): Promise<DbToPublicLeagueDataResult> {
  const league = await prisma.league.findFirst({
    where: leagueId ? { id: leagueId } : { isDefault: true },
    include: {
      leagueTeams: {
        include: { team: true },
      },
      gameWeeks: {
        include: {
          venue: true,
          matches: {
            include: {
              homeTeam: { include: { team: true } },
              awayTeam: { include: { team: true } },
              // v1.44.0 (PR δ) — public reads compute scoreline from
              // MatchEvent rows. The ordering matches PR γ's admin
              // editor sort: minute asc (nulls last), then createdAt
              // asc to keep co-temporal events stable.
              events: {
                include: {
                  scorer: true,
                  assister: true,
                },
                orderBy: [{ minute: 'asc' }, { createdAt: 'asc' }],
              },
            },
            orderBy: { playedAt: 'asc' },
          },
          // v1.7.0: availability dropped — sourced from Redis at dispatch time.
        },
        orderBy: { weekNumber: 'asc' },
      },
    },
  })

  if (!league) return EMPTY_RESULT

  // ── teams[] ──────────────────────────────────────────────────────────────
  const teams: Team[] = league.leagueTeams.map((lt) => {
    const slug = teamIdToSlug(lt.team.id)
    return {
      id: slug,
      name: lt.team.name,
      shortName: lt.team.shortName ?? slug.slice(0, 3).toUpperCase(),
      color: lt.team.color ?? '#888888',
      logo: lt.team.logoUrl ?? null,
    }
  })

  // LeagueTeam.id → public team slug (e.g. 'lt-...' → 'mariners-fc')
  const ltToSlug = new Map<string, string>(
    league.leagueTeams.map((lt) => [lt.id, teamIdToSlug(lt.team.id)]),
  )

  // ── players[] (via PlayerLeagueMembership) ───────────────────────────────
  // v1.65.0 — only fetch APPROVED memberships with a real team assignment.
  // PENDING-application memberships (no team yet) are not roster members
  // and must not appear in the public Squad list. The leagueTeam.leagueId
  // filter implicitly skips null-leagueTeam rows (no FK to filter on).
  const plas = await prisma.playerLeagueMembership.findMany({
    where: { leagueTeam: { leagueId: league.id } },
    include: { player: true, leagueTeam: true },
    orderBy: { player: { name: 'asc' } },
  })

  // v1.92.0 — pull the linked User.image for the list-view avatar pill
  // in MatchdayAvailability. NextAuth writes `User.image` from the
  // OAuth profile (Google / LINE); this becomes the source-of-truth
  // avatar for any auth-linked Player. There is no `@relation` field
  // from Player → User in the schema (only the `userId String? @unique`
  // column), so we do a separate User lookup keyed by playerId.userId
  // and merge by Map. One extra round-trip; small bounded fanout.
  const userIds = Array.from(
    new Set(
      plas
        .map((pla) => pla.player.userId)
        .filter((id): id is string => typeof id === 'string'),
    ),
  )
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, image: true },
      })
    : []
  const userImageByUserId = new Map<string, string | null>(
    users.map((u) => [u.id, u.image ?? null]),
  )

  const players: Player[] = []
  for (const pla of plas) {
    // v1.88.0 — covers both the legacy single `p-guest` and the
    // per-team `p-guest-<lt-id>` ids; pre-v1.88.0 the GUEST_ID
    // exact-equals filter only matched the legacy single.
    if (isGuestPseudoPlayerId(pla.player.id)) continue
    // v1.65.0 — defensive: leagueTeamId is nullable post-rework. The
    // outer where-filter restricts to leagueTeam.leagueId, which already
    // excludes null-leagueTeam rows, but TS can't narrow that.
    if (pla.leagueTeamId === null) continue
    const slug = playerIdToSlug(pla.player.id)
    const teamSlug = ltToSlug.get(pla.leagueTeamId) ?? ''
    players.push({
      id: slug,
      // v1.33.0 (PR ε) — `Player.name` is now nullable so admins can pre-stage
      // a slot before the user fills onboarding. Public renderers expect a
      // string (regrettable widening would ripple across 30+ components), so
      // we fall back to "TBD" mirroring the v1.31 empty-matchday convention.
      name: pla.player.name ?? 'TBD',
      teamId: teamSlug,
      // v1.65.4 — position lives on PlayerLeagueMembership, not Player.
      // v1.82.0 — prefer the multi-position positions[] array, joined
      // with `/` so existing readers (SquadList chip, formation
      // grouping) handle the multi-position case as a single string
      // (e.g. `"CB/CM"`). Falls through to the legacy single column
      // for memberships that haven't been re-saved since the migration.
      position:
        pla.positions && pla.positions.length > 0
          ? pla.positions.join('/')
          : (pla.position ?? null),
      // v1.86.0 — expose split preferred/secondary so FormationPitch can
      // pass them directly into AssignmentInput without re-parsing position.
      preferredPositions: (pla.preferredPositions ?? []).length > 0
        ? [...pla.preferredPositions]
        : undefined,
      secondaryPositions: (pla.secondaryPositions ?? []).length > 0
        ? [...pla.secondaryPositions]
        : undefined,
      picture: pla.player.pictureUrl ?? null,
      // v1.92.0 — NextAuth User.image (Google avatar / LINE picture).
      // Threaded through so the MatchdayAvailability list-view pill can
      // render the current auth-provider avatar.
      image: pla.player.userId
        ? (userImageByUserId.get(pla.player.userId) ?? null)
        : null,
      // v1.87.0 — per-league retirement marker. SquadList sorts retired
      // players to the bottom of their team and greys them out;
      // MatchdayAvailability filters them out of upcoming goingIds.
      retiredAt: pla.retiredAt ? pla.retiredAt.toISOString() : null,
    })
  }

  // ── matchdays[] + goals[] ────────────────────────────────────────────────
  const matchdays: Matchday[] = []
  const goals: Goal[] = []

  for (const gw of league.gameWeeks) {
    const mdId = `md${gw.weekNumber}`
    const mdLabel = `MD${gw.weekNumber}`
    // v1.31.0 — `gw.startDate` is nullable (admin can clear via the
    // schedule-tab pill). Public-side Matchday.date is `string | null`;
    // MatchdayCard renders "TBD" on null.
    const date = gw.startDate ? formatJstDate(gw.startDate) : null

    // Sitting-out team: the league team not appearing as home/away this MD
    const playingLtIds = new Set<string>()
    for (const m of gw.matches) {
      playingLtIds.add(m.homeTeamId)
      playingLtIds.add(m.awayTeamId)
    }
    const sittingOutLt = league.leagueTeams.find((lt) => !playingLtIds.has(lt.id))
    const sittingOutTeamId = sittingOutLt ? (ltToSlug.get(sittingOutLt.id) ?? '') : ''

    // v1.44.0 (PR δ) — matches[] now reads from MatchEvent rows. The
    // existing `m.homeScore`/`m.awayScore` Int columns are the cache
    // populated by recomputeMatchScore on every event mutation; we use
    // them as-is unless `m.scoreOverride` is set, in which case the
    // override drives display via resolveDisplayScore.
    const publicMatchIdByDbId = new Map<string, string>()
    const matches: Match[] = gw.matches.map((m, idx) => {
      const publicId = `${mdId}-m${idx + 1}`
      publicMatchIdByDbId.set(m.id, publicId)
      const homeTeamId = ltToSlug.get(m.homeTeamId) ?? ''
      const awayTeamId = ltToSlug.get(m.awayTeamId) ?? ''
      const display = resolveDisplayScore({
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        scoreOverride: m.scoreOverride,
      })
      // "Is played" — match is treated as played if it has any events,
      // an explicit override, or status=COMPLETED. Same semantic the
      // pre-δ code carried via `m.status === 'COMPLETED' || m.goals.length > 0`.
      const isPlayed =
        m.status === 'COMPLETED' || m.events.length > 0 || m.scoreOverride !== null
      return {
        id: publicId,
        matchNumber: idx + 1,
        kickoff: formatJstTime(m.playedAt),
        fullTime: m.endedAt ? formatJstTime(m.endedAt) : '',
        homeTeamId,
        awayTeamId,
        homeGoals: isPlayed ? display.home : null,
        awayGoals: isPlayed ? display.away : null,
      }
    })

    // v1.44.0 (PR δ) — goals[] derives from MatchEvent rows. The legacy
    // `Goal.scoringTeamId` was a stored column; in the event model we
    // resolve the scorer's team via `playerToLt` (built once per call
    // from the league's PLA fetch) and flip on OWN_GOAL — same logic
    // as `computeScoreFromEvents` in `lib/matchScore.ts`.
    const playerToLt = new Map<string, string>()
    for (const pla of plas) {
      // v1.65.0 — only members with a leagueTeam contribute. PENDING
      // applicants (null leagueTeamId) cannot have scored a goal.
      if (pla.leagueTeamId === null) continue
      // v1.88.0 — guest pseudo-players (pre-cleanup) shouldn't
      // contribute to score derivation; guest events use
      // beneficiaryTeamId directly.
      if (isGuestPseudoPlayerId(pla.playerId)) continue
      playerToLt.set(pla.playerId, pla.leagueTeamId)
    }

    for (const m of gw.matches) {
      const publicMatchId = publicMatchIdByDbId.get(m.id) ?? ''
      const homeSlug = ltToSlug.get(m.homeTeamId) ?? ''
      const awaySlug = ltToSlug.get(m.awayTeamId) ?? ''
      for (const ev of m.events) {
        // v1.88.0 — beneficiary team resolution.
        // Guest events (`isGuestScorer=true` → scorerId=null) always
        // have `beneficiaryTeamId` set at write time; trust it
        // directly. Real-scorer events derive via the playerToLt
        // lookup, flipping for OG (matches `computeScoreFromEvents`).
        let beneficiaryLt: string | null = null
        if (ev.isGuestScorer || !ev.scorerId) {
          if (
            ev.beneficiaryTeamId &&
            (ev.beneficiaryTeamId === m.homeTeamId || ev.beneficiaryTeamId === m.awayTeamId)
          ) {
            beneficiaryLt = ev.beneficiaryTeamId
          }
        } else {
          const scorerLt = playerToLt.get(ev.scorerId)
          if (!scorerLt || (scorerLt !== m.homeTeamId && scorerLt !== m.awayTeamId)) {
            // Skip events whose scorer is not on either match team
            // (data bug; admin should review).
            continue
          }
          const isOwnGoal = ev.goalType === 'OWN_GOAL'
          beneficiaryLt = isOwnGoal
            ? scorerLt === m.homeTeamId
              ? m.awayTeamId
              : m.homeTeamId
            : scorerLt
        }
        if (!beneficiaryLt) continue
        const beneficiarySlug = ltToSlug.get(beneficiaryLt) ?? ''
        const concedingSlug = beneficiarySlug === homeSlug ? awaySlug : homeSlug
        // v1.88.0 — guest scorer renders as "Guest"; guest assister
        // renders as "Guest" too. Real-scorer events keep the existing
        // ev.scorer.name fallback. Player relation is now nullable.
        const scorerLabel = ev.isGuestScorer
          ? 'Guest'
          : (ev.scorer?.name ?? 'TBD')
        const assisterLabel = ev.isGuestAssister
          ? 'Guest'
          : (ev.assister?.name ?? null)
        goals.push({
          id: ev.id,
          matchId: publicMatchId,
          matchdayId: mdId,
          scoringTeamId: beneficiarySlug,
          concedingTeamId: concedingSlug,
          scorer: scorerLabel,
          assister: assisterLabel,
          minute: ev.minute,
          goalType: ev.goalType,
        })
      }
    }

    matchdays.push({
      id: mdId,
      label: mdLabel,
      date,
      venueName: gw.venue?.name,
      venueUrl: gw.venue?.url ?? undefined,
      venueCourtSize: gw.venue?.courtSize ?? undefined,
      matches,
      sittingOutTeamId,
    })
  }

  // v1.7.0: availability/availabilityStatuses/played are merged in by
  // `lib/publicData.ts#getPublicLeagueData` from the Redis rsvpStore.

  // v1.14.0 — co-cache the DB-side GameWeek metadata so the RSVP merge can
  // read it from the same Prisma round-trip rather than re-querying.
  const gameWeeks: GameWeekMeta[] = league.gameWeeks.map((gw) => ({
    id: gw.id,
    weekNumber: gw.weekNumber,
    startDate: gw.startDate,
  }))

  // v1.91.0 — Add Guests feature. Per-(matchday, team) external/league
  // guest counts. One round-trip indexed by gameWeekId; only this league's
  // game weeks are fetched.
  const gwIdToMdId = new Map<string, string>(
    league.gameWeeks.map((gw) => [gw.id, `md${gw.weekNumber}`]),
  )
  const guestCounts: MatchdayGuestCounts = {}
  if (league.gameWeeks.length > 0) {
    const guestRows = await prisma.matchdayGuestEntry.findMany({
      where: { gameWeekId: { in: league.gameWeeks.map((gw) => gw.id) } },
      select: {
        gameWeekId: true,
        leagueTeamId: true,
        externalCount: true,
        leagueCount: true,
      },
    })
    for (const row of guestRows) {
      const mdId = gwIdToMdId.get(row.gameWeekId)
      const teamSlug = ltToSlug.get(row.leagueTeamId)
      if (!mdId || !teamSlug) continue
      if (row.externalCount === 0 && row.leagueCount === 0) continue
      if (!guestCounts[mdId]) guestCounts[mdId] = {}
      guestCounts[mdId][teamSlug] = {
        externalCount: row.externalCount,
        leagueCount: row.leagueCount,
      }
    }
  }

  return {
    data: {
      teams,
      players,
      matchdays,
      goals,
      availability: {},
      availabilityStatuses: {},
      played: {},
      guestCounts,
    },
    gameWeeks,
  }
}
