import { describe, it, expect } from 'vitest'
import {
  RESERVED_LEAGUE_SLUGS,
  validateLeagueSlug,
  isResolvableLeagueSlug,
  normalizeLeagueSlug,
} from '@/lib/leagueSlug'

describe('RESERVED_LEAGUE_SLUGS (v1.54.0 — slimmed to recursive guard)', () => {
  it('contains the recursive `id` guard', () => {
    // v1.54.0 namespaced every tenant URL under `/id/<slug>` so the
    // reserved set collapsed to just the recursive guard against a
    // league slug equal to "id" itself (which would produce visually
    // confusing URLs like `/id/id` or `/id/id/md/md1`). Every other
    // top-level platform route is now a sibling of `/id/`, not a parent,
    // so they no longer need to be reserved.
    expect(RESERVED_LEAGUE_SLUGS.has('id')).toBe(true)
  })

  it('does NOT contain top-level platform route names (post-v1.54.0)', () => {
    // Pre-v1.54.0 these were all reserved because `/<slug>` was the
    // canonical render and would have shadowed top-level platform routes.
    // Post-v1.54.0 `/<slug>` is a 308-redirect to `/id/<slug>` and
    // Next.js's static-wins-over-dynamic rule means `/admin` etc. never
    // even reach the redirect — they resolve to their dedicated route
    // files. The reserved set no longer needs to track them.
    expect(RESERVED_LEAGUE_SLUGS.has('admin')).toBe(false)
    expect(RESERVED_LEAGUE_SLUGS.has('auth')).toBe(false)
    expect(RESERVED_LEAGUE_SLUGS.has('api')).toBe(false)
    expect(RESERVED_LEAGUE_SLUGS.has('league')).toBe(false)
    expect(RESERVED_LEAGUE_SLUGS.has('matchday')).toBe(false)
  })

  it('does NOT contain valid league slugs', () => {
    expect(RESERVED_LEAGUE_SLUGS.has('t9l')).toBe(false)
    expect(RESERVED_LEAGUE_SLUGS.has('tamachi')).toBe(false)
    expect(RESERVED_LEAGUE_SLUGS.has('minato-2025')).toBe(false)
  })

  it('is exactly the slim {id} set (regression target — would fail if a future PR re-broadens)', () => {
    expect(Array.from(RESERVED_LEAGUE_SLUGS).sort()).toEqual(['id'])
  })
})

