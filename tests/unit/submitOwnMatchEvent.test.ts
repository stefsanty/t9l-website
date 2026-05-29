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
  userFindUniqueMock,
  leagueFindUniqueMock,
  gameWeekFindFirstMock,
  plaFindFirstMock,
  matchEventCreateMock,
  txMock,
  revalidateMock,
  recomputeMock,
  getServerSessionMock,
} = vi.hoisted(() => {
  const playerFindUniqueMock = vi.fn()
  const userFindUniqueMock = vi.fn()
  const leagueFindUniqueMock = vi.fn()
  const gameWeekFindFirstMock = vi.fn()
  const plaFindFirstMock = vi.fn()
  const matchEventCreateMock = vi.fn().mockResolvedValue({ id: 'me-zeta' })
  const recomputeMock = vi.fn().mockResolvedValue({ home: 1, away: 0 })
  const txMock = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    return cb({ matchEvent: { create: matchEventCreateMock } })
  })
  return {
    playerFindUniqueMock,
    userFindUniqueMock,
    leagueFindUniqueMock,
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
    user: { findUnique: userFindUniqueMock },
    league: { findUnique: leagueFindUniqueMock },
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
// v2.2.2 — the form sends *public team slugs* (derived from Team.id,
// not LeagueTeam.id). The action resolves slug → Team.id → match
// LeagueTeam.id; the mocked gameWeek therefore needs Team.id alongside
// the LeagueTeam.id for each side.
const HOME_TEAM = 't-home'
const AWAY_TEAM = 't-away'
const HOME_SLUG = 'home'
const AWAY_SLUG = 'away'
const NOW = Date.now()
const PAST = new Date(NOW - 60_000)
const FUTURE = new Date(NOW + 60 * 60_000)

beforeEach(() => {
  playerFindUniqueMock.mockReset()
  userFindUniqueMock.mockReset()
  leagueFindUniqueMock.mockReset()
  gameWeekFindFirstMock.mockReset()
  plaFindFirstMock.mockReset()
  // v2.2.5 — action resolves leagueId via League.subdomain lookup using
  // the form-provided leagueSlug. Default mock matches the test's HOME_LT
  // leagueId on the caller assignment.
  leagueFindUniqueMock.mockResolvedValue({ id: 'l-default' })
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
  // v2.2.1 — user lookup added to the gate so LINE-only sessions
  // (lineId set, userId null) can still resolve. Default returns the
  // calling User row with a linked playerId.
  userFindUniqueMock.mockResolvedValue({
    id: 'u-stefan',
    playerId: 'p-stefan-santos',
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
      {
        id: 'm-real',
        homeTeamId: HOME_LT,
        awayTeamId: AWAY_LT,
        playedAt: PAST,
        homeTeam: { teamId: HOME_TEAM },
        awayTeam: { teamId: AWAY_TEAM },
      },
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
      leagueSlug: 't9l',
      beneficiaryTeamId: HOME_SLUG,
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
    // v2.2.21 — scorer membership check filters via leagueTeam.leagueId
    // (matches the form's source-of-truth join). Pre-v2.2.21 it filtered
    // via the direct nullable PlayerLeagueMembership.leagueId column,
    // which rejected legacy rows where the column was never backfilled.
    const calls = plaFindFirstMock.mock.calls
    expect(calls.length).toBeGreaterThanOrEqual(1)
    const scorerWhere = calls[0][0].where
    expect(scorerWhere.leagueTeam).toEqual({ leagueId: 'l-default' })
    expect(scorerWhere.leagueId).toBeUndefined()
  })

  it('rejects when not signed in', async () => {
    getServerSessionMock.mockResolvedValue(null)
    await expect(
      submitOwnMatchEvent({
        matchPublicId: 'md1-m1',
        leagueSlug: 't9l',
        beneficiaryTeamId: HOME_SLUG,
        scorerPlayerSlug: 'aleksandr-ivankov',
        goalType: 'OPEN_PLAY',
      }),
    ).rejects.toThrow(/Sign in to submit a goal/)
    expect(matchEventCreateMock).not.toHaveBeenCalled()
  })

  it('rejects when session has neither userId nor lineId', async () => {
    // v2.2.1 — admin-credentials session (no userId, no lineId). Pre-fix
    // this was the "Not signed in" branch. The neutral copy replaces the
    // misleading old wording.
    getServerSessionMock.mockResolvedValue({ userId: null, lineId: null })
    await expect(
      submitOwnMatchEvent({
        matchPublicId: 'md1-m1',
        leagueSlug: 't9l',
        beneficiaryTeamId: HOME_SLUG,
        scorerPlayerSlug: 'aleksandr-ivankov',
        goalType: 'OPEN_PLAY',
      }),
    ).rejects.toThrow(/Sign in to submit a goal/)
  })

  it('rejects when caller has no linked player', async () => {
    getServerSessionMock.mockResolvedValue({ userId: 'u-x', playerId: null })
    userFindUniqueMock.mockResolvedValue({ id: 'u-x', playerId: null })
    await expect(
      submitOwnMatchEvent({
        matchPublicId: 'md1-m1',
        leagueSlug: 't9l',
        beneficiaryTeamId: HOME_SLUG,
        scorerPlayerSlug: 'aleksandr-ivankov',
        goalType: 'OPEN_PLAY',
      }),
    ).rejects.toThrow(/No linked player/)
  })

  it('v2.2.1 regression target: LINE-only session (lineId set, userId null) submits successfully', async () => {
    // Pre-v2.2.1 grandfathered LINE-auth sessions whose JWT predates the
    // v1.28.0 NextAuth migration carry lineId but no userId — the gate
    // rejected with "Not signed in" (digest=1570823256 in prod). The fix
    // mirrors v1.80.10 / v1.80.11: accept the session, resolve User by
    // lineId, derive caller player from User.playerId.
    getServerSessionMock.mockResolvedValue({
      userId: null,
      lineId: 'U-line-stefan',
      playerId: null,
    })
    // sessionUserId is null, so only the lineId lookup branch runs.
    userFindUniqueMock.mockResolvedValue({
      id: 'u-stefan',
      playerId: 'p-stefan-santos',
    })
    const result = await submitOwnMatchEvent({
      matchPublicId: 'md1-m1',
      leagueSlug: 't9l',
      beneficiaryTeamId: HOME_SLUG,
      scorerPlayerSlug: 'aleksandr-ivankov',
      goalType: 'OPEN_PLAY',
    })
    expect(result.id).toBe('me-zeta')
    // User lookup falls back to lineId — both branches consulted.
    const userCalls = userFindUniqueMock.mock.calls
    expect(userCalls.length).toBeGreaterThanOrEqual(1)
    const lineLookup = userCalls.find(
      (c: unknown[]) => (c[0] as { where: { lineId?: string } }).where.lineId === 'U-line-stefan',
    )
    expect(lineLookup).toBeDefined()
    const data = matchEventCreateMock.mock.calls[0][0].data
    // createdById sourced from the resolved canonical User row.
    expect(data.createdById).toBe('u-stefan')
  })

  it('v2.2.1 regression target: session.playerId missing — falls back to User.playerId', async () => {
    // LINE-only viewer where the session JWT carries lineId but no
    // userId AND no playerId (the JWT-callback didn't decorate that
    // field). The action must resolve the caller via User.playerId.
    getServerSessionMock.mockResolvedValue({
      userId: 'u-stefan',
      lineId: null,
      playerId: null,
    })
    userFindUniqueMock.mockResolvedValue({
      id: 'u-stefan',
      playerId: 'p-stefan-santos',
    })
    const result = await submitOwnMatchEvent({
      matchPublicId: 'md1-m1',
      leagueSlug: 't9l',
      beneficiaryTeamId: HOME_SLUG,
      scorerPlayerSlug: 'aleksandr-ivankov',
      goalType: 'OPEN_PLAY',
    })
    expect(result.id).toBe('me-zeta')
    const data = matchEventCreateMock.mock.calls[0][0].data
    expect(data.createdById).toBe('u-stefan')
  })

  it('rejects on invalid goalType', async () => {
    await expect(
      submitOwnMatchEvent({
        matchPublicId: 'md1-m1',
        leagueSlug: 't9l',
        beneficiaryTeamId: HOME_SLUG,
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
        leagueSlug: 't9l',
        beneficiaryTeamId: HOME_SLUG,
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
        leagueSlug: 't9l',
        beneficiaryTeamId: HOME_SLUG,
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
      leagueSlug: 't9l',
      beneficiaryTeamId: HOME_SLUG,
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
        leagueSlug: 't9l',
        beneficiaryTeamId: HOME_SLUG,
        scorerPlayerSlug: 'random-guy',
        goalType: 'OPEN_PLAY',
      }),
    ).rejects.toThrow(/Scorer is not a member of this league/)
  })

  it('v1.82.0 regression target: rejects when beneficiaryTeamId is not part of the match', async () => {
    await expect(
      submitOwnMatchEvent({
        matchPublicId: 'md1-m1',
        leagueSlug: 't9l',
        beneficiaryTeamId: 'third',
        scorerPlayerSlug: 'aleksandr-ivankov',
        goalType: 'OPEN_PLAY',
      }),
    ).rejects.toThrow(/Beneficiary team is not part of this match/)
  })

  it('v2.2.3 regression target: accepts slug when match Team.id lacks the `t-` prefix (asymmetric round-trip)', async () => {
    // teamIdToSlug only strips `t-` if present; slugToTeamId always adds it.
    // A Team.id stored bare ("home" instead of "t-home") surfaces as "home"
    // in the dropdown, but slugToTeamId resolves "home" → "t-home", so the
    // strict-equality check at v2.2.2 fails. v2.2.3 accepts either form.
    gameWeekFindFirstMock.mockResolvedValueOnce({
      matches: [
        {
          id: 'm-real',
          homeTeamId: HOME_LT,
          awayTeamId: AWAY_LT,
          playedAt: PAST,
          homeTeam: { teamId: HOME_SLUG },
          awayTeam: { teamId: AWAY_SLUG },
        },
      ],
    })
    const result = await submitOwnMatchEvent({
      matchPublicId: 'md1-m1',
      leagueSlug: 't9l',
      beneficiaryTeamId: HOME_SLUG,
      scorerPlayerSlug: 'aleksandr-ivankov',
      goalType: 'OPEN_PLAY',
    })
    expect(result.id).toBe('me-zeta')
    const data = matchEventCreateMock.mock.calls.at(-1)![0].data
    expect(data.beneficiaryTeamId).toBe(HOME_LT)
  })

  it('v1.82.0 regression target: rejects when beneficiaryTeamId is empty', async () => {
    await expect(
      submitOwnMatchEvent({
        matchPublicId: 'md1-m1',
        leagueSlug: 't9l',
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
        leagueSlug: 't9l',
        beneficiaryTeamId: HOME_SLUG,
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
        leagueSlug: 't9l',
        beneficiaryTeamId: HOME_SLUG,
        scorerPlayerSlug: 'aleksandr-ivankov',
        goalType: 'OPEN_PLAY',
      }),
    ).rejects.toThrow(/Submission opens at kickoff/)
  })

  it('rejects when assister equals scorer', async () => {
    await expect(
      submitOwnMatchEvent({
        matchPublicId: 'md1-m1',
        leagueSlug: 't9l',
        beneficiaryTeamId: HOME_SLUG,
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
      leagueSlug: 't9l',
      beneficiaryTeamId: HOME_SLUG,
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
        leagueSlug: 't9l',
        beneficiaryTeamId: HOME_SLUG,
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
      leagueSlug: 't9l',
      beneficiaryTeamId: AWAY_SLUG,
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
      leagueSlug: 't9l',
      beneficiaryTeamId: HOME_SLUG,
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
      leagueSlug: 't9l',
      beneficiaryTeamId: HOME_SLUG,
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
        leagueSlug: 't9l',
        beneficiaryTeamId: HOME_SLUG,
        scorerPlayerSlug: 'aleksandr-ivankov',
        goalType: 'OPEN_PLAY',
        minute: 999,
      }),
    ).rejects.toThrow(/minute out of range/)
  })

  // v2.2.5 — multi-tenant scoping regression. Pre-v2.2.5 the action picked
  // the caller's first non-null league assignment, so a user who was a
  // member of both prod `t9l` AND a seed/test league could resolve
  // `md3-m1` against the wrong tenant (prod observed: Phoenix FC vs
  // test-storm-united resolved when user was on Fenix vs Torpedo).
  describe('v2.2.5 multi-tenant league scoping', () => {
    it('uses the form-provided leagueSlug, not the caller’s first assignment', async () => {
      // Caller is in two leagues — t9l (l-t9l) and a test league (l-test).
      // Pre-v2.2.5 the action picked l-test (the array order); v2.2.5 must
      // resolve via the form's leagueSlug to l-t9l.
      playerFindUniqueMock.mockResolvedValue({
        id: 'p-stefan-santos',
        name: 'Stefan',
        leagueAssignments: [
          { leagueTeamId: 'lt-test', leagueTeam: { id: 'lt-test', leagueId: 'l-test' } },
          { leagueTeamId: 'lt-t9l', leagueTeam: { id: 'lt-t9l', leagueId: 'l-t9l' } },
        ],
      })
      leagueFindUniqueMock.mockResolvedValue({ id: 'l-t9l' })
      gameWeekFindFirstMock.mockResolvedValue({
        matches: [
          {
            id: 'm-t9l-md3-m1',
            homeTeamId: HOME_LT,
            awayTeamId: AWAY_LT,
            playedAt: PAST,
            homeTeam: { teamId: HOME_TEAM },
            awayTeam: { teamId: AWAY_TEAM },
          },
        ],
      })

      const result = await submitOwnMatchEvent({
        matchPublicId: 'md3-m1',
        leagueSlug: 't9l',
        beneficiaryTeamId: HOME_SLUG,
        scorerPlayerSlug: 'aleksandr-ivankov',
        goalType: 'OPEN_PLAY',
      })
      expect(result.id).toBe('me-zeta')

      // League lookup was made with the FORM slug, not derived from caller.
      const leagueCall = leagueFindUniqueMock.mock.calls[0][0]
      expect(leagueCall.where.subdomain).toBe('t9l')
      // GameWeek lookup was scoped to the slug-resolved league.
      const gwCall = gameWeekFindFirstMock.mock.calls[0][0]
      expect(gwCall.where.leagueId).toBe('l-t9l')
      // Scorer membership check also scoped to the form's league.
      // v2.2.21 — via the leagueTeam.leagueId join, not the direct column.
      const scorerWhere = plaFindFirstMock.mock.calls[0][0].where
      expect(scorerWhere.leagueTeam).toEqual({ leagueId: 'l-t9l' })
    })

    it('rejects when caller is not a member of the form-provided league', async () => {
      // Caller is only in l-other; form says t9l. v2.2.5 must reject.
      playerFindUniqueMock.mockResolvedValue({
        id: 'p-stefan-santos',
        name: 'Stefan',
        leagueAssignments: [
          { leagueTeamId: 'lt-other', leagueTeam: { id: 'lt-other', leagueId: 'l-other' } },
        ],
      })
      leagueFindUniqueMock.mockResolvedValue({ id: 'l-t9l' })

      await expect(
        submitOwnMatchEvent({
          matchPublicId: 'md3-m1',
          leagueSlug: 't9l',
          beneficiaryTeamId: HOME_SLUG,
          scorerPlayerSlug: 'aleksandr-ivankov',
          goalType: 'OPEN_PLAY',
        }),
      ).rejects.toThrow(/Caller not assigned to this league/)
      // No match lookup happens — fail-fast on caller scoping.
      expect(gameWeekFindFirstMock).not.toHaveBeenCalled()
      expect(matchEventCreateMock).not.toHaveBeenCalled()
    })

    it('rejects an unknown leagueSlug', async () => {
      leagueFindUniqueMock.mockResolvedValue(null)
      await expect(
        submitOwnMatchEvent({
          matchPublicId: 'md3-m1',
          leagueSlug: 'bogus-league',
          beneficiaryTeamId: HOME_SLUG,
          scorerPlayerSlug: 'aleksandr-ivankov',
          goalType: 'OPEN_PLAY',
        }),
      ).rejects.toThrow(/Unknown league/)
    })

    it('rejects when leagueSlug is empty', async () => {
      await expect(
        submitOwnMatchEvent({
          matchPublicId: 'md3-m1',
          leagueSlug: '',
          beneficiaryTeamId: HOME_SLUG,
          scorerPlayerSlug: 'aleksandr-ivankov',
          goalType: 'OPEN_PLAY',
        }),
      ).rejects.toThrow(/League context missing/)
    })
  })
})
