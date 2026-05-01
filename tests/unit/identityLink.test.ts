import { describe, it, expect, vi } from 'vitest'
import { linkPlayerToUser, unlinkPlayerFromUser } from '@/lib/identityLink'

/**
 * v1.29.0 — User ↔ Player dual-write helpers (stage β).
 *
 * Tests use a hand-rolled mock for Prisma's TransactionClient because the
 * helper only touches `tx.user.findUnique` / `tx.user.update` /
 * `tx.player.update` / `tx.player.updateMany`. We assert on the call
 * pattern (the transaction shape that β commits to) rather than DB state
 * since this is a pure-orchestration helper.
 */

interface MockTx {
  user: {
    findUnique: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }
  player: {
    update: ReturnType<typeof vi.fn>
    updateMany: ReturnType<typeof vi.fn>
  }
}

function makeTx(opts: {
  user: { id: string; playerId: string | null } | null
}): MockTx {
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue(opts.user),
      update: vi.fn().mockResolvedValue({}),
    },
    player: {
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  }
}

describe('linkPlayerToUser', () => {
  it('returns false and skips writes when no User exists for the lineId', async () => {
    const tx = makeTx({ user: null })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await linkPlayerToUser(tx as never, {
      playerId: 'p-stefan-s',
      lineId: 'U_unknown',
    })
    expect(result).toBe(false)
    expect(tx.user.update).not.toHaveBeenCalled()
    expect(tx.player.update).not.toHaveBeenCalled()
    expect(tx.player.updateMany).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('linkPlayerToUser'),
      expect.any(String),
    )
    warnSpy.mockRestore()
  })

  it('writes the canonical link when User exists with no prior playerId', async () => {
    const tx = makeTx({ user: { id: 'user-stefan', playerId: null } })
    const result = await linkPlayerToUser(tx as never, {
      playerId: 'p-stefan-s',
      lineId: 'U_stefan',
    })
    expect(result).toBe(true)
    // Defensive clear of any other Player pointing at this User
    expect(tx.player.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-stefan', id: { not: 'p-stefan-s' } },
      data: { userId: null },
    })
    // Forward pointer
    expect(tx.player.update).toHaveBeenCalledWith({
      where: { id: 'p-stefan-s' },
      data: { userId: 'user-stefan' },
    })
    // Back pointer
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-stefan' },
      data: { playerId: 'p-stefan-s' },
    })
  })

  it('clears prior Player binding when User was bound to a different Player', async () => {
    const tx = makeTx({
      user: { id: 'user-stefan', playerId: 'p-stefan-old' },
    })
    await linkPlayerToUser(tx as never, {
      playerId: 'p-stefan-new',
      lineId: 'U_stefan',
    })
    // Clear the prior Player.userId
    expect(tx.player.updateMany).toHaveBeenCalledWith({
      where: { id: 'p-stefan-old', userId: 'user-stefan' },
      data: { userId: null },
    })
    // Then defensive clear of any other Players pointing at this User
    expect(tx.player.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-stefan', id: { not: 'p-stefan-new' } },
      data: { userId: null },
    })
    // Forward + back pointers point at the new player
    expect(tx.player.update).toHaveBeenCalledWith({
      where: { id: 'p-stefan-new' },
      data: { userId: 'user-stefan' },
    })
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-stefan' },
      data: { playerId: 'p-stefan-new' },
    })
  })

  it('is idempotent when User is already bound to the requested Player', async () => {
    const tx = makeTx({
      user: { id: 'user-stefan', playerId: 'p-stefan-s' },
    })
    await linkPlayerToUser(tx as never, {
      playerId: 'p-stefan-s',
      lineId: 'U_stefan',
    })
    // No prior-clear step (user.playerId === args.playerId)
    expect(tx.player.updateMany).toHaveBeenCalledTimes(1)
    expect(tx.player.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-stefan', id: { not: 'p-stefan-s' } },
      data: { userId: null },
    })
    // Forward + back pointers (idempotent — same values)
    expect(tx.player.update).toHaveBeenCalledWith({
      where: { id: 'p-stefan-s' },
      data: { userId: 'user-stefan' },
    })
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-stefan' },
      data: { playerId: 'p-stefan-s' },
    })
  })

  it('queries User by lineId, not by id (legacy compat through stage 3)', async () => {
    const tx = makeTx({ user: { id: 'user-stefan', playerId: null } })
    await linkPlayerToUser(tx as never, {
      playerId: 'p-stefan-s',
      lineId: 'U_stefan',
    })
    expect(tx.user.findUnique).toHaveBeenCalledWith({
      where: { lineId: 'U_stefan' },
      select: { id: true, playerId: true },
    })
  })
})

describe('unlinkPlayerFromUser', () => {
  it('returns false and skips writes when no User exists', async () => {
    const tx = makeTx({ user: null })
    const result = await unlinkPlayerFromUser(tx as never, {
      lineId: 'U_unknown',
    })
    expect(result).toBe(false)
    expect(tx.user.update).not.toHaveBeenCalled()
    expect(tx.player.update).not.toHaveBeenCalled()
  })

  it('clears Player.userId then User.playerId when User has a binding', async () => {
    const tx = makeTx({
      user: { id: 'user-stefan', playerId: 'p-stefan-s' },
    })
    const result = await unlinkPlayerFromUser(tx as never, {
      lineId: 'U_stefan',
    })
    expect(result).toBe(true)
    // Player-side clear (back-pointer first)
    expect(tx.player.updateMany).toHaveBeenCalledWith({
      where: { id: 'p-stefan-s', userId: 'user-stefan' },
      data: { userId: null },
    })
    // User-side clear (forward-pointer second)
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-stefan' },
      data: { playerId: null },
    })
  })

  it('still clears User.playerId when Player.userId was already null', async () => {
    const tx = makeTx({ user: { id: 'user-stefan', playerId: null } })
    const result = await unlinkPlayerFromUser(tx as never, {
      lineId: 'U_stefan',
    })
    expect(result).toBe(true)
    // No Player update needed (no current binding to clear)
    expect(tx.player.updateMany).not.toHaveBeenCalled()
    // User-side clear still fires (idempotent)
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-stefan' },
      data: { playerId: null },
    })
  })
})
