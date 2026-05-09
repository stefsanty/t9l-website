/**
 * v1.83.0 — server actions for /account/player after the multi-league
 * redesign. The old monolithic `updatePlayerSelf({ name, positions })`
 * is split into:
 *
 *   1. `updatePlayerProfile({ name })` — player-level, writes Player.name
 *      + User.name, busts the per-LINE Redis mapping cache.
 *   2. `updatePlayerLeague({ leagueId, positions?, idShared? })` —
 *      per-league, scoped to one PLM owned by the caller. Validates
 *      positions against THAT league's ballType. Dual-writes the legacy
 *      `position` scalar only when `positions` is provided.
 *
 * Pin:
 *   - Auth gate: no session → throws; admin-credentials session (no
 *     userId AND no lineId) → throws. v1.59.1: LINE-only sessions
 *     (lineId present, userId absent) are NOT rejected.
 *   - Owner gate: resolves Player by `userId @unique` first, falling
 *     back to `lineId @unique`. Throws if neither resolves.
 *   - `updatePlayerLeague` cross-league guard: throws when the
 *     submitted leagueId doesn't resolve to an active PLM owned by the
 *     caller — the player can't write to a league they're not in.
 *   - File validation: MIME (jpeg/png/webp), size (≤5MB).
 *   - Blob token gate: upload throws when BLOB_READ_WRITE_TOKEN missing.
 *   - Replace-only: prior URL is DEL'd after successful new put.
 *
 * v1.83.0 regression-target tests are tagged in the test names so
 * stash-pop sanity-checks can verify they fail on the broken state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const {
  playerFindUniqueMock,
  playerUpdateMock,
  plmFindFirstMock,
  plmUpdateManyMock,
  userUpdateManyMock,
  transactionMock,
  revalidateMock,
  putMock,
  delMock,
  sessionMock,
  deleteMappingMock,
} = vi.hoisted(() => {
  const playerFindUniqueMock = vi.fn()
  const playerUpdateMock = vi.fn().mockResolvedValue({})
  // v1.83.0 — `updatePlayerLeague` looks up the target PLM via
  // findFirst (owner gate scoped to playerId + leagueId + toGameWeek
  // === null) before writing.
  const plmFindFirstMock = vi.fn().mockResolvedValue({
    id: 'plm-1',
    league: { ballType: 'SOCCER' },
    leagueTeam: null,
  })
  // v1.83.0 — write happens via updateMany scoped to
  // (playerId, leagueId, toGameWeek === null).
  const plmUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 })
  const userUpdateManyMock = vi.fn().mockResolvedValue({ count: 0 })
  // updatePlayerProfile uses prisma.$transaction with an inner callback
  // calling tx.player.update + tx.user.updateMany.
  const transactionMock = vi.fn().mockImplementation(async (arg) => {
    if (typeof arg === 'function') {
      const tx = {
        player: { update: playerUpdateMock, findUnique: playerFindUniqueMock },
        user: { updateMany: userUpdateManyMock },
      }
      return arg(tx)
    }
    return Promise.all(arg)
  })
  return {
    playerFindUniqueMock,
    playerUpdateMock,
    plmFindFirstMock,
    plmUpdateManyMock,
    userUpdateManyMock,
    transactionMock,
    revalidateMock: vi.fn(),
    putMock: vi.fn(),
    delMock: vi.fn(),
    sessionMock: vi.fn(),
    deleteMappingMock: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    player: { findUnique: playerFindUniqueMock, update: playerUpdateMock },
    playerLeagueMembership: {
      findFirst: plmFindFirstMock,
      updateMany: plmUpdateManyMock,
    },
    $transaction: transactionMock,
  },
}))
vi.mock('@/lib/revalidate', () => ({ revalidate: revalidateMock }))
vi.mock('@/lib/playerMappingStore', () => ({ deleteMapping: deleteMappingMock }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@vercel/blob', () => ({
  put: putMock,
  del: delMock,
}))

import {
  updatePlayerProfile,
  updatePlayerLeague,
  uploadPlayerProfilePicture,
  removePlayerProfilePicture,
} from '@/app/account/player/actions'
import {
  PROFILE_PIC_ALLOWED_TYPES,
  PROFILE_PIC_MAX_BYTES,
} from '@/app/account/player/validation'

const ORIG_BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN

beforeEach(() => {
  vi.clearAllMocks()
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token'
  sessionMock.mockResolvedValue({ userId: 'u-1', playerId: 'p-stefan-s' })
  playerFindUniqueMock.mockResolvedValue({ id: 'p-stefan-s' })
  // Default plm.findFirst — soccer membership owned by the caller.
  plmFindFirstMock.mockResolvedValue({
    id: 'plm-1',
    league: { ballType: 'SOCCER' },
    leagueTeam: null,
  })
  plmUpdateManyMock.mockResolvedValue({ count: 1 })
})

afterEach(() => {
  if (ORIG_BLOB_TOKEN === undefined) delete process.env.BLOB_READ_WRITE_TOKEN
  else process.env.BLOB_READ_WRITE_TOKEN = ORIG_BLOB_TOKEN
})

describe('updatePlayerProfile — auth gates', () => {
  it('throws when there is no session', async () => {
    sessionMock.mockResolvedValue(null)
    await expect(updatePlayerProfile({ name: 'Stefan' })).rejects.toThrow(/sign in/i)
    expect(playerUpdateMock).not.toHaveBeenCalled()
  })

  it('throws when admin-credentials session has no userId AND no lineId', async () => {
    sessionMock.mockResolvedValue({ playerId: null, lineId: '' })
    await expect(updatePlayerProfile({ name: 'Stefan' })).rejects.toThrow(/admin/i)
    expect(playerUpdateMock).not.toHaveBeenCalled()
  })

  it("throws when neither userId nor lineId resolves a Player", async () => {
    sessionMock.mockResolvedValue({ userId: 'u-1', lineId: 'L-1' })
    playerFindUniqueMock.mockResolvedValue(null)
    await expect(updatePlayerProfile({ name: 'Stefan' })).rejects.toThrow(/no player/i)
    expect(playerUpdateMock).not.toHaveBeenCalled()
  })

  // v1.59.1 — pre-v1.28.0 LINE sessions (and LINE-auth admins) have
  // lineId set but no userId. They MUST be allowed in, resolving via
  // the lineId fallback.
  it('v1.59.1 — accepts LINE-only session (no userId, has lineId) and resolves Player via lineId fallback', async () => {
    sessionMock.mockResolvedValue({ userId: null, lineId: 'L-stefan' })
    playerFindUniqueMock.mockResolvedValueOnce({ id: 'p-stefan-s' })
    await updatePlayerProfile({ name: 'Stefan S' })
    expect(playerFindUniqueMock).toHaveBeenCalledWith({
      where: { lineId: 'L-stefan' },
      select: { id: true },
    })
    expect(playerUpdateMock).toHaveBeenCalledWith({
      where: { id: 'p-stefan-s' },
      data: { name: 'Stefan S' },
    })
  })

  it('v1.59.1 — prefers userId lookup when both are present', async () => {
    sessionMock.mockResolvedValue({ userId: 'u-1', lineId: 'L-1' })
    playerFindUniqueMock.mockResolvedValueOnce({ id: 'p-stefan-s' })
    await updatePlayerProfile({ name: 'Stefan' })
    expect(playerFindUniqueMock).toHaveBeenCalledTimes(1)
    expect(playerFindUniqueMock).toHaveBeenCalledWith({
      where: { userId: 'u-1' },
      select: { id: true },
    })
  })
})

describe('updatePlayerProfile — validation + writes', () => {
  it('rejects empty name', async () => {
    await expect(updatePlayerProfile({ name: '   ' })).rejects.toThrow(/required/i)
    expect(playerUpdateMock).not.toHaveBeenCalled()
  })

  it('rejects names over 100 chars', async () => {
    await expect(updatePlayerProfile({ name: 'x'.repeat(101) })).rejects.toThrow(/100/)
    expect(playerUpdateMock).not.toHaveBeenCalled()
  })

  it('trims name and writes Player.name + User.name', async () => {
    await updatePlayerProfile({ name: '  Stefan S  ' })
    expect(playerUpdateMock).toHaveBeenCalledWith({
      where: { id: 'p-stefan-s' },
      data: { name: 'Stefan S' },
    })
    expect(userUpdateManyMock).toHaveBeenCalledWith({
      where: { playerId: 'p-stefan-s' },
      data: { name: 'Stefan S' },
    })
  })

  // v1.83.0 regression-target — `updatePlayerProfile` must NOT write
  // any positions to any membership. Pre-v1.83.0 the monolithic
  // `updatePlayerSelf` always touched PLM rows; the split removes
  // that coupling. If a regression re-introduces a per-membership
  // write inside the profile action, this test fails.
  it('v1.83.0 regression-target — does NOT touch any PlayerLeagueMembership rows', async () => {
    await updatePlayerProfile({ name: 'Stefan' })
    expect(plmFindFirstMock).not.toHaveBeenCalled()
    expect(plmUpdateManyMock).not.toHaveBeenCalled()
  })

  it('busts deleteMapping(lineId) so JWT picks up the new playerName', async () => {
    sessionMock.mockResolvedValue({ userId: 'u-1', lineId: 'L-stefan' })
    await updatePlayerProfile({ name: 'Stefan' })
    expect(deleteMappingMock).toHaveBeenCalledWith('L-stefan')
  })

  it('does NOT call deleteMapping when session has no lineId', async () => {
    sessionMock.mockResolvedValue({ userId: 'u-1', lineId: null })
    await updatePlayerProfile({ name: 'Stefan' })
    expect(deleteMappingMock).not.toHaveBeenCalled()
  })

  it('survives deleteMapping rejection (best-effort)', async () => {
    sessionMock.mockResolvedValue({ userId: 'u-1', lineId: 'L-stefan' })
    deleteMappingMock.mockRejectedValueOnce(new Error('upstash blip'))
    await expect(updatePlayerProfile({ name: 'Stefan' })).resolves.toBeUndefined()
    expect(playerUpdateMock).toHaveBeenCalled()
  })

  it('revalidates the public domain', async () => {
    await updatePlayerProfile({ name: 'Stefan' })
    expect(revalidateMock).toHaveBeenCalledWith({
      domain: 'public',
      paths: ['/account/player'],
    })
  })
})

describe('updatePlayerLeague — auth gates', () => {
  it('throws when there is no session', async () => {
    sessionMock.mockResolvedValue(null)
    await expect(
      updatePlayerLeague({ leagueId: 'league-1', positions: ['CM'] }),
    ).rejects.toThrow(/sign in/i)
    expect(plmUpdateManyMock).not.toHaveBeenCalled()
  })

  it('throws when admin-credentials session has no userId AND no lineId', async () => {
    sessionMock.mockResolvedValue({ playerId: null, lineId: '' })
    await expect(
      updatePlayerLeague({ leagueId: 'league-1', positions: ['CM'] }),
    ).rejects.toThrow(/admin/i)
    expect(plmUpdateManyMock).not.toHaveBeenCalled()
  })

  it('throws when leagueId is empty', async () => {
    await expect(
      updatePlayerLeague({ leagueId: '', positions: ['CM'] }),
    ).rejects.toThrow(/leagueId/i)
    expect(plmUpdateManyMock).not.toHaveBeenCalled()
  })

  // v1.83.0 regression-target — owner-gate cross-league bleed. A
  // player must not be able to write to a league they're not in.
  // Pre-v1.83.0 the action was scoped to (playerId, toGameWeek === null)
  // alone — passing any leagueId would silently no-op via updateMany,
  // OR (worse) overwrite EVERY active membership. Post-v1.83.0 the
  // findFirst lookup enforces the league owner gate; if it returns
  // null, the action throws.
  it('v1.83.0 regression-target — throws when the leagueId is not an active membership of the caller', async () => {
    plmFindFirstMock.mockResolvedValueOnce(null)
    await expect(
      updatePlayerLeague({ leagueId: 'someone-elses-league', positions: ['CM'] }),
    ).rejects.toThrow(/no active membership/i)
    expect(plmUpdateManyMock).not.toHaveBeenCalled()
  })

  it('owner gate uses (playerId, leagueId, toGameWeek === null) — no cross-league bleed', async () => {
    await updatePlayerLeague({ leagueId: 'league-A', positions: ['CM'] })
    expect(plmFindFirstMock).toHaveBeenCalledWith({
      where: { playerId: 'p-stefan-s', leagueId: 'league-A', toGameWeek: null },
      select: expect.any(Object),
    })
  })
})

describe('updatePlayerLeague — positions write', () => {
  it('validates positions against the membership league ballType (SOCCER)', async () => {
    plmFindFirstMock.mockResolvedValue({
      id: 'plm-1',
      league: { ballType: 'SOCCER' },
      leagueTeam: null,
    })
    // `normalizePositions` keeps input order while deduping; the
    // legacy enum is bucketed from the FIRST entry — so submit-order
    // ['CM', 'CB'] writes positions=['CM','CB'] and legacy=MF.
    await updatePlayerLeague({ leagueId: 'league-A', positions: ['CM', 'CB'] })
    expect(plmUpdateManyMock).toHaveBeenCalledWith({
      where: { playerId: 'p-stefan-s', leagueId: 'league-A', toGameWeek: null },
      data: { positions: ['CM', 'CB'], preferredPositions: ['CM', 'CB'], secondaryPositions: [], position: 'MF' },
    })
  })

  it('rejects soccer codes for a futsal membership', async () => {
    plmFindFirstMock.mockResolvedValue({
      id: 'plm-1',
      league: { ballType: 'FUTSAL' },
      leagueTeam: null,
    })
    await expect(
      updatePlayerLeague({ leagueId: 'league-A', positions: ['CM'] }),
    ).rejects.toThrow(/invalid position/i)
    expect(plmUpdateManyMock).not.toHaveBeenCalled()
  })

  it('accepts FIXO/ALA/PIVOT for a futsal membership and dual-writes legacy bucket', async () => {
    plmFindFirstMock.mockResolvedValue({
      id: 'plm-1',
      league: { ballType: 'FUTSAL' },
      leagueTeam: null,
    })
    await updatePlayerLeague({ leagueId: 'league-A', positions: ['ALA'] })
    expect(plmUpdateManyMock).toHaveBeenCalledWith({
      where: { playerId: 'p-stefan-s', leagueId: 'league-A', toGameWeek: null },
      data: { positions: ['ALA'], preferredPositions: ['ALA'], secondaryPositions: [], position: 'MF' },
    })
  })

  it('empty positions[] clears positions + null legacy', async () => {
    await updatePlayerLeague({ leagueId: 'league-A', positions: [] })
    expect(plmUpdateManyMock).toHaveBeenCalledWith({
      where: { playerId: 'p-stefan-s', leagueId: 'league-A', toGameWeek: null },
      data: { positions: [], preferredPositions: [], secondaryPositions: [], position: null },
    })
  })

  // v1.83.0 — falls through league.ballType when leagueTeam.league
  // exists. Older membership rows may have leagueId NULL but a
  // leagueTeam pointing at a league.
  it('falls back to leagueTeam.league.ballType when membership.league is null', async () => {
    plmFindFirstMock.mockResolvedValue({
      id: 'plm-1',
      league: null,
      leagueTeam: { league: { ballType: 'FUTSAL' } },
    })
    await updatePlayerLeague({ leagueId: 'league-A', positions: ['PIVOT'] })
    expect(plmUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { positions: ['PIVOT'], preferredPositions: ['PIVOT'], secondaryPositions: [], position: 'FW' },
      }),
    )
  })
})

describe('updatePlayerLeague — idShared write', () => {
  it('writes idShared when supplied', async () => {
    await updatePlayerLeague({ leagueId: 'league-A', idShared: false })
    expect(plmUpdateManyMock).toHaveBeenCalledWith({
      where: { playerId: 'p-stefan-s', leagueId: 'league-A', toGameWeek: null },
      data: { idShared: false },
    })
  })

  it('idShared-only update does NOT touch positions/legacy enum', async () => {
    await updatePlayerLeague({ leagueId: 'league-A', idShared: true })
    const call = plmUpdateManyMock.mock.calls[0][0]
    expect(call.data.positions).toBeUndefined()
    expect(call.data.position).toBeUndefined()
  })

  it('combined positions + idShared write hits both columns', async () => {
    await updatePlayerLeague({
      leagueId: 'league-A',
      positions: ['ST'],
      idShared: false,
    })
    expect(plmUpdateManyMock).toHaveBeenCalledWith({
      where: { playerId: 'p-stefan-s', leagueId: 'league-A', toGameWeek: null },
      data: { positions: ['ST'], preferredPositions: ['ST'], secondaryPositions: [], position: 'FW', idShared: false },
    })
  })

  it('no-op (no positions, no idShared) skips the write entirely', async () => {
    await updatePlayerLeague({ leagueId: 'league-A' })
    expect(plmUpdateManyMock).not.toHaveBeenCalled()
    // Still revalidates so the page reflects any concurrent state.
    expect(revalidateMock).toHaveBeenCalledWith({
      domain: 'public',
      paths: ['/account/player'],
    })
  })
})

describe('uploadPlayerProfilePicture — validation', () => {
  function makeFile({
    name = 'pic.jpg',
    type = 'image/jpeg',
    size = 1024,
  }: {
    name?: string
    type?: string
    size?: number
  } = {}): File {
    return new File([new Uint8Array(size)], name, { type })
  }

  it('rejects when no file is supplied', async () => {
    const formData = new FormData()
    await expect(uploadPlayerProfilePicture(formData)).rejects.toThrow(/pick.*image/i)
    expect(putMock).not.toHaveBeenCalled()
  })

  it('rejects an empty file (size 0)', async () => {
    const formData = new FormData()
    formData.append('picture', new File([], 'empty.jpg', { type: 'image/jpeg' }))
    await expect(uploadPlayerProfilePicture(formData)).rejects.toThrow(/pick.*image/i)
    expect(putMock).not.toHaveBeenCalled()
  })

  it('rejects unsupported MIME types (e.g. PDF)', async () => {
    const formData = new FormData()
    formData.append('picture', makeFile({ name: 'doc.pdf', type: 'application/pdf' }))
    await expect(uploadPlayerProfilePicture(formData)).rejects.toThrow(/JPEG.*PNG.*WebP/i)
    expect(putMock).not.toHaveBeenCalled()
  })

  it('rejects files over 5MB', async () => {
    const formData = new FormData()
    formData.append('picture', makeFile({ size: PROFILE_PIC_MAX_BYTES + 1 }))
    await expect(uploadPlayerProfilePicture(formData)).rejects.toThrow(/5MB/i)
    expect(putMock).not.toHaveBeenCalled()
  })

  it('accepts a 5MB file (boundary case)', async () => {
    putMock.mockResolvedValue({ url: 'https://blob/p.jpg' })
    playerFindUniqueMock
      .mockResolvedValueOnce({ id: 'p-stefan-s' })
      .mockResolvedValueOnce({ profilePictureUrl: null })
    const formData = new FormData()
    formData.append('picture', makeFile({ size: PROFILE_PIC_MAX_BYTES }))
    await uploadPlayerProfilePicture(formData)
    expect(putMock).toHaveBeenCalledTimes(1)
  })

  it('throws (does not silently succeed) when BLOB_READ_WRITE_TOKEN is missing', async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN
    const formData = new FormData()
    formData.append('picture', makeFile())
    await expect(uploadPlayerProfilePicture(formData)).rejects.toThrow(
      /currently unavailable/i,
    )
    expect(putMock).not.toHaveBeenCalled()
  })

  it('checks all 3 allowed MIME types render in the constant', () => {
    expect(PROFILE_PIC_ALLOWED_TYPES).toEqual(['image/jpeg', 'image/png', 'image/webp'])
  })
})

describe('uploadPlayerProfilePicture — replace-only behavior', () => {
  function makeFile() {
    return new File([new Uint8Array(8)], 'new.jpg', { type: 'image/jpeg' })
  }

  it('uploads, persists URL, and DELs the prior asset', async () => {
    putMock.mockResolvedValue({ url: 'https://blob/new.jpg' })
    playerFindUniqueMock
      .mockResolvedValueOnce({ id: 'p-stefan-s' })
      .mockResolvedValueOnce({ profilePictureUrl: 'https://blob/old.jpg' })

    const formData = new FormData()
    formData.append('picture', makeFile())
    await uploadPlayerProfilePicture(formData)

    expect(putMock).toHaveBeenCalledTimes(1)
    const putArgs = putMock.mock.calls[0]
    expect(putArgs[0]).toMatch(/^player-profile\/p-stefan-s\//)
    expect(putArgs[2]).toMatchObject({
      access: 'public',
      addRandomSuffix: false,
    })

    expect(playerUpdateMock).toHaveBeenCalledWith({
      where: { id: 'p-stefan-s' },
      data: { profilePictureUrl: 'https://blob/new.jpg' },
    })

    expect(delMock).toHaveBeenCalledWith('https://blob/old.jpg')
  })

  it('does NOT DEL the prior URL when it equals the new URL (rare same-path overwrite)', async () => {
    putMock.mockResolvedValue({ url: 'https://blob/same.jpg' })
    playerFindUniqueMock
      .mockResolvedValueOnce({ id: 'p-stefan-s' })
      .mockResolvedValueOnce({ profilePictureUrl: 'https://blob/same.jpg' })

    const formData = new FormData()
    formData.append('picture', makeFile())
    await uploadPlayerProfilePicture(formData)

    expect(delMock).not.toHaveBeenCalled()
  })

  it('does not throw if the prior DEL fails (best-effort)', async () => {
    putMock.mockResolvedValue({ url: 'https://blob/new.jpg' })
    playerFindUniqueMock
      .mockResolvedValueOnce({ id: 'p-stefan-s' })
      .mockResolvedValueOnce({ profilePictureUrl: 'https://blob/old.jpg' })
    delMock.mockRejectedValue(new Error('blob api 500'))

    const formData = new FormData()
    formData.append('picture', makeFile())
    await expect(uploadPlayerProfilePicture(formData)).resolves.toBeUndefined()
    expect(playerUpdateMock).toHaveBeenCalled()
  })

  it('skips DEL when there is no prior asset', async () => {
    putMock.mockResolvedValue({ url: 'https://blob/new.jpg' })
    playerFindUniqueMock
      .mockResolvedValueOnce({ id: 'p-stefan-s' })
      .mockResolvedValueOnce({ profilePictureUrl: null })

    const formData = new FormData()
    formData.append('picture', makeFile())
    await uploadPlayerProfilePicture(formData)

    expect(delMock).not.toHaveBeenCalled()
  })
})

describe('removePlayerProfilePicture', () => {
  it('clears the column even when BLOB token is missing', async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN
    playerFindUniqueMock
      .mockResolvedValueOnce({ id: 'p-stefan-s' })
      .mockResolvedValueOnce({ profilePictureUrl: 'https://blob/old.jpg' })

    await removePlayerProfilePicture()

    expect(playerUpdateMock).toHaveBeenCalledWith({
      where: { id: 'p-stefan-s' },
      data: { profilePictureUrl: null },
    })
    expect(delMock).not.toHaveBeenCalled()
  })

  it('DELs the prior asset when the token is present', async () => {
    playerFindUniqueMock
      .mockResolvedValueOnce({ id: 'p-stefan-s' })
      .mockResolvedValueOnce({ profilePictureUrl: 'https://blob/old.jpg' })

    await removePlayerProfilePicture()

    expect(delMock).toHaveBeenCalledWith('https://blob/old.jpg')
  })

  it('no-op DEL when there was no prior asset', async () => {
    playerFindUniqueMock
      .mockResolvedValueOnce({ id: 'p-stefan-s' })
      .mockResolvedValueOnce({ profilePictureUrl: null })

    await removePlayerProfilePicture()

    expect(playerUpdateMock).toHaveBeenCalledWith({
      where: { id: 'p-stefan-s' },
      data: { profilePictureUrl: null },
    })
    expect(delMock).not.toHaveBeenCalled()
  })

  it('throws on auth gate failure (admin-credentials with no userId/lineId)', async () => {
    sessionMock.mockResolvedValue({ playerId: null, lineId: '' })
    await expect(removePlayerProfilePicture()).rejects.toThrow(/admin/i)
  })
})
