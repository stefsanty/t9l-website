import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * v1.26.0 — `getPlayerMappingFromDb(lineId, leagueId?)` resolves the
 * per-league `PlayerLeagueAssignment` for the supplied league.
 *
 * Pre-v1.26.0 (v1.5.0 shape) the function picked the first open assignment
 * regardless of league, which was non-deterministic when a player was
 * assigned in 2+ leagues simultaneously — the JWT callback would surface
 * one league's teamId on a different league's host. v1.26.0 makes the
 * choice deterministic by accepting an explicit league context.
 *
 * The legacy "first open assignment, league-blind" behavior is preserved
 * when `leagueId` is omitted, which is only used by admin write paths
 * that don't operate within a single league context.
 *
 * Pinned contracts:
 *   - With leagueId, returns the assignment in THAT league
 *   - With leagueId, falls back to past (closed) assignment in the same
 *     league before giving up
 *   - With leagueId, returns teamId="" when player exists globally but
 *     has no assignment in this league
 *   - With leagueId, never crosses leagues (regression target — pre-v1.26
 *     would happily return the team from league X when asked about Y)
 *   - Without leagueId, returns the first open assignment (legacy)
 */

const { findUniqueMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    player: {
      findUnique: findUniqueMock,
    },
  },
}))

vi.mock('@/lib/playerMappingStore', () => ({
  getMapping: vi.fn(),
  setMapping: vi.fn(),
}))

import { getPlayerMappingFromDb } from '@/lib/auth'

const LEAGUE_DEFAULT = 'l-default'
const LEAGUE_TAMACHI = 'l-tamachi'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getPlayerMappingFromDb — v1.26.0 per-league resolution', () => {
  it('with leagueId, returns the OPEN assignment in that league', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'p-ian-noseda',
      name: 'Ian Noseda',
      leagueAssignments: [
        // Two open assignments in different leagues — the helper must pick
        // the one matching the requested leagueId, not "first" or "last".
        {
          toGameWeek: null,
          fromGameWeek: 1,
          leagueTeam: { leagueId: LEAGUE_TAMACHI, team: { id: 't-fenix-fc' } },
        },
        {
          toGameWeek: null,
          fromGameWeek: 1,
          leagueTeam: { leagueId: LEAGUE_DEFAULT, team: { id: 't-mariners-fc' } },
        },
      ],
    })

    const result = await getPlayerMappingFromDb('U1', LEAGUE_DEFAULT)

    expect(result).toEqual({
      playerId: 'ian-noseda',
      playerName: 'Ian Noseda',
      teamId: 'mariners-fc',
    })
  })

  it('with leagueId, picks the assignment from the OTHER league when asked about the other league', async () => {
    // Same fixture, opposite request — proves the resolution isn't picking
    // a fixed first/last position; it actually filters by leagueId.
    findUniqueMock.mockResolvedValue({
      id: 'p-ian-noseda',
      name: 'Ian Noseda',
      leagueAssignments: [
        {
          toGameWeek: null,
          fromGameWeek: 1,
          leagueTeam: { leagueId: LEAGUE_TAMACHI, team: { id: 't-fenix-fc' } },
        },
        {
          toGameWeek: null,
          fromGameWeek: 1,
          leagueTeam: { leagueId: LEAGUE_DEFAULT, team: { id: 't-mariners-fc' } },
        },
      ],
    })

    const result = await getPlayerMappingFromDb('U1', LEAGUE_TAMACHI)

    expect(result).toEqual({
      playerId: 'ian-noseda',
      playerName: 'Ian Noseda',
      teamId: 'fenix-fc',
    })
  })

  it('with leagueId, falls back to a past (closed) assignment in the same league when no open one exists', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'p-ian-noseda',
      name: 'Ian Noseda',
      leagueAssignments: [
        // Past assignment in this league.
        {
          toGameWeek: 5,
          fromGameWeek: 1,
          leagueTeam: { leagueId: LEAGUE_DEFAULT, team: { id: 't-mariners-fc' } },
        },
      ],
    })

    const result = await getPlayerMappingFromDb('U1', LEAGUE_DEFAULT)

    expect(result?.teamId).toBe('mariners-fc')
  })

  it('with leagueId, returns teamId="" when player exists but has NO assignment in the requested league (regression target — never cross leagues)', async () => {
    // Player is assigned to LEAGUE_TAMACHI only. Asking about LEAGUE_DEFAULT
    // must return teamId="" — never the tamachi team. Pre-v1.26.0 (the
    // legacy "first open assignment, league-blind" branch) would have
    // returned the tamachi team here, which is the multi-tenant correctness
    // bug v1.26.0 fixes.
    findUniqueMock.mockResolvedValue({
      id: 'p-ian-noseda',
      name: 'Ian Noseda',
      leagueAssignments: [
        {
          toGameWeek: null,
          fromGameWeek: 1,
          leagueTeam: { leagueId: LEAGUE_TAMACHI, team: { id: 't-fenix-fc' } },
        },
      ],
    })

    const result = await getPlayerMappingFromDb('U1', LEAGUE_DEFAULT)

    expect(result).toEqual({
      playerId: 'ian-noseda',
      playerName: 'Ian Noseda',
      teamId: '',
    })
  })

  it('returns null when the player record itself does not exist', async () => {
    findUniqueMock.mockResolvedValue(null)

    const result = await getPlayerMappingFromDb('U-orphan', LEAGUE_DEFAULT)

    expect(result).toBeNull()
  })

  it('without leagueId, falls back to the legacy "first open assignment" behavior', async () => {
    // Backwards-compat path used by admin write sites that don't operate
    // within a single league. The helper picks the first open assignment
    // regardless of which league it's in — pre-v1.26.0 behavior.
    findUniqueMock.mockResolvedValue({
      id: 'p-ian-noseda',
      name: 'Ian Noseda',
      leagueAssignments: [
        {
          toGameWeek: null,
          fromGameWeek: 1,
          leagueTeam: { leagueId: LEAGUE_TAMACHI, team: { id: 't-fenix-fc' } },
        },
      ],
    })

    const result = await getPlayerMappingFromDb('U1')

    expect(result?.teamId).toBe('fenix-fc')
  })

  it('without leagueId, falls back to a past assignment when no open one exists (legacy)', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'p-ian-noseda',
      name: 'Ian Noseda',
      leagueAssignments: [
        {
          toGameWeek: 5,
          fromGameWeek: 1,
          leagueTeam: { leagueId: LEAGUE_DEFAULT, team: { id: 't-mariners-fc' } },
        },
      ],
    })

    const result = await getPlayerMappingFromDb('U1')

    expect(result?.teamId).toBe('mariners-fc')
  })

  it('always strips the "p-"/"t-" prefixes from playerId / teamId', async () => {
    // The Player.id and LeagueTeam.team.id values from Prisma carry
    // "p-"/"t-" prefixes — the public-facing shape uses bare slugs.
    findUniqueMock.mockResolvedValue({
      id: 'p-ian-noseda',
      name: 'Ian Noseda',
      leagueAssignments: [
        {
          toGameWeek: null,
          fromGameWeek: 1,
          leagueTeam: { leagueId: LEAGUE_DEFAULT, team: { id: 't-mariners-fc' } },
        },
      ],
    })

    const result = await getPlayerMappingFromDb('U1', LEAGUE_DEFAULT)

    expect(result?.playerId).toBe('ian-noseda')
    expect(result?.teamId).toBe('mariners-fc')
  })
})
