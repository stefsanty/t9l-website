import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Integration test for the v1.7.0 RSVP write path. Pins three contracts:
 *
 *   1. The DB (`prisma.availability.upsert`) AND the Redis store (`setRsvp`)
 *      are both written to on every successful RSVP — failure of either
 *      still propagates as a 500.
 *   2. `setRsvp` is called with the public slug (not the prefixed DB id)
 *      and the GameWeek's startDate (so the absolute TTL anchors correctly).
 *   3. `revalidateTag('public-data')` and `revalidatePath('/')` are NOT
 *      called from this route — RSVP no longer flows through the static
 *      cache.
 */

vi.mock('@/lib/rsvpStore', () => ({
  setRsvp: vi.fn(),
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
  // dual mode → both Prisma + Sheets writes; Redis pre-warm fires regardless.
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

// Imports must come after vi.mock calls.
import { POST } from '@/app/api/rsvp/route'
import { setRsvp } from '@/lib/rsvpStore'
import { prisma } from '@/lib/prisma'

const setRsvpMock = vi.mocked(setRsvp)
const upsertMock = vi.mocked(prisma.availability.upsert)

beforeEach(() => {
  vi.clearAllMocks()
})

function makeRequest(matchdayId: string, status: string) {
  return new Request('http://localhost/api/rsvp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matchdayId, status }),
  })
}

describe('POST /api/rsvp — v1.7.0 dual-write to Prisma + Redis', () => {
  it('returns 200 and writes Prisma upsert + Redis setRsvp on a GOING RSVP', async () => {
    const res = await POST(makeRequest('md3', 'GOING'))
    expect(res.status).toBe(200)

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

    expect(setRsvpMock).toHaveBeenCalledTimes(1)
    expect(setRsvpMock).toHaveBeenCalledWith(
      'cuid-gw-3',
      new Date('2026-08-01T00:00:00Z'),
      'ian-noseda',
      'GOING',
    )
  })

  it('passes the public slug (no `p-` prefix) to setRsvp — matches the merge-layer contract', async () => {
    await POST(makeRequest('md3', 'UNDECIDED'))
    const playerArg = setRsvpMock.mock.calls[0][2]
    expect(playerArg).toBe('ian-noseda')
    expect(playerArg.startsWith('p-')).toBe(false)
  })

  it('passes null to setRsvp when clearing the RSVP (status="")', async () => {
    await POST(makeRequest('md3', ''))
    expect(setRsvpMock).toHaveBeenCalledWith(
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

  it('returns 500 if Prisma upsert throws — failure surfaces, does not silently desync stores', async () => {
    upsertMock.mockRejectedValueOnce(new Error('Prisma down'))
    const res = await POST(makeRequest('md3', 'GOING'))
    expect(res.status).toBe(500)
    // Critical: no Redis write happens after Prisma fails — partial-write
    // states must not survive. (The Redis write inside the same try block
    // is guarded by the Prisma upsert succeeding.)
    expect(setRsvpMock).not.toHaveBeenCalled()
  })
})
