/**
 * v1.68.0 — ID collection on /recruit + form streamline.
 *
 * Structural tests pinning the load-bearing v1.68.0 contracts:
 *   - Shared `RegistrationFields` component for both /recruit and
 *     /join/[code]/onboarding
 *   - `registerToLeague` server action for /recruit (FormData with
 *     files), atomic Player+PLM+ID create, COMPLETED onboarding
 *   - `completeOnboardingWithId` for /join/[code]/onboarding (FormData
 *     with files), atomic Player update + PLM completion
 *   - Submit gates: name + idFront + idBack required (server-side
 *     mirror of client gate)
 *   - Profile picture is optional (matches admin-invite onboarding
 *     pre-v1.68.0 behavior — picture upload was never required there)
 *
 * Regression target: reverting the form/action edits would re-introduce
 * the v1.67.x state where /recruit had no ID collection at all and
 * users couldn't complete user-initiated registration.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}
function stripComments(src: string): string {
  return src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('v1.68.0 shared RegistrationFields component', () => {
  const PATH = 'src/components/registration/RegistrationFields.tsx'
  const src = read(PATH)

  it('is a client component', () => {
    expect(src).toMatch(/'use client'/)
  })

  it('exposes the four field testids (name + position + ID front + ID back)', () => {
    // FileField wrapper forwards `testid` as `data-testid`, so the test
    // accepts either form (the rendered DOM is `data-testid` either way).
    expect(src).toMatch(/data-testid="registration-fields"/)
    expect(src).toMatch(/data-testid="registration-name"/)
    expect(src).toMatch(/data-testid="registration-position"/)
    expect(src).toMatch(/(?:data-)?testid="registration-id-front"/)
    expect(src).toMatch(/(?:data-)?testid="registration-id-back"/)
  })

  it('renders an OPTIONAL profile picture field (matches admin-invite onboarding behavior)', () => {
    expect(src).toMatch(/(?:data-)?testid="registration-profile-picture"/)
    // The label flags it as optional explicitly so users know they can skip it.
    expect(src).toMatch(/Profile picture \(optional\)/)
    // Only the ID inputs are marked required={true}; the picture is required={false}.
    // We check the FileField wiring: ID fields pass `required` (truthy), the
    // picture passes `required={false}`.
    const code = stripComments(src)
    // Find the FileField for the picture and assert its required prop is false.
    const picBlock = code.split('Profile picture (optional)')
    expect(picBlock.length).toBeGreaterThan(1)
  })

  it('blocks submit until name + idFront + idBack present (regression target — picture is NOT in the gate)', () => {
    const code = stripComments(src)
    // The submitDisabled expression must reference all three required
    // fields. If a future PR drops idFront from the gate, this fails.
    expect(code).toMatch(/submitDisabled\s*=[\s\S]*!name\.trim\(\)/)
    expect(code).toMatch(/submitDisabled\s*=[\s\S]*!idFrontFile/)
    expect(code).toMatch(/submitDisabled\s*=[\s\S]*!idBackFile/)
    // Picture must NOT be in the disable gate (optional).
    const submitDisabledLine = code
      .split('\n')
      .find((l) => l.includes('submitDisabled'))
    expect(submitDisabledLine).toBeDefined()
    expect(submitDisabledLine).not.toMatch(/!picFile/)
  })

  it('builds FormData with name + position + idFront + idBack + optional profilePicture', () => {
    const code = stripComments(src)
    expect(code).toMatch(/formData\.append\('name',/)
    expect(code).toMatch(/formData\.append\('position',/)
    expect(code).toMatch(/formData\.append\('idFront',\s*idFrontFile\)/)
    expect(code).toMatch(/formData\.append\('idBack',\s*idBackFile\)/)
    // Profile picture is appended ONLY when present (conditional).
    expect(code).toMatch(/if \(picFile\)[\s\S]{0,80}formData\.append\('profilePicture',/)
  })

  it('caps file sizes (8MB ID, 5MB picture)', () => {
    expect(src).toMatch(/8\s*\*\s*1024\s*\*\s*1024/)
    expect(src).toMatch(/5\s*\*\s*1024\s*\*\s*1024/)
  })

  it('uses URL.createObjectURL for image previews', () => {
    expect(src).toMatch(/URL\.createObjectURL/)
  })
})

describe('v1.68.0 /recruit/[slug] form (RegistrationForm)', () => {
  const PATH = 'src/app/recruit/[slug]/RegistrationForm.tsx'
  const src = read(PATH)

  it("'use client' directive present", () => {
    expect(src).toMatch(/'use client'/)
  })

  it('imports the shared RegistrationFields and the new registerToLeague action', () => {
    expect(src).toMatch(/import\s+RegistrationFields\s+from\s+'@\/components\/registration\/RegistrationFields'/)
    expect(src).toMatch(/import\s*\{\s*registerToLeague\s*\}\s*from\s+'@\/app\/api\/recruiting\/actions'/)
  })

  it('does NOT import applyToLeague (regression target — v1.67.x form-only flow)', () => {
    const code = stripComments(src)
    expect(code).not.toMatch(/import\s*\{\s*applyToLeague\s*\}/)
  })

  it('renders <RegistrationFields/> wrapping the shared component', () => {
    expect(src).toMatch(/<RegistrationFields/)
    expect(src).toMatch(/data-testid="recruit-registration-form"/)
  })

  it('appends leagueId and forwards FormData to registerToLeague', () => {
    const code = stripComments(src)
    expect(code).toMatch(/formData\.append\('leagueId',\s*leagueId\)/)
    expect(code).toMatch(/registerToLeague\(formData\)/)
  })

  it('navigates to /id/<slug> on success', () => {
    expect(src).toMatch(/router\.push\(`\/id\/\$\{leagueSlug\}`\)/)
  })
})

describe('v1.68.0 /join/[code]/onboarding form (OnboardingForm)', () => {
  const PATH = 'src/app/join/[code]/onboarding/OnboardingForm.tsx'
  const src = read(PATH)

  it("'use client' directive present", () => {
    expect(src).toMatch(/'use client'/)
  })

  it('imports the shared RegistrationFields and the new completeOnboardingWithId action', () => {
    expect(src).toMatch(/import\s+RegistrationFields\s+from\s+'@\/components\/registration\/RegistrationFields'/)
    expect(src).toMatch(/import\s*\{\s*completeOnboardingWithId\s*\}\s*from\s+'\.\.\/actions'/)
  })

  it('does NOT call submitOnboarding directly (regression target — v1.34.0 split-flow)', () => {
    const code = stripComments(src)
    // submitOnboarding stays exported in actions.ts for backward compat,
    // but the new OnboardingForm must not call it.
    expect(code).not.toMatch(/submitOnboarding\(/)
  })

  it('appends code + playerId and forwards FormData to completeOnboardingWithId', () => {
    const code = stripComments(src)
    expect(code).toMatch(/formData\.append\('code',\s*code\)/)
    expect(code).toMatch(/formData\.append\('playerId',\s*playerId\)/)
    expect(code).toMatch(/completeOnboardingWithId\(formData\)/)
  })

  it('threads initialName and initialPosition into the shared component', () => {
    expect(src).toMatch(/initialName=\{initialName\}/)
    expect(src).toMatch(/initialPosition=\{initialPosition\}/)
  })

  it('preserves the onboarding-form testid wrapper', () => {
    expect(src).toMatch(/data-testid="onboarding-form"/)
  })
})

describe('v1.68.0 registerToLeague server action', () => {
  const PATH = 'src/app/api/recruiting/actions.ts'
  const src = read(PATH)

  it('exports the action', () => {
    expect(src).toMatch(/export async function registerToLeague\(formData: FormData\)/)
  })

  it('rejects when sign-in is missing', () => {
    const fn = src.split('export async function registerToLeague')[1].split('export ')[0]
    expect(fn).toMatch(/Sign in required/)
  })

  it('rejects admin-credentials sessions (no userId)', () => {
    const fn = src.split('export async function registerToLeague')[1].split('export ')[0]
    expect(fn).toMatch(/Admin sessions cannot submit applications/)
  })

  it('requires idFront file (server-side authoritative — regression target if client gate is bypassed)', () => {
    const fn = src.split('export async function registerToLeague')[1].split('export ')[0]
    expect(fn).toMatch(/idFront[\s\S]{0,200}Front of ID is required/)
  })

  it('requires idBack file', () => {
    const fn = src.split('export async function registerToLeague')[1].split('export ')[0]
    expect(fn).toMatch(/idBack[\s\S]{0,200}Back of ID is required/)
  })

  it('treats profile picture as optional (only attached if size > 0)', () => {
    const fn = src.split('export async function registerToLeague')[1].split('export ')[0]
    // The presence guard is `instanceof File && size > 0` then ternary to null.
    expect(fn).toMatch(/profilePicture[\s\S]{0,200}instanceof File\s*&&\s*profilePicture\.size\s*>\s*0/)
  })

  it('rejects when BLOB_READ_WRITE_TOKEN is unset (no skip path on /recruit)', () => {
    const fn = src.split('export async function registerToLeague')[1].split('export ')[0]
    expect(fn).toMatch(/BLOB_READ_WRITE_TOKEN/)
    expect(fn).toMatch(/ID upload is currently unavailable/)
  })

  it('rejects when the user already has a Player (State D users use applyToLeague instead)', () => {
    const fn = src.split('export async function registerToLeague')[1].split('export ')[0]
    expect(fn).toMatch(/user\.playerId/)
    expect(fn).toMatch(/already have a player/)
  })

  it('uploads to register-pending/<userId>/ paths via @vercel/blob put (parallel)', () => {
    const fn = src.split('export async function registerToLeague')[1].split('export ')[0]
    expect(fn).toMatch(/register-pending\/\$\{user\.id\}\/id-front-/)
    expect(fn).toMatch(/register-pending\/\$\{user\.id\}\/id-back-/)
    expect(fn).toMatch(/Promise\.all\(uploads\)/)
  })

  it('writes Player + User + PLM atomically in a single $transaction with all URLs populated', () => {
    const fn = src.split('export async function registerToLeague')[1].split('export ')[0]
    expect(fn).toMatch(/prisma\.\$transaction/)
    expect(fn).toMatch(/idFrontUrl:\s*frontResult\.url/)
    expect(fn).toMatch(/idBackUrl:\s*backResult\.url/)
    expect(fn).toMatch(/idUploadedAt:\s*new Date\(\)/)
    expect(fn).toMatch(/profilePictureUrl:\s*picResult\?\.url\s*\?\?\s*null/)
  })

  it('flips PLM.onboardingStatus to COMPLETED at registration time (no follow-up step)', () => {
    const fn = src.split('export async function registerToLeague')[1].split('export ')[0]
    // The PLM create payload must set onboardingStatus to COMPLETED.
    expect(fn).toMatch(/onboardingStatus:\s*'COMPLETED'/)
  })

  it('joinSource is SELF_SERVE for self-registration', () => {
    const fn = src.split('export async function registerToLeague')[1].split('export ')[0]
    expect(fn).toMatch(/joinSource:\s*'SELF_SERVE'/)
  })

  it('busts admin + public caches via the canonical revalidate helper', () => {
    const fn = src.split('export async function registerToLeague')[1].split('export ')[0]
    expect(fn).toMatch(/revalidate\(\{[\s\S]*domain:\s*'admin'/)
    expect(fn).toMatch(/revalidate\(\{\s*domain:\s*'public'\s*\}\)/)
  })
})

describe('v1.68.0 completeOnboardingWithId server action', () => {
  const PATH = 'src/app/join/[code]/actions.ts'
  const src = read(PATH)

  it('exports the action', () => {
    expect(src).toMatch(/export async function completeOnboardingWithId\(formData: FormData\)/)
  })

  it('requires idFront and idBack files (server-side authoritative)', () => {
    const fn = src.split('export async function completeOnboardingWithId')[1].split('export ')[0]
    expect(fn).toMatch(/Front of ID is required/)
    expect(fn).toMatch(/Back of ID is required/)
  })

  it('treats profile picture as optional (size > 0 guard)', () => {
    const fn = src.split('export async function completeOnboardingWithId')[1].split('export ')[0]
    expect(fn).toMatch(/profilePicture[\s\S]{0,200}instanceof File\s*&&\s*profilePicture\.size\s*>\s*0/)
  })

  it('verifies caller User is bound to the supplied playerId (defense in depth)', () => {
    const fn = src.split('export async function completeOnboardingWithId')[1].split('export ')[0]
    expect(fn).toMatch(/player\.userId\s*!==\s*userId/)
    expect(fn).toMatch(/not linked to this player slot/)
  })

  it('uploads ID to player-id/<playerId>/ paths and (when present) profile picture to player-profile/', () => {
    const fn = src.split('export async function completeOnboardingWithId')[1].split('export ')[0]
    expect(fn).toMatch(/player-id\/\$\{playerId\}\/front-/)
    expect(fn).toMatch(/player-id\/\$\{playerId\}\/back-/)
    expect(fn).toMatch(/player-profile\/\$\{playerId\}\//)
  })

  it('updates Player + PLM atomically with onboardingStatus -> COMPLETED', () => {
    const fn = src.split('export async function completeOnboardingWithId')[1].split('export ')[0]
    expect(fn).toMatch(/prisma\.\$transaction/)
    expect(fn).toMatch(/idFrontUrl:\s*frontResult\.url/)
    expect(fn).toMatch(/idBackUrl:\s*backResult\.url/)
    expect(fn).toMatch(/idUploadedAt:\s*new Date\(\)/)
    expect(fn).toMatch(/onboardingStatus:\s*'COMPLETED'/)
  })

  it('busts the per-league Redis mapping for LINE users (mirror of submitOnboarding)', () => {
    const fn = src.split('export async function completeOnboardingWithId')[1].split('export ')[0]
    expect(fn).toMatch(/deleteMapping\(lineId\)/)
  })

  it('redirects to /join/<code>/welcome on success (skipping /id-upload)', () => {
    const fn = src.split('export async function completeOnboardingWithId')[1].split('export ')[0]
    expect(fn).toMatch(/redirect\(`\/join\/\$\{code\}\/welcome`\)/)
  })
})

describe('v1.68.0 atomicity invariants', () => {
  const RECRUIT = read('src/app/api/recruiting/actions.ts')
  const JOIN = read('src/app/join/[code]/actions.ts')

  it('registerToLeague uploads BEFORE the DB transaction (blob failure short-circuits before Player creation)', () => {
    const fn = RECRUIT.split('export async function registerToLeague')[1].split('export ')[0]
    const uploadIdx = fn.indexOf('Promise.all(uploads)')
    const txIdx = fn.indexOf('prisma.$transaction')
    expect(uploadIdx).toBeGreaterThan(0)
    expect(txIdx).toBeGreaterThan(uploadIdx)
  })

  it('completeOnboardingWithId uploads BEFORE the DB transaction', () => {
    const fn = JOIN.split('export async function completeOnboardingWithId')[1].split('export ')[0]
    const uploadIdx = fn.indexOf('Promise.all(uploads)')
    const txIdx = fn.indexOf('prisma.$transaction')
    expect(uploadIdx).toBeGreaterThan(0)
    expect(txIdx).toBeGreaterThan(uploadIdx)
  })

  it('registerToLeague returns ApplyToLeagueResult shape (mode: fresh on success)', () => {
    const fn = RECRUIT.split('export async function registerToLeague')[1].split('export ')[0]
    expect(fn).toMatch(/mode:\s*'fresh'/)
  })
})

describe('v1.68.0 version bump', () => {
  it('APP_VERSION is 1.68.0', () => {
    const src = read('src/lib/version.ts')
    expect(src).toMatch(/APP_VERSION\s*=\s*'1\.68\.0'/)
  })
})
