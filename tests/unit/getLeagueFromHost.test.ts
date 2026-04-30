import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * v1.22.0 — `getLeagueIdFromRequest` resolves the active League.id from the
 * request's Host header. Pre-v1.22.0 the RSVP route hardcoded the default
 * league id, silently mis-routing any subdomain RSVP to the default league's
 * GameWeeks. This is the regression target.
 *
 * Three branches:
 *   - subdomain matches a League → that League's id
 *   - apex / dev base / localhost / vercel.app → default league id
 *   - subdomain present but unknown → null (caller rejects with 404)
 */

const { headersMock, leagueFindUniqueMock, leagueFindFirstMock } = vi.hoisted(() => ({
  headersMock: vi.fn(),
  leagueFindUniqueMock: vi.fn(),
  leagueFindFirstMock: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: headersMock,
}))

vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: leagueFindUniqueMock,
      findFirst: leagueFindFirstMock,
    },
  },
}))

import { extractSubdomain, getLeagueIdFromRequest } from '@/lib/getLeagueFromHost'

function mockHost(host: string) {
  headersMock.mockResolvedValue({
    get: (name: string) => (name.toLowerCase() === 'host' ? host : null),
  })
}

beforeEach(() => {
  // Use mockReset (not clearAllMocks) so any per-test mockResolvedValue or
  // mockResolvedValueOnce queue is fully cleared, preventing leftover
  // implementations from leaking across tests.
  headersMock.mockReset()
  leagueFindUniqueMock.mockReset()
  leagueFindFirstMock.mockReset()
})

describe('extractSubdomain — pure host parsing', () => {
  it('returns null for production apex (t9l.me)', () => {
    expect(extractSubdomain('t9l.me')).toBeNull()
  })

  it('returns null for dev base (dev.t9l.me — "dev" is reserved infra)', () => {
    expect(extractSubdomain('dev.t9l.me')).toBeNull()
  })

  it('returns null for www.t9l.me (also reserved infra)', () => {
    expect(extractSubdomain('www.t9l.me')).toBeNull()
  })

  it('returns the subdomain for a production subdomain (tamachi.t9l.me)', () => {
    expect(extractSubdomain('tamachi.t9l.me')).toBe('tamachi')
  })

  it('returns the subdomain for a dev subdomain (test.dev.t9l.me)', () => {
    expect(extractSubdomain('test.dev.t9l.me')).toBe('test')
  })

  it('returns null for localhost', () => {
    expect(extractSubdomain('localhost')).toBeNull()
  })

  it('returns null for Vercel preview hosts (do not treat hash as a subdomain)', () => {
    expect(extractSubdomain('t9l-website-abc123-t9l-app.vercel.app')).toBeNull()
  })
})

describe('getLeagueIdFromRequest — request → leagueId resolution', () => {
  it('returns the matching League.id when the subdomain resolves (tamachi.t9l.me)', async () => {
    mockHost('tamachi.t9l.me')
    leagueFindUniqueMock.mockResolvedValue({ id: 'l-tamachi-2026' })

    const id = await getLeagueIdFromRequest()

    expect(id).toBe('l-tamachi-2026')
    expect(leagueFindUniqueMock).toHaveBeenCalledWith({
      where: { subdomain: 'tamachi' },
      select: { id: true },
    })
    // Default league lookup must NOT happen when subdomain resolves — that
    // would be silent fallback to the wrong league.
    expect(leagueFindFirstMock).not.toHaveBeenCalled()
  })

  it('returns the default League.id at apex (t9l.me) — apex is the default league', async () => {
    mockHost('t9l.me')
    leagueFindFirstMock.mockResolvedValue({ id: 'l-minato-2025' })

    const id = await getLeagueIdFromRequest()

    expect(id).toBe('l-minato-2025')
    expect(leagueFindFirstMock).toHaveBeenCalledWith({
      where: { isDefault: true },
      select: { id: true },
    })
    // No subdomain → no per-subdomain query.
    expect(leagueFindUniqueMock).not.toHaveBeenCalled()
  })

  it('returns the default League.id on dev base (dev.t9l.me)', async () => {
    mockHost('dev.t9l.me')
    leagueFindFirstMock.mockResolvedValue({ id: 'l-minato-2025' })

    const id = await getLeagueIdFromRequest()

    expect(id).toBe('l-minato-2025')
    expect(leagueFindUniqueMock).not.toHaveBeenCalled()
  })

  it('returns the default League.id for Vercel preview hosts', async () => {
    mockHost('t9l-website-abc123-t9l-app.vercel.app')
    leagueFindFirstMock.mockResolvedValue({ id: 'l-minato-2025' })

    const id = await getLeagueIdFromRequest()

    expect(id).toBe('l-minato-2025')
  })

  it('returns null when the subdomain is present but does not match any League', async () => {
    mockHost('unknown.t9l.me')
    leagueFindUniqueMock.mockResolvedValue(null)

    const id = await getLeagueIdFromRequest()

    expect(id).toBeNull()
    // Critical: do NOT silently fall back to default league for an unknown
    // subdomain. That would let a misconfigured DNS or typo-squat write to
    // the default league's GameWeeks. Caller (RSVP route) returns 404.
    expect(leagueFindFirstMock).not.toHaveBeenCalled()
  })

  it('returns null when no default league exists at apex (catastrophic config)', async () => {
    mockHost('t9l.me')
    leagueFindFirstMock.mockResolvedValue(null)

    const id = await getLeagueIdFromRequest()

    expect(id).toBeNull()
  })

  it('strips the port from the host before parsing (localhost:3000 → null subdomain)', async () => {
    mockHost('localhost:3000')
    leagueFindFirstMock.mockResolvedValue({ id: 'l-minato-2025' })

    const id = await getLeagueIdFromRequest()

    expect(id).toBe('l-minato-2025')
    expect(leagueFindUniqueMock).not.toHaveBeenCalled()
  })

  it('handles missing Host header gracefully (returns default league)', async () => {
    headersMock.mockResolvedValue({
      get: () => null,
    })
    leagueFindFirstMock.mockResolvedValue({ id: 'l-minato-2025' })

    const id = await getLeagueIdFromRequest()

    expect(id).toBe('l-minato-2025')
  })

  it('reserved subdomain "www.t9l.me" routes to default league (treated as apex)', async () => {
    mockHost('www.t9l.me')
    leagueFindFirstMock.mockResolvedValue({ id: 'l-minato-2025' })

    const id = await getLeagueIdFromRequest()

    expect(id).toBe('l-minato-2025')
    expect(leagueFindUniqueMock).not.toHaveBeenCalled()
  })
})
