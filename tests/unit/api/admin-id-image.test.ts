/**
 * v2.2.8 — authenticated proxy for player ID images.
 *
 * Pins the gating contract for the security-hardening fix that closes
 * audit findings C1 (public Blob URL was the only secret), C2 (consent
 * flag was never enforced), and H1 (admin UI rendered bearer URLs).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  getServerSessionMock,
  userFindUniqueMock,
  plmFindFirstMock,
  fetchMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  plmFindFirstMock: vi.fn(),
  fetchMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: userFindUniqueMock },
    playerLeagueMembership: { findFirst: plmFindFirstMock },
  },
}))

globalThis.fetch = fetchMock as unknown as typeof fetch

const { GET } = await import('@/app/api/admin/id-image/[userId]/[side]/route')

function makeParams(userId: string, side: string) {
  return { params: Promise.resolve({ userId, side }) }
}

describe('GET /api/admin/id-image/[userId]/[side]', () => {
  beforeEach(() => {
    getServerSessionMock.mockReset()
    userFindUniqueMock.mockReset()
    plmFindFirstMock.mockReset()
    fetchMock.mockReset()
  })

  it('returns 400 for an invalid side', async () => {
    const req = new Request('http://localhost/api/admin/id-image/u-1/sideways')
    const res = await GET(req as never, makeParams('u-1', 'sideways'))
    expect(res.status).toBe(400)
  })

  it('returns 401 when there is no session', async () => {
    getServerSessionMock.mockResolvedValue(null)
    const req = new Request('http://localhost/api/admin/id-image/u-1/front')
    const res = await GET(req as never, makeParams('u-1', 'front'))
    expect(res.status).toBe(401)
  })

  it('returns 403 when the session is not admin', async () => {
    getServerSessionMock.mockResolvedValue({ isAdmin: false, userId: 'u-other' })
    const req = new Request('http://localhost/api/admin/id-image/u-1/front')
    const res = await GET(req as never, makeParams('u-1', 'front'))
    expect(res.status).toBe(403)
  })

  it('returns 404 when the user does not exist', async () => {
    getServerSessionMock.mockResolvedValue({ isAdmin: true, userId: 'u-admin' })
    userFindUniqueMock.mockResolvedValue(null)
    const req = new Request('http://localhost/api/admin/id-image/u-missing/front')
    const res = await GET(req as never, makeParams('u-missing', 'front'))
    expect(res.status).toBe(404)
  })

  it('returns 404 when the requested side is null on the user record', async () => {
    getServerSessionMock.mockResolvedValue({ isAdmin: true, userId: 'u-admin' })
    userFindUniqueMock.mockResolvedValue({
      idFrontUrl: 'https://blob/front',
      idBackUrl: null,
      playerId: 'p-1',
    })
    const req = new Request('http://localhost/api/admin/id-image/u-1/back')
    const res = await GET(req as never, makeParams('u-1', 'back'))
    expect(res.status).toBe(404)
  })

  it('returns 403 + consent_not_granted when no PLM has idShared=true', async () => {
    getServerSessionMock.mockResolvedValue({ isAdmin: true, userId: 'u-admin' })
    userFindUniqueMock.mockResolvedValue({
      idFrontUrl: 'https://blob/front',
      idBackUrl: 'https://blob/back',
      playerId: 'p-1',
    })
    plmFindFirstMock.mockResolvedValue(null)
    const req = new Request('http://localhost/api/admin/id-image/u-1/front')
    const res = await GET(req as never, makeParams('u-1', 'front'))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('consent_not_granted')
  })

  it('returns 403 + consent_not_granted when the user has no bound player', async () => {
    getServerSessionMock.mockResolvedValue({ isAdmin: true, userId: 'u-admin' })
    userFindUniqueMock.mockResolvedValue({
      idFrontUrl: 'https://blob/front',
      idBackUrl: 'https://blob/back',
      playerId: null,
    })
    const req = new Request('http://localhost/api/admin/id-image/u-1/front')
    const res = await GET(req as never, makeParams('u-1', 'front'))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('consent_not_granted')
  })

  it('returns 200 with bytes + private no-store cache header when consented', async () => {
    getServerSessionMock.mockResolvedValue({ isAdmin: true, userId: 'u-admin' })
    userFindUniqueMock.mockResolvedValue({
      idFrontUrl: 'https://blob/front.jpg',
      idBackUrl: 'https://blob/back.jpg',
      playerId: 'p-1',
    })
    plmFindFirstMock.mockResolvedValue({ id: 'plm-1' })
    const bytes = new Uint8Array([1, 2, 3, 4])
    fetchMock.mockResolvedValue(
      new Response(bytes, {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      }),
    )

    const req = new Request('http://localhost/api/admin/id-image/u-1/front')
    const res = await GET(req as never, makeParams('u-1', 'front'))

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('content-disposition')).toBe('inline')

    expect(fetchMock).toHaveBeenCalledWith('https://blob/front.jpg')
    expect(plmFindFirstMock).toHaveBeenCalledWith({
      where: { playerId: 'p-1', idShared: true },
      select: { id: true },
    })

    const buf = new Uint8Array(await res.arrayBuffer())
    expect(Array.from(buf)).toEqual([1, 2, 3, 4])
  })

  it('returns 502 when Vercel Blob returns a failure', async () => {
    getServerSessionMock.mockResolvedValue({ isAdmin: true, userId: 'u-admin' })
    userFindUniqueMock.mockResolvedValue({
      idFrontUrl: 'https://blob/front.jpg',
      idBackUrl: null,
      playerId: 'p-1',
    })
    plmFindFirstMock.mockResolvedValue({ id: 'plm-1' })
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }))

    const req = new Request('http://localhost/api/admin/id-image/u-1/front')
    const res = await GET(req as never, makeParams('u-1', 'front'))
    expect(res.status).toBe(502)
  })
})
