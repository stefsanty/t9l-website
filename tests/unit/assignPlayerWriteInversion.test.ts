import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * v1.8.0 — write-path inversion regression tests.
 *
 * Pre-v1.8.0 the assign-player route awaited the Prisma transaction on the
 * response critical path (~1–3s on cold Neon). v1.8.0 inverts the write
 * path: Redis (`setMappingOrThrow`) is the canonical store written
 * synchronously, and the Prisma transaction is deferred via `waitUntil`.
 *
 * The load-bearing case is "POST returns 200 BEFORE the Prisma promise
 * resolves" — a regression to the pre-v1.8.0 await order would make the
 * deferred-promise harness time out (or, with our test harness, fail an
 * ordering assertion).
 *
 * Other contracts pinned:
 *   - setMappingOrThrow is called BEFORE waitUntil
 *   - waitUntil is called with a Promise representing the Prisma work
 *   - on Prisma rejection inside waitUntil, the route still returns 200
 *     (the failure surfaces only as a [v1.8.0 DRIFT] log line)
 *   - on Redis throw, the route returns 500 (don't silently 200 with no
 *     durable write landing anywhere)
 */

const {
  transactionMock,
  playerUpdateMock,
  playerUpdateManyMock,
  playerFindUniqueMock,
  getServerSessionMock,
  waitUntilMock,
  setMappingOrThrowMock,
} = vi.hoisted(() => ({
  transactionMock: vi.fn(),
  playerUpdateMock: vi.fn(),
  playerUpdateManyMock: vi.fn(),
  playerFindUniqueMock: vi.fn(),
  getServerSessionMock: vi.fn(),
  waitUntilMock: vi.fn(),
  setMappingOrThrowMock: vi.fn(),
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

const { getPlayerByPublicIdMock, revalidatePathMock, revalidateTagMock } =
  vi.hoisted(() => ({
    getPlayerByPublicIdMock: vi
      .fn()
      .mockResolvedValue({ id: 'test-player', name: 'Test Player', teamId: 'test-team' }),
    revalidatePathMock: vi.fn(),
    revalidateTagMock: vi.fn(),
  }))

vi.mock('@/lib/publicData', () => ({
  getPlayerByPublicId: getPlayerByPublicIdMock,
}))

vi.mock('next/cache', () => ({
  revalidatePath: revalidatePathMock,
  revalidateTag: revalidateTagMock,
}))

vi.mock('@vercel/functions', () => ({
  waitUntil: waitUntilMock,
}))

vi.mock('@vercel/blob', () => ({
  put: vi.fn(),
}))

import { POST, DELETE } from '@/app/api/assign-player/route'

beforeEach(() => {
  vi.clearAllMocks()
  // Default happy paths
  getServerSessionMock.mockResolvedValue({
    lineId: 'U-test',
    // No linePictureUrl → blob upload path skipped (the v1.8.0 contract for
    // Prisma deferral is independent of pic mirror).
  })
  transactionMock.mockResolvedValue([])
  playerFindUniqueMock.mockResolvedValue({ id: 'p-test-player' })
  playerUpdateMock.mockResolvedValue({})
  playerUpdateManyMock.mockResolvedValue({ count: 0 })
  setMappingOrThrowMock.mockResolvedValue(undefined)
  // Capture but DON'T execute the Promise passed to waitUntil — that's the
  // whole point: the response is supposed to return regardless of whether
  // the deferred work has settled.
  waitUntilMock.mockImplementation(() => {
    // intentionally a no-op
  })
})

describe('POST /api/assign-player — Redis-canonical sync, Prisma deferred', () => {
  it('calls setMappingOrThrow BEFORE Prisma transaction (v1.8.0 inversion)', async () => {
    const callOrder: string[] = []
    setMappingOrThrowMock.mockImplementationOnce(async () => {
      callOrder.push('setMappingOrThrow')
    })
    transactionMock.mockImplementationOnce(async () => {
      callOrder.push('prisma.$transaction')
      return []
    })

    // Make waitUntil actually invoke its callback synchronously so we can
    // observe the order. (Production waitUntil schedules; test verifies
    // ordering by forcing immediate execution.)
    waitUntilMock.mockImplementation((p: unknown) => {
      // Eagerly await the promise so transactionMock gets called for ordering.
      ;(p as Promise<unknown>).catch(() => {})
    })

    const req = new Request('http://localhost/api/assign-player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'test-player' }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    // setMappingOrThrow ran synchronously (before waitUntil scheduled prisma).
    // We assert position-0 is the Redis write.
    expect(callOrder[0]).toBe('setMappingOrThrow')
  })

  it('returns 200 BEFORE the deferred Prisma transaction resolves', async () => {
    // The regression target. Build a deferred promise that we can resolve
    // after-the-fact; pass it into waitUntil; verify POST returns first.
    let resolveTransaction: () => void = () => {}
    const transactionDeferred = new Promise<unknown[]>((resolve) => {
      resolveTransaction = () => resolve([])
    })
    transactionMock.mockReturnValueOnce(transactionDeferred)

    // Capture the Promise passed into waitUntil so we know the route handed
    // it off rather than awaiting it.
    let capturedPromise: Promise<unknown> | null = null
    waitUntilMock.mockImplementation((p: unknown) => {
      capturedPromise = p as Promise<unknown>
    })

    const req = new Request('http://localhost/api/assign-player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'test-player' }),
    })

    // POST must resolve even though the Prisma transaction is still pending.
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(waitUntilMock).toHaveBeenCalled()
    expect(capturedPromise).toBeInstanceOf(Promise)

    // Now resolve the Prisma promise (background): it should not affect the
    // already-returned response.
    resolveTransaction()
    await capturedPromise
  })

  it('returns 200 even when the deferred Prisma transaction REJECTS (drift logged, not surfaced)', async () => {
    transactionMock.mockRejectedValueOnce(new Error('cold-Neon timeout'))
    waitUntilMock.mockImplementation((p: unknown) => {
      // Eagerly catch so the test runner doesn't see an unhandled rejection.
      ;(p as Promise<unknown>).catch(() => {})
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const req = new Request('http://localhost/api/assign-player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'test-player' }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    // Drain microtasks so the deferred catch logs.
    await new Promise((r) => setImmediate(r))

    // The DRIFT log line is the operator's signal.
    const driftCall = errorSpy.mock.calls.find((args) =>
      typeof args[0] === 'string' && args[0].includes('[v1.8.0 DRIFT]'),
    )
    expect(driftCall).toBeDefined()
    errorSpy.mockRestore()
  })

  it('returns 500 when setMappingOrThrow throws (Redis canonical write failed)', async () => {
    setMappingOrThrowMock.mockRejectedValueOnce(new Error('Upstash unreachable'))

    const req = new Request('http://localhost/api/assign-player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'test-player' }),
    })

    const res = await POST(req)
    expect(res.status).toBe(500)
    // Prisma must NOT be scheduled when Redis fails — bailing out before
    // waitUntil keeps the stores in lockstep (neither has the write).
    expect(waitUntilMock).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/assign-player — Redis-canonical sync, Prisma deferred', () => {
  it('calls setMappingOrThrow with null and defers Prisma update via waitUntil', async () => {
    const res = await DELETE()
    expect(res.status).toBe(200)
    expect(setMappingOrThrowMock).toHaveBeenCalledWith('U-test', null)
    expect(waitUntilMock).toHaveBeenCalledTimes(1)
  })

  it('returns 200 BEFORE the deferred Prisma update resolves', async () => {
    let resolveFind: () => void = () => {}
    const findDeferred = new Promise<{ id: string } | null>((resolve) => {
      resolveFind = () => resolve({ id: 'p-test-player' })
    })
    playerFindUniqueMock.mockReturnValueOnce(findDeferred)

    let capturedPromise: Promise<unknown> | null = null
    waitUntilMock.mockImplementation((p: unknown) => {
      capturedPromise = p as Promise<unknown>
    })

    const res = await DELETE()
    expect(res.status).toBe(200)
    expect(capturedPromise).toBeInstanceOf(Promise)

    resolveFind()
    await capturedPromise
  })

  it('returns 500 when setMappingOrThrow throws on the unlink path', async () => {
    setMappingOrThrowMock.mockRejectedValueOnce(new Error('Upstash unreachable'))
    const res = await DELETE()
    expect(res.status).toBe(500)
    expect(waitUntilMock).not.toHaveBeenCalled()
  })
})

describe('v1.8.2 — link/unlink does NOT bust the public-data static cache', () => {
  // The link state is owned by the JWT (`session.playerId/playerName/teamId`)
  // and Redis (`playerMappingStore`); none of it flows through the cached
  // `getFromDb()` / `getFromSheets()` blob. Pre-v1.8.2 the route called
  // `revalidatePath('/')` + `revalidateTag('public-data', { expire: 0 })` on
  // every link/unlink, which forced a needless re-derivation on the user's
  // next `/` render — measurably ~580ms warm and multi-second cold. v1.8.2
  // drops both calls. Mirrors v1.7.0's drop of the same calls in `/api/rsvp`.
  //
  // The picture-mirror waitUntil callback DOES still call
  // `revalidateTag('public-data', { expire: 0 })` once a new Blob URL is
  // staged — that's the correct trigger because pictureUrl IS in the static
  // cache. Tests for that path live in `assignPlayerBackgroundPic.test.ts`.

  it('POST does not call revalidatePath', async () => {
    const req = new Request('http://localhost/api/assign-player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'test-player' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it('POST does not call revalidateTag on the synchronous response path', async () => {
    // The pic-mirror code path inside uploadAndPersistLinePic also calls
    // revalidateTag, but only if waitUntil's callback runs. Default test
    // harness has no linePictureUrl + no BLOB_READ_WRITE_TOKEN, so that
    // path is skipped — the assertion here is that the SYNCHRONOUS body
    // of POST emits zero revalidateTag calls.
    const req = new Request('http://localhost/api/assign-player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'test-player' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(revalidateTagMock).not.toHaveBeenCalled()
  })

  it('DELETE does not call revalidatePath or revalidateTag', async () => {
    const res = await DELETE()
    expect(res.status).toBe(200)
    expect(revalidatePathMock).not.toHaveBeenCalled()
    expect(revalidateTagMock).not.toHaveBeenCalled()
  })

  it('uses the lighter getPlayerByPublicId helper, not the full LeagueData blob', async () => {
    // Validation should go through getPlayerByPublicId (no RSVP fanout) — a
    // regression to getPublicLeagueData would re-introduce the uncached
    // 12×HGETALL fanout per write.
    const req = new Request('http://localhost/api/assign-player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'test-player' }),
    })
    await POST(req)
    expect(getPlayerByPublicIdMock).toHaveBeenCalledWith('test-player')
  })
})
