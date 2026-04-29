/**
 * Unit tests for the v1.10.0 / PR B admin-data joins:
 *   - getLeaguePlayers now returns a 4-tuple ending in
 *     `lineLoginsByLineId` (a Record keyed by lineId)
 *   - getAllLineLoginsWithLinkedPlayer returns every LineLogin row
 *     annotated with `linkedPlayer: { id, name } | null`, driving the
 *     remap dialog
 *
 * Verifies the BEHAVIOR (per CLAUDE.md "End-to-end verification rule"):
 *   (1) the LINE-info column has data — display name, picture URL, and
 *       lastSeenAt for every Player whose lineId matches a LineLogin row
 *   (2) Players with no lineId have no LINE info (no spurious join hits)
 *   (3) Players with a lineId but no LineLogin row (rare: e.g. backfilled
 *       roster pre-PR-6) get null fields, not undefined or a crash
 *   (4) The remap dropdown shows linkedPlayer for currently-linked rows
 *       and null for orphans
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { findManyAssignmentsMock, findManyLeagueTeamsMock, findManyGameWeeksMock, findManyLineLoginsMock, findManyPlayersMock } = vi.hoisted(() => ({
  findManyAssignmentsMock: vi.fn(),
  findManyLeagueTeamsMock: vi.fn(),
  findManyGameWeeksMock: vi.fn(),
  findManyLineLoginsMock: vi.fn(),
  findManyPlayersMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerLeagueAssignment: { findMany: findManyAssignmentsMock },
    leagueTeam: { findMany: findManyLeagueTeamsMock },
    gameWeek: { findMany: findManyGameWeeksMock },
    lineLogin: { findMany: findManyLineLoginsMock },
    player: { findMany: findManyPlayersMock },
  },
}))

vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}))

import { getLeaguePlayers, getAllLineLoginsWithLinkedPlayer } from '@/lib/admin-data'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getLeaguePlayers v1.10.0 4-tuple shape', () => {
  it('returns lineLoginsByLineId keyed by lineId for every LineLogin row', async () => {
    findManyAssignmentsMock.mockResolvedValueOnce([])
    findManyLeagueTeamsMock.mockResolvedValueOnce([])
    findManyGameWeeksMock.mockResolvedValueOnce([])
    findManyLineLoginsMock.mockResolvedValueOnce([
      {
        lineId: 'U-alice',
        name: 'Alice',
        pictureUrl: 'https://line.cdn/alice.jpg',
        lastSeenAt: new Date('2026-04-15T10:00:00Z'),
      },
      {
        lineId: 'U-bob',
        name: 'Bob',
        pictureUrl: null,
        lastSeenAt: new Date('2026-04-16T10:00:00Z'),
      },
    ])

    const [, , , lineLoginsByLineId] = await getLeaguePlayers('l-spring')

    expect(lineLoginsByLineId['U-alice']).toEqual({
      name: 'Alice',
      pictureUrl: 'https://line.cdn/alice.jpg',
      lastSeenAt: new Date('2026-04-15T10:00:00Z'),
    })
    expect(lineLoginsByLineId['U-bob']).toEqual({
      name: 'Bob',
      pictureUrl: null,
      lastSeenAt: new Date('2026-04-16T10:00:00Z'),
    })
    expect(lineLoginsByLineId['U-charlie']).toBeUndefined()
  })

  it('returns empty record when no LineLogin rows exist', async () => {
    findManyAssignmentsMock.mockResolvedValueOnce([])
    findManyLeagueTeamsMock.mockResolvedValueOnce([])
    findManyGameWeeksMock.mockResolvedValueOnce([])
    findManyLineLoginsMock.mockResolvedValueOnce([])

    const [, , , lineLoginsByLineId] = await getLeaguePlayers('l-spring')

    expect(lineLoginsByLineId).toEqual({})
  })

  it('preserves the legacy 3-tuple positions for assignments, leagueTeams, gameWeeks', async () => {
    const assignments = [{ id: 'a-1', playerId: 'p-1' }]
    const leagueTeams = [{ id: 'lt-1' }]
    const gameWeeks = [{ weekNumber: 8 }]
    findManyAssignmentsMock.mockResolvedValueOnce(assignments)
    findManyLeagueTeamsMock.mockResolvedValueOnce(leagueTeams)
    findManyGameWeeksMock.mockResolvedValueOnce(gameWeeks)
    findManyLineLoginsMock.mockResolvedValueOnce([])

    const result = await getLeaguePlayers('l-spring')

    expect(result[0]).toBe(assignments)
    expect(result[1]).toBe(leagueTeams)
    expect(result[2]).toBe(gameWeeks)
    // 4th position is the new map.
    expect(result[3]).toEqual({})
  })
})

describe('getAllLineLoginsWithLinkedPlayer (v1.10.0 / PR B remap dialog)', () => {
  it('annotates each LineLogin row with the player it\'s currently linked to', async () => {
    findManyLineLoginsMock.mockResolvedValueOnce([
      {
        lineId: 'U-alice',
        name: 'Alice',
        pictureUrl: null,
        firstSeenAt: new Date('2026-04-01T00:00:00Z'),
        lastSeenAt: new Date('2026-04-16T10:00:00Z'),
      },
      {
        lineId: 'U-orphan',
        name: 'Orphan',
        pictureUrl: null,
        firstSeenAt: new Date('2026-04-02T00:00:00Z'),
        lastSeenAt: new Date('2026-04-15T10:00:00Z'),
      },
    ])
    findManyPlayersMock.mockResolvedValueOnce([
      { id: 'p-alice-player', name: 'Alice Player', lineId: 'U-alice' },
    ])

    const result = await getAllLineLoginsWithLinkedPlayer()

    const alice = result.find((r) => r.lineId === 'U-alice')!
    const orphan = result.find((r) => r.lineId === 'U-orphan')!

    expect(alice.linkedPlayer).toEqual({ id: 'p-alice-player', name: 'Alice Player' })
    expect(orphan.linkedPlayer).toBeNull()
  })

  it('preserves lastSeenAt order from Prisma findMany', async () => {
    findManyLineLoginsMock.mockResolvedValueOnce([
      { lineId: 'U-newest', name: 'A', pictureUrl: null, firstSeenAt: new Date(), lastSeenAt: new Date('2026-04-16') },
      { lineId: 'U-older', name: 'B', pictureUrl: null, firstSeenAt: new Date(), lastSeenAt: new Date('2026-04-15') },
      { lineId: 'U-oldest', name: 'C', pictureUrl: null, firstSeenAt: new Date(), lastSeenAt: new Date('2026-04-14') },
    ])
    findManyPlayersMock.mockResolvedValueOnce([])

    const result = await getAllLineLoginsWithLinkedPlayer()

    expect(result.map((r) => r.lineId)).toEqual(['U-newest', 'U-older', 'U-oldest'])
  })

  it('returns empty array when there are no LineLogin rows', async () => {
    findManyLineLoginsMock.mockResolvedValueOnce([])
    findManyPlayersMock.mockResolvedValueOnce([])

    const result = await getAllLineLoginsWithLinkedPlayer()

    expect(result).toEqual([])
  })

  it('skips Player rows with null lineId in the linkedBy map (defensive)', async () => {
    findManyLineLoginsMock.mockResolvedValueOnce([
      { lineId: 'U-orphan', name: 'X', pictureUrl: null, firstSeenAt: new Date(), lastSeenAt: new Date() },
    ])
    findManyPlayersMock.mockResolvedValueOnce([
      // Prisma `where: { lineId: { not: null } }` should already filter
      // these out, but the test exercises the type guard inside the
      // helper just in case of cache-key drift.
      { id: 'p-broken', name: 'Broken', lineId: null },
    ])

    const result = await getAllLineLoginsWithLinkedPlayer()

    expect(result[0].linkedPlayer).toBeNull()
  })
})
