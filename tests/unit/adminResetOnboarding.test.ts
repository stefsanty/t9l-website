/**
 * v1.36.0 (PR θ) — adminResetOnboarding server action contract.
 *
 * Pin the load-bearing behavior:
 *   - Flips PlayerLeagueAssignment.onboardingStatus from COMPLETED → NOT_YET.
 *   - Preserves all other Player + assignment data (the action only touches
 *     onboardingStatus). PR ζ's onboarding form is idempotent on re-entry,
 *     so re-routing the user through it surfaces their prior submission
 *     pre-filled — no data loss.
 *   - League-scoped (PlayerLeagueAssignment.leagueTeam.leagueId join).
 *   - Idempotent no-op when assignment is already NOT_YET.
 *   - Rejects when the player has no assignment in the supplied league
 *     (cross-league isolation; admin in League A can't reset onboarding
 *     for a player in League B).
 *   - Cache invalidation goes through the canonical revalidate helper
 *     with the per-league players path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  findFirstMock,
  updateMock,
  revalidateMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  updateMock: vi.fn().mockResolvedValue({}),
  revalidateMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerLeagueAssignment: {
      findFirst: findFirstMock,
      update: updateMock,
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    player: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    leagueTeam: { findUnique: vi.fn() },
    leagueInvite: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    $transaction: vi.fn().mockResolvedValue([]),
  },
}))
vi.mock('@/lib/revalidate', () => ({ revalidate: revalidateMock }))
vi.mock('next/cache', () => ({ unstable_cache: <T,>(fn: T) => fn }))
vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue({ isAdmin: true, userId: 'u-admin' }),
}))
vi.mock('@/lib/auth', () => ({ authOptions: {}, getPlayerMappingFromDb: vi.fn() }))
vi.mock('@/lib/playerMappingStore', () => ({
  setMapping: vi.fn(),
  deleteMapping: vi.fn(),
}))
vi.mock('@/lib/rsvpStore', () => ({ seedGameWeek: vi.fn(), deleteGameWeek: vi.fn() }))
vi.mock('@vercel/functions', () => ({ waitUntil: (p: Promise<unknown>) => p }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Map([['host', 't9l.me']])),
}))
vi.mock('@/lib/identityLink', () => ({
  linkPlayerToUser: vi.fn(),
  unlinkPlayerFromUser: vi.fn(),
}))

const { adminResetOnboarding } = await import('@/app/admin/leagues/actions')

beforeEach(() => {
  findFirstMock.mockReset()
  updateMock.mockClear()
  revalidateMock.mockClear()
})

describe('v1.36.0 (PR θ) — adminResetOnboarding', () => {
  it('happy path: flips onboardingStatus from COMPLETED to NOT_YET', async () => {
    findFirstMock.mockResolvedValue({ id: 'pla-1', onboardingStatus: 'COMPLETED' })
    await adminResetOnboarding({ playerId: 'p-1', leagueId: 'l-1' })
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'pla-1' },
      data: { onboardingStatus: 'NOT_YET' },
    })
    expect(revalidateMock).toHaveBeenCalledWith({
      domain: 'admin',
      paths: ['/admin/leagues/l-1/players'],
    })
  })

  it('looks up the assignment league-scoped (cross-league isolation)', async () => {
    findFirstMock.mockResolvedValue({ id: 'pla-1', onboardingStatus: 'COMPLETED' })
    await adminResetOnboarding({ playerId: 'p-1', leagueId: 'l-1' })
    expect(findFirstMock).toHaveBeenCalledWith({
      where: {
        playerId: 'p-1',
        leagueTeam: { leagueId: 'l-1' },
      },
      select: { id: true, onboardingStatus: true },
    })
  })

  it('idempotent no-op when assignment is already NOT_YET (admin clicks twice)', async () => {
    findFirstMock.mockResolvedValue({ id: 'pla-1', onboardingStatus: 'NOT_YET' })
    await adminResetOnboarding({ playerId: 'p-1', leagueId: 'l-1' })
    expect(updateMock).not.toHaveBeenCalled()
    expect(revalidateMock).not.toHaveBeenCalled()
  })

  it('rejects when the player has no assignment in this league', async () => {
    findFirstMock.mockResolvedValue(null)
    await expect(
      adminResetOnboarding({ playerId: 'p-cross-league', leagueId: 'l-1' }),
    ).rejects.toThrow(/no assignment in this league/i)
    expect(updateMock).not.toHaveBeenCalled()
    expect(revalidateMock).not.toHaveBeenCalled()
  })

  it('rejects empty playerId', async () => {
    await expect(
      adminResetOnboarding({ playerId: '', leagueId: 'l-1' }),
    ).rejects.toThrow(/playerId is required/)
    expect(findFirstMock).not.toHaveBeenCalled()
  })

  it('rejects empty leagueId', async () => {
    await expect(
      adminResetOnboarding({ playerId: 'p-1', leagueId: '' }),
    ).rejects.toThrow(/leagueId is required/)
    expect(findFirstMock).not.toHaveBeenCalled()
  })

  it('preserves data: only flips onboardingStatus, never touches Player or other assignment fields', async () => {
    findFirstMock.mockResolvedValue({ id: 'pla-1', onboardingStatus: 'COMPLETED' })
    await adminResetOnboarding({ playerId: 'p-1', leagueId: 'l-1' })
    // The update call's `data` is exactly { onboardingStatus: 'NOT_YET' } —
    // no name / position / preferences / IDs / joinSource modifications.
    const call = updateMock.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(Object.keys(call.data)).toEqual(['onboardingStatus'])
    expect(call.data.onboardingStatus).toBe('NOT_YET')
  })

  it('does not bust the cache on validation failure (no DB write happened)', async () => {
    await expect(
      adminResetOnboarding({ playerId: '', leagueId: 'l-1' }),
    ).rejects.toThrow()
    expect(revalidateMock).not.toHaveBeenCalled()
  })
})
