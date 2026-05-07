/**
 * v1.76.1 — ID upload explanatory callout in RegistrationFields.
 *
 * Structural tests pinning the v1.76.1 contracts:
 *   - `registration-id-callout` testid is present in RegistrationFields.tsx
 *   - Callout renders BEFORE the ID file inputs (order check)
 *   - Exact operator-mandated wording is present verbatim
 *   - Legacy sparse copy ("sole purpose of booking") is removed
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const REGISTRATION_FIELDS_PATH = path.resolve(
  __dirname,
  '../../src/components/registration/RegistrationFields.tsx'
)

const src = fs.readFileSync(REGISTRATION_FIELDS_PATH, 'utf-8')

describe('v1.76.1 — ID upload callout', () => {
  it('registration-id-callout testid exists in RegistrationFields', () => {
    expect(src).toContain('data-testid="registration-id-callout"')
  })

  it('callout appears before the front-of-ID file input (order check)', () => {
    const calloutIdx = src.indexOf('data-testid="registration-id-callout"')
    // FileField receives testid as a prop (not data-testid directly on the element)
    const idFrontIdx = src.indexOf('testid="registration-id-front"')
    expect(calloutIdx).toBeGreaterThan(-1)
    expect(idFrontIdx).toBeGreaterThan(-1)
    expect(calloutIdx).toBeLessThan(idFrontIdx)
  })

  it('callout contains the exact operator-mandated wording', () => {
    expect(src).toContain(
      'We need these IDs to be able to book more courts.'
    )
    expect(src).toContain(
      'We will only ever use your ID'
    )
    expect(src).toContain(
      'to book courts in order to host more games.'
    )
    expect(src).toContain(
      'We require all league members to'
    )
    expect(src).toContain(
      'acknowledge this and submit their ID to join the league.'
    )
  })

  it('legacy sparse copy is removed (regression target)', () => {
    // The old line "for the sole purpose of booking more courts" must not reappear.
    expect(src).not.toContain('sole purpose of booking')
  })

  it('callout has the "Why we need your ID" heading', () => {
    expect(src).toContain('Why we need your ID')
  })
})
