import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Pins the v1.5.0 (PR 16) auth-path semantics around the player-mapping
 * store. The JWT callback in `lib/auth.ts` reads the mapping via the
 * private `getPlayerMapping` — exposed here as `__getPlayerMapping_for_testing`
 * — and applies these rules:
 *
 *   store hit            → return value
 *   store miss           → return null  (NEW: no Prisma fallback)
 *   store error          → fall through to Prisma, then pre-warm the store
 *
 * The miss-vs-error distinction is the architectural change. Pre-v1.5.0 the
 * `getCached` helper collapsed both into `undefined` and the auth path
 * unconditionally fell through to Prisma — making Prisma the canonical
 * source for the mapping. v1.5.0 inverts that: Redis is canonical; Prisma
 * is the defensive backup so that an Upstash transient outage doesn't null
 * every authenticated session for the duration of the blip.
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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getPlayerMapping — store hit (v1.5.0)', () => {
  it('returns the value from the store without touching Prisma', async () => {
    getMappingMock.mockResolvedValue({ status: 'hit', value: SAMPLE })

    const result = await getPlayerMapping('U1')

    expect(result).toEqual(SAMPLE)
    expect(playerFindUniqueMock).not.toHaveBeenCalled()
    expect(setMappingMock).not.toHaveBeenCalled()
  })

  it('returns null directly when the store has the null sentinel for an orphan', async () => {
    getMappingMock.mockResolvedValue({ status: 'hit', value: null })

    const result = await getPlayerMapping('U-orphan-cached')

    expect(result).toBeNull()
    expect(playerFindUniqueMock).not.toHaveBeenCalled()
  })
})

describe('getPlayerMapping — store miss (v1.5.0 contract — NO Prisma fallback)', () => {
  it('returns null without consulting Prisma — orphan must re-link or wait for admin', async () => {
    // The architectural shift: a miss means "no mapping in canonical store",
    // not "we should ask Prisma". This is the regression target — if a
    // future edit re-adds a Prisma fallback in this branch, every
    // never-linked LINE user pays a cold-Neon Prisma round-trip on every
    // request, defeating v1.5.0's purpose.
    getMappingMock.mockResolvedValue({ status: 'miss' })

    const result = await getPlayerMapping('U-never-linked')

    expect(result).toBeNull()
    expect(playerFindUniqueMock).not.toHaveBeenCalled()
    expect(setMappingMock).not.toHaveBeenCalled()
  })
})

describe('getPlayerMapping — store error (defensive Prisma fallback for Upstash transients)', () => {
  it('falls through to Prisma when Redis errors and pre-warms the store on success', async () => {
    getMappingMock.mockResolvedValue({ status: 'error', reason: 'redis-error' })
    playerFindUniqueMock.mockResolvedValue({
      id: 'p-ian-noseda',
      name: 'Ian Noseda',
      leagueAssignments: [
        {
          toGameWeek: null,
          fromGameWeek: 1,
          leagueTeam: { team: { id: 't-mariners-fc' } },
        },
      ],
    })

    const result = await getPlayerMapping('U-during-outage')

    expect(result).toEqual(SAMPLE)
    expect(playerFindUniqueMock).toHaveBeenCalledTimes(1)
    // The fallback writes back to the store on success so the next request
    // finds the entry directly.
    expect(setMappingMock).toHaveBeenCalledWith('U-during-outage', SAMPLE)
  })

  it('falls through to Prisma when the store reports no-client (Upstash unconfigured)', async () => {
    // Local-dev-without-Upstash and the rare unconfigured-prod-deploy path:
    // store reports `no-client` instead of `redis-error`, but the auth
    // callback treats them the same — fall through to Prisma so existing
    // sessions stay alive.
    getMappingMock.mockResolvedValue({ status: 'error', reason: 'no-client' })
    playerFindUniqueMock.mockResolvedValue({
      id: 'p-ian-noseda',
      name: 'Ian Noseda',
      leagueAssignments: [
        {
          toGameWeek: null,
          fromGameWeek: 1,
          leagueTeam: { team: { id: 't-mariners-fc' } },
        },
      ],
    })

    const result = await getPlayerMapping('U-no-client')

    expect(result).toEqual(SAMPLE)
    expect(playerFindUniqueMock).toHaveBeenCalledTimes(1)
  })

  it('returns null when both the store errors AND Prisma errors (worst-case orphan)', async () => {
    // Both stores down. The auth callback can't resolve a mapping; the
    // user is treated as orphan. This is the same failure mode as
    // pre-v1.5.0 when Prisma was down — degraded but not catastrophic
    // (the JWT itself stays valid; only the mapping fields are null).
    getMappingMock.mockResolvedValue({ status: 'error', reason: 'redis-error' })
    playerFindUniqueMock.mockRejectedValue(new Error('Prisma connection failed'))

    const result = await getPlayerMapping('U-double-outage')

    expect(result).toBeNull()
    // Don't try to pre-warm the store with garbage — Prisma failure means
    // we never reached a fresh mapping.
    expect(setMappingMock).not.toHaveBeenCalled()
  })

  it('returns null when the store errors AND Prisma confirms the user is genuinely orphan', async () => {
    getMappingMock.mockResolvedValue({ status: 'error', reason: 'redis-error' })
    playerFindUniqueMock.mockResolvedValue(null)

    const result = await getPlayerMapping('U-genuinely-orphan')

    expect(result).toBeNull()
    // Pre-warm the null result so the next request resolves from the store
    // directly without paying another Prisma round-trip.
    expect(setMappingMock).toHaveBeenCalledWith('U-genuinely-orphan', null)
  })
})
