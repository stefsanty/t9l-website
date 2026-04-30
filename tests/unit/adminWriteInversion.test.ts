import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * v1.13.0 — admin Redis pre-warm deferral via waitUntil.
 * v1.26.0 — per-league cache shape; admin write paths split into:
 *   - `adminLinkLineToPlayer` (knows leagueId): per-league setMapping
 *     deferred via waitUntil; on the target's PRIOR lineId, deleteMapping
 *     across all leagues (admin remap is a global lineId binding change).
 *   - `updatePlayer` / `createPlayer` (no single league context): no
 *     per-league pre-warm; deferDeleteMappingAcrossLeagues invalidates
 *     every per-(leagueId, lineId) entry for the affected lineIds, lazy-
 *     fill on next read.
 *
 * Regression targets:
 *   - the action returns BEFORE the deferred Redis call resolves
 *   - waitUntil is called with a Promise (the action handed it off rather
 *     than awaited it)
 *   - on rejection, the [v1.13.0 DRIFT] / [v1.26.0 DRIFT] log line emits
 *     and the action does NOT throw (admin UX must not surface Upstash
 *     blips)
 */

const {
  findUniqueMock,
  updateMock,
  updateManyMock,
  transactionMock,
  createMock,
  setMappingMock,
  deleteMappingMock,
  getPlayerMappingFromDbMock,
  waitUntilMock,
  revalidateMock,
} = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  updateMock: vi.fn().mockResolvedValue({}),
  updateManyMock: vi.fn().mockResolvedValue({ count: 0 }),
  transactionMock: vi.fn().mockResolvedValue([]),
  createMock: vi.fn().mockResolvedValue({}),
  setMappingMock: vi.fn().mockResolvedValue(undefined),
  deleteMappingMock: vi.fn().mockResolvedValue(undefined),
  getPlayerMappingFromDbMock: vi.fn().mockResolvedValue({
    playerId: 'p-fresh',
    playerName: 'Fresh Player',
    teamId: 't-team',
  }),
  waitUntilMock: vi.fn(),
  revalidateMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    player: {
      findUnique: findUniqueMock,
      update: updateMock,
      updateMany: updateManyMock,
      create: createMock,
    },
    $transaction: transactionMock,
  },
}))

vi.mock('@/lib/playerMappingStore', () => ({
  setMapping: setMappingMock,
  deleteMapping: deleteMappingMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
  getPlayerMappingFromDb: getPlayerMappingFromDbMock,
}))

vi.mock('@/lib/revalidate', () => ({
  revalidate: revalidateMock,
}))

vi.mock('@/lib/rsvpStore', () => ({
  seedGameWeek: vi.fn(),
  deleteGameWeek: vi.fn(),
}))

vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}))

vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue({ isAdmin: true }),
}))

vi.mock('@vercel/functions', () => ({
  waitUntil: waitUntilMock,
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}))

import { adminLinkLineToPlayer } from '@/app/admin/leagues/actions'
import { updatePlayer, createPlayer } from '@/app/admin/actions'

beforeEach(() => {
  vi.clearAllMocks()
  // Default: waitUntil is a no-op capture (production behavior outside the
  // Vercel runtime is also a no-op via the optional-chained getContext().waitUntil).
  waitUntilMock.mockImplementation(() => {
    /* no-op */
  })
})

