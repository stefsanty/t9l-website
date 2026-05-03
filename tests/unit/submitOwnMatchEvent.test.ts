/**
 * v1.46.0 (epic match events PR ζ) — server action `submitOwnMatchEvent`
 * gates the player-side write path. Every gate pinned.
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

  // Default: signed-in linked user; player on home team.
  getServerSessionMock.mockResolvedValue({
    userId: 'u-stefan',
    playerId: 'stefan-santos',
  })
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

describe('submitOwnMatchEvent', () => {
  it('happy path: creates event, recomputes, revalidates', async () => {
    const result = await submitOwnMatchEvent({
      matchPublicId: 'md1-m1',
      goalType: 'OPEN_PLAY',
      assisterPlayerSlug: null,
      minute: 47,
    })
    expect(result.id).toBe('me-zeta')
    expect(matchEventCreateMock).toHaveBeenCalledTimes(1)
    const data = matchEventCreateMock.mock.calls[0][0].data
    expect(data.kind).toBe('GOAL')
    expect(data.scorerId).toBe('p-stefan-santos') // session-driven, not form-driven
    expect(data.goalType).toBe('OPEN_PLAY')
    expect(data.assisterId).toBeNull()
    expect(data.minute).toBe(47)
    expect(data.createdById).toBe('u-stefan')
    expect(recomputeMock).toHaveBeenCalledWith(expect.anything(), 'm-real')
    expect(revalidateMock).toHaveBeenCalledTimes(1)
  })

  it('rejects when not signed in', async () => {
    getServerSessionMock.mockResolvedValue(null)
    await expect(
      submitOwnMatchEvent({ matchPublicId: 'md1-m1', goalType: 'OPEN_PLAY' }),
    ).rejects.toThrow(/Not signed in/)
    expect(matchEventCreateMock).not.toHaveBeenCalled()
  })

  it('rejects when no linked player', async () => {
    getServerSessionMock.mockResolvedValue({ userId: 'u-x', playerId: null })
    await expect(
      submitOwnMatchEvent({ matchPublicId: 'md1-m1', goalType: 'OPEN_PLAY' }),
    ).rejects.toThrow(/No linked player/)
  })

  it('rejects on invalid goalType', async () => {
    await expect(
      submitOwnMatchEvent({
        matchPublicId: 'md1-m1',
        // @ts-expect-error — runtime guard
        goalType: 'BICYCLE',
      }),
    ).rejects.toThrow(/Invalid goalType/)
  })

  it('rejects malformed matchPublicId', async () => {
    await expect(
      submitOwnMatchEvent({ matchPublicId: 'bogus', goalType: 'OPEN_PLAY' }),
    ).rejects.toThrow(/Invalid matchPublicId/)
  })

  it('rejects when match is not in the user’s league', async () => {
    gameWeekFindFirstMock.mockResolvedValue(null)
    await expect(
      submitOwnMatchEvent({ matchPublicId: 'md9-m1', goalType: 'OPEN_PLAY' }),
    ).rejects.toThrow(/Matchday MD9 not in league/)
  })

  it('rejects when player’s team is not in the match', async () => {
    // Match with two teams that don't include the player's team.
    gameWeekFindFirstMock.mockResolvedValue({
      matches: [
        { id: 'm-real', homeTeamId: 'lt-other-1', awayTeamId: 'lt-other-2', playedAt: PAST },
      ],
    })
    await expect(
      submitOwnMatchEvent({ matchPublicId: 'md1-m1', goalType: 'OPEN_PLAY' }),
    ).rejects.toThrow(/Your team is not playing/)
  })

  it('rejects when ALL kickoffs are still in the future', async () => {
    gameWeekFindFirstMock.mockResolvedValue({
      matches: [
        { id: 'm-real', homeTeamId: HOME_LT, awayTeamId: AWAY_LT, playedAt: FUTURE },
      ],
    })
    await expect(
      submitOwnMatchEvent({ matchPublicId: 'md1-m1', goalType: 'OPEN_PLAY' }),
    ).rejects.toThrow(/Submission opens at kickoff/)
  })

  it('rejects when assister equals scorer', async () => {
    await expect(
      submitOwnMatchEvent({
        matchPublicId: 'md1-m1',
        goalType: 'OPEN_PLAY',
        assisterPlayerSlug: 'stefan-santos',
      }),
    ).rejects.toThrow(/Assister cannot be the scorer/)
  })

  it('rejects when assister is not on the player’s team', async () => {
    plaFindFirstMock.mockResolvedValue(null)
    await expect(
      submitOwnMatchEvent({
        matchPublicId: 'md1-m1',
        goalType: 'OPEN_PLAY',
        assisterPlayerSlug: 'random-other',
      }),
    ).rejects.toThrow(/Assister must be on your team/)
  })

  it('OWN_GOAL: scorer must be on the BENEFICIARY team’s opposite (i.e. own team) — happy path', async () => {
    // For OG, scorer (= self) is on the team CONCEDING. The page-level
    // form derives beneficiary as the opposite of self's team. Here the
    // self is on HOME, so beneficiary is AWAY — and the team
    // participation gate still checks self's team is in the match
    // (HOME is, ✓).
    const result = await submitOwnMatchEvent({
      matchPublicId: 'md1-m1',
      goalType: 'OWN_GOAL',
    })
    expect(result.id).toBe('me-zeta')
    expect(matchEventCreateMock.mock.calls[0][0].data.goalType).toBe('OWN_GOAL')
  })

  it('audits createdById from session, not from input', async () => {
    await submitOwnMatchEvent({ matchPublicId: 'md1-m1', goalType: 'OPEN_PLAY' })
    expect(matchEventCreateMock.mock.calls[0][0].data.createdById).toBe('u-stefan')
  })

  it('rejects out-of-range minute', async () => {
    await expect(
      submitOwnMatchEvent({
        matchPublicId: 'md1-m1',
        goalType: 'OPEN_PLAY',
        minute: 999,
      }),
    ).rejects.toThrow(/minute out of range/)
  })
})
