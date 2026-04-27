import { describe, it, expect } from 'vitest'
import { APP_VERSION } from '@/lib/version'

describe('APP_VERSION', () => {
  // Low-cost regression guard. Bumping the version is a deliberate one-line
  // change in src/lib/version.ts; this test forces a matching test update so
  // the bump can't slip in unnoticed (e.g. via accidental find-replace).
  it('is "1.1" — bump intentionally with a matching test update + tag', () => {
    expect(APP_VERSION).toBe('1.1')
  })

  it('is a non-empty string in the expected MAJOR.MINOR shape', () => {
    expect(typeof APP_VERSION).toBe('string')
    expect(APP_VERSION).toMatch(/^\d+\.\d+(\.\d+)?$/)
  })
})
