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
      playerLeagueMembership: { create: assignmentCreateMock },
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
    playerLeagueMembership: { create: assignmentCreateMock },
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
  it('creates a player with name, position enum, and team assignment (v1.65.4 — position on PLM)', async () => {
    leagueTeamFindUniqueMock.mockResolvedValue({ leagueId: 'league-1' })
    const result = await adminCreatePlayer({
      leagueId: 'league-1',
      name: 'Ian Noseda',
      position: 'MF',
      leagueTeamId: 'lt-mariners',
      fromGameWeek: 3,
    })
    expect(result).toEqual({ id: 'p-new-player' })
    // v1.65.4 — Player.create payload is identity-only (name).
    expect(playerCreateMock).toHaveBeenCalledWith({
      data: { name: 'Ian Noseda' },
    })
    // PLM.create carries the position alongside the team binding.
    expect(assignmentCreateMock).toHaveBeenCalledWith({
      data: {
        playerId: 'p-new-player',
        leagueTeamId: 'lt-mariners',
        leagueId: 'league-1',
        fromGameWeek: 3,
        joinSource: 'ADMIN',
        position: 'MF',
      },
    })
    expect(revalidateMock).toHaveBeenCalledWith({
      domain: 'admin',
      paths: ['/admin/leagues/league-1/players'],
    })
  })

  it('creates a pre-staged slot with all fields null (the new ε flow, v1.65.4-shape)', async () => {
    const result = await adminCreatePlayer({ leagueId: 'league-1' })
    expect(result).toEqual({ id: 'p-new-player' })
    // v1.65.4 — Player.create no longer carries position.
    expect(playerCreateMock).toHaveBeenCalledWith({
      data: { name: null },
    })
    expect(assignmentCreateMock).not.toHaveBeenCalled()
  })

  it('trims the name and treats whitespace-only as null', async () => {
    await adminCreatePlayer({ leagueId: 'league-1', name: '   ' })
    expect(playerCreateMock).toHaveBeenCalledWith({
      data: { name: null },
    })
  })

  it('rejects names exceeding 100 chars (matches PillEditor cap + adminUpdatePlayerName)', async () => {
    await expect(
      adminCreatePlayer({ leagueId: 'league-1', name: 'x'.repeat(101) }),
    ).rejects.toThrow(/100 characters or fewer/)
    expect(playerCreateMock).not.toHaveBeenCalled()
    expect(revalidateMock).not.toHaveBeenCalled()
  })

  it('coerces unknown position strings to null (defensive against typos, v1.65.4 — position on PLM)', async () => {
    leagueTeamFindUniqueMock.mockResolvedValue({ leagueId: 'league-1' })
    await adminCreatePlayer({
      leagueId: 'league-1',
      name: 'X',
      position: 'wing-back',
      leagueTeamId: 'lt-x',
    })
    expect(playerCreateMock).toHaveBeenCalledWith({
      data: { name: 'X' },
    })
    // The unknown position coerces to null on the PLM payload.
    expect(assignmentCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ position: null }) }),
    )
  })

  it('uppercases position case-insensitively (v1.65.4 — position on PLM)', async () => {
    leagueTeamFindUniqueMock.mockResolvedValue({ leagueId: 'league-1' })
    await adminCreatePlayer({
      leagueId: 'league-1',
      name: 'X',
      position: 'mf',
      leagueTeamId: 'lt-x',
    })
    expect(playerCreateMock).toHaveBeenCalledWith({
      data: { name: 'X' },
    })
    expect(assignmentCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ position: 'MF' }) }),
    )
  })

  it('defaults fromGameWeek to 1 when not supplied AND a team is given', async () => {
    leagueTeamFindUniqueMock.mockResolvedValue({ leagueId: 'league-1' })
    await adminCreatePlayer({
      leagueId: 'league-1',
      leagueTeamId: 'lt-x',
    })
    expect(assignmentCreateMock).toHaveBeenCalledWith({
      // v1.34.0 (PR ζ) — admin-created assignments carry joinSource: 'ADMIN'.
      // v1.65.4 — leagueId + position fields added.
      data: {
        playerId: 'p-new-player',
        leagueTeamId: 'lt-x',
        leagueId: 'league-1',
        fromGameWeek: 1,
        joinSource: 'ADMIN',
        position: null,
      },
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
