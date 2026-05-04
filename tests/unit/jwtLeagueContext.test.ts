import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * v1.53.0 (PR 4 of the path-routing chain) — JWT callback resolves
 * `leagueId` via `getDefaultLeagueId()` on every refresh, threads it
 * into `getPlayerMapping(lineId, leagueId)`, and surfaces it to the
 * session via `token.leagueId`.
 *
 * Pre-v1.53.0 the callback resolved against the request Host header
 * (v1.26.0 multi-tenant via subdomains). PR 4 strips the host-header
 * path; the JWT callback now always resolves the default league. When
 * the user is browsing a non-default league via /league/<slug>, the
 * page-level league context drives data; session.{playerId,teamId}
 * reflect the user's default-league mapping (best-effort — Dashboard's
 * render-null branches handle the cross-league case gracefully).
 *
 * Pinned contracts:
 *   - `getDefaultLeagueId` is called on EVERY callback (not just sign-in).
 *   - When it returns a leagueId, `getPlayerMapping(lineId, leagueId)`
 *     resolves the per-league mapping.
 *   - When it returns null (catastrophic config — no default league),
 *     `getPlayerMapping` is NOT called and player/team fields null out.
 *   - When it throws (Prisma down), the error is logged and league fields
 *     fall back to null.
 *   - The admin-credentials path short-circuits before league resolution.
 *   - The session callback surfaces token.leagueId on session.leagueId.
 */

const {
  getMappingMock,
  setMappingMock,
  playerFindUniqueMock,
  getDefaultLeagueIdMock,
  trackLineLoginMock,
} = vi.hoisted(() => ({
  getMappingMock: vi.fn(),
  setMappingMock: vi.fn(),
  playerFindUniqueMock: vi.fn(),
  getDefaultLeagueIdMock: vi.fn(),
  trackLineLoginMock: vi.fn().mockResolvedValue(undefined),
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
    lineLogin: {
      upsert: trackLineLoginMock,
    },
  },
}))

vi.mock('@/lib/leagueSlug', () => ({
  getDefaultLeagueId: getDefaultLeagueIdMock,
}))

import { authOptions } from '@/lib/auth'

const SAMPLE_DEFAULT = {
  playerId: 'ian-noseda',
  playerName: 'Ian Noseda',
  teamId: 'mariners-fc',
}

beforeEach(() => {
  vi.clearAllMocks()
})

const jwt = authOptions.callbacks!.jwt!

describe('JWT callback — v1.53.0 default-league resolution (post-subdomain-teardown)', () => {
  it('resolves leagueId via getDefaultLeagueId and threads it into getPlayerMapping', async () => {
    getDefaultLeagueIdMock.mockResolvedValueOnce('l-default')
    getMappingMock.mockResolvedValueOnce({ status: 'hit', value: SAMPLE_DEFAULT })

    const token = { lineId: 'U1' } as Record<string, unknown>
    const result = await jwt({ token } as Parameters<typeof jwt>[0])

    expect(getDefaultLeagueIdMock).toHaveBeenCalledTimes(1)
    expect(getMappingMock).toHaveBeenCalledWith('U1', 'l-default')
    expect((result as { leagueId: string | null }).leagueId).toBe('l-default')
    expect(result.playerId).toBe('ian-noseda')
    expect(result.teamId).toBe('mariners-fc')
  })

  it('null leagueId (no default league configured) → token.leagueId=null, getPlayerMapping NOT called, fields nulled', async () => {
    getDefaultLeagueIdMock.mockResolvedValueOnce(null)

    const token = {
      lineId: 'U1',
      // Stale fields from a previous JWT callback.
      playerId: 'ian-noseda',
      playerName: 'Ian Noseda',
      teamId: 'mariners-fc',
    } as Record<string, unknown>
    const result = await jwt({ token } as Parameters<typeof jwt>[0])

    expect((result as { leagueId: string | null }).leagueId).toBeNull()
    expect(getMappingMock).not.toHaveBeenCalled()
    expect(result.playerId).toBeNull()
    expect(result.playerName).toBeNull()
    expect(result.teamId).toBeNull()
  })

  it('resolves leagueId on EVERY callback, not just sign-in', async () => {
    getDefaultLeagueIdMock
      .mockResolvedValueOnce('l-default')
      .mockResolvedValueOnce('l-default')
    getMappingMock
      .mockResolvedValueOnce({ status: 'hit', value: SAMPLE_DEFAULT })
      .mockResolvedValueOnce({ status: 'hit', value: SAMPLE_DEFAULT })

    await jwt({
      token: { lineId: 'U1' } as Record<string, unknown>,
    } as Parameters<typeof jwt>[0])

    await jwt({
      token: { lineId: 'U1' } as Record<string, unknown>,
    } as Parameters<typeof jwt>[0])

    expect(getDefaultLeagueIdMock).toHaveBeenCalledTimes(2)
  })

  it('does not crash when getDefaultLeagueId throws — falls back to leagueId=null', async () => {
    getDefaultLeagueIdMock.mockRejectedValueOnce(new Error('Prisma down'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const token = { lineId: 'U1' } as Record<string, unknown>
    const result = await jwt({ token } as Parameters<typeof jwt>[0])

    expect((result as { leagueId: string | null }).leagueId).toBeNull()
    expect(getMappingMock).not.toHaveBeenCalled()
    expect(result.playerId).toBeNull()

    errorSpy.mockRestore()
  })

  it('preserves the admin path — admin-credentials provider does NOT resolve leagueId', async () => {
    const token = { authProvider: 'admin-credentials' } as Record<string, unknown>
    const result = await jwt({ token } as Parameters<typeof jwt>[0])

    expect(getDefaultLeagueIdMock).not.toHaveBeenCalled()
    expect(result.leagueId).toBeUndefined()
    expect(result.isAdmin).toBe(true)
  })
})

describe('Session callback — leagueId surface', () => {
  const sessionCb = authOptions.callbacks!.session!

  it('exposes token.leagueId on session.leagueId', async () => {
    const result = await sessionCb({
      session: {} as Parameters<typeof sessionCb>[0]['session'],
      token: { leagueId: 'l-default', lineId: 'U1' } as Parameters<typeof sessionCb>[0]['token'],
    } as Parameters<typeof sessionCb>[0])

    expect((result as { leagueId: string | null }).leagueId).toBe('l-default')
  })

  it('null leagueId on the token surfaces as null on the session', async () => {
    const result = await sessionCb({
      session: {} as Parameters<typeof sessionCb>[0]['session'],
      token: { leagueId: null, lineId: 'U1' } as Parameters<typeof sessionCb>[0]['token'],
    } as Parameters<typeof sessionCb>[0])

    expect((result as { leagueId: string | null }).leagueId).toBeNull()
  })

  it('missing leagueId on the token defaults to null on the session (defensive)', async () => {
    const result = await sessionCb({
      session: {} as Parameters<typeof sessionCb>[0]['session'],
      token: { lineId: 'U1' } as Parameters<typeof sessionCb>[0]['token'],
    } as Parameters<typeof sessionCb>[0])

    expect((result as { leagueId: string | null }).leagueId).toBeNull()
  })
})
