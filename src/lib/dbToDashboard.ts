import type {
  Team,
  Player,
  Matchday,
  Match,
  Goal,
  Availability,
  AvailabilityStatuses,
  PlayedStatus,
} from '@/types'

// ── Input shape ───────────────────────────────────────────────────────────────
// Mirrors the Prisma `include` used by getPublicLeagueData() in admin-data.ts.
// Kept loose (Date | string for dates) so it survives JSON serialization across
// the server/client boundary.

type DbTeam = { id: string; name: string; logoUrl: string | null }

type DbPlayer = { id: string; name: string; pictureUrl: string | null }

type DbAssignment = {
  player: DbPlayer
  fromGameWeek: number
  toGameWeek: number | null
}

type DbLeagueTeam = {
  id: string
  team: DbTeam
  playerAssignments: DbAssignment[]
}

type DbGoal = {
  id: string
  player: DbPlayer
  scoringTeam: { id: string; teamId: string }
  assist: { player: DbPlayer } | null
}

type DbMatch = {
  id: string
  homeTeam: { id: string; team: DbTeam }
  awayTeam: { id: string; team: DbTeam }
  homeScore: number
  awayScore: number
  status: string
  playedAt: Date | string
  endedAt: Date | string | null
  goals: DbGoal[]
}

type DbGameWeek = {
  id: string
  weekNumber: number
  startDate: Date | string
  endDate: Date | string
  venue: { name: string } | null
  matches: DbMatch[]
}

export type DbPublicLeague = {
  id: string
  name: string
  location: string
  startDate: Date | string
  endDate: Date | string | null
  primaryColor: string | null
  accentColor: string | null
  leagueTeams: DbLeagueTeam[]
  gameWeeks: DbGameWeek[]
}

// ── Adapter ───────────────────────────────────────────────────────────────────
// Converts the Prisma public-league shape into the props Dashboard expects.
// The Dashboard component (and its children — NextMatchdayBanner, RsvpBar,
// MatchdayAvailability) was originally driven by a Google Sheet. We use
// LeagueTeam.id as the unifying team identifier across teams/players/matches/
// goals so the cross-references in Dashboard's data model line up.
//
// Fields the DB schema doesn't yet model degrade to empty defaults:
//   - per-player per-matchday RSVP status (availability / availabilityStatuses)
//   - per-player per-matchday played status
//   - sittingOutTeamId (no team-rotation table yet)
//   - position (not on Player)
// Those features are inert until the schema grows to support them.

const FALLBACK_COLORS = [
  '#0055A4', // blue
  '#FFD700', // yellow
  '#DC143C', // crimson
  '#10b981', // emerald
  '#8b5cf6', // violet
  '#f97316', // orange
  '#06b6d4', // cyan
  '#84cc16', // lime
]

function makeShortName(name: string): string {
  const letters = name.replace(/[^A-Za-z]+/g, ' ').trim().split(/\s+/)
  if (letters.length === 0) return name.slice(0, 3).toUpperCase()
  if (letters.length === 1) return letters[0].slice(0, 3).toUpperCase()
  return letters.map((w) => w[0]).join('').slice(0, 4).toUpperCase()
}

function toIsoDay(d: Date | string | null): string | null {
  if (!d) return null
  const date = typeof d === 'string' ? new Date(d) : d
  if (isNaN(date.getTime())) return null
  // Format in JST to keep parity with the Sheets-backed flow
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Tokyo',
  }).formatToParts(date)
  const y = parts.find((p) => p.type === 'year')?.value
  const m = parts.find((p) => p.type === 'month')?.value
  const day = parts.find((p) => p.type === 'day')?.value
  return y && m && day ? `${y}-${m}-${day}` : null
}

function toJstHm(d: Date | string | null): string {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  if (isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Tokyo',
  }).formatToParts(date)
  const h = parts.find((p) => p.type === 'hour')?.value
  const m = parts.find((p) => p.type === 'minute')?.value
  return h && m ? `${h}:${m}` : ''
}

export type DashboardProps = {
  teams: Team[]
  players: Player[]
  matchdays: Matchday[]
  goals: Goal[]
  availability: Availability
  availabilityStatuses: AvailabilityStatuses
  played: PlayedStatus
}

export function dbToDashboard(league: DbPublicLeague): DashboardProps {
  // Teams — keyed by LeagueTeam.id
  const teams: Team[] = league.leagueTeams.map((lt, i) => ({
    id: lt.id,
    name: lt.team.name,
    shortName: makeShortName(lt.team.name),
    color: FALLBACK_COLORS[i % FALLBACK_COLORS.length],
    logo: lt.team.logoUrl,
  }))

  // Players — one entry per active assignment (toGameWeek === null). When a
  // player has been transferred we keep only the latest assignment so the flat
  // teamId on Player resolves to their current team.
  const playerMap = new Map<string, Player>()
  for (const lt of league.leagueTeams) {
    for (const pa of lt.playerAssignments) {
      if (pa.toGameWeek !== null) continue
      const existing = playerMap.get(pa.player.id)
      if (existing && existing.teamId !== lt.id) continue
      playerMap.set(pa.player.id, {
        id: pa.player.id,
        name: pa.player.name,
        teamId: lt.id,
        position: null,
        picture: pa.player.pictureUrl,
      })
    }
  }
  const players: Player[] = [...playerMap.values()]

  // Matchdays + matches
  const matchdays: Matchday[] = league.gameWeeks.map((gw) => {
    const matches: Match[] = gw.matches.map((m, idx) => {
      const isCompleted = m.status === 'COMPLETED'
      return {
        id: m.id,
        matchNumber: idx + 1,
        kickoff: toJstHm(m.playedAt),
        fullTime: toJstHm(m.endedAt),
        homeTeamId: m.homeTeam.id,
        awayTeamId: m.awayTeam.id,
        homeGoals: isCompleted ? m.homeScore : null,
        awayGoals: isCompleted ? m.awayScore : null,
      }
    })

    return {
      id: `md${gw.weekNumber}`,
      label: `MD${gw.weekNumber}`,
      date: toIsoDay(gw.startDate),
      venueName: gw.venue?.name,
      matches,
      sittingOutTeamId: '', // unmodeled — left empty
    }
  })

  // Goals — flatten across gameWeeks/matches. concedingTeamId is derived from
  // the match's home/away pair.
  const goals: Goal[] = []
  for (const gw of league.gameWeeks) {
    const matchdayId = `md${gw.weekNumber}`
    for (const m of gw.matches) {
      for (const g of m.goals) {
        const scoringId = g.scoringTeam.id
        const concedingId = scoringId === m.homeTeam.id ? m.awayTeam.id : m.homeTeam.id
        goals.push({
          id: g.id,
          matchId: m.id,
          matchdayId,
          scoringTeamId: scoringId,
          concedingTeamId: concedingId,
          scorer: g.player?.name ?? 'Unknown',
          assister: g.assist?.player?.name ?? null,
        })
      }
    }
  }

  return {
    teams,
    players,
    matchdays,
    goals,
    availability: {},
    availabilityStatuses: {},
    played: {},
  }
}
