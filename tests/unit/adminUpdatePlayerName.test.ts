/**
 * v1.20.0 — adminUpdatePlayerName server action contract.
 *
 * The action is the canonical write path for editing `Player.name` from
 * the admin Players tab. Validation: name required, trimmed, ≤100 chars.
 * Cache invalidation: `revalidate({ domain: 'admin' })` busts both the
 * admin path and the public-data tag set (player names are reachable
 * from `dbToPublicLeagueData`, so the public dashboard re-derives on
 * next render).
 *
 * Mocking shape mirrors the existing `tests/unit/adminLineActions.test.ts`
 * — Prisma + revalidate + next-auth + the lib/auth re-exports are all
 * mocked so the action runs in isolation and we can assert its
 * dispatch shape without standing up a real DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { updateMock } = vi.hoisted(() => ({
  updateMock: vi.fn().mockResolvedValue({}),
}))

const { revalidateMock } = vi.hoisted(() => ({
  revalidateMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    player: {
      update: updateMock,
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi.fn().mockResolvedValue([]),
  },
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
  getPlayerMappingFromDb: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/playerMappingStore', () => ({
  setMapping: vi.fn().mockResolvedValue(undefined),
  deleteMapping: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/rsvpStore', () => ({
  seedGameWeek: vi.fn(),
  deleteGameWeek: vi.fn(),
}))

vi.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => p,
}))

const { adminUpdatePlayerName } = await import('@/app/admin/leagues/actions')

beforeEach(() => {
  updateMock.mockClear()
  revalidateMock.mockClear()
})

describe('v1.20.0 — adminUpdatePlayerName', () => {
  it('updates Player.name with the trimmed input', async () => {
    await adminUpdatePlayerName({
      playerId: 'p-ian-noseda',
      leagueId: 'league-1',
      name: '  Ian N. Noseda  ',
    })
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'p-ian-noseda' },
      data: { name: 'Ian N. Noseda' },
    })
  })

  it('busts the admin path so the Players tab re-renders with the new name', async () => {
    await adminUpdatePlayerName({
      playerId: 'p-ian-noseda',
      leagueId: 'league-1',
      name: 'Ian Noseda',
    })
    expect(revalidateMock).toHaveBeenCalledWith({
      domain: 'admin',
      paths: ['/admin/leagues/league-1/players'],
    })
  })

  it('throws when name is empty after trim (required)', async () => {
    await expect(
      adminUpdatePlayerName({
        playerId: 'p-ian-noseda',
        leagueId: 'league-1',
        name: '   ',
      }),
    ).rejects.toThrow(/Player name is required/)
    expect(updateMock).not.toHaveBeenCalled()
    expect(revalidateMock).not.toHaveBeenCalled()
  })

  it('throws when name is empty string', async () => {
    await expect(
      adminUpdatePlayerName({
        playerId: 'p-ian-noseda',
        leagueId: 'league-1',
        name: '',
      }),
    ).rejects.toThrow(/Player name is required/)
  })

  it('throws when name exceeds 100 characters (server-side cap matches client maxLength)', async () => {
    const long = 'x'.repeat(101)
    await expect(
      adminUpdatePlayerName({
        playerId: 'p-ian-noseda',
        leagueId: 'league-1',
        name: long,
      }),
    ).rejects.toThrow(/100 characters or fewer/)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('accepts exactly 100 characters at the boundary', async () => {
    const max = 'x'.repeat(100)
    await adminUpdatePlayerName({
      playerId: 'p-ian-noseda',
      leagueId: 'league-1',
      name: max,
    })
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'p-ian-noseda' },
      data: { name: max },
    })
  })

  it('throws when playerId is empty', async () => {
    await expect(
      adminUpdatePlayerName({
        playerId: '',
        leagueId: 'league-1',
        name: 'Ian Noseda',
      }),
    ).rejects.toThrow(/playerId is required/)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('does not bust the cache on validation failure (no Prisma write happened)', async () => {
    await expect(
      adminUpdatePlayerName({
        playerId: 'p-ian-noseda',
        leagueId: 'league-1',
        name: '   ',
      }),
    ).rejects.toThrow()
    // If we revalidated despite no write, every failed-validation click
    // would burn the public-data cache for nothing.
    expect(revalidateMock).not.toHaveBeenCalled()
  })
})
