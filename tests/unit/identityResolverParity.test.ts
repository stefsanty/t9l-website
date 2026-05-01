import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * v1.30.0 (stage γ) — identity resolver parity + flag dispatch.
 *
 * Two contracts:
 *   (1) PARITY — when the data is consistent (every Player.lineId has a
 *       matching User row whose User.playerId points back), the legacy
 *       and user-side resolvers return identical output for the same
 *       input. This is the load-bearing safety property for the
 *       operator flip: if parity holds across the active fixture set,
 *       the cutover is safe.
 *   (2) DISPATCH — `getPlayerMappingFromDb` reads
 *       `Setting('identity.read-source')` on every call and routes to
 *       the right resolver. Default 'legacy' preserves pre-γ behavior;
 *       'user' switches to the new path. Failure to read the Setting
 *       defaults to 'legacy' (defensive: a Settings outage doesn't
 *       flip every session onto the new path during a teardown).
 */

const {
  playerFindUniqueMock,
  userFindUniqueMock,
  getIdentityReadSourceMock,
} = vi.hoisted(() => ({
  playerFindUniqueMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  getIdentityReadSourceMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    player: { findUnique: playerFindUniqueMock },
    user: { findUnique: userFindUniqueMock },
  },
}))

vi.mock('@/lib/playerMappingStore', () => ({
  getMapping: vi.fn(),
  setMapping: vi.fn(),
}))

vi.mock('@/lib/settings', () => ({
  getIdentityReadSource: getIdentityReadSourceMock,
}))

import {
  getPlayerMappingFromDb,
  __resolvers_for_testing,
} from '@/lib/auth'

beforeEach(() => {
  vi.clearAllMocks()
})

const PLAYER_RECORD = {
  id: 'p-stefan-s',
  name: 'Stefan S',
  leagueAssignments: [
    {
      toGameWeek: null,
      leagueTeam: { leagueId: 'l-spring', team: { id: 't-mariners' } },
    },
    {
      toGameWeek: 8,
      leagueTeam: { leagueId: 'l-fall', team: { id: 't-fenix' } },
    },
  ],
}

describe('legacy resolver — Player.lineId @unique lookup', () => {
  it('returns mapping for an open assignment in the requested league', async () => {
    playerFindUniqueMock.mockResolvedValueOnce(PLAYER_RECORD)
    const result = await __resolvers_for_testing.legacy('U_stefan', 'l-spring')
    expect(result).toEqual({
      playerId: 'stefan-s',
      playerName: 'Stefan S',
      teamId: 'mariners',
    })
    expect(playerFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { lineId: 'U_stefan' } }),
    )
    expect(userFindUniqueMock).not.toHaveBeenCalled()
  })

  it('returns null when no Player matches', async () => {
    playerFindUniqueMock.mockResolvedValueOnce(null)
    const result = await __resolvers_for_testing.legacy('U_unknown', 'l-spring')
    expect(result).toBeNull()
  })

  it('falls back to past assignment in the same league when no open one', async () => {
    playerFindUniqueMock.mockResolvedValueOnce(PLAYER_RECORD)
    const result = await __resolvers_for_testing.legacy('U_stefan', 'l-fall')
    expect(result?.teamId).toBe('fenix')
  })

  it('returns teamId="" when no assignment in the requested league', async () => {
    playerFindUniqueMock.mockResolvedValueOnce(PLAYER_RECORD)
    const result = await __resolvers_for_testing.legacy('U_stefan', 'l-summer')
    expect(result?.teamId).toBe('')
  })
})

describe('user resolver — User.lineId → User.playerId → Player walk', () => {
  it('returns mapping by walking through User.playerId', async () => {
    userFindUniqueMock.mockResolvedValueOnce({ playerId: 'p-stefan-s' })
    playerFindUniqueMock.mockResolvedValueOnce(PLAYER_RECORD)

    const result = await __resolvers_for_testing.user('U_stefan', 'l-spring')

    expect(result).toEqual({
      playerId: 'stefan-s',
      playerName: 'Stefan S',
      teamId: 'mariners',
    })
    expect(userFindUniqueMock).toHaveBeenCalledWith({
      where: { lineId: 'U_stefan' },
      select: { playerId: true },
    })
    expect(playerFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p-stefan-s' } }),
    )
  })

  it('returns null when no User matches', async () => {
    userFindUniqueMock.mockResolvedValueOnce(null)
    const result = await __resolvers_for_testing.user('U_unknown', 'l-spring')
    expect(result).toBeNull()
    expect(playerFindUniqueMock).not.toHaveBeenCalled()
  })

  it('returns null when User has no playerId set', async () => {
    userFindUniqueMock.mockResolvedValueOnce({ playerId: null })
    const result = await __resolvers_for_testing.user('U_unlinked', 'l-spring')
    expect(result).toBeNull()
    expect(playerFindUniqueMock).not.toHaveBeenCalled()
  })

  it('returns null when Player.id lookup misses (drift case)', async () => {
    userFindUniqueMock.mockResolvedValueOnce({ playerId: 'p-deleted' })
    playerFindUniqueMock.mockResolvedValueOnce(null)
    const result = await __resolvers_for_testing.user('U_drift', 'l-spring')
    expect(result).toBeNull()
  })
})

