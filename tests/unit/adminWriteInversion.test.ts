import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * v1.13.0 — admin Redis pre-warm deferral via waitUntil.
 *
 * Pre-v1.13.0 the admin server actions (`adminLinkLineToPlayer`,
 * `updatePlayer`, `createPlayer`) awaited `setMapping(...)` on the response
 * critical path. Admin Prisma writes stay synchronous — admin pages re-read
 * Prisma directly via `revalidatePath` — but the Redis pre-warm doesn't need
 * to block the response. v1.13.0 mirrors the v1.8.0 public-hot-path
 * inversion: `setMapping` is wrapped in `waitUntil(setMapping(...).catch(structuredDriftLog))`
 * so admin clicks resolve before the Upstash round-trip lands.
 *
 * Regression targets:
 *   - the action returns BEFORE the deferred setMapping resolves
 *   - waitUntil is called with a Promise (the action handed it off rather
 *     than awaited it)
 *   - on setMapping rejection, the [v1.13.0 DRIFT] log line emits and the
 *     action does NOT throw (admin UX must not surface Upstash blips)
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

describe('adminLinkLineToPlayer — Redis pre-warm deferred via waitUntil', () => {
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

    expect(setMappingMock).toHaveBeenCalledWith(
      'U-new',
      expect.objectContaining({ playerId: 'p-fresh' }),
    )
    expect(waitUntilMock).toHaveBeenCalledTimes(1)
    expect(capturedPromise).toBeInstanceOf(Promise)

    // Drain — resolving the background promise should not throw.
    resolveSetMapping()
    await capturedPromise
  })

  it('emits a [v1.13.0 DRIFT] log line when the deferred setMapping rejects', async () => {
    findUniqueMock.mockResolvedValueOnce({ lineId: null })
    setMappingMock.mockRejectedValueOnce(new Error('Upstash unreachable'))

    waitUntilMock.mockImplementation((p: unknown) => {
      // Eagerly catch so the test runner doesn't see an unhandled rejection.
      ;(p as Promise<unknown>).catch(() => {})
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // The action MUST NOT throw — admin UX must not surface Upstash blips,
    // since the durable Prisma write already landed synchronously.
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
    // The log line carries op + lineId so operators can grep + replay.
    expect(driftCall?.[0]).toContain('op=%s')
    expect(driftCall?.[1]).toBe('admin-link')
    expect(driftCall?.[2]).toBe('U-new')

    errorSpy.mockRestore()
  })
})

describe('updatePlayer — Redis pre-warm deferred via waitUntil', () => {
  it('returns BEFORE the deferred setMapping resolves and tags the drift log with admin-update', async () => {
    findUniqueMock.mockResolvedValueOnce({ lineId: null })

    let resolveSetMapping: () => void = () => {}
    const setMappingDeferred = new Promise<void>((resolve) => {
      resolveSetMapping = () => resolve()
    })
    setMappingMock.mockReturnValueOnce(setMappingDeferred)

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

    expect(setMappingMock).toHaveBeenCalledWith(
      'U-new',
      expect.objectContaining({ playerId: 'p-fresh' }),
    )
    expect(waitUntilMock).toHaveBeenCalledTimes(1)
    expect(capturedPromise).toBeInstanceOf(Promise)

    resolveSetMapping()
    await capturedPromise
  })

  it('logs admin-update on deferred setMapping failure', async () => {
    findUniqueMock.mockResolvedValueOnce({ lineId: null })
    setMappingMock.mockRejectedValueOnce(new Error('Upstash unreachable'))

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
      (args) => typeof args[0] === 'string' && args[0].includes('[v1.13.0 DRIFT]'),
    )
    expect(driftCall?.[1]).toBe('admin-update')

    errorSpy.mockRestore()
  })
})

describe('createPlayer — Redis pre-warm deferred via waitUntil', () => {
  it('defers setMapping for the new lineId and tags the drift log with admin-create', async () => {
    setMappingMock.mockRejectedValueOnce(new Error('Upstash unreachable'))
    waitUntilMock.mockImplementation((p: unknown) => {
      ;(p as Promise<unknown>).catch(() => {})
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const fd = new FormData()
    fd.append('name', 'New Player')
    fd.append('lineId', 'U-new')

    await createPlayer(fd)
    await new Promise((r) => setImmediate(r))

    expect(setMappingMock).toHaveBeenCalledWith(
      'U-new',
      expect.objectContaining({ playerId: 'p-fresh' }),
    )
    expect(waitUntilMock).toHaveBeenCalledTimes(1)

    const driftCall = errorSpy.mock.calls.find(
      (args) => typeof args[0] === 'string' && args[0].includes('[v1.13.0 DRIFT]'),
    )
    expect(driftCall?.[1]).toBe('admin-create')

    errorSpy.mockRestore()
  })

  it('does NOT call setMapping or waitUntil when no lineId is supplied', async () => {
    const fd = new FormData()
    fd.append('name', 'New Player')
    fd.append('lineId', '')

    await createPlayer(fd)

    expect(setMappingMock).not.toHaveBeenCalled()
    expect(waitUntilMock).not.toHaveBeenCalled()
  })
})
