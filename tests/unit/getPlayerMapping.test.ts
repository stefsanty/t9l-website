import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Pins the v1.26.0 (PR β) auth-path semantics around the player-mapping
 * store. The JWT callback in `lib/auth.ts` reads the mapping via the
 * private `getPlayerMapping(lineId, leagueId)` — exposed here as
 * `__getPlayerMapping_for_testing` — and applies these rules:
 *
 *   store hit            → return value
 *   store miss           → fall through to Prisma + write back to Redis
 *   store error          → fall through to Prisma WITHOUT writing back
 *
 * v1.26.0 changes:
 *   - The read path is per-league (`leagueId` required parameter). The
 *     mapping resolves the right `PlayerLeagueAssignment` for the
 *     supplied league; absence of an assignment in this league produces
 *     `teamId: ""` even when the player exists globally.
 *   - The miss policy flips from "return null" (v1.5.0 semantics) to
 *     "fall through + write back". This is required because the per-league
 *     key namespace is fresh post-cutover; pre-existing entries decay
 *     over the 24h sliding TTL but per-league reads still need to fill
 *     the cache lazily on first miss. Mirror of the v1.7.0 RSVP store
 *     miss policy.
 *   - The error policy keeps the v1.5.0 defensive Prisma fallback but
 *     drops the write-back — don't amplify Upstash blips into write
 *     storms (mirror of the v1.7.0 RSVP store error policy).
 */

const { getMappingMock, setMappingMock, playerFindUniqueMock } = vi.hoisted(() => ({
  getMappingMock: vi.fn(),
  setMappingMock: vi.fn(),
  playerFindUniqueMock: vi.fn(),
}))

vi.mock('@/lib/playerMappingStore', () => ({
  getMapping: getMappingMock,
  setMapping: setMappingMock,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    player: {
      findUnique: playerFindUniqueMock,
    },
  },
}))

import { __getPlayerMapping_for_testing as getPlayerMapping } from '@/lib/auth'

const SAMPLE = {
  playerId: 'ian-noseda',
  playerName: 'Ian Noseda',
  teamId: 'mariners-fc',
}

const LEAGUE = 'l-default'
const LEAGUE_OTHER = 'l-tamachi'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getPlayerMapping — store hit (v1.26.0)', () => {
  it('returns the value from the store without touching Prisma', async () => {
    getMappingMock.mockResolvedValue({ status: 'hit', value: SAMPLE })

    const result = await getPlayerMapping('U1', LEAGUE)

    expect(result).toEqual(SAMPLE)
    expect(getMappingMock).toHaveBeenCalledWith('U1', LEAGUE)
    expect(playerFindUniqueMock).not.toHaveBeenCalled()
    expect(setMappingMock).not.toHaveBeenCalled()
  })

  it('returns null directly when the store has the null sentinel for an orphan', async () => {
    getMappingMock.mockResolvedValue({ status: 'hit', value: null })

    const result = await getPlayerMapping('U-orphan-cached', LEAGUE)

    expect(result).toBeNull()
    expect(playerFindUniqueMock).not.toHaveBeenCalled()
  })

  it('threads the leagueId through to the store read (regression target — pre-v1.26.0 was league-blind)', async () => {
    getMappingMock.mockResolvedValue({ status: 'hit', value: SAMPLE })

    await getPlayerMapping('U1', LEAGUE_OTHER)

    expect(getMappingMock).toHaveBeenCalledWith('U1', LEAGUE_OTHER)
  })
})

