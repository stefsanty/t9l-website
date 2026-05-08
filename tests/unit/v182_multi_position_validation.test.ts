/**
 * v1.82.0 — multi-position support regression target.
 *
 * Pins the per-format position vocabulary at the server-action layer:
 *   - applyToLeague accepts positions[] (NOT a single `position`).
 *   - Soccer leagues accept GK/LB/CB/RB/LM/DM/CM/CAM/RM/LW/ST/RW.
 *   - Futsal leagues REJECT any soccer code (and vice versa) with a
 *     friendly `ok: false` error.
 *   - Server dual-writes positions[] + the legacy `position` enum
 *     bucketed via `legacyPositionFromArray`.
 *
 * The futsal-rejects-soccer test is the load-bearing one — it would
 * fail if the per-league vocabulary lookup ever drifted from
 * `League.ballType` (e.g. someone hard-coded the soccer set in the
 * server action). Verified via stash-pop: with positions.ts reverted
 * to the old single-format vocabulary, the futsal test fails because
 * the soccer-only `normalizePositions` would happily accept FW.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  sessionMock,
  leagueFindUniqueMock,
  userFindUniqueMock,
  plmFindFirstMock,
  plmCreateMock,
  txMock,
  redirectMock,
  revalidateMock,
} = vi.hoisted(() => {
  const sessionMock = vi.fn()
  const leagueFindUniqueMock = vi.fn()
  const userFindUniqueMock = vi.fn()
  const plmFindFirstMock = vi.fn()
  const plmCreateMock = vi.fn().mockResolvedValue({ id: 'plm-new' })
  const txMock = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      player: { create: vi.fn().mockResolvedValue({ id: 'p-new' }) },
      user: { update: vi.fn() },
      playerLeagueMembership: { create: plmCreateMock },
    }
    return cb(tx)
  })
  return {
    sessionMock,
    leagueFindUniqueMock,
    userFindUniqueMock,
    plmFindFirstMock,
    plmCreateMock,
    txMock,
    redirectMock: vi.fn().mockImplementation(() => {
      const err = new Error('NEXT_REDIRECT') as Error & { digest?: string }
      err.digest = 'NEXT_REDIRECT'
      throw err
    }),
    revalidateMock: vi.fn(),
  }
})

vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: leagueFindUniqueMock },
    user: { findUnique: userFindUniqueMock },
    playerLeagueMembership: {
      findFirst: plmFindFirstMock,
      create: plmCreateMock,
    },
    $transaction: txMock,
  },
}))
vi.mock('@/lib/revalidate', () => ({ revalidate: revalidateMock }))
vi.mock('next/navigation', () => ({ redirect: redirectMock }))
vi.mock('@vercel/functions', () => ({ waitUntil: (p: Promise<unknown>) => p }))
vi.mock('@/lib/email', () => ({ sendMail: vi.fn() }))
vi.mock('@/lib/emailTemplates', () => ({
  applicationReceivedEmail: vi.fn(() => ({ subject: '', html: '' })),
}))

const { applyToLeague } = await import('@/app/api/recruiting/actions')

beforeEach(() => {
  vi.clearAllMocks()
  sessionMock.mockResolvedValue({ userId: 'u-1', lineId: null })
  userFindUniqueMock.mockResolvedValue({
    id: 'u-1',
    playerId: 'p-existing',
    lineId: null,
  })
  plmFindFirstMock.mockResolvedValue(null)
  // Default: SOCCER league. Each test overrides ballType as needed.
  leagueFindUniqueMock.mockResolvedValue({
    id: 'league-1',
    recruiting: true,
    name: 'Test League',
    subdomain: 'test',
    ballType: 'SOCCER',
  })
})

describe('v1.82.0 — applyToLeague positions[] vocabulary enforcement', () => {
  it('SOCCER league accepts the new 12-code vocabulary', async () => {
    await expect(
      applyToLeague({
        leagueId: 'league-1',
        name: '',
        positions: ['CB', 'CM'],
      }),
    ).rejects.toThrow('NEXT_REDIRECT')
    // PLM was created with the validated array AND the legacy enum
    // bucketed (CB → DF; first match wins).
    expect(plmCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        positions: ['CB', 'CM'],
        position: 'DF',
      }),
    })
  })

  it('SOCCER league rejects a futsal code (FIXO)', async () => {
    const result = await applyToLeague({
      leagueId: 'league-1',
      name: '',
      positions: ['FIXO'],
    })
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/Invalid position "FIXO" for SOCCER/),
    })
    expect(plmCreateMock).not.toHaveBeenCalled()
  })

  it('SOCCER league rejects the legacy DF code (no longer in the new vocab)', async () => {
    const result = await applyToLeague({
      leagueId: 'league-1',
      name: '',
      positions: ['DF'],
    })
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/Invalid position "DF" for SOCCER/),
    })
    expect(plmCreateMock).not.toHaveBeenCalled()
  })

  it('FUTSAL league accepts GK/FIXO/ALA/PIVOT', async () => {
    leagueFindUniqueMock.mockResolvedValue({
      id: 'league-futsal',
      recruiting: true,
      name: 'Futsal League',
      subdomain: 'futsal',
      ballType: 'FUTSAL',
    })
    await expect(
      applyToLeague({
        leagueId: 'league-futsal',
        name: '',
        positions: ['FIXO', 'PIVOT'],
      }),
    ).rejects.toThrow('NEXT_REDIRECT')
    // FIXO buckets to DF in the legacy enum.
    expect(plmCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        positions: ['FIXO', 'PIVOT'],
        position: 'DF',
      }),
    })
  })

  it('FUTSAL league REJECTS soccer codes (CB, ST, FW)', async () => {
    leagueFindUniqueMock.mockResolvedValue({
      id: 'league-futsal',
      recruiting: true,
      name: 'Futsal League',
      subdomain: 'futsal',
      ballType: 'FUTSAL',
    })
    for (const bad of ['CB', 'ST', 'FW']) {
      const result = await applyToLeague({
        leagueId: 'league-futsal',
        name: '',
        positions: [bad],
      })
      expect(result).toEqual({
        ok: false,
        error: expect.stringMatching(new RegExp(`Invalid position "${bad}" for FUTSAL`)),
      })
    }
    expect(plmCreateMock).not.toHaveBeenCalled()
  })

  it('empty positions[] is accepted (matches legacy "no position recorded")', async () => {
    await expect(
      applyToLeague({
        leagueId: 'league-1',
        name: '',
        positions: [],
      }),
    ).rejects.toThrow('NEXT_REDIRECT')
    expect(plmCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        positions: [],
        position: null,
      }),
    })
  })
})
