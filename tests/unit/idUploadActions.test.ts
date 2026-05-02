/**
 * v1.35.0 (PR η) — submitIdUpload + skipIdUpload + adminPurgePlayerId
 * server actions.
 *
 * Pin the load-bearing behavior:
 *   - submitIdUpload requires both files + BLOB token + bound user;
 *     uploads via @vercel/blob.put; writes URLs + timestamp; flips
 *     onboardingStatus to COMPLETED in same transaction.
 *   - skipIdUpload flips onboardingStatus to COMPLETED without writing
 *     URLs (operator-gate fallback when BLOB token is missing).
 *   - adminPurgePlayerId DELs Blob assets and nulls the columns; no-op
 *     when nothing was uploaded.
 *   - submitOnboarding (PR ζ change) no longer flips onboardingStatus;
 *     redirects to /id-upload not /welcome.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  inviteFindUniqueMock,
  playerFindUniqueMock,
  playerUpdateMock,
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
  const assignmentUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 })
  const txMock = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      player: { update: playerUpdateMock },
      playerLeagueAssignment: { updateMany: assignmentUpdateManyMock },
    }
    return cb(tx)
  })
  return {
    inviteFindUniqueMock,
    playerFindUniqueMock,
    playerUpdateMock,
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
    playerLeagueAssignment: { updateMany: assignmentUpdateManyMock, findFirst: vi.fn() },
    $transaction: txMock,
    user: { update: vi.fn() },
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

describe('v1.35.0 (PR η) — submitIdUpload', () => {
  beforeEach(() => {
    sessionMock.mockResolvedValue({ userId: 'u-1' })
    playerFindUniqueMock.mockResolvedValue({ id: 'p-1', userId: 'u-1' })
    inviteFindUniqueMock.mockResolvedValue({ leagueId: 'l-1' })
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

  it('happy path: uploads both files, writes Player + flips onboardingStatus, redirects', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'fake-token'
    await expect(submitIdUpload(makeFormData())).rejects.toThrow('NEXT_REDIRECT')
    expect(putMock).toHaveBeenCalledTimes(2)
    expect(playerUpdateMock).toHaveBeenCalledWith({
      where: { id: 'p-1' },
      data: expect.objectContaining({
        idFrontUrl: expect.stringContaining('player-id/p-1/front-'),
        idBackUrl: expect.stringContaining('player-id/p-1/back-'),
        idUploadedAt: expect.any(Date),
      }),
    })
    expect(assignmentUpdateManyMock).toHaveBeenCalledWith({
      where: { playerId: 'p-1', leagueTeam: { leagueId: 'l-1' } },
      data: { onboardingStatus: 'COMPLETED' },
    })
    expect(redirectMock).toHaveBeenCalledWith('/join/CODE12345678/welcome')
    delete process.env.BLOB_READ_WRITE_TOKEN
  })

  it('rejects when BLOB_READ_WRITE_TOKEN is missing (operator gate)', async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN
    await expect(submitIdUpload(makeFormData())).rejects.toThrow(/unavailable/i)
    expect(putMock).not.toHaveBeenCalled()
    expect(playerUpdateMock).not.toHaveBeenCalled()
  })

  it('rejects when not signed in', async () => {
    sessionMock.mockResolvedValue(null)
    process.env.BLOB_READ_WRITE_TOKEN = 'fake-token'
    await expect(submitIdUpload(makeFormData())).rejects.toThrow(/sign in/i)
    delete process.env.BLOB_READ_WRITE_TOKEN
  })

  it('rejects when admin-credentials session (no userId)', async () => {
    sessionMock.mockResolvedValue({ isAdmin: true })
    process.env.BLOB_READ_WRITE_TOKEN = 'fake-token'
    await expect(submitIdUpload(makeFormData())).rejects.toThrow(/admin sessions/i)
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

  it('uploads with addRandomSuffix=false + access=public so the URL is stable', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'fake-token'
    await expect(submitIdUpload(makeFormData())).rejects.toThrow('NEXT_REDIRECT')
    expect(putMock).toHaveBeenCalledWith(
      expect.stringMatching(/^player-id\/p-1\/(front|back)-\d+\.jpg$/),
      expect.any(File),
      expect.objectContaining({ access: 'public', addRandomSuffix: false }),
    )
    delete process.env.BLOB_READ_WRITE_TOKEN
  })
})

// ── skipIdUpload ────────────────────────────────────────────────────────────

describe('v1.35.0 (PR η) — skipIdUpload', () => {
  beforeEach(() => {
    sessionMock.mockResolvedValue({ userId: 'u-1' })
    playerFindUniqueMock.mockResolvedValue({ id: 'p-1', userId: 'u-1' })
    inviteFindUniqueMock.mockResolvedValue({ leagueId: 'l-1' })
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
    expect(redirectMock).toHaveBeenCalledWith('/join/CODE12345678/welcome')
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
    playerFindUniqueMock.mockResolvedValue({ id: 'p-1', userId: 'u-1' })
    inviteFindUniqueMock.mockResolvedValue({ leagueId: 'l-1' })
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

  it('does NOT flip onboardingStatus to COMPLETED — that is the ID-upload step\'s job', async () => {
    await expect(
      submitOnboarding({
        code: 'CODE12345678',
        playerId: 'p-1',
        name: 'Stefan S',
      }),
    ).rejects.toThrow('NEXT_REDIRECT')
    // Only the player update happens; assignment update should NOT fire.
    expect(playerUpdateMock).toHaveBeenCalled()
    expect(assignmentUpdateManyMock).not.toHaveBeenCalled()
  })
})

// ── adminPurgePlayerId ──────────────────────────────────────────────────────

describe('v1.35.0 (PR η) — adminPurgePlayerId', () => {
  beforeEach(() => {
    sessionMock.mockResolvedValue({ isAdmin: true })
  })

  it('happy path: DELs Blob URLs and nulls the three columns', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'fake-token'
    playerFindUniqueMock.mockResolvedValue({
      id: 'p-1',
      idFrontUrl: 'https://blob.example/front.jpg',
      idBackUrl: 'https://blob.example/back.jpg',
    })
    delMock.mockResolvedValue(undefined)
    await adminPurgePlayerId({ playerId: 'p-1', leagueId: 'l-1' })
    expect(delMock).toHaveBeenCalledWith([
      'https://blob.example/front.jpg',
      'https://blob.example/back.jpg',
    ])
    expect(playerUpdateMock).toHaveBeenCalledWith({
      where: { id: 'p-1' },
      data: { idFrontUrl: null, idBackUrl: null, idUploadedAt: null },
    })
    expect(revalidateMock).toHaveBeenCalledWith({
      domain: 'admin',
      paths: ['/admin/leagues/l-1/players'],
    })
    delete process.env.BLOB_READ_WRITE_TOKEN
  })

  it('idempotent no-op when both URLs are null (already purged or never uploaded)', async () => {
    playerFindUniqueMock.mockResolvedValue({
      id: 'p-1',
      idFrontUrl: null,
      idBackUrl: null,
    })
    await adminPurgePlayerId({ playerId: 'p-1', leagueId: 'l-1' })
    expect(delMock).not.toHaveBeenCalled()
    expect(playerUpdateMock).not.toHaveBeenCalled()
    expect(revalidateMock).not.toHaveBeenCalled()
  })

  it('still nulls the columns when BLOB token is missing (Blob delete skipped, DB update fires)', async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN
    playerFindUniqueMock.mockResolvedValue({
      id: 'p-1',
      idFrontUrl: 'https://blob.example/front.jpg',
      idBackUrl: 'https://blob.example/back.jpg',
    })
    await adminPurgePlayerId({ playerId: 'p-1', leagueId: 'l-1' })
    expect(delMock).not.toHaveBeenCalled()
    expect(playerUpdateMock).toHaveBeenCalled()
  })

  it('Blob del failure is non-fatal (best-effort) — DB update still fires', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'fake-token'
    playerFindUniqueMock.mockResolvedValue({
      id: 'p-1',
      idFrontUrl: 'https://blob.example/front.jpg',
      idBackUrl: 'https://blob.example/back.jpg',
    })
    delMock.mockRejectedValueOnce(new Error('Blob 503'))
    await adminPurgePlayerId({ playerId: 'p-1', leagueId: 'l-1' })
    expect(playerUpdateMock).toHaveBeenCalled()
    delete process.env.BLOB_READ_WRITE_TOKEN
  })

  it('rejects empty playerId', async () => {
    await expect(
      adminPurgePlayerId({ playerId: '', leagueId: 'l-1' }),
    ).rejects.toThrow(/required/)
  })
})
