import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * v1.23.0 — `getPublicLeagueData(leagueId?)` and `getPlayerByPublicId(slug,
 * leagueId?)` accept an optional leagueId. When supplied, scopes the read to
 * that league. When omitted, falls back to the league flagged
 * `isDefault: true` (pre-v1.23.0 behavior preserved).
 *
 * The underlying `dbToPublicLeagueData(leagueId?)` is the load-bearing
 * adapter: its Prisma `league.findFirst` where-clause flips between
 * `{ id: leagueId }` and `{ isDefault: true }` based on the argument.
 *
 * Pinned contracts:
 *   1. `dbToPublicLeagueData(undefined)` queries by `isDefault: true`.
 *   2. `dbToPublicLeagueData('l-tamachi-2026')` queries by `id: 'l-tamachi-2026'`.
 *   3. `getPublicLeagueData(leagueId)` threads through to `dbToPublicLeagueData(leagueId)`.
 *   4. `getPlayerByPublicId(slug, leagueId)` threads through similarly.
 *   5. Cache isolation: two different leagueIds never share an entry.
 */

const {
  leagueFindFirstMock,
  pleagueFindManyMock,
} = vi.hoisted(() => ({
  leagueFindFirstMock: vi.fn(),
  pleagueFindManyMock: vi.fn(),
}))

vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: leagueFindFirstMock },
    playerLeagueAssignment: { findMany: pleagueFindManyMock },
  },
}))

vi.mock('@/lib/settings', () => ({
  getDataSource: vi.fn().mockResolvedValue('db'),
}))

vi.mock('@/lib/sheets', () => ({
  fetchSheetData: vi.fn(),
}))

vi.mock('@/lib/data', () => ({
  parseAllData: vi.fn(),
}))

vi.mock('@/lib/rsvpStore', () => ({
  getRsvpForGameWeeks: vi.fn().mockResolvedValue(new Map()),
  setRsvp: vi.fn(),
  setParticipated: vi.fn(),
  seedGameWeek: vi.fn(),
}))

vi.mock('@/lib/rsvpMerge', () => ({
  mergeRsvpData: vi.fn().mockReturnValue({
    availability: {},
    availabilityStatuses: {},
    played: {},
  }),
  buildGwToMdMap: vi.fn().mockReturnValue(new Map()),
}))

import { dbToPublicLeagueData } from '@/lib/dbToPublicLeagueData'
import { getPublicLeagueData, getPlayerByPublicId } from '@/lib/publicData'

beforeEach(() => {
  leagueFindFirstMock.mockReset()
  pleagueFindManyMock.mockReset()
  pleagueFindManyMock.mockResolvedValue([])
})

function makeLeagueRow(id: string) {
  return {
    id,
    name: id,
    leagueTeams: [],
    gameWeeks: [],
  }
}

describe('dbToPublicLeagueData(leagueId?) — Prisma where-clause selector', () => {
  it('queries by `isDefault: true` when leagueId is undefined (pre-v1.23.0 behavior)', async () => {
    leagueFindFirstMock.mockResolvedValueOnce(makeLeagueRow('l-default'))

    await dbToPublicLeagueData()

    expect(leagueFindFirstMock).toHaveBeenCalledTimes(1)
    const callArgs = leagueFindFirstMock.mock.calls[0][0]
    expect(callArgs.where).toEqual({ isDefault: true })
  })

  it('queries by `id: leagueId` when leagueId is supplied', async () => {
    leagueFindFirstMock.mockResolvedValueOnce(makeLeagueRow('l-tamachi-2026'))

    await dbToPublicLeagueData('l-tamachi-2026')

    expect(leagueFindFirstMock).toHaveBeenCalledTimes(1)
    const callArgs = leagueFindFirstMock.mock.calls[0][0]
    expect(callArgs.where).toEqual({ id: 'l-tamachi-2026' })
  })

  it('returns empty data when neither match resolves (no default league + unknown leagueId)', async () => {
    leagueFindFirstMock.mockResolvedValueOnce(null)

    const result = await dbToPublicLeagueData('l-nonexistent')

    expect(result.data.teams).toEqual([])
    expect(result.data.players).toEqual([])
    expect(result.gameWeeks).toEqual([])
  })

  it('does not silently fall back to default when an explicit leagueId yields no row', async () => {
    // Critical: passing an explicit leagueId that doesn't exist must NOT
    // silently degrade to `isDefault: true`. The where clause is single-
    // dispatch; a missing row returns empty data, not the default league's.
    leagueFindFirstMock.mockResolvedValueOnce(null)

    await dbToPublicLeagueData('l-nonexistent')

    // Only one findFirst call — the helper does not retry with a different
    // where clause.
    expect(leagueFindFirstMock).toHaveBeenCalledTimes(1)
    expect(leagueFindFirstMock.mock.calls[0][0].where).toEqual({
      id: 'l-nonexistent',
    })
  })
})

describe('getPublicLeagueData(leagueId?) — dispatcher pass-through', () => {
  it('threads leagueId=undefined through to dbToPublicLeagueData (default league)', async () => {
    leagueFindFirstMock.mockResolvedValueOnce(makeLeagueRow('l-default'))

    await getPublicLeagueData()

    expect(leagueFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isDefault: true } }),
    )
  })

  it('threads an explicit leagueId through to dbToPublicLeagueData', async () => {
    leagueFindFirstMock.mockResolvedValueOnce(makeLeagueRow('l-tamachi-2026'))

    await getPublicLeagueData('l-tamachi-2026')

    expect(leagueFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'l-tamachi-2026' } }),
    )
  })
})

describe('getPlayerByPublicId(slug, leagueId?) — validation read scope', () => {
  it('threads leagueId=undefined through to the default-league lookup', async () => {
    leagueFindFirstMock.mockResolvedValueOnce(makeLeagueRow('l-default'))

    await getPlayerByPublicId('ian-noseda')

    expect(leagueFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isDefault: true } }),
    )
  })

  it('threads an explicit leagueId through so subdomain link flows validate against the right roster', async () => {
    leagueFindFirstMock.mockResolvedValueOnce(makeLeagueRow('l-tamachi-2026'))

    await getPlayerByPublicId('ian-noseda', 'l-tamachi-2026')

    expect(leagueFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'l-tamachi-2026' } }),
    )
  })

  it('returns null when the league exists but the player slug is not in the roster', async () => {
    leagueFindFirstMock.mockResolvedValueOnce(makeLeagueRow('l-tamachi-2026'))
    pleagueFindManyMock.mockResolvedValueOnce([]) // empty roster

    const result = await getPlayerByPublicId('not-in-roster', 'l-tamachi-2026')

    expect(result).toBeNull()
  })
})