describe('adminLinkLineToPlayer — Redis pre-warm deferred via waitUntil (v1.26.0 per-league)', () => {
  it('returns BEFORE the deferred setMapping resolves (regression target)', async () => {
    findUniqueMock.mockResolvedValueOnce({ lineId: null })

    // Build a deferred setMapping promise that we resolve after-the-fact.
    let resolveSetMapping: () => void = () => {}
    const setMappingDeferred = new Promise<void>((resolve) => {
      resolveSetMapping = () => resolve()
    })
    setMappingMock.mockReturnValueOnce(setMappingDeferred)

    let capturedPromise: Promise<unknown> | null = null
    waitUntilMock.mockImplementation((p: unknown) => {
      capturedPromise = p as Promise<unknown>
    })

    // The action must resolve even though setMapping is still pending.
    await adminLinkLineToPlayer({
      playerId: 'p-target',
      lineId: 'U-new',
      leagueId: 'l-spring',
    })

    // v1.26.0 — per-league setMapping(lineId, leagueId, mapping).
    expect(setMappingMock).toHaveBeenCalledWith(
      'U-new',
      'l-spring',
      expect.objectContaining({ playerId: 'p-fresh' }),
    )
    expect(waitUntilMock).toHaveBeenCalledTimes(1)
    expect(capturedPromise).toBeInstanceOf(Promise)

    // Drain — resolving the background promise should not throw.
    resolveSetMapping()
    await capturedPromise
  })

  it('threads the leagueId into getPlayerMappingFromDb so the right per-league assignment is resolved (v1.26.0)', async () => {
    findUniqueMock.mockResolvedValueOnce({ lineId: null })

    await adminLinkLineToPlayer({
      playerId: 'p-target',
      lineId: 'U-new',
      leagueId: 'l-spring',
    })

    // v1.26.0 — pre-warm shape includes leagueId. Without this, an admin
    // link in League X would seed Redis with the player's primary-league
    // teamId — wrong for League X.
    expect(getPlayerMappingFromDbMock).toHaveBeenCalledWith('U-new', 'l-spring')
  })

  it('emits a [v1.13.0 DRIFT] log line when the deferred setMapping rejects', async () => {
    findUniqueMock.mockResolvedValueOnce({ lineId: null })
    setMappingMock.mockRejectedValueOnce(new Error('Upstash unreachable'))

    waitUntilMock.mockImplementation((p: unknown) => {
      // Eagerly catch so the test runner doesn't see an unhandled rejection.
      ;(p as Promise<unknown>).catch(() => {})
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // The action MUST NOT throw — admin UX must not surface Upstash blips.
    await expect(
      adminLinkLineToPlayer({
        playerId: 'p-target',
        lineId: 'U-new',
        leagueId: 'l-spring',
      }),
    ).resolves.toBeUndefined()

    // Drain microtasks so the deferred catch runs.
    await new Promise((r) => setImmediate(r))

    const driftCall = errorSpy.mock.calls.find(
      (args) => typeof args[0] === 'string' && args[0].includes('[v1.13.0 DRIFT]'),
    )
    expect(driftCall).toBeDefined()
    expect(driftCall?.[0]).toContain('op=%s')
    expect(driftCall?.[1]).toBe('admin-link')
    expect(driftCall?.[2]).toBe('U-new')
    // v1.26.0 — DRIFT log carries leagueId for operator replay.
    expect(driftCall?.[3]).toBe('l-spring')

    errorSpy.mockRestore()
  })
})

describe('updatePlayer — invalidates per-league cache via SCAN-and-DEL (v1.26.0)', () => {
  it('defers deleteMapping(newLineId) for cache invalidation; does NOT call setMapping (lazy-fill on next read)', async () => {
    // v1.26.0 — updatePlayer no longer pre-warms the cache because the
    // Player is global (may be in N leagues) and the admin write doesn't
    // operate within a single league context. Instead it invalidates
    // across all leagues; first JWT callback per (leagueId, lineId) hits
    // Prisma + writes back.
    findUniqueMock.mockResolvedValueOnce({ lineId: null })

    let resolveDelete: () => void = () => {}
    const deleteDeferred = new Promise<void>((resolve) => {
      resolveDelete = () => resolve()
    })
    deleteMappingMock.mockReturnValueOnce(deleteDeferred)

    let capturedPromise: Promise<unknown> | null = null
    waitUntilMock.mockImplementation((p: unknown) => {
      capturedPromise = p as Promise<unknown>
    })

    const fd = new FormData()
    fd.append('id', 'p-target')
    fd.append('name', 'Test Player')
    fd.append('lineId', 'U-new')
    fd.append('pictureUrl', '')

    await updatePlayer(fd)

    expect(setMappingMock).not.toHaveBeenCalled()
    expect(deleteMappingMock).toHaveBeenCalledWith('U-new')
    expect(waitUntilMock).toHaveBeenCalledTimes(1)
    expect(capturedPromise).toBeInstanceOf(Promise)

    resolveDelete()
    await capturedPromise
  })

  it('logs admin-update on deferred deleteMapping failure', async () => {
    findUniqueMock.mockResolvedValueOnce({ lineId: null })
    deleteMappingMock.mockRejectedValueOnce(new Error('Upstash unreachable'))

    waitUntilMock.mockImplementation((p: unknown) => {
      ;(p as Promise<unknown>).catch(() => {})
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const fd = new FormData()
    fd.append('id', 'p-target')
    fd.append('name', 'Test Player')
    fd.append('lineId', 'U-new')
    fd.append('pictureUrl', '')

    await expect(updatePlayer(fd)).resolves.toBeUndefined()
    await new Promise((r) => setImmediate(r))

    const driftCall = errorSpy.mock.calls.find(
      (args) => typeof args[0] === 'string' && args[0].includes('[v1.26.0 DRIFT]'),
    )
    expect(driftCall?.[1]).toBe('admin-update')
    expect(driftCall?.[2]).toBe('U-new')

    errorSpy.mockRestore()
  })

  it('invalidates the prior lineId AND the new lineId when the lineId changes', async () => {
    findUniqueMock.mockResolvedValueOnce({ lineId: 'U-old' })

    const fd = new FormData()
    fd.append('id', 'p-target')
    fd.append('name', 'Test Player')
    fd.append('lineId', 'U-new')
    fd.append('pictureUrl', '')

    await updatePlayer(fd)

    // Prior lineId — the previous holder no longer maps to this player in any league.
    expect(deleteMappingMock).toHaveBeenCalledWith('U-old')
    // New lineId — invalidate any stale cached null sentinels across leagues.
    expect(deleteMappingMock).toHaveBeenCalledWith('U-new')
    expect(waitUntilMock).toHaveBeenCalledTimes(2)
  })
})

describe('createPlayer — invalidates per-league cache via SCAN-and-DEL (v1.26.0)', () => {
  it('defers deleteMapping for the new lineId and tags the drift log with admin-update', async () => {
    deleteMappingMock.mockRejectedValueOnce(new Error('Upstash unreachable'))
    waitUntilMock.mockImplementation((p: unknown) => {
      ;(p as Promise<unknown>).catch(() => {})
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const fd = new FormData()
    fd.append('name', 'New Player')
    fd.append('lineId', 'U-new')

    await createPlayer(fd)
    await new Promise((r) => setImmediate(r))

    // v1.26.0 — createPlayer doesn't pre-warm because the new Player has
    // no league assignments yet. Just invalidate any stale cached null
    // sentinels across leagues.
    expect(setMappingMock).not.toHaveBeenCalled()
    expect(deleteMappingMock).toHaveBeenCalledWith('U-new')
    expect(waitUntilMock).toHaveBeenCalledTimes(1)

    const driftCall = errorSpy.mock.calls.find(
      (args) => typeof args[0] === 'string' && args[0].includes('[v1.26.0 DRIFT]'),
    )
    expect(driftCall?.[1]).toBe('admin-update')
    expect(driftCall?.[2]).toBe('U-new')

    errorSpy.mockRestore()
  })

  it('does NOT call setMapping/deleteMapping or waitUntil when no lineId is supplied', async () => {
    const fd = new FormData()
    fd.append('name', 'New Player')
    fd.append('lineId', '')

    await createPlayer(fd)

    expect(setMappingMock).not.toHaveBeenCalled()
    expect(deleteMappingMock).not.toHaveBeenCalled()
    expect(waitUntilMock).not.toHaveBeenCalled()
  })
})
