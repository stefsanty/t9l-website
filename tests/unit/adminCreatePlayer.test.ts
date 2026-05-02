/**
 * v1.33.0 (PR ε) — adminCreatePlayer contract.
 *
 * The action lets an admin pre-stage a Player row inside a league with
 * any combination of (name / position / leagueTeamId) — all optional.
 * Returns the created Player.id so the caller (Add Player dialog) can
 * immediately offer a "Generate invite" follow-up. Cache invalidation
 * goes through the canonical revalidate helper with the per-league
 * Players path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  playerCreateMock,
  assignmentCreateMock,
  leagueTeamFindUniqueMock,
  txMock,
  revalidateMock,
} = vi.hoisted(() => {
  const playerCreateMock = vi.fn()
  const assignmentCreateMock = vi.fn().mockResolvedValue({})
  const leagueTeamFindUniqueMock = vi.fn()
  const txMock = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      player: { create: playerCreateMock },
      playerLeagueAssignment: { create: assignmentCreateMock },
    }
    return cb(tx)
  })
  return {
    playerCreateMock,
    assignmentCreateMock,
    leagueTeamFindUniqueMock,
    txMock,
    revalidateMock: vi.fn(),
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    player: { create: playerCreateMock, update: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    playerLeagueAssignment: { create: assignmentCreateMock },
    leagueTeam: { findUnique: leagueTeamFindUniqueMock },
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

const { adminCreatePlayer } = await import('@/app/admin/leagues/actions')

beforeEach(() => {
  playerCreateMock.mockReset()
  playerCreateMock.mockResolvedValue({ id: 'p-new-player' })
  assignmentCreateMock.mockReset()
  assignmentCreateMock.mockResolvedValue({})
  leagueTeamFindUniqueMock.mockReset()
  revalidateMock.mockClear()
})

describe('v1.33.0 (PR ε) — adminCreatePlayer', () => {
  it('creates a player with name, position enum, and team assignment', async () => {
    leagueTeamFindUniqueMock.mockResolvedValue({ leagueId: 'league-1' })
    const result = await adminCreatePlayer({
      leagueId: 'league-1',
      name: 'Ian Noseda',
      position: 'MF',
      leagueTeamId: 'lt-mariners',
      fromGameWeek: 3,
    })
    expect(result).toEqual({ id: 'p-new-player' })
    expect(playerCreateMock).toHaveBeenCalledWith({
      data: { name: 'Ian Noseda', position: 'MF' },
    })
    expect(assignmentCreateMock).toHaveBeenCalledWith({
      // v1.34.0 (PR ζ) — admin-created assignments carry joinSource: 'ADMIN'.
      data: { playerId: 'p-new-player', leagueTeamId: 'lt-mariners', fromGameWeek: 3, joinSource: 'ADMIN' },
    })
    expect(revalidateMock).toHaveBeenCalledWith({
      domain: 'admin',
      paths: ['/admin/leagues/league-1/players'],
    })
  })

  it('creates a pre-staged slot with all fields null (the new ε flow)', async () => {
    const result = await adminCreatePlayer({ leagueId: 'league-1' })
    expect(result).toEqual({ id: 'p-new-player' })
    expect(playerCreateMock).toHaveBeenCalledWith({
      data: { name: null, position: null },
    })
    expect(assignmentCreateMock).not.toHaveBeenCalled()
  })

  it('trims the name and treats whitespace-only as null', async () => {
    await adminCreatePlayer({ leagueId: 'league-1', name: '   ' })
    expect(playerCreateMock).toHaveBeenCalledWith({
      data: { name: null, position: null },
    })
  })

  it('rejects names exceeding 100 chars (matches PillEditor cap + adminUpdatePlayerName)', async () => {
    await expect(
      adminCreatePlayer({ leagueId: 'league-1', name: 'x'.repeat(101) }),
    ).rejects.toThrow(/100 characters or fewer/)
    expect(playerCreateMock).not.toHaveBeenCalled()
    expect(revalidateMock).not.toHaveBeenCalled()
  })

  it('coerces unknown position strings to null (defensive against typos)', async () => {
    await adminCreatePlayer({ leagueId: 'league-1', name: 'X', position: 'wing-back' })
    expect(playerCreateMock).toHaveBeenCalledWith({
      data: { name: 'X', position: null },
    })
  })

  it('uppercases position case-insensitively', async () => {
    await adminCreatePlayer({ leagueId: 'league-1', name: 'X', position: 'mf' })
    expect(playerCreateMock).toHaveBeenCalledWith({
      data: { name: 'X', position: 'MF' },
    })
  })

  it('defaults fromGameWeek to 1 when not supplied AND a team is given', async () => {
    leagueTeamFindUniqueMock.mockResolvedValue({ leagueId: 'league-1' })
    await adminCreatePlayer({
      leagueId: 'league-1',
      leagueTeamId: 'lt-x',
    })
    expect(assignmentCreateMock).toHaveBeenCalledWith({
      // v1.34.0 (PR ζ) — admin-created assignments carry joinSource: 'ADMIN'.
      data: { playerId: 'p-new-player', leagueTeamId: 'lt-x', fromGameWeek: 1, joinSource: 'ADMIN' },
    })
  })

  it('rejects a leagueTeamId that belongs to a different league (cross-league isolation)', async () => {
    leagueTeamFindUniqueMock.mockResolvedValue({ leagueId: 'OTHER-league' })
    await expect(
      adminCreatePlayer({
        leagueId: 'league-1',
        leagueTeamId: 'lt-from-other-league',
      }),
    ).rejects.toThrow(/leagueTeamId does not belong to this league/)
    expect(playerCreateMock).not.toHaveBeenCalled()
    expect(revalidateMock).not.toHaveBeenCalled()
  })

  it('throws when leagueId is empty', async () => {
    await expect(adminCreatePlayer({ leagueId: '' })).rejects.toThrow(/leagueId is required/)
    expect(playerCreateMock).not.toHaveBeenCalled()
  })

  it('does NOT create an assignment when leagueTeamId is empty string', async () => {
    await adminCreatePlayer({ leagueId: 'league-1', leagueTeamId: '   ' })
    expect(assignmentCreateMock).not.toHaveBeenCalled()
  })
})
