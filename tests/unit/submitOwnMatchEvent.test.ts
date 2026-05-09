/**
 * v1.46.0 (epic match events PR ζ) — server action `submitOwnMatchEvent`
 * gates the player-side write path. Every gate pinned.
 *
 * v1.48.0 — open attribution: ANY logged-in linked player can submit a
 * goal for ANY player.
 *
 * v1.82.0 — cross-team scorers/assisters. Scorer/assister scope loosens
 * from "on a match team" to "any active member of this league".
 * Beneficiary team is now an explicit input (the form's "Goal counts
 * for" picker) — required, must be one of the match's two teams. The
 * MatchEvent row records `beneficiaryTeamId` so the score recompute
 * doesn't have to re-derive it from the scorer (which would fail for
 * cross-team guest scorers).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  playerFindUniqueMock,
  gameWeekFindFirstMock,
  plaFindFirstMock,
  matchEventCreateMock,
  txMock,
  revalidateMock,
  recomputeMock,
  getServerSessionMock,
} = vi.hoisted(() => {
  const playerFindUniqueMock = vi.fn()
  const gameWeekFindFirstMock = vi.fn()
  const plaFindFirstMock = vi.fn()
  const matchEventCreateMock = vi.fn().mockResolvedValue({ id: 'me-zeta' })
  const recomputeMock = vi.fn().mockResolvedValue({ home: 1, away: 0 })
  const txMock = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    return cb({ matchEvent: { create: matchEventCreateMock } })
  })
  return {
    playerFindUniqueMock,
    gameWeekFindFirstMock,
    plaFindFirstMock,
    matchEventCreateMock,
    txMock,
    revalidateMock: vi.fn(),
    recomputeMock,
    getServerSessionMock: vi.fn(),
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    player: { findUnique: playerFindUniqueMock },
    gameWeek: { findFirst: gameWeekFindFirstMock },
    playerLeagueMembership: { findFirst: plaFindFirstMock },
    $transaction: txMock,
  },
}))
vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))
vi.mock('@/lib/revalidate', () => ({ revalidate: revalidateMock }))
vi.mock('@/lib/matchScore', () => ({ recomputeMatchScore: recomputeMock }))
vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}))

const { submitOwnMatchEvent } = await import('@/app/matchday/[id]/actions')
const { parseMatchPublicId } = await import('@/lib/matchPublicId')

const HOME_LT = 'lt-home'
const AWAY_LT = 'lt-away'
const NOW = Date.now()
const PAST = new Date(NOW - 60_000)
const FUTURE = new Date(NOW + 60 * 60_000)

beforeEach(() => {
  playerFindUniqueMock.mockReset()
  gameWeekFindFirstMock.mockReset()
  plaFindFirstMock.mockReset()
  matchEventCreateMock.mockReset()
  matchEventCreateMock.mockResolvedValue({ id: 'me-zeta' })
  txMock.mockClear()
  revalidateMock.mockClear()
  recomputeMock.mockClear()
  getServerSessionMock.mockReset()

  // Default: signed-in linked CALLER (audit user). The CALLER does not
  // need to be on either match team; v1.48.0 lets any linked player
  // submit on behalf of any scorer.
  getServerSessionMock.mockResolvedValue({
    userId: 'u-stefan',
    playerId: 'stefan-santos',
  })
  // Caller's player record — drives the leagueId resolution.
  playerFindUniqueMock.mockResolvedValue({
    id: 'p-stefan-santos',
    name: 'Stefan',
    leagueAssignments: [
      {
        leagueTeamId: HOME_LT,
        leagueTeam: { id: HOME_LT, leagueId: 'l-default' },
      },
    ],
  })
  gameWeekFindFirstMock.mockResolvedValue({
    matches: [
      { id: 'm-real', homeTeamId: HOME_LT, awayTeamId: AWAY_LT, playedAt: PAST },
    ],
  })
  // Default scorer/assister membership lookup returns "found" — used by
  // the v1.82.0 league-scope check. Tests that exercise the not-in-league
  // branch override per call below.
  plaFindFirstMock.mockResolvedValue({ id: 'pla-1' })
})

describe('parseMatchPublicId', () => {
  it('parses md3-m2 to weekNumber=3, matchIndex=1', () => {
    expect(parseMatchPublicId('md3-m2')).toEqual({
      weekNumber: 3,
      matchIndex: 1,
      matchdayPublicId: 'md3',
    })
  })

  it('returns null on shape mismatch', () => {
    expect(parseMatchPublicId('m1')).toBeNull()
    expect(parseMatchPublicId('md-m1')).toBeNull()
    expect(parseMatchPublicId('xxx')).toBeNull()
  })
})

describe('submitOwnMatchEvent (v1.82.0 cross-team scorer/assister)', () => {
  it('happy path: creates event with explicit beneficiary, league-scope membership check, recomputes, revalidates', async () => {
    const result = await submitOwnMatchEvent({
      matchPublicId: 'md1-m1',
      beneficiaryTeamId: HOME_LT,
      scorerPlayerSlug: 'aleksandr-ivankov',
      goalType: 'OPEN_PLAY',
      assisterPlayerSlug: null,
      minute: 47,
    })
    expect(result.id).toBe('me-zeta')
    expect(matchEventCreateMock).toHaveBeenCalledTimes(1)
    const data = matchEventCreateMock.mock.calls[0][0].data
    expect(data.kind).toBe('GOAL')
    expect(data.scorerId).toBe('p-aleksandr-ivankov')
    expect(data.goalType).toBe('OPEN_PLAY')
    expect(data.assisterId).toBeNull()
    expect(data.minute).toBe(47)
    // v1.82.0 — beneficiary now persisted on the event row so the score
    // recompute can attribute cross-team scorers correctly.
    expect(data.beneficiaryTeamId).toBe(HOME_LT)
    expect(data.createdById).toBe('u-stefan')
    expect(recomputeMock).toHaveBeenCalledWith(expect.anything(), 'm-real')
    expect(revalidateMock).toHaveBeenCalledTimes(1)
    // v1.82.0 — scorer membership check uses leagueId (not match-team in).
    const calls = plaFindFirstMock.mock.calls
    expect(calls.length).toBeGreaterThanOrEqual(1)
    const scorerWhere = calls[0][0].where
    expect(scorerWhere.leagueId).toBe('l-default')
    expect(scorerWhere.leagueTeamId).toEqual({ not: null })
  })

  it('rejects when not signed in', async () => {
    getServerSessionMock.mockResolvedValue(null)
    await expect(
      submitOwnMatchEvent({
        matchPublicId: 'md1-m1',
        beneficiaryTeamId: HOME_LT,
        scorerPlayerSlug: 'aleksandr-ivankov',
        goalType: 'OPEN_PLAY',
      }),
    ).rejects.toThrow(/Not signed in/)
    expect(matchEventCreateMock).not.toHaveBeenCalled()
  })

  it('rejects when caller has no linked player', async () => {
    getServerSessionMock.mockResolvedValue({ userId: 'u-x', playerId: null })
    await expect(
      submitOwnMatchEvent({
        matchPublicId: 'md1-m1',
        beneficiaryTeamId: HOME_LT,
        scorerPlayerSlug: 'aleksandr-ivankov',
        goalType: 'OPEN_PLAY',
      }),
    ).rejects.toThrow(/No linked player/)
  })

  it('rejects on invalid goalType', async () => {
    await expect(
      submitOwnMatchEvent({
        matchPublicId: 'md1-m1',
        beneficiaryTeamId: HOME_LT,
        scorerPlayerSlug: 'aleksandr-ivankov',
        // @ts-expect-error — runtime guard
        goalType: 'BICYCLE',
      }),
    ).rejects.toThrow(/Invalid goalType/)
  })

  it('rejects malformed matchPublicId', async () => {
    await expect(
      submitOwnMatchEvent({
        matchPublicId: 'bogus',
        beneficiaryTeamId: HOME_LT,
        scorerPlayerSlug: 'aleksandr-ivankov',
        goalType: 'OPEN_PLAY',
      }),
    ).rejects.toThrow(/Invalid matchPublicId/)
  })

  it('rejects when match is not in the caller’s league', async () => {
    gameWeekFindFirstMock.mockResolvedValue(null)
    await expect(
      submitOwnMatchEvent({
        matchPublicId: 'md9-m1',
        beneficiaryTeamId: HOME_LT,
        scorerPlayerSlug: 'aleksandr-ivankov',
        goalType: 'OPEN_PLAY',
      }),
    ).rejects.toThrow(/Matchday MD9 not in league/)
  })

  it('v1.82.0 regression target: accepts a cross-team scorer (guest player from a third team)', async () => {
    // Scorer is on a third league team — not on either match team.
    // Pre-v1.82.0 this would have rejected with "Scorer is not on either
    // of the match teams"; post-v1.82.0 the scorer needs only to be a
    // member of the same league. The membership lookup now scopes by
    // leagueId rather than match-team-set, so the mock returning a
    // truthy result here mirrors what the real query does for guests.
    plaFindFirstMock.mockResolvedValue({ id: 'pla-third-team' })
    const result = await submitOwnMatchEvent({
      matchPublicId: 'md1-m1',
      beneficiaryTeamId: HOME_LT,
      scorerPlayerSlug: 'guest-player',
      goalType: 'OPEN_PLAY',
    })
    expect(result.id).toBe('me-zeta')
    const data = matchEventCreateMock.mock.calls[0][0].data
    expect(data.scorerId).toBe('p-guest-player')
    expect(data.beneficiaryTeamId).toBe(HOME_LT)
  })

  it('v1.82.0 regression target: rejects when scorer is not in this league at all', async () => {
    plaFindFirstMock.mockResolvedValue(null)
    await expect(
      submitOwnMatchEvent({
        matchPublicId: 'md1-m1',
        beneficiaryTeamId: HOME_LT,
        scorerPlayerSlug: 'random-guy',
        goalType: 'OPEN_PLAY',
      }),
    ).rejects.toThrow(/Scorer is not a member of this league/)
  })

  it('v1.82.0 regression target: rejects when beneficiaryTeamId is not part of the match', async () => {
    await expect(
      submitOwnMatchEvent({
        matchPublicId: 'md1-m1',
        beneficiaryTeamId: 'lt-third',
        scorerPlayerSlug: 'aleksandr-ivankov',
        goalType: 'OPEN_PLAY',
      }),
    ).rejects.toThrow(/Beneficiary team is not part of this match/)
  })

  it('v1.82.0 regression target: rejects when beneficiaryTeamId is empty', async () => {
    await expect(
      submitOwnMatchEvent({
        matchPublicId: 'md1-m1',
        beneficiaryTeamId: '',
        scorerPlayerSlug: 'aleksandr-ivankov',
        goalType: 'OPEN_PLAY',
      }),
    ).rejects.toThrow(/Beneficiary team is required/)
  })

  it('rejects when scorer slug is empty', async () => {
    await expect(
      submitOwnMatchEvent({
        matchPublicId: 'md1-m1',
        beneficiaryTeamId: HOME_LT,
        scorerPlayerSlug: '',
        goalType: 'OPEN_PLAY',
      }),
    ).rejects.toThrow(/Scorer is required/)
  })

  it('rejects when ALL kickoffs are still in the future', async () => {
    gameWeekFindFirstMock.mockResolvedValue({
      matches: [
        { id: 'm-real', homeTeamId: HOME_LT, awayTeamId: AWAY_LT, playedAt: FUTURE },
      ],
    })
    await expect(
      submitOwnMatchEvent({
        matchPublicId: 'md1-m1',
        beneficiaryTeamId: HOME_LT,
        scorerPlayerSlug: 'aleksandr-ivankov',
        goalType: 'OPEN_PLAY',
      }),
    ).rejects.toThrow(/Submission opens at kickoff/)
  })

  it('rejects when assister equals scorer', async () => {
    await expect(
      submitOwnMatchEvent({
        matchPublicId: 'md1-m1',
        beneficiaryTeamId: HOME_LT,
        scorerPlayerSlug: 'aleksandr-ivankov',
        goalType: 'OPEN_PLAY',
        assisterPlayerSlug: 'aleksandr-ivankov',
      }),
    ).rejects.toThrow(/Assister cannot be the scorer/)
  })

  it('v1.82.0: accepts a cross-team assister (any league member)', async () => {
    // Two findFirst calls — scorer + assister. Both succeed (truthy).
    plaFindFirstMock
      .mockResolvedValueOnce({ id: 'pla-scorer' })
      .mockResolvedValueOnce({ id: 'pla-assister-other-team' })
    const result = await submitOwnMatchEvent({
      matchPublicId: 'md1-m1',
      beneficiaryTeamId: HOME_LT,
      scorerPlayerSlug: 'aleksandr-ivankov',
      goalType: 'OPEN_PLAY',
      assisterPlayerSlug: 'cross-team-assister',
    })
    expect(result.id).toBe('me-zeta')
    const data = matchEventCreateMock.mock.calls[0][0].data
    expect(data.assisterId).toBe('p-cross-team-assister')
  })

  it('v1.82.0 regression target: rejects when assister is not in this league at all', async () => {
    plaFindFirstMock
      .mockResolvedValueOnce({ id: 'pla-scorer' })
      .mockResolvedValueOnce(null)
    await expect(
      submitOwnMatchEvent({
        matchPublicId: 'md1-m1',
        beneficiaryTeamId: HOME_LT,
        scorerPlayerSlug: 'aleksandr-ivankov',
        goalType: 'OPEN_PLAY',
        assisterPlayerSlug: 'random-other',
      }),
    ).rejects.toThrow(/Assister is not a member of this league/)
  })

  it('OWN_GOAL: beneficiaryTeamId from input drives recompute (not derived from scorer)', async () => {
    // For OG, the beneficiary is the team that benefits from the goal —
    // explicitly passed by the form. v1.82.0 no longer derives this from
    // the scorer's team membership.
    const result = await submitOwnMatchEvent({
      matchPublicId: 'md1-m1',
      beneficiaryTeamId: AWAY_LT,
      scorerPlayerSlug: 'aleksandr-ivankov',
      goalType: 'OWN_GOAL',
    })
    expect(result.id).toBe('me-zeta')
    const data = matchEventCreateMock.mock.calls[0][0].data
    expect(data.goalType).toBe('OWN_GOAL')
    expect(data.beneficiaryTeamId).toBe(AWAY_LT)
  })

  it('audits createdById from session, scorer from input', async () => {
    await submitOwnMatchEvent({
      matchPublicId: 'md1-m1',
      beneficiaryTeamId: HOME_LT,
      scorerPlayerSlug: 'someone-else',
      goalType: 'OPEN_PLAY',
    })
    const data = matchEventCreateMock.mock.calls[0][0].data
    expect(data.createdById).toBe('u-stefan')
    expect(data.scorerId).toBe('p-someone-else')
  })

  it('caller does NOT need to be on a match team to submit (open attribution)', async () => {
    const result = await submitOwnMatchEvent({
      matchPublicId: 'md1-m1',
      beneficiaryTeamId: HOME_LT,
      scorerPlayerSlug: 'aleksandr-ivankov',
      goalType: 'OPEN_PLAY',
    })
    expect(result.id).toBe('me-zeta')
    expect(matchEventCreateMock.mock.calls[0][0].data.scorerId).toBe('p-aleksandr-ivankov')
  })

  it('rejects out-of-range minute', async () => {
    await expect(
      submitOwnMatchEvent({
        matchPublicId: 'md1-m1',
        beneficiaryTeamId: HOME_LT,
        scorerPlayerSlug: 'aleksandr-ivankov',
        goalType: 'OPEN_PLAY',
        minute: 999,
      }),
    ).rejects.toThrow(/minute out of range/)
  })
})
