import { describe, it, expect } from 'vitest'
import {
  SETTING_ID_IDENTITY_READ_SOURCE,
  resolveIdentityReadSource,
} from '@/lib/settings'

describe('resolveIdentityReadSource (v1.30.0 stage γ)', () => {
  // The flag-flip happens via PR #5 (operator-driven, not yet shipped).
  // γ ships with the code in place but inert — default 'legacy' preserves
  // the v1.5.0 read path until an operator flips it on prod.
  it("returns 'legacy' when the Setting value is missing", () => {
    expect(resolveIdentityReadSource(null)).toBe('legacy')
    expect(resolveIdentityReadSource(undefined)).toBe('legacy')
  })

  it("returns 'legacy' when the value is unrecognized", () => {
    expect(resolveIdentityReadSource('')).toBe('legacy')
    expect(resolveIdentityReadSource('USER')).toBe('legacy')
    expect(resolveIdentityReadSource('newpath')).toBe('legacy')
  })

  it("returns 'user' only on the explicit 'user' value", () => {
    expect(resolveIdentityReadSource('user')).toBe('user')
  })

  it("returns 'legacy' on the explicit 'legacy' value", () => {
    expect(resolveIdentityReadSource('legacy')).toBe('legacy')
  })

  it('exports a stable Setting id for the flag', () => {
    expect(SETTING_ID_IDENTITY_READ_SOURCE).toBe('s-identity-readSource-global')
    expect(SETTING_ID_IDENTITY_READ_SOURCE).toBe(SETTING_ID_IDENTITY_READ_SOURCE)
  })
})
