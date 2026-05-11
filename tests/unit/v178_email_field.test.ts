/**
 * v1.78.0 — Required email field on the registration form.
 *
 * Pins every contract the PR introduces:
 *   - Schema: `User.email` exists with `@unique`; `Player` has no email column.
 *   - `RegistrationFieldsSubmit` shape carries `email: string`.
 *   - `RegistrationFields` renders an email input with the right attributes.
 *   - `RegistrationFields` accepts and pre-fills `initialEmail`.
 *   - `RegisterToLeagueInput` declares `email: string`.
 *   - `CompleteOnboardingWithIdInput` declares `email: string`.
 *   - Both server actions validate email (empty / malformed / >254 chars).
 *   - Both server actions only write `User.email` when the row's email is null
 *     (no silent overwrite of a verified address).
 *   - Both server actions catch Prisma `P2002` and surface a friendly error.
 *   - The recruit page selects `email` + `emailVerified` and threads
 *     `initialEmail` only when the existing email is verified.
 *   - The join onboarding page does the same.
 *   - `RegistrationForm` and `OnboardingForm` thread `initialEmail`
 *     through to `RegistrationFields`, and pass `email` to the action.
 *   - `applyToLeague` (State D modal) does NOT take an email arg
 *     (regression target — the brief scoped the field to the recruit + onboarding forms).
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

function read(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}

const REG_FIELDS = read('src/components/registration/RegistrationFields.tsx')
const RECRUIT_ACTIONS = read('src/app/api/recruiting/actions.ts')
const JOIN_ACTIONS = read('src/app/join/[code]/actions.ts')
const RECRUIT_PAGE = read('src/app/recruit/[slug]/page.tsx')
const RECRUIT_FORM = read('src/app/recruit/[slug]/RegistrationForm.tsx')
const JOIN_PAGE = read('src/app/join/[code]/onboarding/page.tsx')
const JOIN_FORM = read('src/app/join/[code]/onboarding/OnboardingForm.tsx')
const SCHEMA = read('prisma/schema.prisma')

// Slice helper — extract the `registerToLeague` body for narrower asserts.
const REGISTER_FN =
  RECRUIT_ACTIONS.split('export async function registerToLeague')[1]?.split(
    '\nfunction isOwnedBlobUrl',
  )[0] ?? ''

const COMPLETE_ONBOARDING_FN =
  JOIN_ACTIONS.split('export async function completeOnboardingWithId')[1]?.split(
    '\nfunction isOwnedBlobUrl',
  )[0] ?? ''

const APPLY_TO_LEAGUE_FN =
  RECRUIT_ACTIONS.split('export async function applyToLeague')[1]?.split(
    '\nexport async function ',
  )[0] ?? ''

describe('v1.78.0 — Schema sanity (no migration; relies on existing User.email)', () => {
  it('User.email is declared and @unique', () => {
    // Allow whitespace between the field name, type, and modifiers.
    expect(SCHEMA).toMatch(/email\s+String\?\s+@unique/)
  })

  it('Player has no email column (regression target — identity lives on User)', () => {
    // Slice out the Player model block and assert no `email` field declaration in it.
    const playerBlock = SCHEMA.split('model Player {')[1]?.split('\nmodel ')[0] ?? ''
    expect(playerBlock).not.toMatch(/\n\s*email\s+String/)
  })
})

describe('v1.78.0 — RegistrationFields component', () => {
  it('RegistrationFieldsSubmit declares email: string', () => {
    expect(REG_FIELDS).toMatch(
      /export interface RegistrationFieldsSubmit\s*\{[^}]*email:\s*string/,
    )
  })

  it('RegistrationFieldsProps declares initialEmail?: string', () => {
    expect(REG_FIELDS).toMatch(/initialEmail\?:\s*string/)
  })

  it('renders an email input with data-testid="registration-email"', () => {
    expect(REG_FIELDS).toContain('data-testid="registration-email"')
  })

  it('email input is type="email", required, autoComplete="email"', () => {
    // Pull the block from `data-testid="registration-email"` upward.
    const idx = REG_FIELDS.indexOf('data-testid="registration-email"')
    const start = REG_FIELDS.lastIndexOf('<input', idx)
    const block = REG_FIELDS.slice(start, idx + 'data-testid="registration-email"'.length)
    expect(block).toMatch(/type="email"/)
    expect(block).toMatch(/\brequired\b/)
    expect(block).toMatch(/autoComplete="email"/)
  })

  it('email input has a maxLength bounded to 254 (RFC 5321 mailbox max)', () => {
    expect(REG_FIELDS).toMatch(/EMAIL_MAX_LENGTH\s*=\s*254/)
  })

  it('handleSubmit validates trimmed email is non-empty / matches regex / under max length', () => {
    expect(REG_FIELDS).toMatch(/Email is required/)
    expect(REG_FIELDS).toMatch(/Please enter a valid email address/)
    expect(REG_FIELDS).toMatch(/Email is too long/)
  })

  it('email is included in the onSubmit payload (lowercased + trimmed)', () => {
    // The `await onSubmit({ ... email: trimmedEmail, ... })` block should appear.
    expect(REG_FIELDS).toMatch(/await onSubmit\(\{[\s\S]*email:\s*trimmedEmail/)
  })

  it('email field renders BEFORE the preferred-position picker (order check)', () => {
    const emailIdx = REG_FIELDS.indexOf('data-testid="registration-email"')
    // v1.82.0 — Position dropdown replaced with the chip PositionMultiSelect.
    // v1.93.0 — split into preferred + secondary; preferred renders first.
    const positionIdx = REG_FIELDS.indexOf('testIdPrefix="registration-preferred"')
    expect(emailIdx).toBeGreaterThan(-1)
    expect(positionIdx).toBeGreaterThan(-1)
    expect(emailIdx).toBeLessThan(positionIdx)
  })

  it('email state is initialized from initialEmail prop', () => {
    expect(REG_FIELDS).toMatch(/useState\(initialEmail\)/)
  })

  it('submit button stays disabled when email is empty', () => {
    // submitDisabled depends on email.trim()
    expect(REG_FIELDS).toMatch(/submitDisabled\s*=[\s\S]*?!email\.trim\(\)/)
  })
})

describe('v1.78.0 — registerToLeague server action', () => {
  it('RegisterToLeagueInput declares email: string', () => {
    expect(RECRUIT_ACTIONS).toMatch(
      /export interface RegisterToLeagueInput\s*\{[^}]*email:\s*string/,
    )
  })

  it('rejects empty email', () => {
    expect(REGISTER_FN).toMatch(/Email is required/)
  })

  it('rejects malformed email (regex check)', () => {
    expect(REGISTER_FN).toMatch(/Please enter a valid email address/)
    // Confirm the regex actually exists upstream in the file.
    expect(RECRUIT_ACTIONS).toMatch(/EMAIL_REGEX\s*=\s*\/\^\[\^\\s@\]\+@/)
  })

  it('rejects email >254 chars', () => {
    expect(REGISTER_FN).toMatch(/Email is too long/)
    expect(RECRUIT_ACTIONS).toMatch(/EMAIL_MAX_LENGTH\s*=\s*254/)
  })

  it('lowercases + trims the email before storage', () => {
    expect(REGISTER_FN).toMatch(/input\.email\.trim\(\)\.toLowerCase\(\)/)
  })

  it('selects email from prisma.user.findUnique (so the conditional write can fire)', () => {
    expect(REGISTER_FN).toMatch(
      /select:\s*\{[^}]*id:\s*true[^}]*playerId:\s*true[^}]*lineId:\s*true[^}]*email:\s*true[^}]*\}/,
    )
  })

  it('only writes email when User.email is currently null (conditional spread)', () => {
    // The pattern is `...(shouldWriteEmail ? { email: trimmedEmail } : {})`
    expect(REGISTER_FN).toMatch(/shouldWriteEmail/)
    expect(REGISTER_FN).toMatch(/shouldWriteEmail\s*\?\s*\{\s*email:\s*trimmedEmail\s*\}\s*:\s*\{\s*\}/)
  })

  it('catches Prisma P2002 and surfaces a friendly error', () => {
    expect(REGISTER_FN).toMatch(/P2002/)
    expect(REGISTER_FN).toMatch(/already linked to another account/)
  })
})

describe('v1.78.0 — completeOnboardingWithId server action', () => {
  it('CompleteOnboardingWithIdInput declares email: string', () => {
    expect(JOIN_ACTIONS).toMatch(
      /export interface CompleteOnboardingWithIdInput\s*\{[^}]*email:\s*string/,
    )
  })

  it('rejects empty email', () => {
    expect(COMPLETE_ONBOARDING_FN).toMatch(/Email is required/)
  })

  it('rejects malformed email (regex check)', () => {
    expect(COMPLETE_ONBOARDING_FN).toMatch(/Please enter a valid email address/)
    expect(JOIN_ACTIONS).toMatch(/EMAIL_REGEX\s*=\s*\/\^\[\^\\s@\]\+@/)
  })

  it('rejects email >254 chars', () => {
    expect(COMPLETE_ONBOARDING_FN).toMatch(/Email is too long/)
    expect(JOIN_ACTIONS).toMatch(/EMAIL_MAX_LENGTH\s*=\s*254/)
  })

  it('lowercases + trims the email before storage', () => {
    expect(COMPLETE_ONBOARDING_FN).toMatch(/input\.email\.trim\(\)\.toLowerCase\(\)/)
  })

  it('reads existing User.email before deciding whether to write', () => {
    // v1.80.11 — User row resolved at the top of the function with the
    // session-resolution lookup; the select includes `email: true`
    // (alongside `id: true, lineId: true`) so a separate lookup is no
    // longer needed.
    expect(COMPLETE_ONBOARDING_FN).toMatch(
      /prisma\.user\.findUnique\([\s\S]*?select:\s*\{[\s\S]*?email:\s*true/,
    )
  })

  it('only writes email when User.email is currently null (conditional spread)', () => {
    expect(COMPLETE_ONBOARDING_FN).toMatch(/shouldWriteEmail/)
    expect(COMPLETE_ONBOARDING_FN).toMatch(/shouldWriteEmail\s*\?\s*\{\s*email:\s*trimmedEmail\s*\}\s*:\s*\{\s*\}/)
  })

  it('catches Prisma P2002 and surfaces a friendly error', () => {
    expect(COMPLETE_ONBOARDING_FN).toMatch(/P2002/)
    expect(COMPLETE_ONBOARDING_FN).toMatch(/already linked to another account/)
  })
})

describe('v1.78.0 — recruit page + RegistrationForm wiring', () => {
  it('recruit page selects email + emailVerified on the User read', () => {
    // v1.80.10 — the User read now also pulls `id` because the page
    // resolves the User row via userId-or-lineId fallback, then threads
    // the canonical `user.id` into RegistrationForm. The select shape
    // still includes playerId/email/emailVerified.
    expect(RECRUIT_PAGE).toMatch(
      /select:\s*\{[^}]*playerId:\s*true[^}]*email:\s*true[^}]*emailVerified:\s*true/,
    )
  })

  it('recruit page only pre-fills initialEmail when emailVerified is non-null', () => {
    // v1.80.10 — `user` is non-null past the resolved-or-throw gate, so
    // optional chaining on the access is no longer needed. Logic is
    // identical: use email only when emailVerified is also set.
    expect(RECRUIT_PAGE).toMatch(/user\.email\s*&&\s*user\.emailVerified\s*\?\s*user\.email\s*:\s*''/)
  })

  it('recruit page passes initialEmail prop to RegistrationForm', () => {
    expect(RECRUIT_PAGE).toMatch(/initialEmail=\{initialEmail\}/)
  })

  it('RegistrationForm declares initialEmail prop', () => {
    expect(RECRUIT_FORM).toMatch(/initialEmail\?:\s*string/)
  })

  it('RegistrationForm threads initialEmail through to RegistrationFields', () => {
    expect(RECRUIT_FORM).toMatch(/initialEmail=\{initialEmail\}/)
  })

  it('RegistrationForm passes email to registerToLeague', () => {
    expect(RECRUIT_FORM).toMatch(/await registerToLeague\(\{[\s\S]*email:\s*input\.email/)
  })
})

describe('v1.78.0 — join onboarding page + OnboardingForm wiring', () => {
  it('join onboarding page reads User.email + emailVerified', () => {
    expect(JOIN_PAGE).toMatch(
      /prisma\.user\.findUnique\([\s\S]*?select:\s*\{\s*email:\s*true,\s*emailVerified:\s*true/,
    )
  })

  it('join onboarding page only pre-fills initialEmail when emailVerified is non-null', () => {
    expect(JOIN_PAGE).toMatch(
      /userRow\?\.email\s*&&\s*userRow\?\.emailVerified\s*\?\s*userRow\.email\s*:\s*''/,
    )
  })

  it('join onboarding page passes initialEmail to OnboardingForm', () => {
    expect(JOIN_PAGE).toMatch(/initialEmail=\{initialEmail\}/)
  })

  it('OnboardingForm declares initialEmail prop', () => {
    expect(JOIN_FORM).toMatch(/initialEmail:\s*string/)
  })

  it('OnboardingForm threads initialEmail through to RegistrationFields', () => {
    expect(JOIN_FORM).toMatch(/initialEmail=\{initialEmail\}/)
  })

  it('OnboardingForm passes email to completeOnboardingWithId', () => {
    expect(JOIN_FORM).toMatch(/await completeOnboardingWithId\(\{[\s\S]*email:\s*input\.email/)
  })
})

describe('v1.78.0 — applyToLeague (State D modal) is not changed (regression target)', () => {
  it('ApplyToLeagueInput does NOT declare an email field', () => {
    const block = RECRUIT_ACTIONS.match(/export interface ApplyToLeagueInput\s*\{[^}]*\}/)?.[0] ?? ''
    expect(block).not.toMatch(/\bemail:/)
  })

  it('applyToLeague body does not validate or read input.email', () => {
    expect(APPLY_TO_LEAGUE_FN).not.toMatch(/input\.email/)
  })
})
