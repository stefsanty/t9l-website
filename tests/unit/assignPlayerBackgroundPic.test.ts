import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Regression test for PR 12 / v1.3.1 — the LINE profile picture upload must
 * run as background work via `waitUntil`, not on the response critical path.
 *
 * Pre-fix the route awaited LINE-CDN fetch + Blob put + Redis SET serially
 * before returning. That added 200–500ms warm and meaningfully more cold to
 * every assign-player response on the user's perceived path. The link
 * itself only needs the Prisma transaction; pictures land out of band.
 *
 * Contract pinned here:
 *   - When session has both `linePictureUrl` AND `BLOB_READ_WRITE_TOKEN`:
 *       * waitUntil() is called exactly once
 *       * the response returns 200 BEFORE the background work resolves
 *       * the synchronous Prisma transaction does NOT include pictureUrl
 *   - When linePictureUrl is empty: waitUntil is NOT called
 *   - When BLOB_READ_WRITE_TOKEN is absent: waitUntil is NOT called
 */

const {
  transactionMock,
  playerUpdateMock,
  playerUpdateManyMock,
  playerFindUniqueMock,
  getServerSessionMock,
  waitUntilMock,
  putMock,
  setCachedMock,
} = vi.hoisted(() => ({
  transactionMock: vi.fn().mockResolvedValue([]),
  playerUpdateMock: vi.fn().mockResolvedValue({}),
  playerUpdateManyMock: vi.fn().mockResolvedValue({ count: 0 }),
  playerFindUniqueMock: vi.fn().mockResolvedValue({ id: 'p-test-player' }),
  getServerSessionMock: vi.fn(),
  waitUntilMock: vi.fn(),
  putMock: vi.fn().mockResolvedValue({ url: 'https://blob.example/pic.png' }),
  setCachedMock: vi.fn(),
}))

vi.mock('@/lib/playerMappingCache', () => ({
  setMapping: setCachedMock,
  deleteMapping: vi.fn(),
  getMapping: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: transactionMock,
    player: {
      findUnique: playerFindUniqueMock,
      update: playerUpdateMock,
      updateMany: playerUpdateManyMock,
    },
  },
}))

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/publicData', () => ({
  getPublicLeagueData: vi.fn().mockResolvedValue({
    players: [{ id: 'test-player', name: 'Test Player', teamId: 'test-team' }],
  }),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@vercel/functions', () => ({
  waitUntil: waitUntilMock,
}))

vi.mock('@vercel/blob', () => ({
  put: putMock,
}))

import { POST } from '@/app/api/assign-player/route'

beforeEach(() => {
  vi.clearAllMocks()
  // Restore the pass-through default for the per-test session override.
  getServerSessionMock.mockResolvedValue({
    lineId: 'U-test',
    linePictureUrl: 'https://line-cdn.example/avatar.png',
  })
  process.env.BLOB_READ_WRITE_TOKEN = 'fake-blob-token'
})

describe('POST /api/assign-player schedules pic upload via waitUntil (PR 12)', () => {
  it('calls waitUntil exactly once when linePictureUrl + BLOB_READ_WRITE_TOKEN are set', async () => {
    const req = new Request('http://localhost/api/assign-player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'test-player' }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(waitUntilMock).toHaveBeenCalledTimes(1)
    expect(waitUntilMock.mock.calls[0][0]).toBeInstanceOf(Promise)
  })

  // The response must NOT await the background work — that's the whole point
  // of moving Blob upload off the critical path. Set put() to a Promise that
  // never resolves: if the route is awaiting it, `await POST(req)` below
  // hangs and the test times out. If the route is correctly fire-and-forget
  // (via waitUntil), POST resolves immediately and the assertion passes.
  it('returns the response BEFORE the background pic-upload Promise resolves', async () => {
    putMock.mockImplementationOnce(
      () => new Promise<{ url: string }>(() => { /* never resolves */ }),
    )

    // Stall fetch quickly so the background work lands on the put() stall.
    const originalFetch = global.fetch
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['img']),
    } as unknown as Response)

    const req = new Request('http://localhost/api/assign-player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'test-player' }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(waitUntilMock).toHaveBeenCalledTimes(1)

    global.fetch = originalFetch
  })

  it('does NOT include pictureUrl in the synchronous Prisma transaction', async () => {
    const req = new Request('http://localhost/api/assign-player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'test-player' }),
    })

    await POST(req)

    // Inspect the second argument to $transaction — an array of Prisma promises.
    // The route uses prisma.player.update for the target lineId set; assert
    // that update's `data` argument has lineId only, no pictureUrl.
    const updateCalls = (
      vi.mocked(playerUpdateMock).mock.calls as unknown as Array<[unknown]>
    )
    const setLineIdCall = updateCalls.find((args) => {
      const arg = args[0] as { where?: { id?: string }; data?: Record<string, unknown> }
      return arg?.where?.id === 'p-test-player' && arg?.data && 'lineId' in arg.data
    })
    expect(setLineIdCall).toBeDefined()
    const dataArg = (setLineIdCall![0] as { data: Record<string, unknown> }).data
    expect(dataArg).not.toHaveProperty('pictureUrl')
  })

  it('does NOT call waitUntil when session has no linePictureUrl', async () => {
    getServerSessionMock.mockResolvedValueOnce({
      lineId: 'U-no-pic',
      linePictureUrl: '',
    })

    const req = new Request('http://localhost/api/assign-player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'test-player' }),
    })

    await POST(req)
    expect(waitUntilMock).not.toHaveBeenCalled()
  })

  it('does NOT call waitUntil when BLOB_READ_WRITE_TOKEN is unset', async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN

    const req = new Request('http://localhost/api/assign-player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'test-player' }),
    })

    await POST(req)
    expect(waitUntilMock).not.toHaveBeenCalled()
  })
})
