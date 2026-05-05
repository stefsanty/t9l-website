import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * v1.59.0 — getMembershipsForSession behavioral tests.
 *
 * The helper is the load-bearing piece for the SSR-hydrated league switcher.
 * Validates: auth-key dispatch (userId vs lineId vs neither), Prisma query
 * shape, dedup, isCurrent flag, default-league slug fallback, sort, and
 * defensive empty-on-error behavior.
 */

const { playerFindFirstMock } = vi.hoisted(() => ({
  playerFindFirstMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    player: { findFirst: playerFindFirstMock },
  },
}))

import { getMembershipsForSession } from '@/lib/memberships'
import { DEFAULT_LEAGUE_SLUG } from '@/lib/leagueSlug'

beforeEach(() => {
  vi.clearAllMocks()
})

function makePlayer(
  rows: Array<{ id: string; name: string; subdomain: string | null; isDefault: boolean }>,
) {
  return {
    leagueAssignments: rows.map((r) => ({
      leagueTeam: {
        league: { id: r.id, name: r.name, subdomain: r.subdomain, isDefault: r.isDefault },
      },
    })),
  }
}

describe('getMembershipsForSession — auth dispatch', () => {
  it('returns [] when both userId and lineId are null', async () => {
    const result = await getMembershipsForSession({
      userId: null,
      lineId: null,
      currentLeagueId: null,
    })
    expect(result).toEqual([])
    expect(playerFindFirstMock).not.toHaveBeenCalled()
  })

  it('queries by userId when present (canonical post-α.5 path)', async () => {
    playerFindFirstMock.mockResolvedValueOnce(null)
    await getMembershipsForSession({
      userId: 'u-stefan',
      lineId: 'U_line',
      currentLeagueId: null,
    })
    expect(playerFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u-stefan' } }),
    )
  })

  it('falls back to lineId when no userId (legacy LINE-only sessions)', async () => {
    playerFindFirstMock.mockResolvedValueOnce(null)
    await getMembershipsForSession({
      userId: null,
      lineId: 'U_line',
      currentLeagueId: null,
    })
    expect(playerFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { lineId: 'U_line' } }),
    )
  })

  it('returns [] when Player.findFirst returns null (unbound user)', async () => {
    playerFindFirstMock.mockResolvedValueOnce(null)
    const result = await getMembershipsForSession({
      userId: 'u-stefan',
      lineId: null,
      currentLeagueId: null,
    })
    expect(result).toEqual([])
  })
})

describe('getMembershipsForSession — shape', () => {
  it('returns one row per league with correct slug + isCurrent', async () => {
    playerFindFirstMock.mockResolvedValueOnce(
      makePlayer([
        { id: 'l-spring', name: 'T9L 2026 Spring', subdomain: 't9l', isDefault: true },
        { id: 'l-tamachi', name: 'Tamachi League', subdomain: 'tamachi', isDefault: false },
      ]),
    )
    const result = await getMembershipsForSession({
      userId: 'u-stefan',
      lineId: null,
      currentLeagueId: 'l-tamachi',
    })
    expect(result).toEqual([
      {
        leagueId: 'l-spring',
        name: 'T9L 2026 Spring',
        slug: 't9l',
        isCurrent: false,
      },
      {
        leagueId: 'l-tamachi',
        name: 'Tamachi League',
        slug: 'tamachi',
        isCurrent: true,
      },
    ])
  })

  it('falls back to DEFAULT_LEAGUE_SLUG when default-league subdomain is null', async () => {
    playerFindFirstMock.mockResolvedValueOnce(
      makePlayer([
        { id: 'l-spring', name: 'T9L 2026 Spring', subdomain: null, isDefault: true },
      ]),
    )
    const result = await getMembershipsForSession({
      userId: 'u-stefan',
      lineId: null,
      currentLeagueId: null,
    })
    expect(result).toHaveLength(1)
    expect(result[0].slug).toBe(DEFAULT_LEAGUE_SLUG)
  })

  it('drops non-default leagues whose subdomain is null (no slug to navigate to)', async () => {
    playerFindFirstMock.mockResolvedValueOnce(
      makePlayer([
        { id: 'l-spring', name: 'T9L 2026 Spring', subdomain: 't9l', isDefault: true },
        { id: 'l-broken', name: 'Broken League', subdomain: null, isDefault: false },
      ]),
    )
    const result = await getMembershipsForSession({
      userId: 'u-stefan',
      lineId: null,
      currentLeagueId: null,
    })
    expect(result).toHaveLength(1)
    expect(result[0].leagueId).toBe('l-spring')
  })

  it('dedupes rows when a player has multiple PLAs in the same league', async () => {
    playerFindFirstMock.mockResolvedValueOnce(
      makePlayer([
        { id: 'l-spring', name: 'T9L', subdomain: 't9l', isDefault: true },
        { id: 'l-spring', name: 'T9L', subdomain: 't9l', isDefault: true },
      ]),
    )
    const result = await getMembershipsForSession({
      userId: 'u-stefan',
      lineId: null,
      currentLeagueId: null,
    })
    expect(result).toHaveLength(1)
  })

  it('sorts by league name (alphabetical)', async () => {
    playerFindFirstMock.mockResolvedValueOnce(
      makePlayer([
        { id: 'l-z', name: 'Zebra League', subdomain: 'zebra', isDefault: false },
        { id: 'l-a', name: 'Apple League', subdomain: 'apple', isDefault: false },
      ]),
    )
    const result = await getMembershipsForSession({
      userId: 'u-stefan',
      lineId: null,
      currentLeagueId: null,
    })
    expect(result.map((m) => m.name)).toEqual(['Apple League', 'Zebra League'])
  })
})

describe('getMembershipsForSession — defensive', () => {
  it('returns [] on Prisma rejection (does not throw)', async () => {
    playerFindFirstMock.mockRejectedValueOnce(new Error('connection lost'))
    const result = await getMembershipsForSession({
      userId: 'u-stefan',
      lineId: null,
      currentLeagueId: null,
    })
    expect(result).toEqual([])
  })
})
