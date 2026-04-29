import { prisma } from './prisma'
import { formatJstDate, formatJstTime } from './jst'
import { GUEST_ID, playerIdToSlug, teamIdToSlug } from './ids'
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
  startDate: Date
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
 * Adapter: read the Default League's data from Postgres via Prisma and reshape
 * into the public `LeagueData` contract — the same shape `parseAllData()`
 * produces from Google Sheets, so consumer components don't have to change.
 *
 * Selects the single league flagged `isDefault: true` (T9L 2026 Spring on prod).
 * If no default league exists, returns empty data.
 *
 * Per CLAUDE.md "Sheets→DB migration", PR 2 plumbs this in but defaults
 * `dataSource='sheets'`; only PR 4 flips reads to use this.
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
export async function dbToPublicLeagueData(): Promise<DbToPublicLeagueDataResult> {
  const league = await prisma.league.findFirst({
    where: { isDefault: true },
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
              goals: {
                include: {
                  player: true,
                  scoringTeam: { include: { team: true } },
                  assist: { include: { player: true } },
                },
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
      name: pla.player.name,
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
    const date = formatJstDate(gw.startDate)

    // Sitting-out team: the league team not appearing as home/away this MD
    const playingLtIds = new Set<string>()
    for (const m of gw.matches) {
      playingLtIds.add(m.homeTeamId)
      playingLtIds.add(m.awayTeamId)
    }
    const sittingOutLt = league.leagueTeams.find((lt) => !playingLtIds.has(lt.id))
    const sittingOutTeamId = sittingOutLt ? (ltToSlug.get(sittingOutLt.id) ?? '') : ''

    // matches: ordered by playedAt asc; matchNumber = 1-based index
    const publicMatchIdByDbId = new Map<string, string>()
    const matches: Match[] = gw.matches.map((m, idx) => {
      const publicId = `${mdId}-m${idx + 1}`
      publicMatchIdByDbId.set(m.id, publicId)
      const homeTeamId = ltToSlug.get(m.homeTeamId) ?? ''
      const awayTeamId = ltToSlug.get(m.awayTeamId) ?? ''
      const isPlayed = m.status === 'COMPLETED' || m.goals.length > 0
      return {
        id: publicId,
        matchNumber: idx + 1,
        kickoff: formatJstTime(m.playedAt),
        fullTime: m.endedAt ? formatJstTime(m.endedAt) : '',
        homeTeamId,
        awayTeamId,
        homeGoals: isPlayed ? m.homeScore : null,
        awayGoals: isPlayed ? m.awayScore : null,
      }
    })

    // goals: scoringTeamId is a public slug; concedingTeamId is the OTHER team
    // in the match (DB doesn't store it). scorer/assister are NAMES, not ids.
    for (const m of gw.matches) {
      const publicMatchId = publicMatchIdByDbId.get(m.id) ?? ''
      const homeSlug = ltToSlug.get(m.homeTeamId) ?? ''
      const awaySlug = ltToSlug.get(m.awayTeamId) ?? ''
      for (const g of m.goals) {
        const scoringSlug = ltToSlug.get(g.scoringTeamId) ?? ''
        const concedingSlug = scoringSlug === homeSlug ? awaySlug : homeSlug
        goals.push({
          id: g.id,
          matchId: publicMatchId,
          matchdayId: mdId,
          scoringTeamId: scoringSlug,
          concedingTeamId: concedingSlug,
          scorer: g.player.name,
          assister: g.assist?.player?.name ?? null,
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
