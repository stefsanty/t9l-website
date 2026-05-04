import { describe, it, expect } from 'vitest'
import {
  RESERVED_LEAGUE_SLUGS,
  validateLeagueSlug,
  isResolvableLeagueSlug,
  normalizeLeagueSlug,
} from '@/lib/leagueSlug'

describe('RESERVED_LEAGUE_SLUGS', () => {
  it('contains every existing top-level app/ segment', () => {
    // If a top-level route lives in src/app/, it must be in this set so an
    // admin can never register a league that shadows it. Adding a new
    // top-level route requires updating this set in the same PR.
    const required = [
      'league',
      'admin',
      'auth',
      'auth-error',
      'join',
      'md',
      'matchday',
      'account',
      'api',
      'assign-player',
      'dev-login',
      'schedule',
      'stats',
    ]
    for (const slug of required) {
      expect(RESERVED_LEAGUE_SLUGS.has(slug)).toBe(true)
    }
  })

  it('does NOT contain valid league slugs', () => {
    expect(RESERVED_LEAGUE_SLUGS.has('t9l')).toBe(false)
    expect(RESERVED_LEAGUE_SLUGS.has('tamachi')).toBe(false)
    expect(RESERVED_LEAGUE_SLUGS.has('minato-2025')).toBe(false)
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
    // 'admin' passes format but is reserved.
    expect(validateLeagueSlug('admin')).toEqual({ ok: false, reason: 'reserved' })
    // 'matchday' passes format but is reserved.
    expect(validateLeagueSlug('matchday')).toEqual({ ok: false, reason: 'reserved' })
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
    expect(isResolvableLeagueSlug('admin')).toBe(false)
    expect(isResolvableLeagueSlug('a')).toBe(false)
    expect(isResolvableLeagueSlug('')).toBe(false)
  })
})
