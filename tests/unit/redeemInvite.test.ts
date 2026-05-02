/**
 * v1.34.0 (PR ζ) — `redeemInvite` server action contract.
 *
 * Pins the load-bearing redemption logic without standing up a real DB:
 *   - happy paths (PERSONAL + CODE)
 *   - validation rejections matching every `validateInvite` outcome
 *   - already-bound short-circuit
 *   - skipOnboarding routes to /welcome; otherwise to /onboarding
 *   - Google/email user (no lineId) writes Player.userId directly + mirrors
 *     User.playerId; LINE user goes through `linkPlayerToUser` helper
 *   - usedCount increments inside the same transaction as the binding
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  inviteFindUniqueMock,
  playerFindUniqueMock,
  playerUpdateMock,
  userUpdateMock,
  assignmentFindFirstMock,
  assignmentUpdateMock,
  inviteUpdateMock,
  txMock,
  revalidateMock,
  linkPlayerToUserMock,
  linkUserToPlayerMock,
  sessionMock,
  redirectMock,
} = vi.hoisted(() => {
  const inviteFindUniqueMock = vi.fn()
  const playerFindUniqueMock = vi.fn()
  const playerUpdateMock = vi.fn().mockResolvedValue({})
  const userUpdateMock = vi.fn().mockResolvedValue({})
  const assignmentFindFirstMock = vi.fn()
  const assignmentUpdateMock = vi.fn().mockResolvedValue({})
  const inviteUpdateMock = vi.fn().mockResolvedValue({})
  const txMock = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      player: { update: playerUpdateMock, findUnique: vi.fn() },
      user: { update: userUpdateMock },
      playerLeagueAssignment: {
        findFirst: assignmentFindFirstMock,
        update: assignmentUpdateMock,
      },
      leagueInvite: { update: inviteUpdateMock },
    }
    return cb(tx)
  })
  return {
    inviteFindUniqueMock,
    playerFindUniqueMock,
    playerUpdateMock,
    userUpdateMock,
    assignmentFindFirstMock,
    assignmentUpdateMock,
    inviteUpdateMock,
    txMock,
    revalidateMock: vi.fn(),
    linkPlayerToUserMock: vi.fn(),
    linkUserToPlayerMock: vi.fn().mockResolvedValue(true),
    sessionMock: vi.fn(),
    redirectMock: vi.fn(),
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueInvite: { findUnique: inviteFindUniqueMock, update: inviteUpdateMock },
    player: { findUnique: playerFindUniqueMock, update: playerUpdateMock },
    user: { update: userUpdateMock },
    playerLeagueAssignment: {
      findFirst: assignmentFindFirstMock,
      update: assignmentUpdateMock,
      updateMany: vi.fn(),
    },
    $transaction: txMock,
  },
}))
vi.mock('@/lib/revalidate', () => ({ revalidate: revalidateMock }))
vi.mock('@/lib/identityLink', () => ({
  linkPlayerToUser: linkPlayerToUserMock,
  linkUserToPlayer: linkUserToPlayerMock,
  unlinkPlayerFromUser: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {}, getPlayerMappingFromDb: vi.fn() }))
vi.mock('next/cache', () => ({ unstable_cache: <T,>(fn: T) => fn }))
vi.mock('next/navigation', () => ({ redirect: redirectMock }))

const { redeemInvite } = await import('@/app/join/[code]/actions')

beforeEach(() => {
  inviteFindUniqueMock.mockReset()
  playerFindUniqueMock.mockReset()
  playerUpdateMock.mockClear()
  userUpdateMock.mockClear()
  assignmentFindFirstMock.mockReset()
  assignmentUpdateMock.mockClear()
  inviteUpdateMock.mockClear()
  txMock.mockClear()
  revalidateMock.mockClear()
  linkPlayerToUserMock.mockClear()
  linkUserToPlayerMock.mockClear()
  linkUserToPlayerMock.mockResolvedValue(true)
  sessionMock.mockReset()
  redirectMock.mockClear()
})

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

function personalInvite(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invite-1',
    code: 'ABCD1234EFGH',
    kind: 'PERSONAL',
    leagueId: 'league-1',
    targetPlayerId: 'p-target',
    expiresAt: FUTURE,
    revokedAt: null,
    usedCount: 0,
    maxUses: 1,
    skipOnboarding: false,
    ...overrides,
  }
}
function codeInvite(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invite-2',
    code: 'CODE12345678',
    kind: 'CODE',
    leagueId: 'league-1',
    targetPlayerId: null,
    expiresAt: FUTURE,
    revokedAt: null,
    usedCount: 0,
    maxUses: null,
    skipOnboarding: false,
    ...overrides,
  }
}

describe('v1.34.0 (PR ζ) — redeemInvite — auth gate', () => {
  it('rejects with "sign in" when no session', async () => {
    sessionMock.mockResolvedValue(null)
    const r = await redeemInvite({ code: 'C' })
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/sign in/i) })
  })

  it('rejects admin-credentials sessions (no userId on session)', async () => {
    sessionMock.mockResolvedValue({ isAdmin: true })
    const r = await redeemInvite({ code: 'C' })
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/admin sessions cannot/i) })
  })

  it('rejects when code is missing', async () => {
    sessionMock.mockResolvedValue({ userId: 'u-1' })
    const r = await redeemInvite({ code: '' })
    expect(r.ok).toBe(false)
  })
})

describe('v1.34.0 (PR ζ) — redeemInvite — validation rejections', () => {
  beforeEach(() => sessionMock.mockResolvedValue({ userId: 'u-1', lineId: null }))

  it('not-found → "we don\'t recognise" error + code: not-found', async () => {
    inviteFindUniqueMock.mockResolvedValue(null)
    const r = await redeemInvite({ code: 'BAD' })
    expect(r).toMatchObject({ ok: false, code: 'not-found' })
    expect((r as { error: string }).error).toMatch(/recognise/i)
  })

  it('expired → expired-on-X error + code: expired', async () => {
    inviteFindUniqueMock.mockResolvedValue(personalInvite({
      expiresAt: new Date('2026-01-01T00:00:00Z'),
    }))
    const r = await redeemInvite({ code: 'C' })
    expect(r).toMatchObject({ ok: false, code: 'expired' })
  })

  it('revoked → revoked error + code: revoked', async () => {
    inviteFindUniqueMock.mockResolvedValue(personalInvite({
      revokedAt: new Date('2026-04-01T00:00:00Z'),
    }))
    const r = await redeemInvite({ code: 'C' })
    expect(r).toMatchObject({ ok: false, code: 'revoked' })
  })

  it('used-up → used-up error + code: used-up', async () => {
    inviteFindUniqueMock.mockResolvedValue(personalInvite({ usedCount: 1, maxUses: 1 }))
    const r = await redeemInvite({ code: 'C' })
    expect(r).toMatchObject({ ok: false, code: 'used-up' })
  })

  it('does NOT touch DB write paths on validation failure', async () => {
    inviteFindUniqueMock.mockResolvedValue(null)
    await redeemInvite({ code: 'BAD' })
    expect(txMock).not.toHaveBeenCalled()
    expect(revalidateMock).not.toHaveBeenCalled()
  })
})

describe('v1.34.0 (PR ζ) — redeemInvite — PERSONAL happy path', () => {
  beforeEach(() => {
    sessionMock.mockResolvedValue({ userId: 'u-1', lineId: 'U_LINEID' })
    inviteFindUniqueMock.mockResolvedValue(personalInvite())
    playerFindUniqueMock.mockResolvedValue({ id: 'p-target', userId: null, lineId: null })
    assignmentFindFirstMock.mockResolvedValue({ id: 'pla-1' })
  })

  it('returns ok with onboardingStatus NOT_YET + redirectTo /onboarding (skipOnboarding=false)', async () => {
    const r = await redeemInvite({ code: 'ABCD1234EFGH' })
    expect(r).toMatchObject({
      ok: true,
      onboardingStatus: 'NOT_YET',
      redirectTo: '/join/ABCD1234EFGH/onboarding',
      playerId: 'p-target',
    })
  })

  it('skipOnboarding=true → redirectTo /welcome + onboardingStatus COMPLETED', async () => {
    inviteFindUniqueMock.mockResolvedValue(personalInvite({ skipOnboarding: true }))
    const r = await redeemInvite({ code: 'ABCD1234EFGH' })
    expect(r).toMatchObject({
      ok: true,
      onboardingStatus: 'COMPLETED',
      redirectTo: '/join/ABCD1234EFGH/welcome',
    })
  })

  it('v1.39.0 (PR λ) — binds the LINE user via linkUserToPlayer + sets Player.lineId in same call', async () => {
    await redeemInvite({ code: 'ABCD1234EFGH' })
    // The PR λ refactor routes BOTH branches through linkUserToPlayer
    // (the new generic helper). For LINE flows, lineId is passed so
    // Player.lineId is set on the same Player.update inside the helper.
    expect(linkUserToPlayerMock).toHaveBeenCalledWith(expect.anything(), {
      userId: 'u-1',
      playerId: 'p-target',
      lineId: 'U_LINEID',
    })
    // The legacy lineId-keyed `linkPlayerToUser` is no longer called
    // from redeemInvite — linkUserToPlayer subsumes its job here. (Other
    // call sites — admin actions, /api/assign-player — still use
    // linkPlayerToUser; that's checked separately.)
    expect(linkPlayerToUserMock).not.toHaveBeenCalled()
  })

  it('v1.39.0 (PR λ) — Google/email user routes through linkUserToPlayer with NO lineId (Player.lineId stays null)', async () => {
    sessionMock.mockResolvedValue({ userId: 'u-google', lineId: null })
    await redeemInvite({ code: 'ABCD1234EFGH' })
    // The non-LINE branch passes only userId + playerId — no lineId
    // means the helper does NOT touch Player.lineId. This is the fix
    // for the v1.38.x bug where the non-LINE branch went around the
    // helper's invariant-clearing logic.
    expect(linkUserToPlayerMock).toHaveBeenCalledWith(expect.anything(), {
      userId: 'u-google',
      playerId: 'p-target',
    })
    expect(linkPlayerToUserMock).not.toHaveBeenCalled()
  })

  it('updates the existing PlayerLeagueAssignment with PERSONAL + correct status', async () => {
    await redeemInvite({ code: 'ABCD1234EFGH' })
    expect(assignmentUpdateMock).toHaveBeenCalledWith({
      where: { id: 'pla-1' },
      data: { onboardingStatus: 'NOT_YET', joinSource: 'PERSONAL' },
    })
  })

  it('increments LeagueInvite.usedCount inside the same transaction', async () => {
    await redeemInvite({ code: 'ABCD1234EFGH' })
    expect(inviteUpdateMock).toHaveBeenCalledWith({
      where: { id: 'invite-1' },
      data: { usedCount: { increment: 1 } },
    })
    // All writes via the SAME tx (txMock invoked once).
    expect(txMock).toHaveBeenCalledTimes(1)
  })

  it('busts admin + public caches with the league-scoped path', async () => {
    await redeemInvite({ code: 'ABCD1234EFGH' })
    expect(revalidateMock).toHaveBeenCalledWith({
      domain: 'admin',
      paths: ['/admin/leagues/league-1/players'],
    })
    expect(revalidateMock).toHaveBeenCalledWith({ domain: 'public' })
  })

  it('rejects when target Player not found', async () => {
    playerFindUniqueMock.mockResolvedValue(null)
    const r = await redeemInvite({ code: 'ABCD1234EFGH' })
    expect(r.ok).toBe(false)
    expect(txMock).not.toHaveBeenCalled()
  })

  it('rejects when target is already claimed by a DIFFERENT user', async () => {
    playerFindUniqueMock.mockResolvedValue({ id: 'p-target', userId: 'u-other', lineId: null })
    const r = await redeemInvite({ code: 'ABCD1234EFGH' })
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/already claimed/i) })
  })

  it('idempotent: target.userId === current userId is fine (re-confirm)', async () => {
    playerFindUniqueMock.mockResolvedValue({ id: 'p-target', userId: 'u-1', lineId: null })
    const r = await redeemInvite({ code: 'ABCD1234EFGH' })
    expect(r.ok).toBe(true)
  })
})

describe('v1.34.0 (PR ζ) — redeemInvite — CODE flavor', () => {
  beforeEach(() => {
    sessionMock.mockResolvedValue({ userId: 'u-1', lineId: 'U_LINEID' })
    inviteFindUniqueMock.mockResolvedValue(codeInvite())
    playerFindUniqueMock.mockResolvedValue({ id: 'p-picked', userId: null, lineId: null })
    assignmentFindFirstMock.mockResolvedValue({ id: 'pla-2' })
  })

  it('rejects when no playerId is supplied (CODE requires a pick)', async () => {
    const r = await redeemInvite({ code: 'CODE12345678' })
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/pick/i) })
  })

  it('rejects when picked player is not on this league\'s roster', async () => {
    // First findFirst (cross-league check) returns null → rejection before tx.
    assignmentFindFirstMock.mockResolvedValueOnce(null)
    const r = await redeemInvite({ code: 'CODE12345678', pickedPlayerId: 'p-foreign' })
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/roster/i) })
    expect(txMock).not.toHaveBeenCalled()
  })

  it('happy path: tags the assignment with joinSource=CODE', async () => {
    // First findFirst for cross-league check returns the assignment;
    // second findFirst inside the tx finds the existing assignment to update.
    assignmentFindFirstMock
      .mockResolvedValueOnce({ id: 'pla-x' }) // cross-league check
      .mockResolvedValueOnce({ id: 'pla-2' }) // tx update lookup

    const r = await redeemInvite({
      code: 'CODE12345678',
      pickedPlayerId: 'p-picked',
    })
    expect(r).toMatchObject({ ok: true, redirectTo: '/join/CODE12345678/onboarding' })
    expect(assignmentUpdateMock).toHaveBeenCalledWith({
      where: { id: 'pla-2' },
      data: { onboardingStatus: 'NOT_YET', joinSource: 'CODE' },
    })
  })
})
