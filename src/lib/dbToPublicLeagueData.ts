import { prisma } from './prisma'
import type {
  Team,
  Player,
  Match,
  Matchday,
  Goal,
  PlayerRating,
  LeagueData,
} from '@/types'

const TEAM_ID_PREFIX = 't-'
const PLAYER_ID_PREFIX = 'p-'
const GUEST_ID = 'p-guest'

function stripPrefix(id: string, prefix: string): string {
  return id.startsWith(prefix) ? id.slice(prefix.length) : id
}

function fmtDateJST(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Tokyo',
  }).formatToParts(d)
  const y = parts.find((p) => p.type === 'year')?.value
  const m = parts.find((p) => p.type === 'month')?.value
  const day = parts.find((p) => p.type === 'day')?.value
  return `${y}-${m}-${day}`
}

function fmtTimeJST(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Tokyo',
  }).format(d)
}

const EMPTY_DATA: LeagueData = {
  teams: [],
  players: [],
  matchdays: [],
  goals: [],
  ratings: [],
  availability: {},
  availabilityStatuses: {},
  played: {},
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
 * Notes on contract preservation (regression-prone areas — see CLAUDE.md "Important Notes"):
 *  - Match.kickoff / Match.fullTime are JST "HH:MM" strings, not ISO timestamps.
 *  - Team/Player ids in the public shape are slugs ("mariners-fc", "ian-noseda"),
 *    matching what `slugify()` produces in `lib/data.ts`. DB ids carry "t-"/"p-" prefixes.
 *  - Goal.scorer / Goal.assister are player NAMES (not ids) — stats.ts indexes by name.
 *  - sittingOutTeamId is derived (the team in the league that doesn't appear in any
 *    of this matchday's matches), not stored in DB.
 *  - ratings: [] (paused for the migration; Stats page handles empty gracefully).
 */
export async function dbToPublicLeagueData(): Promise<LeagueData> {
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

  if (!league) return EMPTY_DATA

  // ── teams[] ──────────────────────────────────────────────────────────────
  const teams: Team[] = league.leagueTeams.map((lt) => {
    const slug = stripPrefix(lt.team.id, TEAM_ID_PREFIX)
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
    league.leagueTeams.map((lt) => [lt.id, stripPrefix(lt.team.id, TEAM_ID_PREFIX)]),
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
    const slug = stripPrefix(pla.player.id, PLAYER_ID_PREFIX)
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
    const date = fmtDateJST(gw.startDate)

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
        kickoff: fmtTimeJST(m.playedAt),
        fullTime: m.endedAt ? fmtTimeJST(m.endedAt) : '',
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

  // Per migration plan §2 / S3 — ratings paused, not dropped.
  const ratings: PlayerRating[] = []

  return {
    teams,
    players,
    matchdays,
    goals,
    ratings,
    availability: {},
    availabilityStatuses: {},
    played: {},
  }
}

// Exported for unit tests.
export const __test = { stripPrefix, fmtDateJST, fmtTimeJST }