describe('getPlayerMapping — store miss (v1.26.0 — Prisma fallthrough + write-back)', () => {
  it('falls through to Prisma on miss and pre-warms Redis with the resolved per-league mapping', async () => {
    // The architectural shift in v1.26.0: a miss means "cold per-(leagueId,
    // lineId) cache OR genuine orphan in this league". Resolution requires
    // a Prisma read; the result is then written back so the next request
    // hits the store directly. Pre-v1.26.0 (v1.5.0 semantics) miss returned
    // null without touching Prisma.
    getMappingMock.mockResolvedValue({ status: 'miss' })
    playerFindUniqueMock.mockResolvedValue({
      id: 'p-ian-noseda',
      name: 'Ian Noseda',
      leagueAssignments: [
        {
          toGameWeek: null,
          fromGameWeek: 1,
          leagueTeam: { leagueId: LEAGUE, team: { id: 't-mariners-fc' } },
        },
      ],
    })

    const result = await getPlayerMapping('U-cold-cache', LEAGUE)

    expect(result).toEqual(SAMPLE)
    expect(playerFindUniqueMock).toHaveBeenCalledTimes(1)
    // Write back at the per-league key.
    expect(setMappingMock).toHaveBeenCalledWith('U-cold-cache', LEAGUE, SAMPLE)
  })

  it('returns null and writes the null sentinel for an orphan (player exists but no assignment in this league)', async () => {
    getMappingMock.mockResolvedValue({ status: 'miss' })
    playerFindUniqueMock.mockResolvedValue(null)

    const result = await getPlayerMapping('U-orphan-fresh', LEAGUE)

    expect(result).toBeNull()
    // Pre-warm the null result so the next request resolves from the store
    // directly without paying another Prisma round-trip.
    expect(setMappingMock).toHaveBeenCalledWith('U-orphan-fresh', LEAGUE, null)
  })

  it('writes empty teamId for a Player with no assignment in the requested league', async () => {
    // Player exists globally and has assignments in OTHER leagues, but is
    // not assigned to the requested league. The mapping returns the
    // global player identity (playerId, playerName) with teamId="".
    // Dashboard's render-null branches handle the empty teamId.
    getMappingMock.mockResolvedValue({ status: 'miss' })
    playerFindUniqueMock.mockResolvedValue({
      id: 'p-ian-noseda',
      name: 'Ian Noseda',
      leagueAssignments: [
        {
          toGameWeek: null,
          fromGameWeek: 1,
          leagueTeam: {
            leagueId: LEAGUE_OTHER, // assigned to OTHER league, not the requested one
            team: { id: 't-fenix-fc' },
          },
        },
      ],
    })

    const result = await getPlayerMapping('U-cross-league', LEAGUE)

    expect(result).toEqual({
      playerId: 'ian-noseda',
      playerName: 'Ian Noseda',
      teamId: '',
    })
  })

  it('returns null when Prisma fails during miss-fallthrough (degraded orphan)', async () => {
    getMappingMock.mockResolvedValue({ status: 'miss' })
    playerFindUniqueMock.mockRejectedValue(new Error('Prisma connection failed'))

    const result = await getPlayerMapping('U-prisma-fail', LEAGUE)

    expect(result).toBeNull()
    // Don't pre-warm with garbage — Prisma failure means we never reached
    // a fresh mapping.
    expect(setMappingMock).not.toHaveBeenCalled()
  })
})

describe('getPlayerMapping — store error (defensive Prisma fallback, NO write-back)', () => {
  it('falls through to Prisma when Redis errors but does NOT write back (v1.26.0 — avoid write storms)', async () => {
    getMappingMock.mockResolvedValue({ status: 'error', reason: 'redis-error' })
    playerFindUniqueMock.mockResolvedValue({
      id: 'p-ian-noseda',
      name: 'Ian Noseda',
      leagueAssignments: [
        {
          toGameWeek: null,
          fromGameWeek: 1,
          leagueTeam: { leagueId: LEAGUE, team: { id: 't-mariners-fc' } },
        },
      ],
    })

    const result = await getPlayerMapping('U-during-outage', LEAGUE)

    expect(result).toEqual(SAMPLE)
    expect(playerFindUniqueMock).toHaveBeenCalledTimes(1)
    // Critical regression target: error path does NOT pre-warm. Pre-v1.26.0
    // the v1.5.0 code wrote back unconditionally on the error fallback,
    // amplifying Upstash blips into write storms.
    expect(setMappingMock).not.toHaveBeenCalled()
  })

  it('falls through to Prisma when the store reports no-client (Upstash unconfigured)', async () => {
    getMappingMock.mockResolvedValue({ status: 'error', reason: 'no-client' })
    playerFindUniqueMock.mockResolvedValue({
      id: 'p-ian-noseda',
      name: 'Ian Noseda',
      leagueAssignments: [
        {
          toGameWeek: null,
          fromGameWeek: 1,
          leagueTeam: { leagueId: LEAGUE, team: { id: 't-mariners-fc' } },
        },
      ],
    })

    const result = await getPlayerMapping('U-no-client', LEAGUE)

    expect(result).toEqual(SAMPLE)
    expect(setMappingMock).not.toHaveBeenCalled()
  })

  it('returns null when both the store errors AND Prisma errors (worst-case orphan)', async () => {
    getMappingMock.mockResolvedValue({ status: 'error', reason: 'redis-error' })
    playerFindUniqueMock.mockRejectedValue(new Error('Prisma connection failed'))

    const result = await getPlayerMapping('U-double-outage', LEAGUE)

    expect(result).toBeNull()
    expect(setMappingMock).not.toHaveBeenCalled()
  })
})
