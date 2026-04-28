import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Regression test for PR 9 (v1.2.5) — the assign-player route must pre-warm
 * the JWT mapping cache, NOT invalidate it.
 *
 * Pre-PR-9 the route called `invalidate(lineId)` after every write. The next
 * /api/auth/session that ran inside `await update()` on the client (in
 * `AssignPlayerClient.handleConfirm`) hit a cold cache and paid the 1–3s
 * cold-Neon Prisma `findUnique` cost — the bulk of the post-assign hang the
 * v1.2.2 UX fix tried to mask.
 *
 * If a future change reverts to `invalidate(lineId)` (or drops the cache
 * write entirely), this test fails — the contract is "writes pre-warm".
 */

// All module mocks must be hoisted above the route import. vi.mock handles that.

vi.mock('@/lib/playerMappingCache', () => ({
  setCached: vi.fn(),
  invalidate: vi.fn(),
  getCached: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn().mockResolvedValue([]),
    player: {
      findUnique: vi.fn().mockResolvedValue({ id: 'p-test-player' }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}))

vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue({
    lineId: 'U-test',
    // No linePictureUrl → blob upload path is skipped, no @vercel/blob mock needed.
  }),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/publicData', () => ({
  getPublicLeagueData: vi.fn().mockResolvedValue({
    players: [
      { id: 'test-player', name: 'Test Player', teamId: 'test-team' },
    ],
  }),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

// Imports must come after vi.mock calls.
import { POST, DELETE } from '@/app/api/assign-player/route'
import { setCached, invalidate } from '@/lib/playerMappingCache'

const setCachedMock = vi.mocked(setCached)
const invalidateMock = vi.mocked(invalidate)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/assign-player pre-warms the JWT mapping cache (PR 9)', () => {
  it('calls setCached(lineId, postWriteMapping) — slug-only shape, no `p-`/`t-` prefix', async () => {
    const req = new Request('http://localhost/api/assign-player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'test-player' }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    // Pre-warm shape matches getPlayerMappingFromDb in lib/auth.ts.
    expect(setCachedMock).toHaveBeenCalledWith('U-test', {
      playerId: 'test-player',
      playerName: 'Test Player',
      teamId: 'test-team',
    })
  })

  it('does NOT call invalidate (the pre-PR-9 cold-cache footgun)', async () => {
    const req = new Request('http://localhost/api/assign-player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'test-player' }),
    })

    await POST(req)

    expect(invalidateMock).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/assign-player pre-warms the null sentinel (PR 9)', () => {
  it('calls setCached(lineId, null) — un-linked state served from cache', async () => {
    const res = await DELETE()
    expect(res.status).toBe(200)
    expect(setCachedMock).toHaveBeenCalledWith('U-test', null)
  })

  it('does NOT call invalidate', async () => {
    await DELETE()
    expect(invalidateMock).not.toHaveBeenCalled()
  })
})
