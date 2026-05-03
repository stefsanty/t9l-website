/**
 * v1.43.0 (PR γ) — admin MatchEvent CRUD actions: create / update / delete /
 * setMatchScoreOverride.
 *
 * Pins:
 *   1. Auth gate (assertAdmin) at every entry point.
 *   2. Cross-league isolation — match must belong to the supplied leagueId.
 *   3. Smart-picker contract enforced on the SERVER (defense in depth):
 *        - non-OG: scorer must be on beneficiary team
 *        - OG:    scorer must be on OPPOSING team
 *        - assister, when present, must be on beneficiary team
 *   4. Recompute fires after every mutation (called inside the transaction).
 *   5. setMatchScoreOverride writes only the column; never recomputes.
 *   6. Revalidate hits the right paths.
 *   7. Audit fields populated: createdById = session.userId, kind = GOAL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  matchFindUniqueMock,
  matchUpdateMock,
  matchEventCreateMock,
  matchEventUpdateMock,
  matchEventDeleteMock,
  matchEventFindUniqueMock,
  plaFindFirstMock,
  txMock,
  revalidateMock,
  recomputeMock,
} = vi.hoisted(() => {
  const matchFindUniqueMock = vi.fn()
  const matchUpdateMock = vi.fn().mockResolvedValue({})
  const matchEventCreateMock = vi.fn().mockResolvedValue({ id: 'me-new' })
  const matchEventUpdateMock = vi.fn().mockResolvedValue({})
  const matchEventDeleteMock = vi.fn().mockResolvedValue({})
  const matchEventFindUniqueMock = vi.fn()
  const plaFindFirstMock = vi.fn()
  const recomputeMock = vi.fn().mockResolvedValue({ home: 0, away: 0 })
  const txMock = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      match: { update: matchUpdateMock },
      matchEvent: {
        create: matchEventCreateMock,
        update: matchEventUpdateMock,
        delete: matchEventDeleteMock,
      },
    }
    return cb(tx)
  })
  return {
    matchFindUniqueMock,
    matchUpdateMock,
    matchEventCreateMock,
    matchEventUpdateMock,
    matchEventDeleteMock,
    matchEventFindUniqueMock,
    plaFindFirstMock,
    txMock,
    revalidateMock: vi.fn(),
    recomputeMock,
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    match: { findUnique: matchFindUniqueMock, update: matchUpdateMock },
    matchEvent: {
      findUnique: matchEventFindUniqueMock,
      create: matchEventCreateMock,
      update: matchEventUpdateMock,
      delete: matchEventDeleteMock,
    },
    playerLeagueAssignment: { findFirst: plaFindFirstMock },
    $transaction: txMock,
    league: { findUnique: vi.fn() },
    leagueTeam: { findUnique: vi.fn() },
    setting: { upsert: vi.fn() },
    player: { update: vi.fn(), updateMany: vi.fn() },
    leagueInvite: { findFirst: vi.fn(), create: vi.fn() },
  },
}))

vi.mock('@/lib/matchScore', () => ({
  recomputeMatchScore: recomputeMock,
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

const {
  adminCreateMatchEvent,
  adminUpdateMatchEvent,
  adminDeleteMatchEvent,
  adminSetMatchScoreOverride,
} = await import('@/app/admin/leagues/actions')

const LEAGUE = 'l-default'
const MATCH = 'm-1'
const HOME = 'lt-home'
const AWAY = 'lt-away'

beforeEach(() => {
  matchFindUniqueMock.mockReset()
  matchFindUniqueMock.mockResolvedValue({
    id: MATCH,
    leagueId: LEAGUE,
    homeTeamId: HOME,
    awayTeamId: AWAY,
  })
  matchUpdateMock.mockReset()
  matchUpdateMock.mockResolvedValue({})
  matchEventCreateMock.mockReset()
  matchEventCreateMock.mockResolvedValue({ id: 'me-new' })
  matchEventUpdateMock.mockReset()
  matchEventUpdateMock.mockResolvedValue({})
  matchEventDeleteMock.mockReset()
  matchEventDeleteMock.mockResolvedValue({})
  matchEventFindUniqueMock.mockReset()
  plaFindFirstMock.mockReset()
  txMock.mockClear()
  revalidateMock.mockClear()
  recomputeMock.mockClear()
})

describe('adminCreateMatchEvent', () => {
  it('happy path: inserts event, recomputes, revalidates', async () => {
    plaFindFirstMock.mockResolvedValue({ id: 'pla-1' })
    const result = await adminCreateMatchEvent({
      matchId: MATCH,
      leagueId: LEAGUE,
      goalType: 'OPEN_PLAY',
      beneficiaryTeamId: HOME,
      scorerId: 'p-stefan',
      assisterId: null,
      minute: 47,
    })
    expect(result.id).toBe('me-new')
    expect(matchEventCreateMock).toHaveBeenCalledTimes(1)
    const args = matchEventCreateMock.mock.calls[0][0]
    expect(args.data.kind).toBe('GOAL')
    expect(args.data.goalType).toBe('OPEN_PLAY')
    expect(args.data.scorerId).toBe('p-stefan')
    expect(args.data.assisterId).toBeNull()
    expect(args.data.minute).toBe(47)
    expect(args.data.createdById).toBe('u-admin')
    expect(recomputeMock).toHaveBeenCalledWith(expect.anything(), MATCH)
    expect(revalidateMock).toHaveBeenCalledTimes(1)
    expect(revalidateMock.mock.calls[0][0].domain).toBe('admin')
    expect(revalidateMock.mock.calls[0][0].paths).toEqual(
      expect.arrayContaining([
        `/admin/leagues/${LEAGUE}/stats`,
        `/admin/leagues/${LEAGUE}/schedule`,
        `/admin/matches/${MATCH}`,
      ]),
    )
  })

  it('rejects when match is not in the supplied league (cross-league isolation)', async () => {
    matchFindUniqueMock.mockResolvedValue({
      id: MATCH,
      leagueId: 'l-other',
      homeTeamId: HOME,
      awayTeamId: AWAY,
    })
    await expect(
      adminCreateMatchEvent({
        matchId: MATCH,
        leagueId: LEAGUE,
        goalType: 'OPEN_PLAY',
        beneficiaryTeamId: HOME,
        scorerId: 'p-stefan',
      }),
    ).rejects.toThrow(/Match not found in this league/)
    expect(matchEventCreateMock).not.toHaveBeenCalled()
    expect(recomputeMock).not.toHaveBeenCalled()
  })

  it('rejects when beneficiaryTeamId is not part of the match', async () => {
    await expect(
      adminCreateMatchEvent({
        matchId: MATCH,
        leagueId: LEAGUE,
        goalType: 'OPEN_PLAY',
        beneficiaryTeamId: 'lt-stranger',
        scorerId: 'p-stefan',
      }),
    ).rejects.toThrow(/beneficiaryTeamId is not part of this match/)
  })

  it('rejects when scorer is not on the beneficiary team (non-OG)', async () => {
    plaFindFirstMock.mockResolvedValue(null) // scorer is NOT on beneficiary team
    await expect(
      adminCreateMatchEvent({
        matchId: MATCH,
        leagueId: LEAGUE,
        goalType: 'OPEN_PLAY',
        beneficiaryTeamId: HOME,
        scorerId: 'p-stefan',
      }),
    ).rejects.toThrow(/Scorer must be on the beneficiary team/)
  })

  it('rejects OWN_GOAL when scorer is NOT on the OPPOSING team', async () => {
    plaFindFirstMock.mockResolvedValue(null)
    await expect(
      adminCreateMatchEvent({
        matchId: MATCH,
        leagueId: LEAGUE,
        goalType: 'OWN_GOAL',
        beneficiaryTeamId: HOME, // OG benefits HOME → scorer must be on AWAY
        scorerId: 'p-stefan',
      }),
    ).rejects.toThrow(/OPPOSING team/)
    // The query should look for scorer on AWAY (the opposing team).
    expect(plaFindFirstMock).toHaveBeenCalledWith({
      where: { playerId: 'p-stefan', leagueTeamId: AWAY },
      select: { id: true },
    })
  })

  it('OWN_GOAL happy path: scorer on opposing team passes', async () => {
    plaFindFirstMock.mockResolvedValue({ id: 'pla-og' })
    const result = await adminCreateMatchEvent({
      matchId: MATCH,
      leagueId: LEAGUE,
      goalType: 'OWN_GOAL',
      beneficiaryTeamId: HOME,
      scorerId: 'p-og-er',
    })
    expect(result.id).toBe('me-new')
    expect(plaFindFirstMock).toHaveBeenCalledWith({
      where: { playerId: 'p-og-er', leagueTeamId: AWAY },
      select: { id: true },
    })
  })

  it('rejects when assister is not on the beneficiary team', async () => {
    plaFindFirstMock
      .mockResolvedValueOnce({ id: 'pla-1' }) // scorer ✓
      .mockResolvedValueOnce(null) // assister ✗
    await expect(
      adminCreateMatchEvent({
        matchId: MATCH,
        leagueId: LEAGUE,
        goalType: 'OPEN_PLAY',
        beneficiaryTeamId: HOME,
        scorerId: 'p-stefan',
        assisterId: 'p-stranger',
      }),
    ).rejects.toThrow(/Assister must be on the beneficiary team/)
  })

  it('rejects when assister equals scorer', async () => {
    await expect(
      adminCreateMatchEvent({
        matchId: MATCH,
        leagueId: LEAGUE,
        goalType: 'OPEN_PLAY',
        beneficiaryTeamId: HOME,
        scorerId: 'p-stefan',
        assisterId: 'p-stefan',
      }),
    ).rejects.toThrow(/Assister cannot be the scorer/)
  })

  it('rejects invalid goalType', async () => {
    await expect(
      adminCreateMatchEvent({
        matchId: MATCH,
        leagueId: LEAGUE,
        // @ts-expect-error — defensive runtime check
        goalType: 'BICYCLE_KICK',
        beneficiaryTeamId: HOME,
        scorerId: 'p-stefan',
      }),
    ).rejects.toThrow(/Invalid goalType/)
  })

  it('rejects out-of-range minute', async () => {
    await expect(
      adminCreateMatchEvent({
        matchId: MATCH,
        leagueId: LEAGUE,
        goalType: 'OPEN_PLAY',
        beneficiaryTeamId: HOME,
        scorerId: 'p-stefan',
        minute: 999,
      }),
    ).rejects.toThrow(/minute out of range/)
    await expect(
      adminCreateMatchEvent({
        matchId: MATCH,
        leagueId: LEAGUE,
        goalType: 'OPEN_PLAY',
        beneficiaryTeamId: HOME,
        scorerId: 'p-stefan',
        minute: -5,
      }),
    ).rejects.toThrow(/minute out of range/)
  })
})

describe('adminUpdateMatchEvent', () => {
  beforeEach(() => {
    matchEventFindUniqueMock.mockResolvedValue({ id: 'me-1', matchId: MATCH })
  })

  it('updates and recomputes', async () => {
    plaFindFirstMock.mockResolvedValue({ id: 'pla-1' })
    await adminUpdateMatchEvent({
      eventId: 'me-1',
      leagueId: LEAGUE,
      goalType: 'PENALTY',
      beneficiaryTeamId: HOME,
      scorerId: 'p-stefan',
      assisterId: null,
      minute: null,
    })
    expect(matchEventUpdateMock).toHaveBeenCalledTimes(1)
    expect(matchEventUpdateMock.mock.calls[0][0].where.id).toBe('me-1')
    expect(recomputeMock).toHaveBeenCalledWith(expect.anything(), MATCH)
    expect(revalidateMock).toHaveBeenCalledTimes(1)
  })

  it('rejects when event not found', async () => {
    matchEventFindUniqueMock.mockResolvedValue(null)
    await expect(
      adminUpdateMatchEvent({
        eventId: 'me-missing',
        leagueId: LEAGUE,
        goalType: 'OPEN_PLAY',
        beneficiaryTeamId: HOME,
        scorerId: 'p-stefan',
      }),
    ).rejects.toThrow(/Event not found/)
  })

  it('rejects when match cross-league mismatch', async () => {
    matchFindUniqueMock.mockResolvedValue({
      id: MATCH,
      leagueId: 'l-other',
      homeTeamId: HOME,
      awayTeamId: AWAY,
    })
    await expect(
      adminUpdateMatchEvent({
        eventId: 'me-1',
        leagueId: LEAGUE,
        goalType: 'OPEN_PLAY',
        beneficiaryTeamId: HOME,
        scorerId: 'p-stefan',
      }),
    ).rejects.toThrow(/Match not found in this league/)
  })
})

describe('adminDeleteMatchEvent', () => {
  it('deletes and recomputes', async () => {
    matchEventFindUniqueMock.mockResolvedValue({
      id: 'me-1',
      matchId: MATCH,
      match: { leagueId: LEAGUE },
    })
    await adminDeleteMatchEvent({ eventId: 'me-1', leagueId: LEAGUE })
    expect(matchEventDeleteMock).toHaveBeenCalledWith({ where: { id: 'me-1' } })
    expect(recomputeMock).toHaveBeenCalledWith(expect.anything(), MATCH)
    expect(revalidateMock).toHaveBeenCalledTimes(1)
  })

  it('rejects when event not in this league', async () => {
    matchEventFindUniqueMock.mockResolvedValue({
      id: 'me-1',
      matchId: MATCH,
      match: { leagueId: 'l-other' },
    })
    await expect(
      adminDeleteMatchEvent({ eventId: 'me-1', leagueId: LEAGUE }),
    ).rejects.toThrow(/Event not found in this league/)
    expect(matchEventDeleteMock).not.toHaveBeenCalled()
    expect(recomputeMock).not.toHaveBeenCalled()
  })

  it('rejects when event not found', async () => {
    matchEventFindUniqueMock.mockResolvedValue(null)
    await expect(
      adminDeleteMatchEvent({ eventId: 'me-missing', leagueId: LEAGUE }),
    ).rejects.toThrow(/Event not found/)
  })
})

describe('adminSetMatchScoreOverride', () => {
  it('writes the override and DOES NOT recompute', async () => {
    await adminSetMatchScoreOverride({
      matchId: MATCH,
      leagueId: LEAGUE,
      override: '3-0 (forfeit)',
    })
    expect(matchUpdateMock).toHaveBeenCalledWith({
      where: { id: MATCH },
      data: { scoreOverride: '3-0 (forfeit)' },
    })
    expect(recomputeMock).not.toHaveBeenCalled()
    expect(revalidateMock).toHaveBeenCalledTimes(1)
  })

  it('passing null clears the override', async () => {
    await adminSetMatchScoreOverride({
      matchId: MATCH,
      leagueId: LEAGUE,
      override: null,
    })
    expect(matchUpdateMock).toHaveBeenCalledWith({
      where: { id: MATCH },
      data: { scoreOverride: null },
    })
  })

  it('whitespace-only string clears the override', async () => {
    await adminSetMatchScoreOverride({
      matchId: MATCH,
      leagueId: LEAGUE,
      override: '   ',
    })
    expect(matchUpdateMock).toHaveBeenCalledWith({
      where: { id: MATCH },
      data: { scoreOverride: null },
    })
  })

  it('rejects on cross-league mismatch', async () => {
    matchFindUniqueMock.mockResolvedValue({ leagueId: 'l-other' })
    await expect(
      adminSetMatchScoreOverride({
        matchId: MATCH,
        leagueId: LEAGUE,
        override: '1-0',
      }),
    ).rejects.toThrow(/Match not found in this league/)
  })
})
