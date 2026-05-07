import { describe, it, expect, vi } from 'vitest'
import {
  linkPlayerToUser,
  unlinkPlayerFromUser,
  unlinkUserFromPlayer,
} from '@/lib/identityLink'

/**
 * v1.29.0 — User ↔ Player dual-write helpers (stage β).
 * v1.72.0 — updated for User.name ↔ Player.name sync.
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
  user: { id: string; playerId: string | null; authAccountName?: string | null } | null
  playerName?: string | null
}): MockTx {
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue(opts.user),
      update: vi.fn().mockResolvedValue({}),
    },
    player: {
      // v1.72.0 — player.update now returns { name } via select
      update: vi.fn().mockResolvedValue({ name: opts.playerName ?? 'Test Player' }),
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
    const tx = makeTx({ user: { id: 'user-stefan', playerId: null }, playerName: 'Stefan S' })
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
    // Forward pointer — now includes select: { name: true } for v1.72.0
    expect(tx.player.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p-stefan-s' },
        data: { userId: 'user-stefan' },
        select: { name: true },
      }),
    )
    // Back pointer — now includes name: 'Stefan S' for v1.72.0
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-stefan' },
        data: expect.objectContaining({ playerId: 'p-stefan-s', name: 'Stefan S' }),
      }),
    )
  })

  it('clears prior Player binding when User was bound to a different Player', async () => {
    const tx = makeTx({
      user: { id: 'user-stefan', playerId: 'p-stefan-old' },
      playerName: 'Stefan S',
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
    expect(tx.player.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p-stefan-new' },
        data: { userId: 'user-stefan' },
      }),
    )
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-stefan' },
        data: expect.objectContaining({ playerId: 'p-stefan-new' }),
      }),
    )
  })

  it('is idempotent when User is already bound to the requested Player', async () => {
    const tx = makeTx({
      user: { id: 'user-stefan', playerId: 'p-stefan-s' },
      playerName: 'Stefan S',
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
    expect(tx.player.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p-stefan-s' },
        data: { userId: 'user-stefan' },
      }),
    )
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-stefan' },
        data: expect.objectContaining({ playerId: 'p-stefan-s' }),
      }),
    )
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
      user: { id: 'user-stefan', playerId: 'p-stefan-s', authAccountName: 'Stefan LINE' },
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
    // v1.72.0 — User-side clear restores name = authAccountName
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-stefan' },
      data: { playerId: null, name: 'Stefan LINE' },
    })
  })

  it('still clears User.playerId when Player.userId was already null', async () => {
    const tx = makeTx({ user: { id: 'user-stefan', playerId: null, authAccountName: 'Stefan LINE' } })
    const result = await unlinkPlayerFromUser(tx as never, {
      lineId: 'U_stefan',
    })
    expect(result).toBe(true)
    // No Player update needed (no current binding to clear)
    expect(tx.player.updateMany).not.toHaveBeenCalled()
    // User-side clear still fires (idempotent)
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-stefan' },
      data: { playerId: null, name: 'Stefan LINE' },
    })
  })

  it('selects authAccountName in the User findUnique (v1.72.0)', async () => {
    const tx = makeTx({ user: { id: 'user-stefan', playerId: null, authAccountName: null } })
    await unlinkPlayerFromUser(tx as never, { lineId: 'U_stefan' })
    expect(tx.user.findUnique).toHaveBeenCalledWith({
      where: { lineId: 'U_stefan' },
      select: { id: true, playerId: true, authAccountName: true },
    })
  })
})

/**
 * v1.61.0 — `unlinkUserFromPlayer` is the inverse of `linkUserToPlayer`
 * keyed on `User.id`. Used by the `/api/assign-player` DELETE handler
 * for non-LINE sessions (Google / email) — `unlinkPlayerFromUser` is
 * keyed on `User.lineId @unique` which is null for non-LINE Users, so
 * it would no-op for them.
 */
describe('unlinkUserFromPlayer', () => {
  it('returns { unlinkedPlayerId: null } and skips writes when no User exists', async () => {
    const tx = makeTx({ user: null })
    const result = await unlinkUserFromPlayer(tx as never, {
      userId: 'unknown-user',
    })
    expect(result).toEqual({ unlinkedPlayerId: null })
    expect(tx.user.update).not.toHaveBeenCalled()
    expect(tx.player.updateMany).not.toHaveBeenCalled()
  })

  it('clears Player.userId then User.playerId and returns the cleared playerId', async () => {
    const tx = makeTx({
      user: { id: 'user-google-123', playerId: 'p-stefan-s', authAccountName: 'Stefan Google' },
    })
    const result = await unlinkUserFromPlayer(tx as never, {
      userId: 'user-google-123',
    })
    expect(result).toEqual({ unlinkedPlayerId: 'p-stefan-s' })
    expect(tx.player.updateMany).toHaveBeenCalledWith({
      where: { id: 'p-stefan-s', userId: 'user-google-123' },
      data: { userId: null },
    })
    // v1.72.0 — restores name = authAccountName
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-google-123' },
      data: { playerId: null, name: 'Stefan Google' },
    })
  })

  it('idempotent — still clears User.playerId when Player.userId was already null', async () => {
    const tx = makeTx({ user: { id: 'user-google-123', playerId: null, authAccountName: null } })
    const result = await unlinkUserFromPlayer(tx as never, {
      userId: 'user-google-123',
    })
    expect(result).toEqual({ unlinkedPlayerId: null })
    expect(tx.player.updateMany).not.toHaveBeenCalled()
    // name: null (authAccountName is null)
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-google-123' },
      data: { playerId: null, name: null },
    })
  })

  it('keys lookup on User.id (not User.lineId) — supports non-LINE Users', async () => {
    const tx = makeTx({ user: { id: 'user-email-456', playerId: null, authAccountName: null } })
    await unlinkUserFromPlayer(tx as never, { userId: 'user-email-456' })
    expect(tx.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-email-456' },
      select: { id: true, playerId: true, authAccountName: true },
    })
  })
})
