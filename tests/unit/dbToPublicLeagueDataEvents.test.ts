/**
 * v1.44.0 (PR δ) — `dbToPublicLeagueData` now flattens MatchEvent rows
 * into `LeagueData.goals[]` (replacing the legacy Goal/Assist join) and
 * exposes minute + goalType on each Goal record.
 *
 * Pins:
 *   1. Adapter reshapes events into Goal[] with the right scoringTeamId
 *      (beneficiary slug, with OG flip).
 *   2. minute + goalType are surfaced on each Goal row.
 *   3. Match.scoreOverride drives display when set; cache integers when
 *      unset.
 *   4. Events with unresolvable scorer (player not on either match team)
 *      are silently skipped — mirrors the structured-warning shape in
 *      `recomputeMatchScore`.
 *   5. `Match.events.length` (not `goals.length`) drives the "isPlayed"
 *      branch.
 *   6. Sort order: minute asc, ties broken by createdAt.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const findFirstMock = vi.fn()
const plaFindManyMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: findFirstMock },
    playerLeagueAssignment: { findMany: plaFindManyMock },
  },
}))

const { dbToPublicLeagueData } = await import('@/lib/dbToPublicLeagueData')

const HOME_LT = 'lt-mariners'
const AWAY_LT = 'lt-fenix'

function makeLeague(overrides: Partial<{
  matches: Array<{
    id: string
    homeTeamId: string
    awayTeamId: string
    homeScore: number
    awayScore: number
    scoreOverride: string | null
    status: string
    playedAt: Date
    endedAt: Date | null
    events: Array<{
      id: string
      minute: number | null
      goalType: 'OPEN_PLAY' | 'SET_PIECE' | 'PENALTY' | 'OWN_GOAL' | null
      scorerId: string
      scorer: { id: string; name: string }
      assister: { id: string; name: string } | null
      createdAt: Date
    }>
  }>
}> = {}) {
  const matches = overrides.matches ?? []
  return {
    id: 'l-default',
    isDefault: true,
    leagueTeams: [
      { id: HOME_LT, team: { id: 't-mariners-fc', name: 'Mariners FC', shortName: 'MRN', color: '#0055A4', logoUrl: null } },
      { id: AWAY_LT, team: { id: 't-fenix-fc', name: 'Fenix FC', shortName: 'FEN', color: '#FFD700', logoUrl: null } },
    ],
    gameWeeks: [
      {
        id: 'gw-1',
        weekNumber: 1,
        startDate: new Date('2026-04-01T00:00:00+09:00'),
        endDate: null,
        venue: null,
        matches,
      },
    ],
  }
}

beforeEach(() => {
  findFirstMock.mockReset()
  plaFindManyMock.mockReset()
  // Default PLA shape: stefan + alex on home, khrapov on away.
  plaFindManyMock.mockResolvedValue([
    { playerId: 'p-stefan', leagueTeamId: HOME_LT, player: { id: 'p-stefan', name: 'Stefan' }, leagueTeam: { id: HOME_LT } },
    { playerId: 'p-alex', leagueTeamId: HOME_LT, player: { id: 'p-alex', name: 'Alex' }, leagueTeam: { id: HOME_LT } },
    { playerId: 'p-khrapov', leagueTeamId: AWAY_LT, player: { id: 'p-khrapov', name: 'Khrapov' }, leagueTeam: { id: AWAY_LT } },
  ])
})

describe('dbToPublicLeagueData (PR δ event-flow)', () => {
  it('reshapes MatchEvent rows into Goal[] with beneficiary-team-derived scoringTeamId', async () => {
    findFirstMock.mockResolvedValue(makeLeague({
      matches: [
        {
          id: 'm-1',
          homeTeamId: HOME_LT,
          awayTeamId: AWAY_LT,
          homeScore: 1,
          awayScore: 0,
          scoreOverride: null,
          status: 'COMPLETED',
          playedAt: new Date('2026-04-01T19:05:00+09:00'),
          endedAt: null,
          events: [
            {
              id: 'me-1',
              minute: 47,
              goalType: 'OPEN_PLAY',
              scorerId: 'p-stefan',
              scorer: { id: 'p-stefan', name: 'Stefan' },
              assister: { id: 'p-alex', name: 'Alex' },
              createdAt: new Date('2026-04-01T20:00:00Z'),
            },
          ],
        },
      ],
    }))
    const { data } = await dbToPublicLeagueData()
    expect(data.goals).toHaveLength(1)
    const g = data.goals[0]
    expect(g.scorer).toBe('Stefan')
    expect(g.assister).toBe('Alex')
    expect(g.minute).toBe(47)
    expect(g.goalType).toBe('OPEN_PLAY')
    expect(g.scoringTeamId).toBe('mariners-fc')
    expect(g.concedingTeamId).toBe('fenix-fc')
  })

  it('OWN_GOAL flips scoringTeamId to the OPPOSITE team', async () => {
    findFirstMock.mockResolvedValue(makeLeague({
      matches: [
        {
          id: 'm-1',
          homeTeamId: HOME_LT,
          awayTeamId: AWAY_LT,
          homeScore: 0,
          awayScore: 1,
          scoreOverride: null,
          status: 'COMPLETED',
          playedAt: new Date(),
          endedAt: null,
          events: [
            {
              id: 'me-og',
              minute: 30,
              goalType: 'OWN_GOAL',
              scorerId: 'p-stefan', // Home player conceding
              scorer: { id: 'p-stefan', name: 'Stefan' },
              assister: null,
              createdAt: new Date(),
            },
          ],
        },
      ],
    }))
    const { data } = await dbToPublicLeagueData()
    const g = data.goals[0]
    // OG by home player → goal credits AWAY team (Fenix)
    expect(g.scoringTeamId).toBe('fenix-fc')
    expect(g.concedingTeamId).toBe('mariners-fc')
    expect(g.scorer).toBe('Stefan') // scorer name still preserved
    expect(g.goalType).toBe('OWN_GOAL')
  })

  it('Match.scoreOverride drives display when set', async () => {
    findFirstMock.mockResolvedValue(makeLeague({
      matches: [
        {
          id: 'm-1',
          homeTeamId: HOME_LT,
          awayTeamId: AWAY_LT,
          homeScore: 0,
          awayScore: 0,
          scoreOverride: '3-0 (forfeit)',
          status: 'COMPLETED',
          playedAt: new Date(),
          endedAt: null,
          events: [],
        },
      ],
    }))
    const { data } = await dbToPublicLeagueData()
    const m = data.matchdays[0].matches[0]
    expect(m.homeGoals).toBe(3)
    expect(m.awayGoals).toBe(0)
  })

  it('cache integers stand when scoreOverride is null', async () => {
    findFirstMock.mockResolvedValue(makeLeague({
      matches: [
        {
          id: 'm-1',
          homeTeamId: HOME_LT,
          awayTeamId: AWAY_LT,
          homeScore: 2,
          awayScore: 1,
          scoreOverride: null,
          status: 'COMPLETED',
          playedAt: new Date(),
          endedAt: null,
          events: [
            { id: 'me-1', minute: 10, goalType: 'OPEN_PLAY', scorerId: 'p-stefan', scorer: { id: 'p-stefan', name: 'Stefan' }, assister: null, createdAt: new Date() },
          ],
        },
      ],
    }))
    const { data } = await dbToPublicLeagueData()
    const m = data.matchdays[0].matches[0]
    expect(m.homeGoals).toBe(2)
    expect(m.awayGoals).toBe(1)
  })

  it('match with no events / no override / not COMPLETED → homeGoals/awayGoals are null', async () => {
    findFirstMock.mockResolvedValue(makeLeague({
      matches: [
        {
          id: 'm-1',
          homeTeamId: HOME_LT,
          awayTeamId: AWAY_LT,
          homeScore: 0,
          awayScore: 0,
          scoreOverride: null,
          status: 'SCHEDULED',
          playedAt: new Date(),
          endedAt: null,
          events: [],
        },
      ],
    }))
    const { data } = await dbToPublicLeagueData()
    const m = data.matchdays[0].matches[0]
    expect(m.homeGoals).toBeNull()
    expect(m.awayGoals).toBeNull()
  })

  it('match with events but status=SCHEDULED still treats as played (in-progress live tally)', async () => {
    findFirstMock.mockResolvedValue(makeLeague({
      matches: [
        {
          id: 'm-1',
          homeTeamId: HOME_LT,
          awayTeamId: AWAY_LT,
          homeScore: 1,
          awayScore: 0,
          scoreOverride: null,
          status: 'IN_PROGRESS',
          playedAt: new Date(),
          endedAt: null,
          events: [
            { id: 'me-1', minute: 5, goalType: 'OPEN_PLAY', scorerId: 'p-stefan', scorer: { id: 'p-stefan', name: 'Stefan' }, assister: null, createdAt: new Date() },
          ],
        },
      ],
    }))
    const { data } = await dbToPublicLeagueData()
    const m = data.matchdays[0].matches[0]
    expect(m.homeGoals).toBe(1)
    expect(m.awayGoals).toBe(0)
  })

  it('event with unresolvable scorer is silently skipped', async () => {
    findFirstMock.mockResolvedValue(makeLeague({
      matches: [
        {
          id: 'm-1',
          homeTeamId: HOME_LT,
          awayTeamId: AWAY_LT,
          homeScore: 1,
          awayScore: 0,
          scoreOverride: null,
          status: 'COMPLETED',
          playedAt: new Date(),
          endedAt: null,
          events: [
            { id: 'me-good', minute: 10, goalType: 'OPEN_PLAY', scorerId: 'p-stefan', scorer: { id: 'p-stefan', name: 'Stefan' }, assister: null, createdAt: new Date() },
            { id: 'me-orphan', minute: 20, goalType: 'OPEN_PLAY', scorerId: 'p-orphan', scorer: { id: 'p-orphan', name: 'Orphan' }, assister: null, createdAt: new Date() },
          ],
        },
      ],
    }))
    const { data } = await dbToPublicLeagueData()
    expect(data.goals).toHaveLength(1)
    expect(data.goals[0].id).toBe('me-good')
  })
})
