/**
 * v1.76.1 — ID upload explanatory callout in RegistrationFields.
 *
 * v2.2.9 — copy rewritten by operator. Subheader flipped from "Why we
 * need your ID" to "Share Your ID"; body expanded to three verbatim
 * paragraphs covering motivation, scope, and access control. Structural
 * pins (testid presence, render order before the ID front input) are
 * preserved; the copy assertions track the new wording.
 *
 * Structural tests pinning the contracts:
 *   - `registration-id-callout` testid is present in RegistrationFields.tsx
 *   - Callout renders BEFORE the ID file inputs (order check)
 *   - Exact operator-mandated wording (v2.2.9) is present verbatim
 *   - v1.76.1 copy ("sole purpose of booking" / "Why we need your ID") gone
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const REGISTRATION_FIELDS_PATH = path.resolve(
  __dirname,
  '../../src/components/registration/RegistrationFields.tsx'
)

const src = fs.readFileSync(REGISTRATION_FIELDS_PATH, 'utf-8')

describe('v1.76.1 / v2.2.9 — ID upload callout', () => {
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

  it('callout contains the exact v2.2.9 operator-mandated wording', () => {
    expect(src).toContain(
      'We require your ID strictly to enable more regular league games!'
    )
    expect(src).toContain(
      'we require league members to share your ID with us in order to book more courts.'
    )
    expect(src).toContain(
      'Your ID will only ever be shared to the organizers, and is secured so that no one but the organizers may access your ID.'
    )
  })

  it('callout uses the v2.2.9 "Share Your ID" heading', () => {
    expect(src).toContain('Share Your ID')
  })

  it('legacy sparse copy is removed (regression target)', () => {
    // The old "sole purpose of booking" line must not reappear.
    expect(src).not.toContain('sole purpose of booking')
  })

  it('legacy v1.76.1 heading "Why we need your ID" is removed', () => {
    // v2.2.9 flipped the heading. A future revert would surface here.
    expect(src).not.toContain('Why we need your ID')
  })
})
