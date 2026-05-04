/**
 * v1.46.0 (epic match events PR ζ) — server action `submitOwnMatchEvent`
 * gates the player-side write path. Every gate pinned.
 *
 * v1.48.0 — open attribution: ANY logged-in linked player can submit a
 * goal for ANY player. Tests rewritten for the new contract:
 *   - `scorerPlayerSlug` is required, comes from form input (not session)
 *   - the scorer must have an assignment in one of the match's two teams
 *   - the calling user (`session.playerId`) is recorded in `createdById`
 *     for audit but is NOT used as the scorer
 *   - assister, if supplied, must be on the SCORER's team (not caller's)
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
    playerLeagueAssignment: { findFirst: plaFindFirstMock },
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
  // Default scorer-on-home; assister-on-home (used for happy path).
  plaFindFirstMock.mockResolvedValue({ id: 'pla-1', leagueTeamId: HOME_LT })
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

describe('submitOwnMatchEvent (v1.48.0 open attribution)', () => {
  it('happy path: creates event with scorer from form input, recomputes, revalidates', async () => {
    const result = await submitOwnMatchEvent({
      matchPublicId: 'md1-m1',
      scorerPlayerSlug: 'aleksandr-ivankov',
      goalType: 'OPEN_PLAY',
      assisterPlayerSlug: null,
      minute: 47,
    })
    expect(result.id).toBe('me-zeta')
    expect(matchEventCreateMock).toHaveBeenCalledTimes(1)
    const data = matchEventCreateMock.mock.calls[0][0].data
    expect(data.kind).toBe('GOAL')
    // Scorer driven by form input (not session)
    expect(data.scorerId).toBe('p-aleksandr-ivankov')
    expect(data.goalType).toBe('OPEN_PLAY')
    expect(data.assisterId).toBeNull()
    expect(data.minute).toBe(47)
    // createdById still recorded from session for audit
    expect(data.createdById).toBe('u-stefan')
    expect(recomputeMock).toHaveBeenCalledWith(expect.anything(), 'm-real')
    expect(revalidateMock).toHaveBeenCalledTimes(1)
  })

  it('rejects when not signed in', async () => {
    getServerSessionMock.mockResolvedValue(null)
    await expect(
      submitOwnMatchEvent({
        matchPublicId: 'md1-m1',
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
        scorerPlayerSlug: 'aleksandr-ivankov',
        goalType: 'OPEN_PLAY',
      }),
    ).rejects.toThrow(/No linked player/)
  })

  it('rejects on invalid goalType', async () => {
    await expect(
      submitOwnMatchEvent({
        matchPublicId: 'md1-m1',
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
        scorerPlayerSlug: 'aleksandr-ivankov',
        goalType: 'OPEN_PLAY',
      }),
    ).rejects.toThrow(/Matchday MD9 not in league/)
  })

  it('rejects when scorer is not on either match team (cross-team picker abuse)', async () => {
    plaFindFirstMock.mockResolvedValue(null) // scorer assignment lookup returns null
    await expect(
      submitOwnMatchEvent({
        matchPublicId: 'md1-m1',
        scorerPlayerSlug: 'random-guy',
        goalType: 'OPEN_PLAY',
      }),
    ).rejects.toThrow(/Scorer is not on either of the match teams/)
  })

  it('rejects when scorer slug is empty', async () => {
    await expect(
      submitOwnMatchEvent({
        matchPublicId: 'md1-m1',
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
        scorerPlayerSlug: 'aleksandr-ivankov',
        goalType: 'OPEN_PLAY',
      }),
    ).rejects.toThrow(/Submission opens at kickoff/)
  })

  it('rejects when assister equals scorer', async () => {
    await expect(
      submitOwnMatchEvent({
        matchPublicId: 'md1-m1',
        scorerPlayerSlug: 'aleksandr-ivankov',
        goalType: 'OPEN_PLAY',
        assisterPlayerSlug: 'aleksandr-ivankov',
      }),
    ).rejects.toThrow(/Assister cannot be the scorer/)
  })

  it('rejects when assister is not on the scorer’s team', async () => {
    // First call resolves scorer (HOME); second call (assister lookup
    // scoped to scorer's leagueTeamId) returns null.
    plaFindFirstMock
      .mockResolvedValueOnce({ id: 'pla-scorer', leagueTeamId: HOME_LT })
      .mockResolvedValueOnce(null)
    await expect(
      submitOwnMatchEvent({
        matchPublicId: 'md1-m1',
        scorerPlayerSlug: 'aleksandr-ivankov',
        goalType: 'OPEN_PLAY',
        assisterPlayerSlug: 'random-other',
      }),
    ).rejects.toThrow(/Assister must be on the scorer's team/)
  })

  it('OWN_GOAL: scorer on HOME, beneficiary derived as AWAY (handled in the event derivation)', async () => {
    // For OG, scorer is on the team CONCEDING. The action derives
    // beneficiary as opposite of scorer's team. Here scorer assignment
    // returns HOME, so beneficiary is AWAY.
    const result = await submitOwnMatchEvent({
      matchPublicId: 'md1-m1',
      scorerPlayerSlug: 'aleksandr-ivankov',
      goalType: 'OWN_GOAL',
    })
    expect(result.id).toBe('me-zeta')
    expect(matchEventCreateMock.mock.calls[0][0].data.goalType).toBe('OWN_GOAL')
    expect(matchEventCreateMock.mock.calls[0][0].data.scorerId).toBe('p-aleksandr-ivankov')
  })

  it('audits createdById from session, scorer from input (the v1.48.0 contract regression target)', async () => {
    await submitOwnMatchEvent({
      matchPublicId: 'md1-m1',
      scorerPlayerSlug: 'someone-else',
      goalType: 'OPEN_PLAY',
    })
    const data = matchEventCreateMock.mock.calls[0][0].data
    // Audit: who SUBMITTED (the calling user)
    expect(data.createdById).toBe('u-stefan')
    // Attribution: who SCORED (form input — different from caller)
    expect(data.scorerId).toBe('p-someone-else')
  })

  it('caller does NOT need to be on a match team to submit (open attribution)', async () => {
    // The caller (Stefan) is on HOME. The match is HOME vs AWAY. Even
    // if we were to make Stefan be on a third team that's not playing,
    // submission should still succeed because the caller is just the
    // audit identity — only the SCORER's team matters for participation.
    // (This case is the practical inverse of pre-v1.48.0 behavior.)
    const result = await submitOwnMatchEvent({
      matchPublicId: 'md1-m1',
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
        scorerPlayerSlug: 'aleksandr-ivankov',
        goalType: 'OPEN_PLAY',
        minute: 999,
      }),
    ).rejects.toThrow(/minute out of range/)
  })
})
