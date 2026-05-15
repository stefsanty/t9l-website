/**
 * v1.35.0 (PR η) — submitIdUpload + skipIdUpload + adminPurgePlayerId
 * server actions.
 *
 * v1.70.0 — ID columns moved from Player to User. Tests updated to
 * pin the new write target (`tx.user.update`) and the new
 * adminPurgePlayerId resolution path (Player.userId → User.id → null
 * the User columns).
 *
 * Pin the load-bearing behavior:
 *   - submitIdUpload requires both files + BLOB token + bound user;
 *     uploads via @vercel/blob.put; writes URLs + timestamp to User
 *     (v1.70.0); flips onboardingStatus to COMPLETED in same transaction.
 *   - skipIdUpload flips onboardingStatus to COMPLETED without writing
 *     URLs (operator-gate fallback when BLOB token is missing).
 *   - adminPurgePlayerId resolves the linked User via Player.userId,
 *     DELs Blob assets and nulls the User columns; no-op when nothing
 *     was uploaded.
 *   - submitOnboarding (PR ζ change) no longer flips onboardingStatus;
 *     redirects to /id-upload not /welcome.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  inviteFindUniqueMock,
  playerFindUniqueMock,
  playerUpdateMock,
  userFindUniqueMock,
  userUpdateMock,
  assignmentUpdateManyMock,
  txMock,
  revalidateMock,
  redirectMock,
  putMock,
  delMock,
  sessionMock,
} = vi.hoisted(() => {
  const inviteFindUniqueMock = vi.fn()
  const playerFindUniqueMock = vi.fn()
  const playerUpdateMock = vi.fn().mockResolvedValue({})
  const userFindUniqueMock = vi.fn()
  const userUpdateMock = vi.fn().mockResolvedValue({})
  const assignmentUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 })
  const txMock = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      player: { update: playerUpdateMock },
      user: { update: userUpdateMock },
      playerLeagueMembership: { updateMany: assignmentUpdateManyMock },
    }
    return cb(tx)
  })
  return {
    inviteFindUniqueMock,
    playerFindUniqueMock,
    playerUpdateMock,
    userFindUniqueMock,
    userUpdateMock,
    assignmentUpdateManyMock,
    txMock,
    revalidateMock: vi.fn(),
    redirectMock: vi.fn().mockImplementation(() => {
      // The real next/navigation redirect throws a special error to halt
      // execution. Mimic that — server actions in this test should not
      // continue past redirect.
      const err = new Error('NEXT_REDIRECT') as Error & { digest?: string }
      err.digest = 'NEXT_REDIRECT'
      throw err
    }),
    putMock: vi.fn(),
    delMock: vi.fn(),
    sessionMock: vi.fn(),
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueInvite: { findUnique: inviteFindUniqueMock },
    player: { findUnique: playerFindUniqueMock, update: playerUpdateMock },
    user: { findUnique: userFindUniqueMock, update: userUpdateMock },
    playerLeagueMembership: { updateMany: assignmentUpdateManyMock, findFirst: vi.fn() },
    $transaction: txMock,
  },
}))
vi.mock('@/lib/revalidate', () => ({ revalidate: revalidateMock }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {}, getPlayerMappingFromDb: vi.fn() }))
vi.mock('@/lib/identityLink', () => ({
  linkPlayerToUser: vi.fn(),
  unlinkPlayerFromUser: vi.fn(),
}))
vi.mock('next/cache', () => ({ unstable_cache: <T,>(fn: T) => fn }))
vi.mock('next/navigation', () => ({ redirect: redirectMock }))
vi.mock('@vercel/blob', () => ({
  put: putMock,
  del: delMock,
}))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Map([['host', 't9l.me']])),
}))
vi.mock('@/lib/playerMappingStore', () => ({
  setMapping: vi.fn(),
  deleteMapping: vi.fn(),
}))
vi.mock('@/lib/rsvpStore', () => ({ seedGameWeek: vi.fn(), deleteGameWeek: vi.fn() }))
vi.mock('@vercel/functions', () => ({ waitUntil: (p: Promise<unknown>) => p }))

const { submitIdUpload, skipIdUpload, submitOnboarding } = await import(
  '@/app/join/[code]/actions'
)
const { adminPurgePlayerId } = await import('@/app/admin/leagues/actions')

beforeEach(() => {
  inviteFindUniqueMock.mockReset()
  playerFindUniqueMock.mockReset()
  playerUpdateMock.mockClear()
  userFindUniqueMock.mockReset()
  userUpdateMock.mockClear()
  assignmentUpdateManyMock.mockClear()
  assignmentUpdateManyMock.mockResolvedValue({ count: 1 })
  txMock.mockClear()
  revalidateMock.mockClear()
  redirectMock.mockClear()
  putMock.mockReset()
  delMock.mockReset()
  sessionMock.mockReset()
})

function makeFile(name: string, type: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type })
}

// ── submitIdUpload ──────────────────────────────────────────────────────────

describe('v1.35.0 (PR η) — submitIdUpload (v1.70.0 writes to User)', () => {
  beforeEach(() => {
    sessionMock.mockResolvedValue({ userId: 'u-1' })
    // v1.80.11 — User row resolved by userId before the player check.
    userFindUniqueMock.mockResolvedValue({ id: 'u-1' })
    playerFindUniqueMock.mockResolvedValue({ id: 'p-1', userId: 'u-1' })
    inviteFindUniqueMock.mockResolvedValue({ leagueId: 'l-1', league: { ballType: 'SOCCER', name: 'Test League' } })
    putMock.mockImplementation(async (path: string) => ({
      url: `https://blob.vercel-storage.com/${path}`,
    }))
  })

  function makeFormData(overrides: Partial<Record<string, unknown>> = {}): FormData {
    const fd = new FormData()
    fd.append('code', overrides.code as string ?? 'CODE12345678')
    fd.append('playerId', overrides.playerId as string ?? 'p-1')
    if (overrides.idFront !== null) {
      fd.append('idFront', (overrides.idFront as File) ?? makeFile('front.jpg', 'image/jpeg', 1000))
    }
    if (overrides.idBack !== null) {
      fd.append('idBack', (overrides.idBack as File) ?? makeFile('back.jpg', 'image/jpeg', 1000))
    }
    return fd
  }

  it('happy path: uploads both files, writes User + flips onboardingStatus, redirects', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'fake-token'
    await expect(submitIdUpload(makeFormData())).rejects.toThrow('NEXT_REDIRECT')
    expect(putMock).toHaveBeenCalledTimes(2)
    // v1.70.0 — writes go to User, not Player.
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: expect.objectContaining({
        idFrontUrl: expect.stringContaining('player-id/p-1/front-'),
        idBackUrl: expect.stringContaining('player-id/p-1/back-'),
        idUploadedAt: expect.any(Date),
      }),
    })
    // Player.update is NOT called by submitIdUpload post-v1.70.0.
    expect(playerUpdateMock).not.toHaveBeenCalled()
    expect(assignmentUpdateManyMock).toHaveBeenCalledWith({
      where: { playerId: 'p-1', leagueTeam: { leagueId: 'l-1' } },
      data: { onboardingStatus: 'COMPLETED' },
    })
    // v1.81.2 — the `?submitted=submitIdUpload` query param triggers the
    // post-submit success popup on the welcome page.
    expect(redirectMock).toHaveBeenCalledWith(
      '/join/CODE12345678/welcome?submitted=submitIdUpload',
    )
    delete process.env.BLOB_READ_WRITE_TOKEN
  })

  it('rejects when BLOB_READ_WRITE_TOKEN is missing (operator gate)', async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN
    await expect(submitIdUpload(makeFormData())).rejects.toThrow(/unavailable/i)
    expect(putMock).not.toHaveBeenCalled()
    expect(userUpdateMock).not.toHaveBeenCalled()
  })

  it('rejects when not signed in', async () => {
    sessionMock.mockResolvedValue(null)
    process.env.BLOB_READ_WRITE_TOKEN = 'fake-token'
    await expect(submitIdUpload(makeFormData())).rejects.toThrow(/sign in/i)
    delete process.env.BLOB_READ_WRITE_TOKEN
  })

  it('rejects when admin-credentials session (no userId, no lineId)', async () => {
    // v1.80.11 — admin-orthogonal-UX: only sessions with NEITHER
    // identifier are rejected, with neutral copy.
    sessionMock.mockResolvedValue({ isAdmin: true })
    process.env.BLOB_READ_WRITE_TOKEN = 'fake-token'
    await expect(submitIdUpload(makeFormData())).rejects.toThrow(
      /sign in with a player account/i,
    )
    delete process.env.BLOB_READ_WRITE_TOKEN
  })

  it('v1.80.11 — accepts LINE-auth admin (lineId only) via lineId fallback', async () => {
    sessionMock.mockResolvedValue({ isAdmin: true, lineId: 'U_LINEID' })
    userFindUniqueMock.mockResolvedValueOnce({ id: 'u-1' })
    process.env.BLOB_READ_WRITE_TOKEN = 'fake-token'
    await expect(submitIdUpload(makeFormData())).rejects.toThrow('NEXT_REDIRECT')
    // v1.81.2 — `?submitted=submitIdUpload` carries to the welcome page.
    expect(redirectMock).toHaveBeenCalledWith(
      '/join/CODE12345678/welcome?submitted=submitIdUpload',
    )
    delete process.env.BLOB_READ_WRITE_TOKEN
  })

  it('rejects when user is not bound to the player (defense in depth)', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'fake-token'
    playerFindUniqueMock.mockResolvedValue({ id: 'p-1', userId: 'u-other' })
    await expect(submitIdUpload(makeFormData())).rejects.toThrow(/not linked/i)
    expect(putMock).not.toHaveBeenCalled()
    delete process.env.BLOB_READ_WRITE_TOKEN
  })

  it('rejects when front file is missing (empty File)', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'fake-token'
    const fd = makeFormData({ idFront: makeFile('empty.jpg', 'image/jpeg', 0) })
    await expect(submitIdUpload(fd)).rejects.toThrow(/Front of ID/i)
    delete process.env.BLOB_READ_WRITE_TOKEN
  })

  it('rejects when back file is missing', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'fake-token'
    const fd = makeFormData({ idBack: makeFile('empty.jpg', 'image/jpeg', 0) })
    await expect(submitIdUpload(fd)).rejects.toThrow(/Back of ID/i)
    delete process.env.BLOB_READ_WRITE_TOKEN
  })

  it('uploads with addRandomSuffix=true + access=public (v2.2.8 — bytes flow through the authenticated proxy, path no longer needs to be guessable)', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'fake-token'
    await expect(submitIdUpload(makeFormData())).rejects.toThrow('NEXT_REDIRECT')
    expect(putMock).toHaveBeenCalledWith(
      expect.stringMatching(/^player-id\/p-1\/(front|back)-\d+\.jpg$/),
      expect.any(File),
      expect.objectContaining({ access: 'public', addRandomSuffix: true }),
    )
    delete process.env.BLOB_READ_WRITE_TOKEN
  })
})

// ── skipIdUpload ────────────────────────────────────────────────────────────

describe('v1.35.0 (PR η) — skipIdUpload', () => {
  beforeEach(() => {
    sessionMock.mockResolvedValue({ userId: 'u-1' })
    // v1.80.11 — User row resolved by userId before the player check.
    userFindUniqueMock.mockResolvedValue({ id: 'u-1' })
    playerFindUniqueMock.mockResolvedValue({ id: 'p-1', userId: 'u-1' })
    inviteFindUniqueMock.mockResolvedValue({ leagueId: 'l-1', league: { ballType: 'SOCCER', name: 'Test League' } })
  })

  it('flips onboardingStatus to COMPLETED without writing ID URLs', async () => {
    await expect(
      skipIdUpload({ code: 'CODE12345678', playerId: 'p-1' }),
    ).rejects.toThrow('NEXT_REDIRECT')
    expect(assignmentUpdateManyMock).toHaveBeenCalledWith({
      where: { playerId: 'p-1', leagueTeam: { leagueId: 'l-1' } },
      data: { onboardingStatus: 'COMPLETED' },
    })
    expect(playerUpdateMock).not.toHaveBeenCalled()
    expect(userUpdateMock).not.toHaveBeenCalled()
    // v1.81.2 — `?submitted=skipIdUpload` triggers the post-submit
    // success popup on the welcome page.
    expect(redirectMock).toHaveBeenCalledWith(
      '/join/CODE12345678/welcome?submitted=skipIdUpload',
    )
  })

  it('rejects when not signed in', async () => {
    sessionMock.mockResolvedValue(null)
    await expect(
      skipIdUpload({ code: 'C', playerId: 'p-1' }),
    ).rejects.toThrow(/sign in/i)
  })

  it('rejects when user is not bound to the player', async () => {
    playerFindUniqueMock.mockResolvedValue({ id: 'p-1', userId: 'u-other' })
    await expect(
      skipIdUpload({ code: 'C', playerId: 'p-1' }),
    ).rejects.toThrow(/not linked/i)
    expect(assignmentUpdateManyMock).not.toHaveBeenCalled()
  })
})

// ── submitOnboarding (PR ζ change tracker) ──────────────────────────────────

describe('v1.35.0 (PR η) — submitOnboarding routing change', () => {
  beforeEach(() => {
    sessionMock.mockResolvedValue({ userId: 'u-1' })
    // v1.80.11 — User row resolved by userId before the player check.
    userFindUniqueMock.mockResolvedValue({ id: 'u-1', lineId: null })
    playerFindUniqueMock.mockResolvedValue({ id: 'p-1', userId: 'u-1' })
    inviteFindUniqueMock.mockResolvedValue({ leagueId: 'l-1', league: { ballType: 'SOCCER', name: 'Test League' } })
  })

  it('redirects to /id-upload (not /welcome) post-η', async () => {
    await expect(
      submitOnboarding({
        code: 'CODE12345678',
        playerId: 'p-1',
        name: 'Stefan S',
      }),
    ).rejects.toThrow('NEXT_REDIRECT')
    expect(redirectMock).toHaveBeenCalledWith('/join/CODE12345678/id-upload')
  })

  it('v1.82.0 — submits multi-position via PLM.updateMany; never sets onboardingStatus here', async () => {
    await expect(
      submitOnboarding({
        code: 'CODE12345678',
        playerId: 'p-1',
        name: 'Stefan S',
        positions: ['CM'],
      }),
    ).rejects.toThrow('NEXT_REDIRECT')
    // Player gets the identity update (name).
    expect(playerUpdateMock).toHaveBeenCalled()
    // v1.82.0 — PLM.updateMany dual-writes positions[] + legacy enum
    // (CM buckets to MF in the legacy column). onboardingStatus stays
    // out of this payload — that's the ID-upload step's job.
    expect(assignmentUpdateManyMock).toHaveBeenCalled()
    const plmCall = assignmentUpdateManyMock.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(plmCall.data.onboardingStatus).toBeUndefined()
    expect(plmCall.data.positions).toEqual(['CM'])
    expect(plmCall.data.position).toBe('MF')
  })
})

// ── adminPurgePlayerId ──────────────────────────────────────────────────────

describe('v1.35.0 (PR η) — adminPurgePlayerId (v1.70.0 reads/writes User)', () => {
  beforeEach(() => {
    sessionMock.mockResolvedValue({ isAdmin: true })
  })

  it('happy path: resolves User via Player.userId, DELs Blob URLs, nulls the three User columns', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'fake-token'
    playerFindUniqueMock.mockResolvedValue({ id: 'p-1', userId: 'u-1' })
    userFindUniqueMock.mockResolvedValue({
      id: 'u-1',
      idFrontUrl: 'https://blob.example/front.jpg',
      idBackUrl: 'https://blob.example/back.jpg',
    })
    delMock.mockResolvedValue(undefined)
    await adminPurgePlayerId({ playerId: 'p-1', leagueId: 'l-1' })
    expect(delMock).toHaveBeenCalledWith([
      'https://blob.example/front.jpg',
      'https://blob.example/back.jpg',
    ])
    // v1.70.0 — writes to User, not Player.
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { idFrontUrl: null, idBackUrl: null, idUploadedAt: null },
    })
    expect(playerUpdateMock).not.toHaveBeenCalled()
    expect(revalidateMock).toHaveBeenCalledWith({
      domain: 'admin',
      paths: ['/admin/leagues/l-1/players'],
    })
    delete process.env.BLOB_READ_WRITE_TOKEN
  })

  it('idempotent no-op when both User URLs are null (already purged or never uploaded)', async () => {
    playerFindUniqueMock.mockResolvedValue({ id: 'p-1', userId: 'u-1' })
    userFindUniqueMock.mockResolvedValue({
      id: 'u-1',
      idFrontUrl: null,
      idBackUrl: null,
    })
    await adminPurgePlayerId({ playerId: 'p-1', leagueId: 'l-1' })
    expect(delMock).not.toHaveBeenCalled()
    expect(userUpdateMock).not.toHaveBeenCalled()
    expect(playerUpdateMock).not.toHaveBeenCalled()
    expect(revalidateMock).not.toHaveBeenCalled()
  })

  it('no-op when Player has no linked User (userId null) — no User row holds an ID', async () => {
    playerFindUniqueMock.mockResolvedValue({ id: 'p-1', userId: null })
    await adminPurgePlayerId({ playerId: 'p-1', leagueId: 'l-1' })
    expect(userFindUniqueMock).not.toHaveBeenCalled()
    expect(userUpdateMock).not.toHaveBeenCalled()
  })

  it('still nulls the User columns when BLOB token is missing (Blob delete skipped, DB update fires)', async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN
    playerFindUniqueMock.mockResolvedValue({ id: 'p-1', userId: 'u-1' })
    userFindUniqueMock.mockResolvedValue({
      id: 'u-1',
      idFrontUrl: 'https://blob.example/front.jpg',
      idBackUrl: 'https://blob.example/back.jpg',
    })
    await adminPurgePlayerId({ playerId: 'p-1', leagueId: 'l-1' })
    expect(delMock).not.toHaveBeenCalled()
    expect(userUpdateMock).toHaveBeenCalled()
  })

  it('Blob del failure is non-fatal (best-effort) — DB update still fires', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'fake-token'
    playerFindUniqueMock.mockResolvedValue({ id: 'p-1', userId: 'u-1' })
    userFindUniqueMock.mockResolvedValue({
      id: 'u-1',
      idFrontUrl: 'https://blob.example/front.jpg',
      idBackUrl: 'https://blob.example/back.jpg',
    })
    delMock.mockRejectedValueOnce(new Error('Blob 503'))
    await adminPurgePlayerId({ playerId: 'p-1', leagueId: 'l-1' })
    expect(userUpdateMock).toHaveBeenCalled()
    delete process.env.BLOB_READ_WRITE_TOKEN
  })

  it('rejects empty playerId', async () => {
    await expect(
      adminPurgePlayerId({ playerId: '', leagueId: 'l-1' }),
    ).rejects.toThrow(/required/)
  })
})
