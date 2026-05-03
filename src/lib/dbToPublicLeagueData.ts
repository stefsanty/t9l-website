import { prisma } from './prisma'
import { formatJstDate, formatJstTime } from './jst'
import { GUEST_ID, playerIdToSlug, teamIdToSlug } from './ids'
import { resolveDisplayScore } from './matchScore'
import type {
  Team,
  Player,
  Match,
  Matchday,
  Goal,
  LeagueData,
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
  },
  gameWeeks: [],
}

/**
 * Adapter: read a League's data from Postgres via Prisma and reshape into the
 * public `LeagueData` contract — the same shape `parseAllData()` produces
 * from Google Sheets, so consumer components don't have to change.
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
 *    matching what `slugify()` produces in `lib/data.ts`. DB ids carry "t-"/"p-" prefixes.
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

  // ── players[] (via PlayerLeagueAssignment) ───────────────────────────────
  const plas = await prisma.playerLeagueAssignment.findMany({
    where: { leagueTeam: { leagueId: league.id } },
    include: { player: true, leagueTeam: true },
    orderBy: { player: { name: 'asc' } },
  })

  const players: Player[] = []
  for (const pla of plas) {
    if (pla.player.id === GUEST_ID) continue
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
      position: pla.player.position ?? null,
      picture: pla.player.pictureUrl ?? null,
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
    for (const pla of plas) playerToLt.set(pla.playerId, pla.leagueTeamId)

    for (const m of gw.matches) {
      const publicMatchId = publicMatchIdByDbId.get(m.id) ?? ''
      const homeSlug = ltToSlug.get(m.homeTeamId) ?? ''
      const awaySlug = ltToSlug.get(m.awayTeamId) ?? ''
      for (const ev of m.events) {
        const scorerLt = playerToLt.get(ev.scorerId)
        // Skip events whose scorer is not on either match team (data bug;
        // admin should review). Mirrors the structured-warning path in
        // `recomputeMatchScore`.
        if (!scorerLt || (scorerLt !== m.homeTeamId && scorerLt !== m.awayTeamId)) {
          continue
        }
        const isOwnGoal = ev.goalType === 'OWN_GOAL'
        // Beneficiary team (the side the goal counts toward).
        const beneficiaryLt = isOwnGoal
          ? scorerLt === m.homeTeamId
            ? m.awayTeamId
            : m.homeTeamId
          : scorerLt
        const beneficiarySlug = ltToSlug.get(beneficiaryLt) ?? ''
        const concedingSlug = beneficiarySlug === homeSlug ? awaySlug : homeSlug
        goals.push({
          id: ev.id,
          matchId: publicMatchId,
          matchdayId: mdId,
          scoringTeamId: beneficiarySlug,
          concedingTeamId: concedingSlug,
          // v1.33.0 (PR ε) — defensive fallback for nullable Player.name.
          scorer: ev.scorer.name ?? 'TBD',
          assister: ev.assister?.name ?? null,
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

  return {
    data: {
      teams,
      players,
      matchdays,
      goals,
      availability: {},
      availabilityStatuses: {},
      played: {},
    },
    gameWeeks,
  }
}
