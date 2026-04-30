import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Regression test for the assign-player route's write to the player-mapping
 * store. The contract: every link/unlink writes the post-write state into
 * Redis (`setMappingOrThrow`), it does NOT delete (`deleteMapping`) and
 * re-read.
 *
 * v1.8.0 update: the route now uses `setMappingOrThrow` (the throwing
 * variant) on the response critical path, with the Prisma transaction
 * deferred via `waitUntil`. The contract pinned here is unchanged in
 * spirit — write the post-write mapping (or null sentinel) on every link/
 * unlink — the import name and failure semantics are what shifted.
 *
 * Pre-PR-9 (v1.2.5) the route called `invalidate(lineId)` after every write,
 * forcing the next /api/auth/session through a cold-Neon Prisma findUnique
 * (1–3 s) — the bulk of the post-assign hang the v1.2.2 UX fix tried to mask.
 * PR 9 replaced that with `setCached(lineId, postWriteMapping)` — Redis as a
 * cache pre-warm in front of Prisma.
 *
 * As of PR 16 / v1.5.0 the framing inverted: Redis is the **canonical store**
 * for the auth lookup, not a cache. PR 20 / v1.8.0 inverts the WRITE path
 * too: Redis is written sync; Prisma is deferred via waitUntil. The post-
 * write mapping must land in Redis before the response returns.
 */

const { setMappingOrThrowMock, waitUntilMock } = vi.hoisted(() => ({
  setMappingOrThrowMock: vi.fn(),
  waitUntilMock: vi.fn(),
}))

vi.mock('@/lib/playerMappingStore', () => ({
  setMappingOrThrow: setMappingOrThrowMock,
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
  // v1.8.2 — route uses the lighter getPlayerByPublicId helper (skips RSVP
  // merge). The keyed mock returns a single player record matching the
  // test fixture playerId.
  getPlayerByPublicId: vi
    .fn()
    .mockResolvedValue({ id: 'test-player', name: 'Test Player', teamId: 'test-team' }),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}))

vi.mock('@/lib/getLeagueFromHost', () => ({
  getLeagueIdFromRequest: vi.fn().mockResolvedValue('l-minato-2025'),
}))

vi.mock('@vercel/functions', () => ({
  waitUntil: waitUntilMock,
}))

// Imports must come after vi.mock calls.
import { POST, DELETE } from '@/app/api/assign-player/route'

beforeEach(() => {
  vi.clearAllMocks()
  setMappingOrThrowMock.mockResolvedValue(undefined)
  waitUntilMock.mockImplementation(() => {})
})

describe('POST /api/assign-player writes the post-write mapping to the store (PR 9 / PR 16 / PR 20 / v1.26.0)', () => {
  it('calls setMappingOrThrow(lineId, leagueId, postWriteMapping) — slug-only shape, per-league key', async () => {
    const req = new Request('http://localhost/api/assign-player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'test-player' }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    // v1.26.0 — leagueId threads through. Post-write shape matches
    // getPlayerMappingFromDb in lib/auth.ts.
    expect(setMappingOrThrowMock).toHaveBeenCalledWith('U-test', 'l-minato-2025', {
      playerId: 'test-player',
      playerName: 'Test Player',
      teamId: 'test-team',
    })
  })
})

describe('DELETE /api/assign-player writes the null sentinel (PR 9 / PR 16 / PR 20 / v1.26.0)', () => {
  it('calls setMappingOrThrow(lineId, leagueId, null) — un-linked state served from the store at the per-league key', async () => {
    const res = await DELETE()
    expect(res.status).toBe(200)
    expect(setMappingOrThrowMock).toHaveBeenCalledWith('U-test', 'l-minato-2025', null)
  })
})
