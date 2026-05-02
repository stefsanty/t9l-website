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

const {
  findManyAssignmentsMock,
  findManyLeagueTeamsMock,
  findManyGameWeeksMock,
  findManyLineLoginsMock,
  findManyPlayersMock,
  findManyInvitesMock,
} = vi.hoisted(() => ({
  findManyAssignmentsMock: vi.fn(),
  findManyLeagueTeamsMock: vi.fn(),
  findManyGameWeeksMock: vi.fn(),
  findManyLineLoginsMock: vi.fn(),
  findManyPlayersMock: vi.fn(),
  // v1.38.0 (PR κ) — admin-data now also fetches active PERSONAL invites
  // per league for the new "Invited" sign-in-status badge.
  findManyInvitesMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerLeagueAssignment: { findMany: findManyAssignmentsMock },
    leagueTeam: { findMany: findManyLeagueTeamsMock },
    gameWeek: { findMany: findManyGameWeeksMock },
    lineLogin: { findMany: findManyLineLoginsMock },
    player: { findMany: findManyPlayersMock },
    leagueInvite: { findMany: findManyInvitesMock },
  },
}))

vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}))

import { getLeaguePlayers, getAllLineLoginsWithLinkedPlayer } from '@/lib/admin-data'

beforeEach(() => {
  vi.clearAllMocks()
  // v1.38.0 (PR κ) — default the new invite fetch to empty so existing
  // test cases don't need to set it explicitly. Tests that exercise the
  // "Invited" badge override this in their own `mockResolvedValueOnce`.
  findManyInvitesMock.mockResolvedValue([])
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

    // v1.17.1 — lastSeenAt is serialized to ISO string at this boundary
    // because the function is wrapped in `unstable_cache` (which JSON
    // round-trips Date → string). The contract is now string-not-Date.
    expect(lineLoginsByLineId['U-alice']).toEqual({
      name: 'Alice',
      pictureUrl: 'https://line.cdn/alice.jpg',
      lastSeenAt: '2026-04-15T10:00:00.000Z',
    })
    expect(lineLoginsByLineId['U-bob']).toEqual({
      name: 'Bob',
      pictureUrl: null,
      lastSeenAt: '2026-04-16T10:00:00.000Z',
    })
    expect(lineLoginsByLineId['U-charlie']).toBeUndefined()
  })

  it('regression v1.17.1 — lineLoginsByLineId.lastSeenAt is a string so consumers do not need .toISOString()', async () => {
    // Reproduces the v1.17.0 prod bug:
    //   TypeError: b?.lastSeenAt.toISOString is not a function
    // at /admin/leagues/[id]/players. `unstable_cache` JSON-round-trips
    // its return value, which converts Date → string. Pre-fix the page
    // called `ll?.lastSeenAt.toISOString()` on the cached result and
    // crashed because the value was already a string.
    //
    // Post-fix `getLeaguePlayers` serializes to ISO string at the source,
    // so the page can pass the value through unchanged regardless of
    // whether the result came from a fresh fetch or the cache.
    findManyAssignmentsMock.mockResolvedValueOnce([])
    findManyLeagueTeamsMock.mockResolvedValueOnce([])
    findManyGameWeeksMock.mockResolvedValueOnce([])
    findManyLineLoginsMock.mockResolvedValueOnce([
      {
        lineId: 'U-alice',
        name: 'Alice',
        pictureUrl: null,
        lastSeenAt: new Date('2026-04-15T10:00:00Z'),
      },
    ])

    const [, , , map] = await getLeaguePlayers('l-spring')

    // Contract: typeof string at the source.
    expect(typeof map['U-alice'].lastSeenAt).toBe('string')
    expect(map['U-alice'].lastSeenAt).toBe('2026-04-15T10:00:00.000Z')

    // Simulate the cache JSON round-trip — even after that, the page-level
    // pass-through `ll?.lastSeenAt ?? null` still produces a usable ISO
    // string. (Pre-fix the page did `ll?.lastSeenAt.toISOString() ?? null`,
    // which would throw on the already-a-string value below.)
    const cacheRoundTripped = JSON.parse(JSON.stringify(map)) as typeof map
    const ll = cacheRoundTripped['U-alice']
    expect(typeof ll.lastSeenAt).toBe('string')
    const lineLastSeenAt = ll?.lastSeenAt ?? null
    expect(lineLastSeenAt).toBe('2026-04-15T10:00:00.000Z')
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
    // 4th position is the line-login map (v1.10.0); 5th is the active
    // invite count map (v1.38.0 / PR κ).
    expect(result[3]).toEqual({})
    expect(result[4]).toEqual({})
  })

  it('v1.38.0 (PR κ) — counts active PERSONAL invites per targetPlayerId', async () => {
    findManyAssignmentsMock.mockResolvedValueOnce([])
    findManyLeagueTeamsMock.mockResolvedValueOnce([])
    findManyGameWeeksMock.mockResolvedValueOnce([])
    findManyLineLoginsMock.mockResolvedValueOnce([])
    const future = new Date(Date.now() + 86_400_000) // +1 day
    const past = new Date(Date.now() - 86_400_000) // -1 day
    findManyInvitesMock.mockResolvedValueOnce([
      // active — counted
      { targetPlayerId: 'p-alice', expiresAt: future, maxUses: 1, usedCount: 0 },
      // active, no expiry — counted
      { targetPlayerId: 'p-alice', expiresAt: null, maxUses: null, usedCount: 0 },
      // expired — NOT counted
      { targetPlayerId: 'p-alice', expiresAt: past, maxUses: 1, usedCount: 0 },
      // used up — NOT counted
      { targetPlayerId: 'p-bob', expiresAt: future, maxUses: 1, usedCount: 1 },
      // null targetPlayerId — NOT counted (defensive)
      { targetPlayerId: null, expiresAt: future, maxUses: 1, usedCount: 0 },
      // active for charlie
      { targetPlayerId: 'p-charlie', expiresAt: future, maxUses: 5, usedCount: 2 },
    ])

    const [, , , , inviteCounts] = await getLeaguePlayers('l-spring')

    expect(inviteCounts['p-alice']).toBe(2)
    expect(inviteCounts['p-bob']).toBeUndefined()
    expect(inviteCounts['p-charlie']).toBe(1)
  })

  it('v1.38.0 (PR κ) — passes the right where-clause to leagueInvite.findMany', async () => {
    findManyAssignmentsMock.mockResolvedValueOnce([])
    findManyLeagueTeamsMock.mockResolvedValueOnce([])
    findManyGameWeeksMock.mockResolvedValueOnce([])
    findManyLineLoginsMock.mockResolvedValueOnce([])
    findManyInvitesMock.mockResolvedValueOnce([])

    await getLeaguePlayers('l-spring')

    expect(findManyInvitesMock).toHaveBeenCalledTimes(1)
    const call = findManyInvitesMock.mock.calls[0][0]
    // Scope to the league and to PERSONAL invites with a target.
    expect(call.where).toMatchObject({
      leagueId: 'l-spring',
      kind: 'PERSONAL',
      revokedAt: null,
      targetPlayerId: { not: null },
    })
    // Selecting only the fields needed for the JS-side filter.
    expect(call.select).toMatchObject({
      targetPlayerId: true,
      expiresAt: true,
      maxUses: true,
      usedCount: true,
    })
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