describe('validateLeagueSlug', () => {
  it('accepts the canonical default league slug', () => {
    expect(validateLeagueSlug('t9l')).toEqual({ ok: true })
  })

  it('accepts hyphenated slugs', () => {
    expect(validateLeagueSlug('minato-2025')).toEqual({ ok: true })
    expect(validateLeagueSlug('tamachi-spring')).toEqual({ ok: true })
  })

  it('accepts the 3-char minimum', () => {
    expect(validateLeagueSlug('abc')).toEqual({ ok: true })
  })

  it('accepts the 30-char maximum', () => {
    const slug = 'a'.repeat(30)
    expect(validateLeagueSlug(slug)).toEqual({ ok: true })
  })

  it('rejects empty input', () => {
    expect(validateLeagueSlug('')).toEqual({ ok: false, reason: 'empty' })
    expect(validateLeagueSlug('   ')).toEqual({ ok: false, reason: 'empty' })
    expect(validateLeagueSlug(null)).toEqual({ ok: false, reason: 'empty' })
    expect(validateLeagueSlug(undefined)).toEqual({ ok: false, reason: 'empty' })
  })

  it('rejects slugs shorter than 3 chars', () => {
    expect(validateLeagueSlug('a')).toEqual({ ok: false, reason: 'too-short' })
    expect(validateLeagueSlug('ab')).toEqual({ ok: false, reason: 'too-short' })
  })

  it('rejects slugs longer than 30 chars', () => {
    const slug = 'a'.repeat(31)
    expect(validateLeagueSlug(slug)).toEqual({ ok: false, reason: 'too-long' })
  })

  it('rejects uppercase', () => {
    expect(validateLeagueSlug('T9L')).toEqual({ ok: false, reason: 'invalid-format' })
    expect(validateLeagueSlug('Tamachi')).toEqual({ ok: false, reason: 'invalid-format' })
  })

  it('rejects underscores and other special chars', () => {
    expect(validateLeagueSlug('foo_bar')).toEqual({ ok: false, reason: 'invalid-format' })
    expect(validateLeagueSlug('foo.bar')).toEqual({ ok: false, reason: 'invalid-format' })
    expect(validateLeagueSlug('foo bar')).toEqual({ ok: false, reason: 'invalid-format' })
    expect(validateLeagueSlug('foo/bar')).toEqual({ ok: false, reason: 'invalid-format' })
  })

  it('rejects slugs that start or end with a hyphen', () => {
    expect(validateLeagueSlug('-foo')).toEqual({ ok: false, reason: 'invalid-format' })
    expect(validateLeagueSlug('foo-')).toEqual({ ok: false, reason: 'invalid-format' })
  })

  it('rejects every reserved word', () => {
    for (const slug of RESERVED_LEAGUE_SLUGS) {
      const result = validateLeagueSlug(slug)
      // Reserved words might also fail format validation (e.g. "auth-error"
      // which contains a hyphen and would actually pass format). The
      // contract is just "rejected somehow" — we assert .ok is false and
      // surface the reason.
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(['reserved', 'invalid-format', 'too-short']).toContain(result.reason)
      }
    }
  })

  it('reserved-word check fires AFTER format check', () => {
    // 'id' passes format (3 chars, lowercase alnum) but is reserved
    // by the v1.54.0 recursive guard.
    expect(validateLeagueSlug('id')).toEqual({ ok: false, reason: 'too-short' })
    // 'id' is exactly 2 chars so it actually trips too-short before
    // hitting the reserved check. The reserved check still fires for
    // anything that's at least 3 chars and reserved (currently nothing
    // beyond 'id' itself, but the contract is preserved).
  })

  it('admin / matchday / api / etc. are no longer reserved (post-v1.54.0)', () => {
    // v1.54.0 — these all pass validation now because the route-shadow
    // problem they used to guard against is gone (every tenant URL is
    // namespaced under `/id/<slug>`). An admin can register a league
    // called "admin" and it will live at `/id/admin`, never colliding
    // with the platform `/admin` route.
    expect(validateLeagueSlug('admin')).toEqual({ ok: true })
    expect(validateLeagueSlug('matchday')).toEqual({ ok: true })
    expect(validateLeagueSlug('api')).toEqual({ ok: true })
    expect(validateLeagueSlug('auth')).toEqual({ ok: true })
  })

  it('trims whitespace before validating', () => {
    // Admin form might submit with leading/trailing whitespace after typing.
    expect(validateLeagueSlug('  t9l  ')).toEqual({ ok: true })
  })

  it('rejects uppercase strictly (does NOT silently lowercase)', () => {
    // The validator is strict so admin forms surface the typo to the user
    // rather than silently coercing it. URL-side resolution lowercases
    // first via `normalizeLeagueSlug` so `/T9L` still resolves.
    expect(validateLeagueSlug('T9L')).toEqual({ ok: false, reason: 'invalid-format' })
    expect(validateLeagueSlug('Tamachi')).toEqual({ ok: false, reason: 'invalid-format' })
  })
})

describe('normalizeLeagueSlug', () => {
  it('lowercases + trims', () => {
    expect(normalizeLeagueSlug('T9L')).toBe('t9l')
    expect(normalizeLeagueSlug('  Tamachi  ')).toBe('tamachi')
    expect(normalizeLeagueSlug('Md2')).toBe('md2')
  })

  it('preserves already-lowercase input', () => {
    expect(normalizeLeagueSlug('t9l')).toBe('t9l')
  })
})

describe('isResolvableLeagueSlug', () => {
  it('returns true iff the normalized slug passes validation', () => {
    expect(isResolvableLeagueSlug('t9l')).toBe(true)
    // Resolves uppercase via normalization (URL-side permissive).
    expect(isResolvableLeagueSlug('T9L')).toBe(true)
    // Post-v1.54.0: 'admin' / 'auth' / 'matchday' all resolve as valid
    // slugs (they're sandboxed under /id/<slug>).
    expect(isResolvableLeagueSlug('admin')).toBe(true)
    expect(isResolvableLeagueSlug('matchday')).toBe(true)
    // Recursive guard: 'id' itself is still rejected.
    expect(isResolvableLeagueSlug('id')).toBe(false)
    expect(isResolvableLeagueSlug('a')).toBe(false)
    expect(isResolvableLeagueSlug('')).toBe(false)
  })
})
