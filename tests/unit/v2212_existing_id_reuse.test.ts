/**
 * v2.2.12 regression target for the existing-ID-reuse-with-consent path
 * (item #6 in the v2.2.12 onboarding-polish PR).
 *
 * Source-grep style — pins the load-bearing wiring without invoking
 * Prisma / NextAuth / React DOM. Matches the v2.2.10 / v2.2.11 style.
 *
 * Surfaces covered:
 *   - `RegistrationFields.tsx`: new `hasExistingIds` prop, consent
 *     checkbox path, "Upload new ID instead" affordance, regression
 *     pin that the upload-fields branch is preserved.
 *   - `OnboardingForm.tsx`: threads `hasExistingIds` through and passes
 *     `reuseExistingId` into `completeOnboardingWithId`.
 *   - `onboarding/page.tsx`: selects `idFrontUrl`/`idBackUrl`/
 *     `idUploadedAt`, derives `hasExistingIds`, passes it down.
 *   - `actions.ts#completeOnboardingWithId`: typed `reuseExistingId`,
 *     server-side `hasExistingIds` re-check, ID-validation skip on
 *     reuse path, friendly consent-error on forged reuse, User.update
 *     skips ID columns on reuse, PLM update writes `idShared: true`
 *     on reuse.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..', '..')
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const REG_FIELDS_SRC = read('src/components/registration/RegistrationFields.tsx')
const ONBOARDING_FORM_SRC = read('src/app/join/[code]/onboarding/OnboardingForm.tsx')
const ONBOARDING_PAGE_SRC = read('src/app/join/[code]/onboarding/page.tsx')
const ACTIONS_SRC = read('src/app/join/[code]/actions.ts')

describe('v2.2.12 — RegistrationFields existing-ID reuse path', () => {
  it('declares a hasExistingIds prop with default false', () => {
    expect(REG_FIELDS_SRC).toMatch(/hasExistingIds\?:\s*boolean/)
    expect(REG_FIELDS_SRC).toMatch(/hasExistingIds\s*=\s*false/)
  })

  it('extends RegistrationFieldsSubmit with reuseExistingId: boolean', () => {
    // Type field on the submit payload.
    expect(REG_FIELDS_SRC).toMatch(/reuseExistingId:\s*boolean/)
    // Field passed in the onSubmit call.
    expect(REG_FIELDS_SRC).toMatch(/reuseExistingId:\s*reusing/)
  })

  it('renders the consent checkbox + Upload new affordance on the reuse branch', () => {
    expect(REG_FIELDS_SRC).toContain('data-testid="registration-id-reuse"')
    expect(REG_FIELDS_SRC).toContain('data-testid="registration-id-reuse-consent"')
    expect(REG_FIELDS_SRC).toContain('data-testid="registration-id-upload-new-trigger"')
    expect(REG_FIELDS_SRC).toContain(
      'I consent to share my existing ID with the organizers of this',
    )
    expect(REG_FIELDS_SRC).toContain('Upload new ID instead')
    expect(REG_FIELDS_SRC).toContain(
      'We already have your ID on file from a previous league',
    )
    // JSX uses &apos; for apostrophes — assert the source spelling.
    expect(REG_FIELDS_SRC).toMatch(/Confirm below to share it with this league&apos;s organizers/)
  })

  it('preserves the upload-fields branch (back-compat regression)', () => {
    // The FileFields are still in source — just gated by the reuse-branch
    // conditional. testids match v1.71.1.
    expect(REG_FIELDS_SRC).toContain('testid="registration-id-front"')
    expect(REG_FIELDS_SRC).toContain('testid="registration-id-back"')
  })

  it('exposes a "Use existing ID instead" toggle on the upload branch when hasExistingIds is true', () => {
    expect(REG_FIELDS_SRC).toContain('data-testid="registration-id-use-existing-trigger"')
    expect(REG_FIELDS_SRC).toContain('Use existing ID instead')
  })

  it('blocks submit with a friendly consent error when reusing but checkbox unchecked', () => {
    expect(REG_FIELDS_SRC).toContain(
      "Please confirm consent to share your ID with this league's organizers.",
    )
  })

  it('gates the submit button on the consent checkbox when reusing, else on file presence (v2.2.15: mode-decider shape)', () => {
    // v2.2.15 — gate routed through `sectionMode` (the pure helper's
    // output). Reuse branch: consent checkbox. Other upload branches:
    // both files. External + none: gate is open. Same semantic, new
    // shape — pinning the mode-decider key clause.
    expect(REG_FIELDS_SRC).toMatch(
      /sectionMode === 'reuse-existing' && useExistingId\s*\?\s*consentExistingId\s*:\s*!!\(idFrontFile && idBackFile\)/,
    )
  })

  it('skips file uploads on the reuse branch (defence-in-depth)', () => {
    expect(REG_FIELDS_SRC).toMatch(/const shouldUploadId\s*=\s*!reusing/)
  })
})

describe('v2.2.12 — OnboardingForm threads hasExistingIds + reuseExistingId', () => {
  it('accepts a hasExistingIds prop', () => {
    expect(ONBOARDING_FORM_SRC).toMatch(/hasExistingIds\?:\s*boolean/)
    expect(ONBOARDING_FORM_SRC).toMatch(/hasExistingIds\s*=\s*false/)
  })

  it('passes hasExistingIds into RegistrationFields', () => {
    expect(ONBOARDING_FORM_SRC).toMatch(/hasExistingIds=\{hasExistingIds\}/)
  })

  it('passes input.reuseExistingId into completeOnboardingWithId', () => {
    expect(ONBOARDING_FORM_SRC).toMatch(/reuseExistingId:\s*input\.reuseExistingId/)
  })
})

describe('v2.2.12 — onboarding page selects existing-ID columns', () => {
  it('selects idFrontUrl, idBackUrl, idUploadedAt on the user lookup', () => {
    expect(ONBOARDING_PAGE_SRC).toMatch(/idFrontUrl:\s*true/)
    expect(ONBOARDING_PAGE_SRC).toMatch(/idBackUrl:\s*true/)
    expect(ONBOARDING_PAGE_SRC).toMatch(/idUploadedAt:\s*true/)
  })

  it('derives hasExistingIds from all three columns being set', () => {
    expect(ONBOARDING_PAGE_SRC).toMatch(
      /hasExistingIds\s*=\s*!!\(\s*userRow\?\.idFrontUrl\s*&&\s*userRow\?\.idBackUrl\s*&&\s*userRow\?\.idUploadedAt\s*\)/,
    )
  })

  it('passes hasExistingIds to OnboardingForm', () => {
    expect(ONBOARDING_PAGE_SRC).toMatch(/hasExistingIds=\{hasExistingIds\}/)
  })
})

describe('v2.2.12 — completeOnboardingWithId server-side reuse gate', () => {
  it('types reuseExistingId on the input', () => {
    expect(ACTIONS_SRC).toMatch(/reuseExistingId\?:\s*boolean/)
  })

  it('selects existing-ID columns on the User lookup (both userId + lineId branches)', () => {
    // Two occurrences for the userId branch + the lineId fallback.
    expect((ACTIONS_SRC.match(/idFrontUrl:\s*true/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect((ACTIONS_SRC.match(/idBackUrl:\s*true/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect((ACTIONS_SRC.match(/idUploadedAt:\s*true/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('re-checks hasExistingIds server-side from all three columns', () => {
    expect(ACTIONS_SRC).toMatch(
      /hasExistingIds\s*=\s*!!\(\s*[\s\S]{0,80}user\.idFrontUrl\s*&&\s*user\.idBackUrl\s*&&\s*user\.idUploadedAt\s*\)/,
    )
  })

  it('skips the Blob URL gate when reuseExistingId is true (v2.2.15: priority chain)', () => {
    // v2.2.15 — the gate is now a priority chain that mirrors
    // `selectIdSectionMode()`: reupload-requested wins, external wins
    // over reuse, reuse wins over default. The default `!reuseExistingId`
    // branch still exists but is now inside an `else if`.
    expect(ACTIONS_SRC).toMatch(/idRequired\s*&&\s*!reuseExistingId/)
  })

  it('throws the consent error when reuse is requested but user has no IDs on file', () => {
    expect(ACTIONS_SRC).toMatch(/reuseExistingId\s*&&\s*!hasExistingIds/)
    expect(ACTIONS_SRC).toContain(
      "Please confirm consent to share your ID with this league's organizers.",
    )
  })

  it('skips the User.update id-column write on the reuse path (v2.2.15: shouldWriteIdColumns)', () => {
    // v2.2.15 — the conditional spread on User.update now keys on
    // `shouldWriteIdColumns`, a derived bool that excludes
    // reuse-existing AND external-attestation. The reuse-skip semantic
    // is preserved.
    expect(ACTIONS_SRC).toMatch(/shouldWriteIdColumns/)
    // The derivation must reference both reuseExistingId AND
    // idCollectedExternally as exclusions.
    expect(ACTIONS_SRC).toMatch(
      /shouldWriteIdColumns[\s\S]{0,200}!reuseExistingId/,
    )
    expect(ACTIONS_SRC).toMatch(
      /shouldWriteIdColumns[\s\S]{0,200}!user\.idCollectedExternally/,
    )
  })

  it('writes idShared: true on the PLM update when reusing (v2.2.15: also for external)', () => {
    // v2.2.15 — the idShared write is now also triggered for
    // externally-attested users so the admin proxy's consent gate
    // passes (it then returns 404 `external_id` and the admin UI
    // surfaces "stored externally" instead of a broken image).
    expect(ACTIONS_SRC).toMatch(
      /reuseExistingId\s*\|\|\s*user\.idCollectedExternally[\s\S]{0,80}idShared:\s*true/,
    )
  })
})
