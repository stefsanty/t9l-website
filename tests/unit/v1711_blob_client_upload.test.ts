/**
 * v1.71.1 — switch ID + profile-picture uploads from server-side
 * `put` (FormData multipart in the server-action body) to
 * client-direct uploads via `@vercel/blob/client#upload`.
 *
 * **Why:** the Vercel platform caps serverless function request
 * bodies at ~4.5MB and rejects oversize requests at the edge with
 * HTTP 413 (FUNCTION_PAYLOAD_TOO_LARGE) BEFORE the function runs.
 * Next.js's `experimental.serverActions.bodySizeLimit` setting cannot
 * override that platform cap, which is why the v1.62.0 → v1.69.1
 * `bodySizeLimit` chain (1mb → 6mb → 25mb) had no effect on real
 * iPhone-camera uploads. v1.71.1 routes the bytes around the function
 * entirely: the browser PUTs each file straight to Vercel Blob, and
 * the server action receives only the resulting URLs (a few KB).
 *
 * Empirical confirmation against prod (handover, 2026-05-07):
 *   4MB POST /recruit/test → 500 (function reached)
 *   5MB POST /recruit/test → 413 FUNCTION_PAYLOAD_TOO_LARGE (rejected at edge)
 *   6MB POST /recruit/test → 413
 *   10MB POST /recruit/test → 413
 *
 * **Regression targets (load-bearing):**
 *   - The actions MUST NOT contain `await import('@vercel/blob')` or
 *     `put(` (restoring the v1.68.0 server-side put pattern would
 *     re-introduce the 4.5MB cliff).
 *   - The actions MUST contain `isOwnedBlobUrl(` calls (defense in
 *     depth: a forged URL on submit would land here without the
 *     upload-token gate having run).
 *   - `RegistrationFields.tsx` MUST import `upload` from
 *     `@vercel/blob/client` AND MUST NOT build FormData with file
 *     fields (regression target).
 *
 * Note: legacy `submitIdUpload` in `src/app/join/[code]/actions.ts`
 * stays as-is (back-compat for the pre-v1.68.0 split flow); this test
 * targets `registerToLeague` and `completeOnboardingWithId` only.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}
function stripComments(src: string): string {
  return src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('v1.71.1 — /api/blob/upload-token route', () => {
  const PATH = 'src/app/api/blob/upload-token/route.ts'

  it('exists', () => {
    expect(existsSync(join(ROOT, PATH))).toBe(true)
  })

  const src = existsSync(join(ROOT, PATH)) ? read(PATH) : ''

  it('exports POST', () => {
    expect(src).toMatch(/export async function POST\s*\(/)
  })

  it('imports handleUpload from @vercel/blob/client', () => {
    expect(src).toMatch(/import\s*\{[^}]*handleUpload[^}]*\}\s*from\s*['"]@vercel\/blob\/client['"]/)
  })

  it('imports HandleUploadBody type from @vercel/blob/client', () => {
    expect(src).toMatch(/HandleUploadBody/)
  })

  it('gates by getServerSession (401 when no session.userId)', () => {
    expect(src).toMatch(/getServerSession\(authOptions\)/)
    expect(src).toMatch(/Sign in required/)
    expect(src).toMatch(/status:\s*401/)
  })

  it('rejects pathname that does not start with one of the three allowed prefixes', () => {
    // v1.80.10 — pathname now keys on `resolvedUserId` (canonical User.id
    // resolved by `userId` first, then `lineId` fallback) so legacy LINE
    // sessions whose JWT predates v1.28.0 still match the prefix issued
    // by their own upload-token call.
    expect(src).toMatch(/register-pending\/\$\{resolvedUserId\}/)
    expect(src).toMatch(/player-id\\\/\[\^\/\]\+\\\/\(front\|back\)/)
    expect(src).toMatch(/player-profile\\\/\[\^\/\]\+/)
    expect(src).toMatch(/Pathname not allowed for this user/)
  })

  it('configures different content-type allowlists for ID vs picture', () => {
    expect(src).toMatch(/image\/jpeg/)
    expect(src).toMatch(/image\/png/)
    expect(src).toMatch(/image\/heic/)
    expect(src).toMatch(/application\/pdf/)
    expect(src).toMatch(/PIC_CONTENT_TYPES/)
    expect(src).toMatch(/ID_CONTENT_TYPES/)
  })

  it('configures different size caps for ID (8MB) vs picture (5MB)', () => {
    expect(src).toMatch(/ID_MAX_BYTES\s*=\s*8\s*\*\s*1024\s*\*\s*1024/)
    expect(src).toMatch(/PIC_MAX_BYTES\s*=\s*5\s*\*\s*1024\s*\*\s*1024/)
  })

  it('uses addRandomSuffix: false so the path-based ownership gate works', () => {
    expect(src).toMatch(/addRandomSuffix:\s*false/)
  })
})

describe('v1.71.1 — RegistrationFields uses client-direct upload', () => {
  const PATH = 'src/components/registration/RegistrationFields.tsx'
  const src = read(PATH)

  it("imports upload from '@vercel/blob/client'", () => {
    expect(src).toMatch(/import\s*\{\s*upload\s*\}\s*from\s*['"]@vercel\/blob\/client['"]/)
  })

  it('calls upload(...) with handleUploadUrl pointing at the token route', () => {
    expect(src).toMatch(/upload\(/)
    expect(src).toMatch(/handleUploadUrl:\s*UPLOAD_TOKEN_URL/)
    expect(src).toMatch(/UPLOAD_TOKEN_URL\s*=\s*['"]\/api\/blob\/upload-token['"]/)
  })

  it("does NOT build FormData with file fields (regression target — restoring would re-introduce the 4.5MB cliff)", () => {
    const code = stripComments(src)
    expect(code).not.toMatch(/formData\.append\(\s*['"]idFront['"]/)
    expect(code).not.toMatch(/formData\.append\(\s*['"]idBack['"]/)
    expect(code).not.toMatch(/formData\.append\(\s*['"]profilePicture['"]/)
  })

  it("does NOT pass FormData through onSubmit (the contract is a typed object now)", () => {
    expect(src).toMatch(/onSubmit:\s*\(input:\s*RegistrationFieldsSubmit\)\s*=>\s*Promise<void>/)
  })

  it('exports the RegistrationFieldsSubmit shape with idFrontUrl / idBackUrl / profilePictureUrl', () => {
    expect(src).toMatch(/idFrontUrl:\s*string/)
    expect(src).toMatch(/idBackUrl:\s*string/)
    expect(src).toMatch(/profilePictureUrl:\s*string\s*\|\s*null/)
  })

  it('takes uploadPathPrefix as a prop (so callers control the user-/player-keyed prefix)', () => {
    expect(src).toMatch(/uploadPathPrefix:\s*string/)
  })

  it('takes optional picturePathPrefix override (for the join flow that puts pic at player-profile/<id>)', () => {
    expect(src).toMatch(/picturePathPrefix\?:\s*string/)
  })
})

describe('v1.71.1 — registerToLeague action contract', () => {
  const PATH = 'src/app/api/recruiting/actions.ts'
  const src = read(PATH)

  it('signature accepts a typed input object (NOT FormData)', () => {
    expect(src).toMatch(/registerToLeague\(\s*input:\s*RegisterToLeagueInput[\s,]*\)/)
    // Regression target: the v1.68.0 FormData signature must be gone.
    expect(src).not.toMatch(/registerToLeague\(\s*formData:\s*FormData\s*\)/)
  })

  it('exports RegisterToLeagueInput interface with the URL fields', () => {
    expect(src).toMatch(/export interface RegisterToLeagueInput/)
    expect(src).toMatch(/idFrontUrl:\s*string/)
    expect(src).toMatch(/idBackUrl:\s*string/)
    expect(src).toMatch(/profilePictureUrl\?:\s*string\s*\|\s*null/)
  })

  it('does NOT contain `await import(\'@vercel/blob\')` (regression target)', () => {
    const code = stripComments(src)
    expect(code).not.toMatch(/await\s+import\(\s*['"]@vercel\/blob['"]\s*\)/)
  })

  it('does NOT contain `put(` calls (regression target — restoring would re-introduce the 4.5MB cliff)', () => {
    const code = stripComments(src)
    expect(code).not.toMatch(/\bput\s*\(/)
  })

  it('validates URL ownership via isOwnedBlobUrl for all three URLs', () => {
    expect(src).toMatch(/isOwnedBlobUrl/)
    expect(src).toMatch(/isOwnedBlobUrl\(input\.idFrontUrl/)
    expect(src).toMatch(/isOwnedBlobUrl\(input\.idBackUrl/)
    expect(src).toMatch(/isOwnedBlobUrl\(input\.profilePictureUrl/)
  })

  it('isOwnedBlobUrl rejects URLs not under *.public.blob.vercel-storage.com', () => {
    expect(src).toMatch(/\.public\.blob\.vercel-storage\.com/)
  })

  it('expected URL prefix is /register-pending/<resolved user.id>/', () => {
    // v1.80.10 — keyed on the resolved User row's id rather than raw
    // session.userId, so legacy LINE sessions (lineId only, userId null
    // on JWT) still match the prefix the upload-token route issued
    // against their canonical User.id.
    expect(src).toMatch(/expectedPrefix\s*=\s*`\/register-pending\/\$\{user\.id\}\//)
  })
})

describe('v1.71.1 — completeOnboardingWithId action contract', () => {
  const PATH = 'src/app/join/[code]/actions.ts'
  const src = read(PATH)

  it('signature accepts a typed input object (NOT FormData)', () => {
    expect(src).toMatch(/completeOnboardingWithId\(\s*input:\s*CompleteOnboardingWithIdInput[\s,]*\)/)
    // Regression target: the v1.68.0 FormData signature must be gone.
    expect(src).not.toMatch(/completeOnboardingWithId\(\s*formData:\s*FormData\s*\)/)
  })

  it('exports CompleteOnboardingWithIdInput interface with the URL fields', () => {
    expect(src).toMatch(/export interface CompleteOnboardingWithIdInput/)
    expect(src).toMatch(/idFrontUrl:\s*string/)
    expect(src).toMatch(/idBackUrl:\s*string/)
    expect(src).toMatch(/profilePictureUrl\?:\s*string\s*\|\s*null/)
  })

  it('completeOnboardingWithId body does NOT call `put(` (legacy submitIdUpload still does for back-compat)', () => {
    const fn = src
      .split('export async function completeOnboardingWithId')[1]
      .split('export ')[0]
    const stripped = stripComments(fn)
    expect(stripped).not.toMatch(/\bput\s*\(/)
    expect(stripped).not.toMatch(/await\s+import\(\s*['"]@vercel\/blob['"]\s*\)/)
  })

  it('validates URL ownership via isOwnedBlobUrl with player-keyed prefix', () => {
    const fn = src
      .split('export async function completeOnboardingWithId')[1]
      .split('export ')[0]
    expect(fn).toMatch(/isOwnedBlobUrl/)
    expect(fn).toMatch(/idPrefix\s*=\s*`\/player-id\/\$\{input\.playerId\}\//)
    expect(fn).toMatch(/picPrefix\s*=\s*`\/player-profile\/\$\{input\.playerId\}\//)
  })
})

describe('v1.71.1 — RegistrationForm + OnboardingForm onSubmit contract', () => {
  const RECRUIT = read('src/app/recruit/[slug]/RegistrationForm.tsx')
  const JOIN = read('src/app/join/[code]/onboarding/OnboardingForm.tsx')

  it('RegistrationForm threads userId through to the upload prefix', () => {
    expect(RECRUIT).toMatch(/userId:\s*string/)
    expect(RECRUIT).toMatch(/uploadPathPrefix=\{`register-pending\/\$\{userId\}`\}/)
  })

  it('RegistrationForm calls registerToLeague with a typed input (NOT FormData)', () => {
    const code = stripComments(RECRUIT)
    expect(code).toMatch(/registerToLeague\(\s*\{[\s\S]+idFrontUrl:\s*input\.idFrontUrl/)
    expect(code).not.toMatch(/registerToLeague\(formData\)/)
  })

  it('OnboardingForm passes player-keyed prefixes for ID and pic', () => {
    expect(JOIN).toMatch(/uploadPathPrefix=\{`player-id\/\$\{playerId\}`\}/)
    expect(JOIN).toMatch(/picturePathPrefix=\{`player-profile\/\$\{playerId\}`\}/)
  })

  it('OnboardingForm calls completeOnboardingWithId with a typed input (NOT FormData)', () => {
    const code = stripComments(JOIN)
    expect(code).toMatch(/completeOnboardingWithId\(\s*\{[\s\S]+idFrontUrl:\s*input\.idFrontUrl/)
    expect(code).not.toMatch(/completeOnboardingWithId\(formData\)/)
  })
})

describe('v1.71.1 — recruit page threads userId through', () => {
  const PATH = 'src/app/recruit/[slug]/page.tsx'
  const src = read(PATH)

  it('passes the resolved user.id to <RegistrationForm/>', () => {
    // v1.80.10 — the page resolves the User row by userId OR lineId
    // fallback and threads the canonical User.id to the form. Pre-fix
    // this was raw `session.userId` which could be null for legacy LINE
    // sessions.
    expect(src).toMatch(/<RegistrationForm[\s\S]*userId=\{user\.id\}/)
  })
})

describe('v1.71.1 — version bump', () => {
  it('APP_VERSION is at least 1.71.1', () => {
    const src = read('src/lib/version.ts')
    expect(src).toMatch(
      /APP_VERSION\s*=\s*['"](?:1\.(?:71\.[1-9]\d*|7[2-9]\.\d+|[8-9]\d?\.\d+)|2\.\d+\.\d+)['"]/,
    )
  })
})

describe('v1.71.1 — next.config.ts no longer pinned to a high bodySizeLimit', () => {
  // The Vercel platform 4.5MB cap overrides this setting anyway; v1.71.1
  // documents the fact and routes the bytes around the function. Any
  // small value is now acceptable; we just assert the setting still
  // exists (it gates JSON-shaped server-action payloads).
  const src = read('next.config.ts')

  it('still configures bodySizeLimit (any digit-mb value)', () => {
    expect(src).toMatch(/bodySizeLimit:\s*['"]\d+mb['"]/)
  })
})
