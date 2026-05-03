/**
 * v1.42.0 (epic match events PR α) — `recomputeMatchScore` integration with
 * a fake Prisma client. Pins:
 *   1. Reads match (homeTeamId/awayTeamId/gameWeekId).
 *   2. Reads MatchEvent rows for the match (kind=GOAL filter).
 *   3. Reads PlayerLeagueAssignment for both LeagueTeam ids.
 *   4. Builds the player→team lookup (first-assignment-wins).
 *   5. Calls computeScoreFromEvents and writes the result via match.update.
 *   6. Logs a structured warning when an event scorer is unresolved.
 *   7. Never mutates Match.scoreOverride.
 *   8. Returns the cache pair the caller can use without re-querying.
 *   9. Idempotent — re-running on the same data yields the same write.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { recomputeMatchScore } from '@/lib/matchScore'

type Match = {
  id: string
  homeTeamId: string
  awayTeamId: string
  gameWeekId: string
}
type Event = { scorerId: string; goalType: string | null }
type Assignment = { playerId: string; leagueTeamId: string }

function makeFakePrisma(opts: {
  match: Match | null
  events: Event[]
  assignments: Assignment[]
}) {
  const matchUpdate = vi.fn(async ({ where, data }: { where: { id: string }; data: { homeScore: number; awayScore: number } }) => ({
    id: where.id,
    ...data,
  }))
  return {
    match: {
      findUnique: vi.fn(async () => opts.match),
      update: matchUpdate,
    },
    matchEvent: {
      findMany: vi.fn(async ({ where }: { where: { matchId: string; kind: string } }) => {
        // Defensive — assert the caller scopes by kind=GOAL.
        if (where.kind !== 'GOAL') return []
        return opts.events
      }),
    },
    playerLeagueAssignment: {
      findMany: vi.fn(async ({ where }: { where: { leagueTeamId: { in: string[] } } }) => {
        return opts.assignments.filter((a) =>
          where.leagueTeamId.in.includes(a.leagueTeamId),
        )
      }),
    },
    _matchUpdate: matchUpdate,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('recomputeMatchScore', () => {
  it('writes 0-0 when no events exist', async () => {
    const fake = makeFakePrisma({
      match: { id: 'm-1', homeTeamId: 'lt-h', awayTeamId: 'lt-a', gameWeekId: 'gw-1' },
      events: [],
      assignments: [],
    })
    const result = await recomputeMatchScore(fake as never, 'm-1')
    expect(result).toEqual({ home: 0, away: 0 })
    expect(fake._matchUpdate).toHaveBeenCalledWith({
      where: { id: 'm-1' },
      data: { homeScore: 0, awayScore: 0 },
    })
  })

  it('correctly computes home/away from a mix of events including own goal', async () => {
    const fake = makeFakePrisma({
      match: { id: 'm-1', homeTeamId: 'lt-h', awayTeamId: 'lt-a', gameWeekId: 'gw-1' },
      events: [
        { scorerId: 'p-h1', goalType: 'OPEN_PLAY' }, // home + 1
        { scorerId: 'p-h2', goalType: 'PENALTY' }, // home + 1
        { scorerId: 'p-a1', goalType: 'OPEN_PLAY' }, // away + 1
        { scorerId: 'p-h1', goalType: 'OWN_GOAL' }, // away + 1
      ],
      assignments: [
        { playerId: 'p-h1', leagueTeamId: 'lt-h' },
        { playerId: 'p-h2', leagueTeamId: 'lt-h' },
        { playerId: 'p-a1', leagueTeamId: 'lt-a' },
      ],
    })
    const result = await recomputeMatchScore(fake as never, 'm-1')
    expect(result).toEqual({ home: 2, away: 2 })
    expect(fake._matchUpdate).toHaveBeenCalledWith({
      where: { id: 'm-1' },
      data: { homeScore: 2, awayScore: 2 },
    })
  })

  it('logs a structured warning when an event scorer is not on either team', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fake = makeFakePrisma({
      match: { id: 'm-1', homeTeamId: 'lt-h', awayTeamId: 'lt-a', gameWeekId: 'gw-1' },
      events: [
        { scorerId: 'p-real', goalType: 'OPEN_PLAY' },
        { scorerId: 'p-orphan', goalType: 'OPEN_PLAY' },
      ],
      assignments: [{ playerId: 'p-real', leagueTeamId: 'lt-h' }],
    })
    const result = await recomputeMatchScore(fake as never, 'm-1')
    expect(result).toEqual({ home: 1, away: 0 })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatch(/\[v1\.42\.0 SCORE-COMPUTE\]/)
    expect(warn.mock.calls[0][0]).toMatch(/match=m-1/)
    expect(warn.mock.calls[0][0]).toMatch(/unresolved-scorers=1/)
  })

  it('returns 0-0 and does NOT call match.update when the match is not found', async () => {
    const fake = makeFakePrisma({
      match: null,
      events: [],
      assignments: [],
    })
    const result = await recomputeMatchScore(fake as never, 'm-missing')
    expect(result).toEqual({ home: 0, away: 0 })
    expect(fake._matchUpdate).not.toHaveBeenCalled()
  })

  it('does NOT touch Match.scoreOverride during recompute', async () => {
    const fake = makeFakePrisma({
      match: { id: 'm-1', homeTeamId: 'lt-h', awayTeamId: 'lt-a', gameWeekId: 'gw-1' },
      events: [{ scorerId: 'p-h1', goalType: 'OPEN_PLAY' }],
      assignments: [{ playerId: 'p-h1', leagueTeamId: 'lt-h' }],
    })
    await recomputeMatchScore(fake as never, 'm-1')
    const updateCall = fake._matchUpdate.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(updateCall.data).not.toHaveProperty('scoreOverride')
  })

  it('is idempotent — running twice yields the same write', async () => {
    const fake = makeFakePrisma({
      match: { id: 'm-1', homeTeamId: 'lt-h', awayTeamId: 'lt-a', gameWeekId: 'gw-1' },
      events: [
        { scorerId: 'p-h1', goalType: 'OPEN_PLAY' },
        { scorerId: 'p-a1', goalType: 'OPEN_PLAY' },
      ],
      assignments: [
        { playerId: 'p-h1', leagueTeamId: 'lt-h' },
        { playerId: 'p-a1', leagueTeamId: 'lt-a' },
      ],
    })
    const r1 = await recomputeMatchScore(fake as never, 'm-1')
    const r2 = await recomputeMatchScore(fake as never, 'm-1')
    expect(r1).toEqual(r2)
    expect(fake._matchUpdate).toHaveBeenCalledTimes(2)
    const both = fake._matchUpdate.mock.calls.map((c) => (c[0] as { data: unknown }).data)
    expect(both[0]).toEqual(both[1])
  })

  it('only counts the FIRST PlayerLeagueAssignment when a player has multiple', async () => {
    // Defensive — a player who moved teams mid-season has multiple PLA
    // rows. The simple lookup keeps the first assignment seen; future PRs
    // can refine via fromGameWeek/toGameWeek when the score-time matchday
    // is known.
    const fake = makeFakePrisma({
      match: { id: 'm-1', homeTeamId: 'lt-h', awayTeamId: 'lt-a', gameWeekId: 'gw-1' },
      events: [{ scorerId: 'p-mover', goalType: 'OPEN_PLAY' }],
      assignments: [
        { playerId: 'p-mover', leagueTeamId: 'lt-h' }, // first wins
        { playerId: 'p-mover', leagueTeamId: 'lt-a' },
      ],
    })
    const result = await recomputeMatchScore(fake as never, 'm-1')
    expect(result).toEqual({ home: 1, away: 0 })
  })
})
