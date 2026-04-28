import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Regression test for PR 12 / v1.3.1 — the LINE profile picture upload must
 * run as background work via `waitUntil`, not on the response critical path.
 *
 * v1.8.0 update: the route now calls `waitUntil` TWICE per POST when a LINE
 * picture is present:
 *   1. The deferred Prisma transaction (the v1.8.0 inversion)
 *   2. The pic upload (PR 12, unchanged in spirit)
 *
 * Contracts pinned here:
 *   - When session has both `linePictureUrl` AND `BLOB_READ_WRITE_TOKEN`:
 *       * waitUntil() is called twice (Prisma defer + pic defer)
 *       * the response returns 200 BEFORE either background promise resolves
 *       * the synchronous Prisma transaction does NOT execute inline
 *         (because it's deferred — the v1.8.0 inversion)
 *   - When linePictureUrl is empty: waitUntil is called ONCE (Prisma defer
 *     only — no pic upload to schedule)
 *   - When BLOB_READ_WRITE_TOKEN is absent: same — only the Prisma defer
 */

const {
  transactionMock,
  playerUpdateMock,
  playerUpdateManyMock,
  playerFindUniqueMock,
  getServerSessionMock,
  waitUntilMock,
  putMock,
  setMappingOrThrowMock,
} = vi.hoisted(() => ({
  transactionMock: vi.fn().mockResolvedValue([]),
  playerUpdateMock: vi.fn().mockResolvedValue({}),
  playerUpdateManyMock: vi.fn().mockResolvedValue({ count: 0 }),
  playerFindUniqueMock: vi.fn().mockResolvedValue({ id: 'p-test-player' }),
  getServerSessionMock: vi.fn(),
  waitUntilMock: vi.fn(),
  putMock: vi.fn().mockResolvedValue({ url: 'https://blob.example/pic.png' }),
  setMappingOrThrowMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/playerMappingStore', () => ({
  setMappingOrThrow: setMappingOrThrowMock,
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
  // Default: capture only — don't execute deferred work in these timing tests.
  waitUntilMock.mockImplementation(() => {})
})

describe('POST /api/assign-player schedules background work via waitUntil (PR 12 + PR 20)', () => {
  it('calls waitUntil TWICE when linePictureUrl + BLOB_READ_WRITE_TOKEN are set (Prisma defer + pic defer)', async () => {
    const req = new Request('http://localhost/api/assign-player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'test-player' }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    // v1.8.0: Prisma transaction also goes through waitUntil; pic continues
    // to ride along on its own waitUntil for independent failure semantics.
    expect(waitUntilMock).toHaveBeenCalledTimes(2)
    expect(waitUntilMock.mock.calls[0][0]).toBeInstanceOf(Promise)
    expect(waitUntilMock.mock.calls[1][0]).toBeInstanceOf(Promise)
  })

  // The response must NOT await the background work — that's the whole point
  // of moving Blob upload (PR 12) and the Prisma transaction (PR 20) off the
  // critical path. Stall both: if the route awaits either, POST below hangs
  // and the test times out.
  it('returns the response BEFORE the background promises resolve', async () => {
    putMock.mockImplementationOnce(
      () => new Promise<{ url: string }>(() => { /* never resolves */ }),
    )
    transactionMock.mockImplementationOnce(
      () => new Promise(() => { /* never resolves */ }),
    )

    // Stall fetch quickly so the background pic work lands on the put() stall.
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
    expect(waitUntilMock).toHaveBeenCalledTimes(2)

    global.fetch = originalFetch
  })

  it('does NOT include pictureUrl in the deferred Prisma transaction', async () => {
    // Eagerly run the deferred work so we can inspect what shape the route
    // built for the Prisma update — but only the Prisma defer, not the pic
    // upload (which would hit blob mocks etc).
    let capturedPromises: Promise<unknown>[] = []
    waitUntilMock.mockImplementation((p: unknown) => {
      capturedPromises.push(p as Promise<unknown>)
      ;(p as Promise<unknown>).catch(() => {})
    })

    const req = new Request('http://localhost/api/assign-player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'test-player' }),
    })

    await POST(req)

    // Drain the deferred work so the transaction call lands.
    await Promise.allSettled(capturedPromises)

    // The Prisma update inside the deferred transaction must NOT include
    // pictureUrl — pictures are mirrored separately via the pic-upload
    // waitUntil. (Pre-PR-12 the pic was set inline in the same transaction,
    // adding 200–500ms to the response path.)
    const updateCalls = playerUpdateMock.mock.calls as unknown as Array<[unknown]>
    const setLineIdCall = updateCalls.find((args) => {
      const arg = args[0] as { where?: { id?: string }; data?: Record<string, unknown> }
      return arg?.where?.id === 'p-test-player' && arg?.data && 'lineId' in arg.data
    })
    expect(setLineIdCall).toBeDefined()
    const dataArg = (setLineIdCall![0] as { data: Record<string, unknown> }).data
    expect(dataArg).not.toHaveProperty('pictureUrl')
  })

  it('calls waitUntil ONCE when session has no linePictureUrl (only the Prisma defer)', async () => {
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
    expect(waitUntilMock).toHaveBeenCalledTimes(1)
  })

  it('calls waitUntil ONCE when BLOB_READ_WRITE_TOKEN is unset (only the Prisma defer)', async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN

    const req = new Request('http://localhost/api/assign-player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'test-player' }),
    })

    await POST(req)
    expect(waitUntilMock).toHaveBeenCalledTimes(1)
  })
})
