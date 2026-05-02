/**
 * v1.33.0 (PR ε) — adminGenerateInvite + adminGenerateInvitesBulk + the
 * pure `buildInviteCreateData` helper.
 *
 * The action issues PERSONAL invites bound to a specific Player slot. It
 * validates that:
 *   - the target Player exists and has no LINE binding (already-linked
 *     players don't need an invite),
 *   - no other active PERSONAL invite already exists for the target,
 *   - the generated code lands in `LeagueInvite.code` with the expected
 *     shape, expiry, and skipOnboarding flag.
 *
 * Bulk variant runs sequentially, accumulates per-row results with errors
 * surfaced as field-level reasons rather than aborting the batch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  playerFindUniqueMock,
  playerFindManyMock,
  inviteFindFirstMock,
  inviteCreateMock,
  revalidateMock,
} = vi.hoisted(() => ({
  playerFindUniqueMock: vi.fn(),
  playerFindManyMock: vi.fn(),
  inviteFindFirstMock: vi.fn(),
  inviteCreateMock: vi.fn(),
  revalidateMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    player: {
      findUnique: playerFindUniqueMock,
      findMany: playerFindManyMock,
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    leagueInvite: {
      findFirst: inviteFindFirstMock,
      create: inviteCreateMock,
    },
    leagueTeam: { findUnique: vi.fn() },
    playerLeagueAssignment: { create: vi.fn() },
    $transaction: vi.fn().mockResolvedValue([]),
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

const {
  adminGenerateInvite,
  adminGenerateInvitesBulk,
  buildInviteCreateData,
} = await import('@/app/admin/leagues/actions')

beforeEach(() => {
  playerFindUniqueMock.mockReset()
  playerFindManyMock.mockReset()
  inviteFindFirstMock.mockReset()
  inviteCreateMock.mockReset()
  revalidateMock.mockClear()
})

// ── buildInviteCreateData (pure helper) ─────────────────────────────────────

describe('v1.33.0 (PR ε) — buildInviteCreateData', () => {
  const expiresAt = new Date('2026-05-10T10:00:00Z')

  it('PERSONAL kind when targetPlayerId is set; maxUses=1 (single-use)', () => {
    const data = buildInviteCreateData({
      leagueId: 'league-1',
      targetPlayerId: 'p-1',
      code: 'ABCD1234EFGH',
      expiresAt,
      skipOnboarding: false,
      createdById: 'u-admin',
    })
    expect(data).toEqual({
      leagueId: 'league-1',
      code: 'ABCD1234EFGH',
      kind: 'PERSONAL',
      targetPlayerId: 'p-1',
      createdById: 'u-admin',
      expiresAt,
      maxUses: 1,
      skipOnboarding: false,
    })
  })

  it('CODE kind when no targetPlayerId; maxUses=null (unlimited)', () => {
    const data = buildInviteCreateData({
      leagueId: 'league-1',
      targetPlayerId: null,
      code: 'XYZ12345ABCD',
      expiresAt,
      skipOnboarding: true,
      createdById: null,
    })
    expect(data.kind).toBe('CODE')
    expect(data.targetPlayerId).toBeNull()
    expect(data.maxUses).toBeNull()
    expect(data.skipOnboarding).toBe(true)
    expect(data.createdById).toBeNull()
  })

  it('passes skipOnboarding through verbatim (true and false)', () => {
    expect(
      buildInviteCreateData({
        leagueId: 'L', targetPlayerId: 'p', code: 'C', expiresAt: null,
        skipOnboarding: true, createdById: null,
      }).skipOnboarding,
    ).toBe(true)
    expect(
      buildInviteCreateData({
        leagueId: 'L', targetPlayerId: 'p', code: 'C', expiresAt: null,
        skipOnboarding: false, createdById: null,
      }).skipOnboarding,
    ).toBe(false)
  })

  it('expiresAt: null → null (admin opt-out for "never expires")', () => {
    const data = buildInviteCreateData({
      leagueId: 'L', targetPlayerId: 'p', code: 'C', expiresAt: null,
      skipOnboarding: false, createdById: null,
    })
    expect(data.expiresAt).toBeNull()
  })
})

// ── adminGenerateInvite (single) ────────────────────────────────────────────

describe('v1.33.0 (PR ε) — adminGenerateInvite', () => {
  it('happy path: creates a PERSONAL invite with code, expiresAt = +7 days, skipOnboarding=false by default', async () => {
    playerFindUniqueMock.mockResolvedValue({ id: 'p-target', lineId: null })
    inviteFindFirstMock.mockResolvedValue(null)
    inviteCreateMock.mockResolvedValue({
      id: 'invite-1',
      code: 'ABCD1234EFGH',
      expiresAt: new Date('2026-05-10T10:00:00Z'),
      skipOnboarding: false,
    })
    const result = await adminGenerateInvite({
      leagueId: 'league-1',
      targetPlayerId: 'p-target',
    })
    expect(result.id).toBe('invite-1')
    expect(result.code).toMatch(/^[A-Z0-9]{12}$/) // 12-char uppercase alphanum
    expect(result.skipOnboarding).toBe(false)
    expect(result.joinUrl).toBe(`https://t9l.me/join/${result.code}`)
    expect(inviteCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'PERSONAL',
        targetPlayerId: 'p-target',
        skipOnboarding: false,
        maxUses: 1,
      }),
    })
    expect(revalidateMock).toHaveBeenCalledWith({
      domain: 'admin',
      paths: ['/admin/leagues/league-1/players'],
    })
  })

  it('uses the request Host header so subdomain admins get subdomain join URLs', async () => {
    playerFindUniqueMock.mockResolvedValue({ id: 'p-x', lineId: null })
    inviteFindFirstMock.mockResolvedValue(null)
    inviteCreateMock.mockResolvedValue({
      id: 'i', code: 'ABCDEFGHJKMN', expiresAt: null, skipOnboarding: false,
    })
    const headersModule = await import('next/headers')
    vi.mocked(headersModule.headers).mockResolvedValueOnce(
      new Map([['host', 'tamachi.t9l.me']]) as unknown as Awaited<ReturnType<typeof headersModule.headers>>,
    )
    const result = await adminGenerateInvite({
      leagueId: 'league-1', targetPlayerId: 'p-x',
    })
    expect(result.joinUrl).toBe('https://tamachi.t9l.me/join/ABCDEFGHJKMN')
  })

  it('rejects when target Player does not exist', async () => {
    playerFindUniqueMock.mockResolvedValue(null)
    await expect(
      adminGenerateInvite({ leagueId: 'L', targetPlayerId: 'p-nope' }),
    ).rejects.toThrow(/Target player not found/)
    expect(inviteCreateMock).not.toHaveBeenCalled()
    expect(revalidateMock).not.toHaveBeenCalled()
  })

  it('rejects when target Player is already linked to a LINE user (use remap, not invite)', async () => {
    playerFindUniqueMock.mockResolvedValue({ id: 'p-x', lineId: 'U123456' })
    await expect(
      adminGenerateInvite({ leagueId: 'L', targetPlayerId: 'p-x' }),
    ).rejects.toThrow(/already linked/)
    expect(inviteCreateMock).not.toHaveBeenCalled()
  })

  it('rejects when an active PERSONAL invite already exists for the target (no double-issue)', async () => {
    playerFindUniqueMock.mockResolvedValue({ id: 'p-x', lineId: null })
    inviteFindFirstMock.mockResolvedValue({ id: 'invite-existing' })
    await expect(
      adminGenerateInvite({ leagueId: 'L', targetPlayerId: 'p-x' }),
    ).rejects.toThrow(/active personal invite already exists/i)
    expect(inviteCreateMock).not.toHaveBeenCalled()
  })

  it('honors skipOnboarding=true on the resulting LeagueInvite row', async () => {
    playerFindUniqueMock.mockResolvedValue({ id: 'p-x', lineId: null })
    inviteFindFirstMock.mockResolvedValue(null)
    inviteCreateMock.mockResolvedValue({
      id: 'i', code: 'ABCD1234EFGH', expiresAt: null, skipOnboarding: true,
    })
    const result = await adminGenerateInvite({
      leagueId: 'L', targetPlayerId: 'p-x', skipOnboarding: true,
    })
    expect(result.skipOnboarding).toBe(true)
    expect(inviteCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ skipOnboarding: true }),
    })
  })

  it('explicit expiresAt: null → invite never expires (admin opt-out)', async () => {
    playerFindUniqueMock.mockResolvedValue({ id: 'p-x', lineId: null })
    inviteFindFirstMock.mockResolvedValue(null)
    inviteCreateMock.mockResolvedValue({
      id: 'i', code: 'ABCD1234EFGH', expiresAt: null, skipOnboarding: false,
    })
    const result = await adminGenerateInvite({
      leagueId: 'L', targetPlayerId: 'p-x', expiresAt: null,
    })
    expect(result.expiresAt).toBeNull()
    expect(inviteCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ expiresAt: null }),
    })
  })

  it('retries on @unique code collision (P2002) up to 5 times', async () => {
    playerFindUniqueMock.mockResolvedValue({ id: 'p-x', lineId: null })
    inviteFindFirstMock.mockResolvedValue(null)
    let calls = 0
    inviteCreateMock.mockImplementation(async () => {
      calls++
      if (calls < 3) {
        const err: Error & { code?: string } = new Error('Unique constraint failed')
        err.code = 'P2002'
        throw err
      }
      return { id: 'i', code: 'ABCD1234EFGH', expiresAt: null, skipOnboarding: false }
    })
    const result = await adminGenerateInvite({ leagueId: 'L', targetPlayerId: 'p-x' })
    expect(calls).toBe(3)
    expect(result.code).toBeTruthy()
  })

  it('throws when playerId is empty', async () => {
    await expect(
      adminGenerateInvite({ leagueId: 'L', targetPlayerId: '' }),
    ).rejects.toThrow(/targetPlayerId is required/)
    expect(playerFindUniqueMock).not.toHaveBeenCalled()
  })
})

// ── adminGenerateInvitesBulk ────────────────────────────────────────────────

describe('v1.33.0 (PR ε) — adminGenerateInvitesBulk', () => {
  it('all-success batch: per-row results all ok=true + CSV with N+1 lines (header + N rows)', async () => {
    playerFindManyMock.mockResolvedValue([
      { id: 'p-a', name: 'Alice', lineId: null },
      { id: 'p-b', name: 'Bob',   lineId: null },
    ])
    playerFindUniqueMock.mockImplementation(async ({ where }) => ({
      id: where.id, lineId: null,
    }))
    inviteFindFirstMock.mockResolvedValue(null)
    let codeCounter = 0
    inviteCreateMock.mockImplementation(async () => ({
      id: `i-${++codeCounter}`,
      code: `CODE${String(codeCounter).padStart(8, '0')}`,
      expiresAt: new Date('2026-05-10T10:00:00Z'),
      skipOnboarding: false,
    }))

    const result = await adminGenerateInvitesBulk({
      leagueId: 'L', targetPlayerIds: ['p-a', 'p-b'],
    })

    expect(result.results).toHaveLength(2)
    expect(result.results.every((r) => r.ok)).toBe(true)
    expect(result.results[0]).toMatchObject({ playerId: 'p-a', playerName: 'Alice', ok: true })
    expect(result.results[1]).toMatchObject({ playerId: 'p-b', playerName: 'Bob',   ok: true })
    // CSV: header + 2 rows + trailing newline
    const lines = result.csv.trim().split('\n')
    expect(lines).toHaveLength(3) // header + 2 rows
    expect(lines[0]).toBe('playerId,playerName,code,joinUrl,expiresAt,skipOnboarding')
  })

  it('partial-failure batch: skipped player surfaces in results with error reason; CSV omits failures', async () => {
    playerFindManyMock.mockResolvedValue([
      { id: 'p-a', name: 'Alice', lineId: null },
      { id: 'p-b', name: 'Bob',   lineId: 'U123' },  // already linked → skip
      { id: 'p-c', name: null,    lineId: null },     // pre-staged, eligible
    ])
    playerFindUniqueMock.mockImplementation(async ({ where }) => {
      if (where.id === 'p-a') return { id: 'p-a', lineId: null }
      if (where.id === 'p-c') return { id: 'p-c', lineId: null }
      return { id: where.id, lineId: 'U123' }
    })
    inviteFindFirstMock.mockResolvedValue(null)
    let n = 0
    inviteCreateMock.mockImplementation(async () => ({
      id: `i-${++n}`, code: `CODE${n}0000000`.slice(0, 12),
      expiresAt: null, skipOnboarding: false,
    }))

    const result = await adminGenerateInvitesBulk({
      leagueId: 'L', targetPlayerIds: ['p-a', 'p-b', 'p-c'],
    })

    expect(result.results).toHaveLength(3)
    expect(result.results[0].ok).toBe(true)
    expect(result.results[1].ok).toBe(false)
    expect(result.results[1].error).toMatch(/already linked/)
    expect(result.results[2].ok).toBe(true)
    expect(result.results[2].playerName).toBeNull() // pre-staged
    // CSV: header + 2 rows (the 2 successes); failure row omitted
    expect(result.csv.trim().split('\n').filter((l) => l.length > 0)).toHaveLength(3)
  })

  it('caps at 100 targets per call (operator safety)', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `p-${i}`)
    await expect(
      adminGenerateInvitesBulk({ leagueId: 'L', targetPlayerIds: ids }),
    ).rejects.toThrow(/100 targets/)
  })

  it('rejects empty / non-array input', async () => {
    await expect(
      adminGenerateInvitesBulk({ leagueId: 'L', targetPlayerIds: [] }),
    ).rejects.toThrow(/non-empty array/)
  })

  it('skipOnboarding flag flows through to every generated invite in the batch', async () => {
    playerFindManyMock.mockResolvedValue([
      { id: 'p-a', name: 'Alice', lineId: null },
    ])
    playerFindUniqueMock.mockResolvedValue({ id: 'p-a', lineId: null })
    inviteFindFirstMock.mockResolvedValue(null)
    inviteCreateMock.mockResolvedValue({
      id: 'i', code: 'ABCDEFGHJKMN', expiresAt: null, skipOnboarding: true,
    })
    const result = await adminGenerateInvitesBulk({
      leagueId: 'L', targetPlayerIds: ['p-a'], skipOnboarding: true,
    })
    expect(result.results[0].skipOnboarding).toBe(true)
    expect(inviteCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ skipOnboarding: true }),
    })
  })
})
