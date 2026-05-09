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
  leagueFindUniqueMock,
  txMock,
  revalidateMock,
} = vi.hoisted(() => {
  const playerCreateMock = vi.fn()
  const assignmentCreateMock = vi.fn().mockResolvedValue({})
  const leagueTeamFindUniqueMock = vi.fn()
  // v1.82.0 — adminCreatePlayer now reads `League.ballType` to validate
  // submitted positions against the right vocabulary.
  const leagueFindUniqueMock = vi.fn().mockResolvedValue({ ballType: 'SOCCER' })
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
    leagueFindUniqueMock,
    txMock,
    revalidateMock: vi.fn(),
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    player: { create: playerCreateMock, update: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    playerLeagueMembership: { create: assignmentCreateMock },
    leagueTeam: { findUnique: leagueTeamFindUniqueMock },
    league: { findUnique: leagueFindUniqueMock },
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
  it('v1.82.0 — creates a player with multi-position + team assignment (positions[] + legacy enum dual-write)', async () => {
    leagueTeamFindUniqueMock.mockResolvedValue({ leagueId: 'league-1' })
    const result = await adminCreatePlayer({
      leagueId: 'league-1',
      name: 'Ian Noseda',
      positions: ['CM'],
      leagueTeamId: 'lt-mariners',
      fromGameWeek: 3,
    })
    expect(result).toEqual({ id: 'p-new-player' })
    // v1.65.4 — Player.create payload is identity-only (name).
    expect(playerCreateMock).toHaveBeenCalledWith({
      data: { name: 'Ian Noseda' },
    })
    // v1.82.0 — PLM.create dual-writes positions[] + legacy enum
    // (CM buckets to MF in the legacy column).
    // v1.86.0 — also writes preferredPositions; secondaryPositions starts [].
    expect(assignmentCreateMock).toHaveBeenCalledWith({
      data: {
        playerId: 'p-new-player',
        leagueTeamId: 'lt-mariners',
        leagueId: 'league-1',
        fromGameWeek: 3,
        joinSource: 'ADMIN',
        positions: ['CM'],
        preferredPositions: ['CM'],
        secondaryPositions: [],
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

  it('v1.82.0 — REJECTS unknown position codes (vocabulary-aware validation throws)', async () => {
    leagueTeamFindUniqueMock.mockResolvedValue({ leagueId: 'league-1' })
    await expect(
      adminCreatePlayer({
        leagueId: 'league-1',
        name: 'X',
        positions: ['wing-back'],
        leagueTeamId: 'lt-x',
      }),
    ).rejects.toThrow(/Invalid position "WING-BACK"/)
    // Player.create never fires when validation throws.
    expect(playerCreateMock).not.toHaveBeenCalled()
    expect(assignmentCreateMock).not.toHaveBeenCalled()
  })

  it('v1.82.0 — uppercases & dedupes positions case-insensitively', async () => {
    leagueTeamFindUniqueMock.mockResolvedValue({ leagueId: 'league-1' })
    await adminCreatePlayer({
      leagueId: 'league-1',
      name: 'X',
      positions: ['cm', 'CB', 'cm'],
      leagueTeamId: 'lt-x',
    })
    expect(playerCreateMock).toHaveBeenCalledWith({
      data: { name: 'X' },
    })
    // Order from canonical vocabulary; CB precedes CM.
    expect(assignmentCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          positions: ['CM', 'CB'],
          position: 'MF',
        }),
      }),
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
        // v1.82.0 — empty positions[] when caller supplies no positions.
        // v1.86.0 — also writes preferredPositions; secondaryPositions starts [].
        positions: [],
        preferredPositions: [],
        secondaryPositions: [],
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