describe('parity: legacy and user resolvers agree on consistent data', () => {
  it.each([
    ['l-spring', { playerId: 'stefan-s', playerName: 'Stefan S', teamId: 'mariners' }],
    ['l-fall', { playerId: 'stefan-s', playerName: 'Stefan S', teamId: 'fenix' }],
    ['l-summer', { playerId: 'stefan-s', playerName: 'Stefan S', teamId: '' }],
  ])('league=%s produces the same mapping from both resolvers', async (leagueId, expected) => {
    // Legacy path
    playerFindUniqueMock.mockResolvedValueOnce(PLAYER_RECORD)
    const legacyResult = await __resolvers_for_testing.legacy('U_stefan', leagueId)
    expect(legacyResult).toEqual(expected)

    // User path
    userFindUniqueMock.mockResolvedValueOnce({ playerId: 'p-stefan-s' })
    playerFindUniqueMock.mockResolvedValueOnce(PLAYER_RECORD)
    const userResult = await __resolvers_for_testing.user('U_stefan', leagueId)
    expect(userResult).toEqual(expected)
  })
})

describe('flag dispatch: getPlayerMappingFromDb', () => {
  it('routes to legacy resolver when Setting is "legacy"', async () => {
    getIdentityReadSourceMock.mockResolvedValueOnce('legacy')
    playerFindUniqueMock.mockResolvedValueOnce(PLAYER_RECORD)

    const result = await getPlayerMappingFromDb('U_stefan', 'l-spring')

    expect(result?.teamId).toBe('mariners')
    expect(playerFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { lineId: 'U_stefan' } }),
    )
    expect(userFindUniqueMock).not.toHaveBeenCalled()
  })

  it('routes to user resolver when Setting is "user"', async () => {
    getIdentityReadSourceMock.mockResolvedValueOnce('user')
    userFindUniqueMock.mockResolvedValueOnce({ playerId: 'p-stefan-s' })
    playerFindUniqueMock.mockResolvedValueOnce(PLAYER_RECORD)

    const result = await getPlayerMappingFromDb('U_stefan', 'l-spring')

    expect(result?.teamId).toBe('mariners')
    expect(userFindUniqueMock).toHaveBeenCalled()
    expect(playerFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p-stefan-s' } }),
    )
  })

  it('defaults to legacy when getIdentityReadSource throws (defensive)', async () => {
    getIdentityReadSourceMock.mockRejectedValueOnce(new Error('settings cache miss'))
    playerFindUniqueMock.mockResolvedValueOnce(PLAYER_RECORD)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await getPlayerMappingFromDb('U_stefan', 'l-spring')

    expect(result?.teamId).toBe('mariners')
    expect(playerFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { lineId: 'U_stefan' } }),
    )
    expect(userFindUniqueMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('getIdentityReadSource failed'),
      expect.any(Error),
    )
    warnSpy.mockRestore()
  })

  it('reads the flag on every call (no JS-side caching beyond unstable_cache)', async () => {
    // Two consecutive calls must each invoke getIdentityReadSource. The
    // 30s TTL caching lives inside that helper (next/cache); this
    // dispatcher is a thin shim with no memoization of its own.
    getIdentityReadSourceMock.mockResolvedValue('legacy')
    playerFindUniqueMock.mockResolvedValue(PLAYER_RECORD)

    await getPlayerMappingFromDb('U_stefan', 'l-spring')
    await getPlayerMappingFromDb('U_stefan', 'l-spring')

    expect(getIdentityReadSourceMock).toHaveBeenCalledTimes(2)
  })
})
