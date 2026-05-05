/**
 * v1.57.0 (PR 4 of route-shortening chain) — adminUnlinkUserFromPlayer
 * contract.
 *
 * Clears the `User.playerId` <-> `Player.userId` 1:1 binding that was
 * established by stage β (v1.29.0) via `linkPlayerToUser`. Both rows
 * survive — only the binding is cleared. Idempotent on already-unlinked
 * Users.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  userFindUniqueMock,
  userUpdateMock,
  playerUpdateManyMock,
  txMock,
  revalidateMock,
} = vi.hoisted(() => {
  const userFindUniqueMock = vi.fn()
  const userUpdateMock = vi.fn().mockResolvedValue({})
  const playerUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 })
  const txMock = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      user: { findUnique: userFindUniqueMock, update: userUpdateMock },
      player: { updateMany: playerUpdateManyMock },
    }
    return cb(tx)
  })
  return {
    userFindUniqueMock,
    userUpdateMock,
    playerUpdateManyMock,
    txMock,
    revalidateMock: vi.fn(),
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: userFindUniqueMock, update: userUpdateMock },
    player: { updateMany: playerUpdateManyMock, findUnique: vi.fn() },
    playerLeagueMembership: { create: vi.fn(), findFirst: vi.fn() },
    leagueTeam: { findUnique: vi.fn(), findMany: vi.fn() },
    leagueInvite: { findFirst: vi.fn(), create: vi.fn() },
    $transaction: txMock,
  },
}))

vi.mock('@/lib/revalidate', () => ({ revalidate: revalidateMock }))
vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}))
vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue({ isAdmin: true, userId: 'u-admin' }),
}))
vi.mock('@/lib/auth', () => ({
  authOptions: {},
  getPlayerMappingFromDb: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/playerMappingStore', () => ({
  setMapping: vi.fn().mockResolvedValue(undefined),
  deleteMapping: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/rsvpStore', () => ({ seedGameWeek: vi.fn(), deleteGameWeek: vi.fn() }))
vi.mock('@vercel/functions', () => ({ waitUntil: (p: Promise<unknown>) => p }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Map([['host', 't9l.me']])),
}))

const { adminUnlinkUserFromPlayer } = await import('@/app/admin/leagues/actions')

beforeEach(() => {
  userFindUniqueMock.mockReset()
  userUpdateMock.mockClear()
  userUpdateMock.mockResolvedValue({})
  playerUpdateManyMock.mockClear()
  playerUpdateManyMock.mockResolvedValue({ count: 1 })
  revalidateMock.mockClear()
  txMock.mockClear()
})

describe('adminUnlinkUserFromPlayer', () => {
  it('happy path — clears User.playerId and Player.userId in a transaction', async () => {
    userFindUniqueMock.mockResolvedValue({ id: 'u-stefan', playerId: 'p-stefan' })

    await adminUnlinkUserFromPlayer({ userId: 'u-stefan' })

    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: 'u-stefan' },
      data: { playerId: null },
    })
    expect(playerUpdateManyMock).toHaveBeenCalledWith({
      where: { userId: 'u-stefan' },
      data: { userId: null },
    })
    expect(revalidateMock).toHaveBeenCalledWith({
      domain: 'admin',
      paths: ['/admin/users'],
    })
  })

  it('idempotent — no-op when User.playerId is already null', async () => {
    userFindUniqueMock.mockResolvedValue({ id: 'u-stefan', playerId: null })

    await adminUnlinkUserFromPlayer({ userId: 'u-stefan' })

    expect(userUpdateMock).not.toHaveBeenCalled()
    expect(playerUpdateManyMock).not.toHaveBeenCalled()
    // Revalidate STILL fires per the canonical contract — caller may
    // have stale data on the admin page even if the binding was already
    // cleared by another admin in a different tab.
    expect(revalidateMock).toHaveBeenCalled()
  })

  it('rejects when User does not exist', async () => {
    userFindUniqueMock.mockResolvedValue(null)

    await expect(adminUnlinkUserFromPlayer({ userId: 'u-missing' })).rejects.toThrow(
      /User not found/,
    )
    expect(userUpdateMock).not.toHaveBeenCalled()
    expect(playerUpdateManyMock).not.toHaveBeenCalled()
  })

  it('rejects when userId is empty', async () => {
    await expect(adminUnlinkUserFromPlayer({ userId: '' })).rejects.toThrow(/userId/)
    expect(userUpdateMock).not.toHaveBeenCalled()
    expect(revalidateMock).not.toHaveBeenCalled()
  })

  it('runs both clears inside a single $transaction (atomic — partial-write states never survive)', async () => {
    userFindUniqueMock.mockResolvedValue({ id: 'u-stefan', playerId: 'p-stefan' })

    await adminUnlinkUserFromPlayer({ userId: 'u-stefan' })

    expect(txMock).toHaveBeenCalledTimes(1)
  })

  it('does NOT touch Player.lineId (legacy mirror; identity-rework stage 4 territory)', async () => {
    userFindUniqueMock.mockResolvedValue({ id: 'u-stefan', playerId: 'p-stefan' })

    await adminUnlinkUserFromPlayer({ userId: 'u-stefan' })

    // playerUpdateMany is invoked exactly once with userId clear; no
    // further player updates would touch lineId. The mock would catch
    // a second updateMany call.
    expect(playerUpdateManyMock).toHaveBeenCalledTimes(1)
    const arg = playerUpdateManyMock.mock.calls[0][0] as {
      data: Record<string, unknown>
    }
    expect(arg.data).toEqual({ userId: null })
    expect(arg.data).not.toHaveProperty('lineId')
  })
})
