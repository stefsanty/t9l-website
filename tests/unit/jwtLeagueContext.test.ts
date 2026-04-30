import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * v1.26.0 — JWT callback resolves `leagueId` from the request Host header
 * on every refresh, threads it into `getPlayerMapping(lineId, leagueId)`,
 * and surfaces it to the session via `token.leagueId`.
 *
 * Pre-v1.26.0 the JWT was league-blind: the callback called
 * `getPlayerMapping(lineId)` and the cache key was a single value per
 * LINE user. With multi-tenant, a player may be assigned to different
 * teams in different leagues; the cross-league correct behavior is to
 * resolve the per-league mapping based on the host the user is currently
 * viewing.
 *
 * Pinned contracts:
 *   - Apex / known subdomain → leagueId resolved from getLeagueIdFromRequest;
 *     getPlayerMapping called with (lineId, leagueId)
 *   - Unknown subdomain (getLeagueIdFromRequest → null) → token leagueId
 *     is null, getPlayerMapping is NOT called, token.{playerId,teamId}
 *     are nulled out so we don't surface stale league data
 *   - The leagueId is resolved on EVERY callback (not just sign-in) so
 *     navigating across subdomains updates the per-league mapping
 *     deterministically (regression target — pre-v1.26.0 setting it
 *     once at sign-in would persist the wrong league across nav)
 */

const {
  getMappingMock,
  setMappingMock,
  playerFindUniqueMock,
  getLeagueIdFromRequestMock,
  trackLineLoginMock,
} = vi.hoisted(() => ({
  getMappingMock: vi.fn(),
  setMappingMock: vi.fn(),
  playerFindUniqueMock: vi.fn(),
  getLeagueIdFromRequestMock: vi.fn(),
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

vi.mock('@/lib/getLeagueFromHost', () => ({
  getLeagueIdFromRequest: getLeagueIdFromRequestMock,
}))

import { authOptions } from '@/lib/auth'

const SAMPLE_DEFAULT = {
  playerId: 'ian-noseda',
  playerName: 'Ian Noseda',
  teamId: 'mariners-fc',
}

const SAMPLE_TAMACHI = {
  playerId: 'ian-noseda',
  playerName: 'Ian Noseda',
  teamId: 'fenix-fc',
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: KV unset shape isn't relevant here — only the JWT callback
  // matters and it goes through the mocked store.
})

// Resolve the JWT callback once per test from the (typed) authOptions.
const jwt = authOptions.callbacks!.jwt!

describe('JWT callback — v1.26.0 league context resolution', () => {
  it('resolves leagueId from getLeagueIdFromRequest and threads it into getPlayerMapping', async () => {
    getLeagueIdFromRequestMock.mockResolvedValueOnce('l-default')
    getMappingMock.mockResolvedValueOnce({ status: 'hit', value: SAMPLE_DEFAULT })

    const token = { lineId: 'U1' } as Record<string, unknown>
    const result = await jwt({ token } as Parameters<typeof jwt>[0])

    expect(getLeagueIdFromRequestMock).toHaveBeenCalledTimes(1)
    expect(getMappingMock).toHaveBeenCalledWith('U1', 'l-default')
    expect((result as { leagueId: string | null }).leagueId).toBe('l-default')
    expect(result.playerId).toBe('ian-noseda')
    expect(result.teamId).toBe('mariners-fc')
  })

  it('different host → different leagueId → different per-league teamId surfaced on the token', async () => {
    // Regression target: a player assigned to t-mariners-fc in the default
    // league AND t-fenix-fc in tamachi must surface different teamId
    // values depending on which subdomain the JWT callback runs against.
    getLeagueIdFromRequestMock.mockResolvedValueOnce('l-tamachi')
    getMappingMock.mockResolvedValueOnce({ status: 'hit', value: SAMPLE_TAMACHI })

    const token = { lineId: 'U1' } as Record<string, unknown>
    const result = await jwt({ token } as Parameters<typeof jwt>[0])

    expect(getMappingMock).toHaveBeenCalledWith('U1', 'l-tamachi')
    expect(result.leagueId).toBe('l-tamachi')
    expect(result.teamId).toBe('fenix-fc')
  })

  it('unknown subdomain (leagueId=null) → token.leagueId=null, getPlayerMapping NOT called, fields nulled', async () => {
    // Regression target: we must NOT serve cross-league data when the
    // host doesn't map to a known league. Pre-v1.26.0 (or any post-v1.26
    // edit that omits this branch) would surface the previous league's
    // teamId on an unknown-subdomain navigation.
    getLeagueIdFromRequestMock.mockResolvedValueOnce(null)

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

  it('resolves leagueId on EVERY callback, not just sign-in (regression target)', async () => {
    // Pre-v1.26.0 a naive implementation might set leagueId once when
    // `account && profile` are present (at sign-in) and skip resolution on
    // subsequent refreshes. That would mean a user signed in on apex
    // and then navigating to tamachi.t9l.me would still see apex data.
    // The contract: every JWT callback re-resolves from the host.
    getLeagueIdFromRequestMock
      .mockResolvedValueOnce('l-default')
      .mockResolvedValueOnce('l-tamachi')
    getMappingMock
      .mockResolvedValueOnce({ status: 'hit', value: SAMPLE_DEFAULT })
      .mockResolvedValueOnce({ status: 'hit', value: SAMPLE_TAMACHI })

    // First refresh — apex.
    const r1 = await jwt({
      token: { lineId: 'U1' } as Record<string, unknown>,
    } as Parameters<typeof jwt>[0])
    // Snapshot the relevant fields before issuing the second callback —
    // next-auth mutates the token by reference, so r1 and r2 share the
    // same object identity. Asserting on captured copies keeps each
    // callback's outcome independent.
    const r1TeamId = r1.teamId
    const r1LeagueId = r1.leagueId

    // Second refresh — tamachi (fresh token to mirror what a new request
    // would carry — the cookie-deserialized JWT is a fresh object each
    // time anyway).
    const r2 = await jwt({
      token: { lineId: 'U1' } as Record<string, unknown>,
    } as Parameters<typeof jwt>[0])

    expect(getLeagueIdFromRequestMock).toHaveBeenCalledTimes(2)
    expect(r1TeamId).toBe('mariners-fc')
    expect(r1LeagueId).toBe('l-default')
    expect(r2.teamId).toBe('fenix-fc')
    expect(r2.leagueId).toBe('l-tamachi')
  })

  it('does not crash when getLeagueIdFromRequest throws — falls back to leagueId=null', async () => {
    getLeagueIdFromRequestMock.mockRejectedValueOnce(new Error('Prisma down'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const token = { lineId: 'U1' } as Record<string, unknown>
    const result = await jwt({ token } as Parameters<typeof jwt>[0])

    expect((result as { leagueId: string | null }).leagueId).toBeNull()
    expect(getMappingMock).not.toHaveBeenCalled()
    expect(result.playerId).toBeNull()

    errorSpy.mockRestore()
  })

  it('preserves the admin path — admin-credentials provider does NOT resolve leagueId', async () => {
    // Admin is global; the admin shell renders /admin/* which is league-
    // independent. The JWT callback short-circuits before the leagueId
    // resolve path runs.
    const token = { authProvider: 'admin-credentials' } as Record<string, unknown>
    const result = await jwt({ token } as Parameters<typeof jwt>[0])

    expect(getLeagueIdFromRequestMock).not.toHaveBeenCalled()
    expect(result.leagueId).toBeUndefined()
    expect(result.isAdmin).toBe(true)
  })
})

describe('Session callback — v1.26.0 leagueId surface', () => {
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
