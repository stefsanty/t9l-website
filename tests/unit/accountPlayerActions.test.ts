/**
 * v1.37.0 (PR ι) — server actions for /account/player.
 *
 * Three actions:
 *   1. updatePlayerSelf — name + position + preferences
 *   2. uploadPlayerProfilePicture — file → Blob → Player.profilePictureUrl
 *   3. removePlayerProfilePicture — clear column + DEL Blob
 *
 * Pin:
 *   - Auth gate: no session → throws; admin-credentials session (no
 *     userId AND no lineId) → throws. v1.59.1: LINE-only sessions
 *     (lineId present, userId absent — pre-v1.28.0 grandfathered
 *     sessions OR LINE-auth admins) are NOT rejected.
 *   - Owner gate (v1.59.1): resolves Player by `userId @unique` first,
 *     falling back to `lineId @unique`. Throws if neither resolves.
 *   - File validation: MIME (jpeg/png/webp), size (≤5MB).
 *   - Blob token gate: upload throws when BLOB_READ_WRITE_TOKEN missing.
 *   - Replace-only: prior URL is DEL'd after successful new put.
 *   - Validation: name required, ≤100 chars; position enum or null.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  playerFindUniqueMock,
  playerUpdateMock,
  revalidateMock,
  putMock,
  delMock,
  sessionMock,
} = vi.hoisted(() => ({
  playerFindUniqueMock: vi.fn(),
  playerUpdateMock: vi.fn().mockResolvedValue({}),
  revalidateMock: vi.fn(),
  putMock: vi.fn(),
  delMock: vi.fn(),
  sessionMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    player: { findUnique: playerFindUniqueMock, update: playerUpdateMock },
  },
}))
vi.mock('@/lib/revalidate', () => ({ revalidate: revalidateMock }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@vercel/blob', () => ({
  put: putMock,
  del: delMock,
}))

import {
  updatePlayerSelf,
  uploadPlayerProfilePicture,
  removePlayerProfilePicture,
} from '@/app/account/player/actions'
// v1.59.2 — constants moved to a non-`'use server'` module so client
// imports get the real values; see validation.ts.
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
})

afterEach(() => {
  if (ORIG_BLOB_TOKEN === undefined) delete process.env.BLOB_READ_WRITE_TOKEN
  else process.env.BLOB_READ_WRITE_TOKEN = ORIG_BLOB_TOKEN
})

import { afterEach } from 'vitest'

describe('updatePlayerSelf — auth gates', () => {
  it('throws when there is no session', async () => {
    sessionMock.mockResolvedValue(null)
    await expect(updatePlayerSelf({ name: 'Stefan' })).rejects.toThrow(/sign in/i)
    expect(playerUpdateMock).not.toHaveBeenCalled()
  })

  it('throws when admin-credentials session has no userId AND no lineId', async () => {
    sessionMock.mockResolvedValue({ playerId: null, lineId: '' })
    await expect(updatePlayerSelf({ name: 'Stefan' })).rejects.toThrow(/admin/i)
    expect(playerUpdateMock).not.toHaveBeenCalled()
  })

  it("throws when neither userId nor lineId resolves a Player", async () => {
    sessionMock.mockResolvedValue({ userId: 'u-1', lineId: 'L-1' })
    playerFindUniqueMock.mockResolvedValue(null)
    await expect(updatePlayerSelf({ name: 'Stefan' })).rejects.toThrow(/no player/i)
    expect(playerUpdateMock).not.toHaveBeenCalled()
  })

  // v1.59.1 — pre-v1.28.0 LINE sessions (and LINE-auth admins like
  // Stefan S) have lineId set but no userId. They MUST be allowed in,
  // resolving the Player via the lineId fallback.
  it('v1.59.1 — accepts LINE-only session (no userId, has lineId) and resolves Player via lineId fallback', async () => {
    sessionMock.mockResolvedValue({ userId: null, lineId: 'L-stefan' })
    // First findUnique (where: { userId }) is skipped because userId is null.
    // Fallback findUnique (where: { lineId }) returns the player.
    playerFindUniqueMock.mockResolvedValueOnce({ id: 'p-stefan-s' })
    await updatePlayerSelf({ name: 'Stefan S' })
    // Verify the lookup was by lineId, not userId
    expect(playerFindUniqueMock).toHaveBeenCalledWith({
      where: { lineId: 'L-stefan' },
      select: { id: true },
    })
    expect(playerUpdateMock).toHaveBeenCalledWith({
      where: { id: 'p-stefan-s' },
      data: expect.objectContaining({ name: 'Stefan S' }),
    })
  })

  // v1.59.1 — userId-first preference: when both are present, userId
  // resolves first. lineId is the fallback only.
  it('v1.59.1 — prefers userId lookup when both userId and lineId are present', async () => {
    sessionMock.mockResolvedValue({ userId: 'u-1', lineId: 'L-1' })
    playerFindUniqueMock.mockResolvedValueOnce({ id: 'p-stefan-s' })
    await updatePlayerSelf({ name: 'Stefan' })
    expect(playerFindUniqueMock).toHaveBeenCalledTimes(1)
    expect(playerFindUniqueMock).toHaveBeenCalledWith({
      where: { userId: 'u-1' },
      select: { id: true },
    })
  })

  // v1.59.1 — drift case: session has userId but Player.userId column
  // isn't populated (e.g. v1.29.0 backfill missed this row). Falls
  // through to lineId.
  it('v1.59.1 — falls back to lineId when userId lookup misses', async () => {
    sessionMock.mockResolvedValue({ userId: 'u-1', lineId: 'L-stefan' })
    playerFindUniqueMock
      .mockResolvedValueOnce(null) // userId miss
      .mockResolvedValueOnce({ id: 'p-stefan-s' }) // lineId hit
    await updatePlayerSelf({ name: 'Stefan S' })
    expect(playerFindUniqueMock).toHaveBeenCalledTimes(2)
    expect(playerFindUniqueMock).toHaveBeenNthCalledWith(1, {
      where: { userId: 'u-1' },
      select: { id: true },
    })
    expect(playerFindUniqueMock).toHaveBeenNthCalledWith(2, {
      where: { lineId: 'L-stefan' },
      select: { id: true },
    })
  })
})

describe('updatePlayerSelf — validation', () => {
  it('rejects empty name', async () => {
    await expect(updatePlayerSelf({ name: '   ' })).rejects.toThrow(/required/i)
    expect(playerUpdateMock).not.toHaveBeenCalled()
  })

  it('rejects names over 100 chars', async () => {
    await expect(updatePlayerSelf({ name: 'x'.repeat(101) })).rejects.toThrow(/100/)
    expect(playerUpdateMock).not.toHaveBeenCalled()
  })

  it('trims name and writes Prisma update', async () => {
    await updatePlayerSelf({ name: '  Stefan S  ', position: 'MF' })
    expect(playerUpdateMock).toHaveBeenCalledWith({
      where: { id: 'p-stefan-s' },
      data: expect.objectContaining({
        name: 'Stefan S',
        position: 'MF',
      }),
    })
  })

  it('persists preferences as JSON shape', async () => {
    await updatePlayerSelf({
      name: 'Stefan',
      preferredLeagueTeamId: 'lt-1',
      preferredTeammateIds: ['p-a', 'p-b'],
      preferredTeammatesFreeText: 'Riki',
    })
    const call = playerUpdateMock.mock.calls[0][0]
    expect(call.data.onboardingPreferences).toEqual({
      preferredLeagueTeamId: 'lt-1',
      preferredTeammateIds: ['p-a', 'p-b'],
      preferredTeammatesFreeText: 'Riki',
    })
  })

  it('treats empty position string as null', async () => {
    await updatePlayerSelf({ name: 'Stefan', position: null })
    const call = playerUpdateMock.mock.calls[0][0]
    expect(call.data.position).toBeNull()
  })

  it("revalidates the public domain so dashboard reflects the new name", async () => {
    await updatePlayerSelf({ name: 'Stefan' })
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
      .mockResolvedValueOnce({ id: 'p-stefan-s' }) // resolveOwnedPlayerId
      .mockResolvedValueOnce({ profilePictureUrl: 'https://blob/old.jpg' }) // prior

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
    expect(playerUpdateMock).toHaveBeenCalled() // column still updated
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
