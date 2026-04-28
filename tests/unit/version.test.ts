import { describe, it, expect } from 'vitest'
import { APP_VERSION } from '@/lib/version'

describe('APP_VERSION', () => {
  // Per CLAUDE.md "Version-bump rule" — every PR bumps APP_VERSION.
  // This test pins the current value, so bumping requires a matching test
  // edit. That's the point: it forces the bump to be deliberate, not a
  // find-replace artifact.
  it('matches the current release pinned in CLAUDE.md', () => {
    expect(APP_VERSION).toBe('1.5.0')
  })

  it('is a non-empty string in semver MAJOR.MINOR.PATCH shape', () => {
    expect(typeof APP_VERSION).toBe('string')
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
