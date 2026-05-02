/**
 * v1.39.0 (PR λ) — `linkUserToPlayer` helper.
 *
 * Generic User↔Player binder keyed on `User.id` (not `User.lineId`),
 * so it works for Google / email / LINE flows alike. Same invariant-
 * clearing logic as `linkPlayerToUser`:
 *   - Clear stale `Player.userId === user.id` from a different Player.
 *   - Clear `User.playerId` if previously bound to a different Player.
 * Optional `lineId` argument lets the LINE-auth caller set Player.lineId
 * in the same Player.update call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { linkUserToPlayer } from '@/lib/identityLink'

interface Tx {
  user: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }
  player: {
    update: ReturnType<typeof vi.fn>
    updateMany: ReturnType<typeof vi.fn>
  }
}

function makeTx(): Tx {
  return {
    user: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    player: {
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  }
}

describe('linkUserToPlayer — happy path (no prior bindings)', () => {
  let tx: Tx
  beforeEach(() => {
    tx = makeTx()
    tx.user.findUnique.mockResolvedValue({ id: 'u-1', playerId: null })
  })

  it('returns true and fires the four expected writes', async () => {
    const ok = await linkUserToPlayer(tx as any, {
      userId: 'u-1',
      playerId: 'p-target',
    })
    expect(ok).toBe(true)
    expect(tx.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      select: { id: true, playerId: true },
    })
    // No prior playerId → no stale clear via the user.playerId branch.
    // Defensive scan still fires (catches the race).
    expect(tx.player.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u-1', id: { not: 'p-target' } },
      data: { userId: null },
    })
    // Forward pointer.
    expect(tx.player.update).toHaveBeenCalledWith({
      where: { id: 'p-target' },
      data: { userId: 'u-1' },
    })
    // Back pointer.
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { playerId: 'p-target' },
    })
  })

  it('does NOT touch Player.lineId when lineId arg is omitted', async () => {
    await linkUserToPlayer(tx as any, { userId: 'u-1', playerId: 'p-target' })
    const playerUpdateData = tx.player.update.mock.calls[0][0].data
    expect(playerUpdateData).not.toHaveProperty('lineId')
  })

  it('SETS Player.lineId when lineId arg is supplied', async () => {
    await linkUserToPlayer(tx as any, {
      userId: 'u-1',
      playerId: 'p-target',
      lineId: 'U_LINE123',
    })
    expect(tx.player.update).toHaveBeenCalledWith({
      where: { id: 'p-target' },
      data: { userId: 'u-1', lineId: 'U_LINE123' },
    })
  })

  it('SETS Player.lineId to null when lineId arg is explicitly null (admin clear flow)', async () => {
    // The LINE branch passes `lineId: session.lineId` which COULD be
    // null in pathological cases. Document the behavior: explicit null
    // clears Player.lineId.
    await linkUserToPlayer(tx as any, {
      userId: 'u-1',
      playerId: 'p-target',
      lineId: null,
    })
    expect(tx.player.update).toHaveBeenCalledWith({
      where: { id: 'p-target' },
      data: { userId: 'u-1', lineId: null },
    })
  })
})

describe('linkUserToPlayer — invariant clearing on rebind', () => {
  it('clears the prior Player.userId when User was bound to a different Player', async () => {
    const tx = makeTx()
    tx.user.findUnique.mockResolvedValue({ id: 'u-1', playerId: 'p-prior' })

    await linkUserToPlayer(tx as any, { userId: 'u-1', playerId: 'p-new' })

    // Two updateMany calls fire — one for the named prior Player, one
    // for the defensive cross-cut scan. Verify the named-prior clear.
    const calls = tx.player.updateMany.mock.calls.map((c: any) => c[0])
    expect(calls).toContainEqual({
      where: { id: 'p-prior', userId: 'u-1' },
      data: { userId: null },
    })
  })

  it('does NOT fire the named-prior clear when prior playerId === target playerId (idempotent re-bind)', async () => {
    const tx = makeTx()
    tx.user.findUnique.mockResolvedValue({ id: 'u-1', playerId: 'p-same' })

    await linkUserToPlayer(tx as any, { userId: 'u-1', playerId: 'p-same' })

    // Named-prior clear only fires when prior !== target. Defensive
    // scan still fires unconditionally.
    const calls = tx.player.updateMany.mock.calls.map((c: any) => c[0])
    expect(calls).not.toContainEqual({
      where: { id: 'p-same', userId: 'u-1' },
      data: { userId: null },
    })
    // The defensive scan still fires.
    expect(calls).toContainEqual({
      where: { userId: 'u-1', id: { not: 'p-same' } },
      data: { userId: null },
    })
  })
})

describe('linkUserToPlayer — failure modes', () => {
  it('returns false (no-op) and warns when User does not exist', async () => {
    const tx = makeTx()
    tx.user.findUnique.mockResolvedValue(null)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const ok = await linkUserToPlayer(tx as any, {
      userId: 'u-missing',
      playerId: 'p-target',
    })

    expect(ok).toBe(false)
    expect(tx.player.update).not.toHaveBeenCalled()
    expect(tx.player.updateMany).not.toHaveBeenCalled()
    expect(tx.user.update).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('linkUserToPlayer'),
      'u-missing',
    )
    warn.mockRestore()
  })
})
