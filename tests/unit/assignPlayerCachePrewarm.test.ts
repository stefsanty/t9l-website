import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Regression test for the assign-player route's write to the player-mapping
 * store. The contract: every link/unlink writes the post-write state into
 * Redis (`setMapping`), it does NOT delete (`deleteMapping`) and re-read.
 *
 * Pre-PR-9 (v1.2.5) the route called `invalidate(lineId)` after every write,
 * forcing the next /api/auth/session through a cold-Neon Prisma findUnique
 * (1–3 s) — the bulk of the post-assign hang the v1.2.2 UX fix tried to mask.
 * PR 9 replaced that with `setCached(lineId, postWriteMapping)` — Redis as a
 * cache pre-warm in front of Prisma.
 *
 * As of PR 16 / v1.5.0 the framing inverted: Redis is the **canonical store**
 * for the auth lookup, not a cache. The contract this test pins is the
 * same — write the post-write mapping (or null sentinel) on every link/
 * unlink — but it now matters because there's no Prisma fallback in the
 * happy path. A forgotten `setMapping` would not be self-healed by the
 * defensive Redis-error fallback (that path only fires when Redis is
 * unreachable, not when the key is genuinely missing).
 */

vi.mock('@/lib/playerMappingStore', () => ({
  setMapping: vi.fn(),
  deleteMapping: vi.fn(),
  getMapping: vi.fn(),
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
import { setMapping, deleteMapping } from '@/lib/playerMappingStore'

const setMappingMock = vi.mocked(setMapping)
const deleteMappingMock = vi.mocked(deleteMapping)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/assign-player writes the post-write mapping to the store (PR 9 / PR 16)', () => {
  it('calls setMapping(lineId, postWriteMapping) — slug-only shape, no `p-`/`t-` prefix', async () => {
    const req = new Request('http://localhost/api/assign-player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'test-player' }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    // Post-write shape matches getPlayerMappingFromDb in lib/auth.ts.
    expect(setMappingMock).toHaveBeenCalledWith('U-test', {
      playerId: 'test-player',
      playerName: 'Test Player',
      teamId: 'test-team',
    })
  })

  it('does NOT call deleteMapping (the pre-PR-9 cold-cache footgun)', async () => {
    const req = new Request('http://localhost/api/assign-player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'test-player' }),
    })

    await POST(req)

    expect(deleteMappingMock).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/assign-player writes the null sentinel (PR 9 / PR 16)', () => {
  it('calls setMapping(lineId, null) — un-linked state served from the store', async () => {
    const res = await DELETE()
    expect(res.status).toBe(200)
    expect(setMappingMock).toHaveBeenCalledWith('U-test', null)
  })

  it('does NOT call deleteMapping', async () => {
    await DELETE()
    expect(deleteMappingMock).not.toHaveBeenCalled()
  })
})
