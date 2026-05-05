/**
 * v1.56.0 (PR 3 of route-shortening chain) — adminLinkExistingPlayer +
 * adminLinkExistingPlayersBulk contract.
 *
 * The action attaches an existing global Player to a league's roster
 * by creating a new `PlayerLeagueAssignment` row. Distinct from
 * `adminCreatePlayer` (which creates a new global Player) and
 * `transferPlayer` (which moves a player between teams within a single
 * league).
 *
 * Validation gates:
 *   - leagueTeam belongs to leagueId (cross-league isolation)
 *   - Player exists
 *   - Player NOT already on this league's roster (no double-roster)
 *   - fromGameWeek defaults to 1 if not supplied or invalid
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  playerFindUniqueMock,
  leagueTeamFindUniqueMock,
  assignmentFindFirstMock,
  assignmentCreateMock,
  revalidateMock,
} = vi.hoisted(() => ({
  playerFindUniqueMock: vi.fn(),
  leagueTeamFindUniqueMock: vi.fn(),
  assignmentFindFirstMock: vi.fn(),
  assignmentCreateMock: vi.fn(),
  revalidateMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    player: { findUnique: playerFindUniqueMock, update: vi.fn(), updateMany: vi.fn() },
    playerLeagueAssignment: {
      findFirst: assignmentFindFirstMock,
      create: assignmentCreateMock,
      updateMany: vi.fn(),
    },
    leagueTeam: { findUnique: leagueTeamFindUniqueMock, findMany: vi.fn() },
    leagueInvite: { findFirst: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({})),
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

const { adminLinkExistingPlayer, adminLinkExistingPlayersBulk } = await import(
  '@/app/admin/leagues/actions'
)

beforeEach(() => {
  playerFindUniqueMock.mockReset()
  leagueTeamFindUniqueMock.mockReset()
  assignmentFindFirstMock.mockReset()
  assignmentCreateMock.mockReset()
  revalidateMock.mockClear()
})

describe('adminLinkExistingPlayer (single)', () => {
  it('happy path — creates assignment with joinSource: ADMIN + revalidates', async () => {
    playerFindUniqueMock.mockResolvedValue({ id: 'p-stefan' })
    leagueTeamFindUniqueMock.mockResolvedValue({ leagueId: 'league-test' })
    assignmentFindFirstMock.mockResolvedValue(null)
    assignmentCreateMock.mockResolvedValue({ id: 'pla-new' })

    const result = await adminLinkExistingPlayer({
      leagueId: 'league-test',
      playerId: 'p-stefan',
      leagueTeamId: 'lt-mariners',
    })

    expect(result.assignmentId).toBe('pla-new')
    expect(assignmentCreateMock).toHaveBeenCalledWith({
      data: {
        playerId: 'p-stefan',
        leagueTeamId: 'lt-mariners',
        fromGameWeek: 1,
        joinSource: 'ADMIN',
      },
      select: { id: true },
    })
    expect(revalidateMock).toHaveBeenCalledWith({
      domain: 'admin',
      paths: ['/admin/leagues/league-test/players'],
    })
  })

  it('honors explicit fromGameWeek when supplied', async () => {
    playerFindUniqueMock.mockResolvedValue({ id: 'p-stefan' })
    leagueTeamFindUniqueMock.mockResolvedValue({ leagueId: 'league-test' })
    assignmentFindFirstMock.mockResolvedValue(null)
    assignmentCreateMock.mockResolvedValue({ id: 'pla-new' })

    await adminLinkExistingPlayer({
      leagueId: 'league-test',
      playerId: 'p-stefan',
      leagueTeamId: 'lt-mariners',
      fromGameWeek: 5,
    })

    expect(assignmentCreateMock).toHaveBeenCalledWith({
      data: { playerId: 'p-stefan', leagueTeamId: 'lt-mariners', fromGameWeek: 5, joinSource: 'ADMIN' },
      select: { id: true },
    })
  })

  it('coerces non-positive / undefined fromGameWeek to 1', async () => {
    playerFindUniqueMock.mockResolvedValue({ id: 'p-stefan' })
    leagueTeamFindUniqueMock.mockResolvedValue({ leagueId: 'league-test' })
    assignmentFindFirstMock.mockResolvedValue(null)
    assignmentCreateMock.mockResolvedValue({ id: 'pla-new' })

    await adminLinkExistingPlayer({
      leagueId: 'league-test',
      playerId: 'p-stefan',
      leagueTeamId: 'lt-mariners',
      fromGameWeek: 0,
    })
    expect(assignmentCreateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fromGameWeek: 1 }) }),
    )

    await adminLinkExistingPlayer({
      leagueId: 'league-test',
      playerId: 'p-stefan',
      leagueTeamId: 'lt-mariners',
      fromGameWeek: -3,
    })
    expect(assignmentCreateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fromGameWeek: 1 }) }),
    )
  })

  it('rejects when leagueId is empty', async () => {
    await expect(
      adminLinkExistingPlayer({
        leagueId: '',
        playerId: 'p-stefan',
        leagueTeamId: 'lt-mariners',
      }),
    ).rejects.toThrow(/leagueId/)
    expect(assignmentCreateMock).not.toHaveBeenCalled()
    expect(revalidateMock).not.toHaveBeenCalled()
  })

  it('rejects when playerId is empty', async () => {
    await expect(
      adminLinkExistingPlayer({
        leagueId: 'league-test',
        playerId: '',
        leagueTeamId: 'lt-mariners',
      }),
    ).rejects.toThrow(/playerId/)
    expect(assignmentCreateMock).not.toHaveBeenCalled()
  })

  it('rejects when leagueTeamId is empty', async () => {
    await expect(
      adminLinkExistingPlayer({
        leagueId: 'league-test',
        playerId: 'p-stefan',
        leagueTeamId: '',
      }),
    ).rejects.toThrow(/leagueTeamId/)
    expect(assignmentCreateMock).not.toHaveBeenCalled()
  })

  it('rejects when player does not exist', async () => {
    playerFindUniqueMock.mockResolvedValue(null)
    leagueTeamFindUniqueMock.mockResolvedValue({ leagueId: 'league-test' })

    await expect(
      adminLinkExistingPlayer({
        leagueId: 'league-test',
        playerId: 'p-missing',
        leagueTeamId: 'lt-mariners',
      }),
    ).rejects.toThrow(/Player not found/)
    expect(assignmentCreateMock).not.toHaveBeenCalled()
  })

  it('rejects when leagueTeam belongs to a DIFFERENT league (cross-league isolation)', async () => {
    playerFindUniqueMock.mockResolvedValue({ id: 'p-stefan' })
    leagueTeamFindUniqueMock.mockResolvedValue({ leagueId: 'league-OTHER' })

    await expect(
      adminLinkExistingPlayer({
        leagueId: 'league-test',
        playerId: 'p-stefan',
        leagueTeamId: 'lt-other-league-team',
      }),
    ).rejects.toThrow(/does not belong to this league/)
    expect(assignmentCreateMock).not.toHaveBeenCalled()
  })

  it('rejects when leagueTeam does not exist', async () => {
    playerFindUniqueMock.mockResolvedValue({ id: 'p-stefan' })
    leagueTeamFindUniqueMock.mockResolvedValue(null)

    await expect(
      adminLinkExistingPlayer({
        leagueId: 'league-test',
        playerId: 'p-stefan',
        leagueTeamId: 'lt-missing',
      }),
    ).rejects.toThrow(/does not belong to this league/)
    expect(assignmentCreateMock).not.toHaveBeenCalled()
  })

  it('rejects when player ALREADY has an active assignment in this league (no double-roster)', async () => {
    playerFindUniqueMock.mockResolvedValue({ id: 'p-stefan' })
    leagueTeamFindUniqueMock.mockResolvedValue({ leagueId: 'league-test' })
    assignmentFindFirstMock.mockResolvedValue({ id: 'pla-existing' })

    await expect(
      adminLinkExistingPlayer({
        leagueId: 'league-test',
        playerId: 'p-stefan',
        leagueTeamId: 'lt-mariners',
      }),
    ).rejects.toThrow(/already on this league/)
    expect(assignmentCreateMock).not.toHaveBeenCalled()
    expect(revalidateMock).not.toHaveBeenCalled()
  })

  it('queries existing assignment with toGameWeek: null + leagueId scoping', async () => {
    playerFindUniqueMock.mockResolvedValue({ id: 'p-stefan' })
    leagueTeamFindUniqueMock.mockResolvedValue({ leagueId: 'league-test' })
    assignmentFindFirstMock.mockResolvedValue(null)
    assignmentCreateMock.mockResolvedValue({ id: 'pla-new' })

    await adminLinkExistingPlayer({
      leagueId: 'league-test',
      playerId: 'p-stefan',
      leagueTeamId: 'lt-mariners',
    })

    expect(assignmentFindFirstMock).toHaveBeenCalledWith({
      where: {
        playerId: 'p-stefan',
        leagueTeam: { leagueId: 'league-test' },
        toGameWeek: null,
      },
      select: { id: true },
    })
  })
})

describe('adminLinkExistingPlayersBulk', () => {
  it('returns empty results when items list is empty (no DB writes)', async () => {
    const result = await adminLinkExistingPlayersBulk({
      leagueId: 'league-test',
      items: [],
    })
    expect(result.results).toEqual([])
    expect(assignmentCreateMock).not.toHaveBeenCalled()
  })

  it('rejects when batch exceeds 100-item cap', async () => {
    const items = Array.from({ length: 101 }, (_, i) => ({
      playerId: `p-${i}`,
      leagueTeamId: 'lt-mariners',
    }))
    await expect(
      adminLinkExistingPlayersBulk({ leagueId: 'league-test', items }),
    ).rejects.toThrow(/100/)
    expect(assignmentCreateMock).not.toHaveBeenCalled()
  })

  it('happy path — creates all assignments + revalidates once at end', async () => {
    playerFindUniqueMock.mockResolvedValue({ id: 'p-stefan' })
    leagueTeamFindUniqueMock.mockResolvedValue({ leagueId: 'league-test' })
    assignmentFindFirstMock.mockResolvedValue(null)
    let callCount = 0
    assignmentCreateMock.mockImplementation(async () => ({ id: `pla-${callCount++}` }))

    const items = [
      { playerId: 'p-1', leagueTeamId: 'lt-mariners' },
      { playerId: 'p-2', leagueTeamId: 'lt-fenix' },
      { playerId: 'p-3', leagueTeamId: 'lt-hygge' },
    ]
    const result = await adminLinkExistingPlayersBulk({
      leagueId: 'league-test',
      items,
    })

    expect(result.results).toHaveLength(3)
    expect(result.results.every((r) => r.ok)).toBe(true)
    expect(assignmentCreateMock).toHaveBeenCalledTimes(3)
    // adminLinkExistingPlayer revalidates per-call PLUS the bulk action
    // does a final bust — at least 4 total calls (3 inner + 1 outer).
    expect(revalidateMock).toHaveBeenCalledTimes(4)
  })

  it('partial-failure path — surfaces per-row error without aborting batch', async () => {
    playerFindUniqueMock.mockResolvedValue({ id: 'p-stefan' })
    leagueTeamFindUniqueMock.mockResolvedValue({ leagueId: 'league-test' })

    let callIndex = 0
    assignmentFindFirstMock.mockImplementation(async () => {
      // Item 1: already-rostered (fails). Items 0 + 2: not rostered (succeed).
      const result = callIndex === 1 ? { id: 'pla-existing' } : null
      callIndex++
      return result
    })
    assignmentCreateMock.mockResolvedValue({ id: 'pla-new' })

    const items = [
      { playerId: 'p-1', leagueTeamId: 'lt-mariners' },
      { playerId: 'p-2', leagueTeamId: 'lt-fenix' }, // already rostered — fails
      { playerId: 'p-3', leagueTeamId: 'lt-hygge' },
    ]
    const result = await adminLinkExistingPlayersBulk({
      leagueId: 'league-test',
      items,
    })

    expect(result.results).toHaveLength(3)
    expect(result.results[0].ok).toBe(true)
    expect(result.results[1].ok).toBe(false)
    if (!result.results[1].ok) {
      expect(result.results[1].error).toMatch(/already on this league/)
    }
    expect(result.results[2].ok).toBe(true)
  })

  it('threads explicit fromGameWeek to every per-row create', async () => {
    playerFindUniqueMock.mockResolvedValue({ id: 'p-stefan' })
    leagueTeamFindUniqueMock.mockResolvedValue({ leagueId: 'league-test' })
    assignmentFindFirstMock.mockResolvedValue(null)
    assignmentCreateMock.mockResolvedValue({ id: 'pla-new' })

    await adminLinkExistingPlayersBulk({
      leagueId: 'league-test',
      items: [
        { playerId: 'p-1', leagueTeamId: 'lt-mariners' },
        { playerId: 'p-2', leagueTeamId: 'lt-fenix' },
      ],
      fromGameWeek: 7,
    })

    expect(assignmentCreateMock).toHaveBeenCalledTimes(2)
    for (const call of assignmentCreateMock.mock.calls) {
      const [{ data }] = call as [{ data: { fromGameWeek: number } }]
      expect(data.fromGameWeek).toBe(7)
    }
  })
})
