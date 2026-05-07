import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * v1.8.0 — RSVP write-path inversion regression tests.
 *
 * Pre-v1.8.0 the RSVP route awaited `prisma.availability.upsert` on the
 * response critical path. v1.8.0 inverts: Redis (`setRsvpOrThrow`) is the
 * canonical store written synchronously, and the Prisma upsert runs in
 * `waitUntil`.
 *
 * v1.71.0 — Sheets dual-write paths retired. `writeMode` setting + the
 * `sheets-only` legacy branch are gone; this test no longer asserts on
 * them.
 *
 * Contracts pinned:
 *   - gameWeek.findUnique stays synchronous (Redis key + TTL need it)
 *   - setRsvpOrThrow is called synchronously with the public slug
 *   - Prisma upsert is INSIDE the waitUntil callback, not awaited inline
 *   - Response returns 200 BEFORE the Prisma upsert resolves
 *   - Prisma rejection emits a [v1.8.0 DRIFT] log; response stays 200
 *   - Redis throw → 500 (don't 200 with no durable write anywhere)
 */

const {
  gameWeekFindUniqueMock,
  availabilityUpsertMock,
  getServerSessionMock,
  waitUntilMock,
  setRsvpOrThrowMock,
  getDefaultLeagueIdMock,
} = vi.hoisted(() => ({
  gameWeekFindUniqueMock: vi.fn(),
  availabilityUpsertMock: vi.fn(),
  getServerSessionMock: vi.fn(),
  waitUntilMock: vi.fn(),
  setRsvpOrThrowMock: vi.fn(),
  getDefaultLeagueIdMock: vi.fn(),
}))

vi.mock('@/lib/rsvpStore', () => ({
  setRsvpOrThrow: setRsvpOrThrowMock,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    gameWeek: { findUnique: gameWeekFindUniqueMock },
    availability: { upsert: availabilityUpsertMock },
  },
}))

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@vercel/functions', () => ({
  waitUntil: waitUntilMock,
}))

vi.mock('@/lib/leagueSlug', () => ({
  getDefaultLeagueId: getDefaultLeagueIdMock,
}))

import { POST } from '@/app/api/rsvp/route'

beforeEach(() => {
  vi.clearAllMocks()
  getServerSessionMock.mockResolvedValue({
    playerId: 'ian-noseda',
    teamId: 'mariners-fc',
  })
  gameWeekFindUniqueMock.mockResolvedValue({
    id: 'cuid-gw-3',
    startDate: new Date('2026-08-01T00:00:00Z'),
  })
  availabilityUpsertMock.mockResolvedValue({})
  setRsvpOrThrowMock.mockResolvedValue(undefined)
  getDefaultLeagueIdMock.mockResolvedValue('l-minato-2025')
  waitUntilMock.mockImplementation(() => {
    // capture-only by default; tests override to control execution
  })
})

function makeRequest(matchdayId: string, status: string) {
  return new Request('http://localhost/api/rsvp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matchdayId, status }),
  })
}

describe('POST /api/rsvp — Redis-canonical sync, Prisma deferred (v1.8.0)', () => {
  it('returns 200 BEFORE the deferred Prisma upsert resolves (regression target)', async () => {
    // Stall the upsert indefinitely. If the route awaits it on the response
    // path, this `await POST(...)` hangs and the test times out. If the route
    // correctly defers via waitUntil, POST resolves regardless.
    availabilityUpsertMock.mockReturnValueOnce(
      new Promise(() => { /* never resolves */ }),
    )
    let capturedPromise: Promise<unknown> | null = null
    waitUntilMock.mockImplementation((p: unknown) => {
      capturedPromise = p as Promise<unknown>
      ;(p as Promise<unknown>).catch(() => {})
    })

    const res = await POST(makeRequest('md3', 'GOING'))
    expect(res.status).toBe(200)
    expect(capturedPromise).toBeInstanceOf(Promise)
    expect(setRsvpOrThrowMock).toHaveBeenCalledTimes(1)
  })

  it('passes the public slug (no `p-` prefix) to setRsvpOrThrow', async () => {
    await POST(makeRequest('md3', 'UNDECIDED'))
    expect(setRsvpOrThrowMock).toHaveBeenCalledWith(
      'cuid-gw-3',
      new Date('2026-08-01T00:00:00Z'),
      'ian-noseda',
      'UNDECIDED',
    )
  })

  it('emits [v1.8.0 DRIFT] log when the deferred Prisma upsert rejects (response still 200)', async () => {
    availabilityUpsertMock.mockRejectedValueOnce(new Error('cold-Neon timeout'))
    waitUntilMock.mockImplementation((p: unknown) => {
      ;(p as Promise<unknown>).catch(() => {})
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(makeRequest('md3', 'GOING'))
    expect(res.status).toBe(200)
    await new Promise((r) => setImmediate(r))

    const driftCall = errorSpy.mock.calls.find((args) =>
      typeof args[0] === 'string' && args[0].includes('[v1.8.0 DRIFT]'),
    )
    expect(driftCall).toBeDefined()
    errorSpy.mockRestore()
  })

  it('returns 500 when setRsvpOrThrow throws (Redis canonical write failed)', async () => {
    setRsvpOrThrowMock.mockRejectedValueOnce(new Error('Upstash unreachable'))
    const res = await POST(makeRequest('md3', 'GOING'))
    expect(res.status).toBe(500)
    expect(waitUntilMock).not.toHaveBeenCalled()
  })

  it('keeps gameWeek.findUnique synchronous (needed for Redis key + TTL)', async () => {
    let findUniqueCalledAt: number | null = null
    let waitUntilCalledAt: number | null = null
    let setRsvpCalledAt: number | null = null
    let counter = 0
    gameWeekFindUniqueMock.mockImplementationOnce(async () => {
      findUniqueCalledAt = ++counter
      return { id: 'cuid-gw-3', startDate: new Date('2026-08-01T00:00:00Z') }
    })
    setRsvpOrThrowMock.mockImplementationOnce(async () => {
      setRsvpCalledAt = ++counter
    })
    waitUntilMock.mockImplementation(() => {
      waitUntilCalledAt = ++counter
    })

    await POST(makeRequest('md3', 'GOING'))

    expect(findUniqueCalledAt).toBe(1)
    expect(setRsvpCalledAt).toBe(2)
    expect(waitUntilCalledAt).toBe(3)
  })
})
