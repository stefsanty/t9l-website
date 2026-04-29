/**
 * Unit tests for v1.10.0 / PR B admin LINE-link server actions:
 *   - adminClearLineLink: idempotent unlink + Redis cleanup
 *   - adminLinkLineToPlayer: now ALSO clears the target player's prior
 *     lineId from Redis when an admin remaps an already-linked target
 *
 * Verifies the BEHAVIOR the PR claims (per CLAUDE.md "End-to-end
 * verification rule"):
 *   (1) clear → Player.lineId = null AND deleteMapping(oldLineId)
 *   (2) clear no-op when player already unlinked (no Prisma update,
 *       no Redis call)
 *   (3) remap to a player that ALREADY had a different lineId → BOTH
 *       (a) the new lineId is set on target via setMapping, AND
 *       (b) the target's prior lineId is invalidated via deleteMapping
 *       — without (b), the v1.5.0 Redis store would still resolve the
 *       prior LINE user to the (now reassigned) target player.
 *   (4) remap of the SAME lineId is a no-op for the prior-lineId clear
 *       (no spurious deleteMapping)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { findUniqueMock, updateMock, transactionMock, updateManyMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  updateMock: vi.fn().mockResolvedValue({}),
  transactionMock: vi.fn().mockResolvedValue([]),
  updateManyMock: vi.fn().mockResolvedValue({ count: 0 }),
}))

const { setMappingMock, deleteMappingMock } = vi.hoisted(() => ({
  setMappingMock: vi.fn().mockResolvedValue(undefined),
  deleteMappingMock: vi.fn().mockResolvedValue(undefined),
}))

const { revalidateMock } = vi.hoisted(() => ({
  revalidateMock: vi.fn(),
}))

const { getPlayerMappingFromDbMock } = vi.hoisted(() => ({
  getPlayerMappingFromDbMock: vi.fn().mockResolvedValue({
    playerId: 'p-fresh',
    playerName: 'Fresh Player',
    teamId: 't-team',
  }),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    player: {
      findUnique: findUniqueMock,
      update: updateMock,
      updateMany: updateManyMock,
    },
    $transaction: transactionMock,
  },
}))

vi.mock('@/lib/playerMappingStore', () => ({
  setMapping: setMappingMock,
  deleteMapping: deleteMappingMock,
}))

vi.mock('@/lib/revalidate', () => ({
  revalidate: revalidateMock,
}))

vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}))

vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue({ isAdmin: true }),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
  getPlayerMappingFromDb: getPlayerMappingFromDbMock,
}))

vi.mock('@/lib/rsvpStore', () => ({
  seedGameWeek: vi.fn(),
  deleteGameWeek: vi.fn(),
}))

import {
  adminClearLineLink,
  adminLinkLineToPlayer,
} from '@/app/admin/leagues/actions'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('adminClearLineLink (v1.10.0 / PR B)', () => {
  it('clears Player.lineId AND invalidates the Redis mapping for the previously-linked LINE user', async () => {
    findUniqueMock.mockResolvedValueOnce({ lineId: 'U-old-line-id' })

    await adminClearLineLink({ playerId: 'p-test', leagueId: 'l-spring' })

    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { id: 'p-test' },
      select: { lineId: true },
    })
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'p-test' },
      data: { lineId: null },
    })
    expect(deleteMappingMock).toHaveBeenCalledWith('U-old-line-id')
    expect(revalidateMock).toHaveBeenCalledWith({
      domain: 'admin',
      paths: ['/admin/leagues/l-spring/players'],
    })
  })

  it('is idempotent: no Prisma update + no Redis call when player already has lineId=null', async () => {
    findUniqueMock.mockResolvedValueOnce({ lineId: null })

    await adminClearLineLink({ playerId: 'p-test', leagueId: 'l-spring' })

    expect(updateMock).not.toHaveBeenCalled()
    expect(deleteMappingMock).not.toHaveBeenCalled()
  })

  it('is idempotent: no Prisma update + no Redis call when player record is missing', async () => {
    findUniqueMock.mockResolvedValueOnce(null)

    await adminClearLineLink({ playerId: 'p-missing', leagueId: 'l-spring' })

    expect(updateMock).not.toHaveBeenCalled()
    expect(deleteMappingMock).not.toHaveBeenCalled()
  })

  it('throws when playerId is empty (validation seam)', async () => {
    await expect(
      adminClearLineLink({ playerId: '', leagueId: 'l-spring' }),
    ).rejects.toThrow(/playerId is required/)
  })
})

describe('adminLinkLineToPlayer remap path (v1.10.0 / PR B)', () => {
  it('clears the target player\'s PRIOR lineId from Redis when remapping to a different LINE user', async () => {
    // Target was previously linked to U-prior — admin is remapping to U-new.
    findUniqueMock.mockResolvedValueOnce({ lineId: 'U-prior' })

    await adminLinkLineToPlayer({
      playerId: 'p-target',
      lineId: 'U-new',
      leagueId: 'l-spring',
    })

    // The new lineId is set on the target via setMapping (post-write
    // pre-warm of the JWT cache).
    expect(setMappingMock).toHaveBeenCalledWith(
      'U-new',
      expect.objectContaining({ playerId: 'p-fresh' }),
    )

    // The PRIOR lineId on the target is invalidated. Without this, the
    // v1.5.0 Redis store would still resolve U-prior → p-target on next
    // JWT callback for that LINE user, even though Prisma now says U-prior
    // is unlinked. This is the regression target — the v1.9.x code did
    // not call deleteMapping on the target's prior lineId.
    expect(deleteMappingMock).toHaveBeenCalledWith('U-prior')
  })

  it('does NOT call deleteMapping when the target player was unlinked before remap', async () => {
    findUniqueMock.mockResolvedValueOnce({ lineId: null })

    await adminLinkLineToPlayer({
      playerId: 'p-target',
      lineId: 'U-new',
      leagueId: 'l-spring',
    })

    expect(setMappingMock).toHaveBeenCalledWith(
      'U-new',
      expect.objectContaining({ playerId: 'p-fresh' }),
    )
    expect(deleteMappingMock).not.toHaveBeenCalled()
  })

  it('does NOT call deleteMapping when remap is a no-op (target already linked to the same lineId)', async () => {
    findUniqueMock.mockResolvedValueOnce({ lineId: 'U-new' })

    await adminLinkLineToPlayer({
      playerId: 'p-target',
      lineId: 'U-new',
      leagueId: 'l-spring',
    })

    expect(setMappingMock).toHaveBeenCalledWith(
      'U-new',
      expect.objectContaining({ playerId: 'p-fresh' }),
    )
    // Same lineId — no prior mapping to invalidate.
    expect(deleteMappingMock).not.toHaveBeenCalled()
  })

  it('still performs the atomic clear-from-other-player + set-on-target transaction', async () => {
    findUniqueMock.mockResolvedValueOnce({ lineId: null })

    await adminLinkLineToPlayer({
      playerId: 'p-target',
      lineId: 'U-new',
      leagueId: 'l-spring',
    })

    // The transaction is opaque to the test (Prisma's $transaction takes
    // an array of operations); we just assert it was invoked.
    expect(transactionMock).toHaveBeenCalledTimes(1)
    expect(revalidateMock).toHaveBeenCalledWith({
      domain: 'admin',
      paths: ['/admin/leagues/l-spring/players'],
    })
  })
})
