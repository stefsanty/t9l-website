/**
 * v1.43.0 (PR γ) — admin MatchEvent CRUD actions: create / update / delete /
 * setMatchScoreOverride.
 *
 * Pins:
 *   1. Auth gate (assertAdmin) at every entry point.
 *   2. Cross-league isolation — match must belong to the supplied leagueId.
 *   3. v1.82.0 — scorer/assister scope enforced on SERVER: any active
 *      member of this league (any team, including non-match teams).
 *      Pre-v1.82.0 the scorer was constrained to beneficiary (or opposing
 *      for OG) and assister to beneficiary; that rule blocked cross-team
 *      guests, which casual leagues actually need.
 *   4. Recompute fires after every mutation (called inside the transaction).
 *   5. setMatchScoreOverride writes only the column; never recomputes.
 *   6. Revalidate hits the right paths.
 *   7. Audit fields populated: createdById = session.userId, kind = GOAL.
 *   8. v1.82.0 — `beneficiaryTeamId` persisted on the MatchEvent row so
 *      score recompute attributes cross-team scorers correctly.
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
    playerLeagueMembership: { findFirst: plaFindFirstMock },
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
  it('happy path: inserts event with beneficiaryTeamId persisted, recomputes, revalidates', async () => {
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
    // v1.82.0 — beneficiary persisted on the event row.
    expect(args.data.beneficiaryTeamId).toBe(HOME)
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

  it('v1.82.0 regression target: accepts a cross-team scorer (guest player from a third team)', async () => {
    // Scorer is NOT on the beneficiary or opposing team — they're on
    // a third league team. Pre-v1.82.0 this rejected; post-v1.82.0 it
    // succeeds because scope loosens to "any active league member".
    plaFindFirstMock.mockResolvedValue({ id: 'pla-third-team' })
    const result = await adminCreateMatchEvent({
      matchId: MATCH,
      leagueId: LEAGUE,
      goalType: 'OPEN_PLAY',
      beneficiaryTeamId: HOME,
      scorerId: 'p-guest',
    })
    expect(result.id).toBe('me-new')
    // v1.82.0 — membership query now scopes by leagueId, not by team.
    const calls = plaFindFirstMock.mock.calls
    const scorerWhere = calls[0][0].where
    expect(scorerWhere.leagueId).toBe(LEAGUE)
    expect(scorerWhere.leagueTeamId).toEqual({ not: null })
  })

  it('v1.82.0 regression target: accepts a cross-team assister', async () => {
    plaFindFirstMock
      .mockResolvedValueOnce({ id: 'pla-scorer' })
      .mockResolvedValueOnce({ id: 'pla-cross-team-assister' })
    const result = await adminCreateMatchEvent({
      matchId: MATCH,
      leagueId: LEAGUE,
      goalType: 'OPEN_PLAY',
      beneficiaryTeamId: HOME,
      scorerId: 'p-stefan',
      assisterId: 'p-other-team-friend',
    })
    expect(result.id).toBe('me-new')
    // Both queries scope by leagueId.
    const assisterCall = plaFindFirstMock.mock.calls[1][0]
    expect(assisterCall.where.leagueId).toBe(LEAGUE)
    expect(assisterCall.where.leagueTeamId).toEqual({ not: null })
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

  it('v1.82.0 regression target: rejects when scorer is not in this league at all', async () => {
    plaFindFirstMock.mockResolvedValue(null)
    await expect(
      adminCreateMatchEvent({
        matchId: MATCH,
        leagueId: LEAGUE,
        goalType: 'OPEN_PLAY',
        beneficiaryTeamId: HOME,
        scorerId: 'p-out-of-league',
      }),
    ).rejects.toThrow(/Scorer is not a member of this league/)
  })

  it('OWN_GOAL with explicit beneficiary persists beneficiaryTeamId from input', async () => {
    plaFindFirstMock.mockResolvedValue({ id: 'pla-og' })
    const result = await adminCreateMatchEvent({
      matchId: MATCH,
      leagueId: LEAGUE,
      goalType: 'OWN_GOAL',
      beneficiaryTeamId: HOME,
      scorerId: 'p-og-er',
    })
    expect(result.id).toBe('me-new')
    // v1.82.0 — beneficiary comes from the form, not derived from the
    // scorer's team. Persisted on the event so recompute can attribute
    // correctly even when scorer is on a non-match team (guest OGer).
    const args = matchEventCreateMock.mock.calls[0][0]
    expect(args.data.goalType).toBe('OWN_GOAL')
    expect(args.data.beneficiaryTeamId).toBe(HOME)
    // v1.82.0 — no longer requires scorer on opposing team; query
    // scopes by leagueId.
    const scorerCall = plaFindFirstMock.mock.calls[0][0]
    expect(scorerCall.where.leagueId).toBe(LEAGUE)
  })

  it('v1.82.0 regression target: rejects when assister is not in this league at all', async () => {
    plaFindFirstMock
      .mockResolvedValueOnce({ id: 'pla-1' }) // scorer in league
      .mockResolvedValueOnce(null) // assister not in league
    await expect(
      adminCreateMatchEvent({
        matchId: MATCH,
        leagueId: LEAGUE,
        goalType: 'OPEN_PLAY',
        beneficiaryTeamId: HOME,
        scorerId: 'p-stefan',
        assisterId: 'p-stranger',
      }),
    ).rejects.toThrow(/Assister is not a member of this league/)
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

  it('updates and recomputes, persists beneficiaryTeamId', async () => {
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
    // v1.82.0 — update propagates beneficiaryTeamId from input.
    expect(matchEventUpdateMock.mock.calls[0][0].data.beneficiaryTeamId).toBe(HOME)
    expect(recomputeMock).toHaveBeenCalledWith(expect.anything(), MATCH)
    expect(revalidateMock).toHaveBeenCalledTimes(1)
  })

  it('v1.82.0 regression target: update accepts a cross-team scorer', async () => {
    plaFindFirstMock.mockResolvedValue({ id: 'pla-third-team' })
    await adminUpdateMatchEvent({
      eventId: 'me-1',
      leagueId: LEAGUE,
      goalType: 'OPEN_PLAY',
      beneficiaryTeamId: HOME,
      scorerId: 'p-guest',
    })
    const scorerCall = plaFindFirstMock.mock.calls[0][0]
    expect(scorerCall.where.leagueId).toBe(LEAGUE)
    expect(scorerCall.where.leagueTeamId).toEqual({ not: null })
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
