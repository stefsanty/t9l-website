import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Integration test for the RSVP write path. v1.8.0 inverts the order:
 * Redis (`setRsvpOrThrow`) is canonical and written synchronously, and the
 * Prisma upsert is deferred via `waitUntil`. The Sheets dual-write rides
 * along inside the same waitUntil callback in `dual` mode.
 *
 * Contracts pinned (post-v1.8.0):
 *   1. The Redis store (`setRsvpOrThrow`) is written on the synchronous
 *      response path with the public slug (not the prefixed DB id) and
 *      the GameWeek's startDate (so the absolute TTL anchors correctly).
 *   2. `prisma.availability.upsert` runs INSIDE `waitUntil` — captured but
 *      not awaited inline. After draining the deferred promise, the upsert
 *      is observed.
 *   3. `revalidateTag('public-data')` and `revalidatePath('/')` are NOT
 *      called from this route — RSVP no longer flows through the static
 *      cache.
 *   4. Redis-throw → 500 response (don't 200 with no durable write
 *      anywhere). v1.8.0 requires the Redis write to succeed before the
 *      response returns; the Prisma write is the durable backup, not the
 *      gate.
 */

const { setRsvpOrThrowMock, waitUntilMock, getLeagueIdFromRequestMock } = vi.hoisted(() => ({
  setRsvpOrThrowMock: vi.fn(),
  waitUntilMock: vi.fn(),
  getLeagueIdFromRequestMock: vi.fn(),
}))

vi.mock('@/lib/rsvpStore', () => ({
  setRsvpOrThrow: setRsvpOrThrowMock,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    gameWeek: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'cuid-gw-3',
        startDate: new Date('2026-08-01T00:00:00Z'),
      }),
    },
    availability: {
      upsert: vi.fn().mockResolvedValue({}),
    },
  },
}))

vi.mock('@/lib/sheets', () => ({
  writeRosterAvailability: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/settings', () => ({
  // dual mode → Prisma write deferred; Sheets best-effort inside the same
  // waitUntil callback. Redis write sync.
  getWriteMode: vi.fn().mockResolvedValue('dual'),
}))

vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue({
    playerId: 'ian-noseda',
    teamId: 'mariners-fc',
  }),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

const revalidateTagMock = vi.fn()
const revalidatePathMock = vi.fn()
vi.mock('next/cache', () => ({
  revalidateTag: revalidateTagMock,
  revalidatePath: revalidatePathMock,
}))

vi.mock('@vercel/functions', () => ({
  waitUntil: waitUntilMock,
}))

vi.mock('@/lib/getLeagueFromHost', () => ({
  getLeagueIdFromRequest: getLeagueIdFromRequestMock,
}))

// Imports must come after vi.mock calls.
import { POST } from '@/app/api/rsvp/route'
import { prisma } from '@/lib/prisma'

const upsertMock = vi.mocked(prisma.availability.upsert)

beforeEach(() => {
  vi.clearAllMocks()
  setRsvpOrThrowMock.mockResolvedValue(undefined)
  getLeagueIdFromRequestMock.mockResolvedValue('l-minato-2025')
  // Eagerly invoke the deferred callback so the Prisma upsert runs in the test.
  waitUntilMock.mockImplementation((p: unknown) => {
    ;(p as Promise<unknown>).catch(() => {})
  })
})

function makeRequest(matchdayId: string, status: string) {
  return new Request('http://localhost/api/rsvp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matchdayId, status }),
  })
}

describe('POST /api/rsvp — v1.8.0 Redis-canonical sync, Prisma deferred', () => {
  it('returns 200, writes Redis sync, and schedules the Prisma upsert via waitUntil', async () => {
    const res = await POST(makeRequest('md3', 'GOING'))
    expect(res.status).toBe(200)

    // Synchronous: Redis write happens on the response path.
    expect(setRsvpOrThrowMock).toHaveBeenCalledTimes(1)
    expect(setRsvpOrThrowMock).toHaveBeenCalledWith(
      'cuid-gw-3',
      new Date('2026-08-01T00:00:00Z'),
      'ian-noseda',
      'GOING',
    )

    // Deferred: waitUntil scheduled exactly one Promise containing the upsert.
    expect(waitUntilMock).toHaveBeenCalledTimes(1)

    // After draining the deferred work, the upsert ran with the expected shape.
    await new Promise((r) => setImmediate(r))
    expect(upsertMock).toHaveBeenCalledTimes(1)
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          playerId_gameWeekId: {
            playerId: 'p-ian-noseda',
            gameWeekId: 'cuid-gw-3',
          },
        },
      }),
    )
  })

  it('passes the public slug (no `p-` prefix) to setRsvpOrThrow', async () => {
    await POST(makeRequest('md3', 'UNDECIDED'))
    const playerArg = setRsvpOrThrowMock.mock.calls[0][2]
    expect(playerArg).toBe('ian-noseda')
    expect(playerArg.startsWith('p-')).toBe(false)
  })

  it('passes null to setRsvpOrThrow when clearing the RSVP (status="")', async () => {
    await POST(makeRequest('md3', ''))
    expect(setRsvpOrThrowMock).toHaveBeenCalledWith(
      'cuid-gw-3',
      new Date('2026-08-01T00:00:00Z'),
      'ian-noseda',
      null,
    )
  })

  it('does NOT call revalidateTag or revalidatePath — RSVP is off the static cache path', async () => {
    await POST(makeRequest('md3', 'GOING'))
    expect(revalidateTagMock).not.toHaveBeenCalled()
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it('returns 500 if setRsvpOrThrow throws — no durable write anywhere is worse than a clear error', async () => {
    setRsvpOrThrowMock.mockRejectedValueOnce(new Error('Upstash unreachable'))
    const res = await POST(makeRequest('md3', 'GOING'))
    expect(res.status).toBe(500)
    // Critical: Prisma must NOT be scheduled when Redis fails — bailing out
    // before waitUntil keeps both stores in lockstep (neither has the write).
    expect(waitUntilMock).not.toHaveBeenCalled()
  })

  it('threads the resolved leagueId from getLeagueIdFromRequest into gameWeek.findUnique (v1.22.0 regression)', async () => {
    // Pre-v1.22.0 the route hardcoded leagueId='l-minato-2025'. This test
    // pins the inversion: a subdomain RSVP routes to the per-subdomain
    // league's GameWeeks, not the default league's.
    getLeagueIdFromRequestMock.mockResolvedValueOnce('l-tamachi-2026')

    await POST(makeRequest('md3', 'GOING'))

    const findUniqueMock = vi.mocked(
      (await import('@/lib/prisma')).prisma.gameWeek.findUnique,
    )
    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { leagueId_weekNumber: { leagueId: 'l-tamachi-2026', weekNumber: 3 } },
      select: { id: true, startDate: true },
    })
  })

  it('returns 404 when getLeagueIdFromRequest returns null (unknown subdomain)', async () => {
    getLeagueIdFromRequestMock.mockResolvedValueOnce(null)

    const res = await POST(makeRequest('md3', 'GOING'))

    expect(res.status).toBe(404)
    // No writes should fire when the league cannot be resolved.
    expect(setRsvpOrThrowMock).not.toHaveBeenCalled()
    expect(waitUntilMock).not.toHaveBeenCalled()
  })
})
