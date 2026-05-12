/**
 * v1.81.2 — Extend the v1.81.0 post-submit success popup pattern to the
 * live join-flow server actions in `src/app/join/[code]/actions.ts`.
 *
 * Pre-v1.81.2 the success popup only fired for the public recruiting
 * paths (`applyToLeague`, `registerToLeague`). Invite-redemption and the
 * single-page onboarding form (`completeOnboardingWithId`) — plus the
 * legacy two-step `/id-upload` path's `submitIdUpload` + `skipIdUpload`
 * — landed users on `/join/[code]/welcome` with no acknowledgement modal.
 *
 * Pins:
 *   1. `redeemInvite` returns `redirectTo` with `?submitted=redeemInvite`
 *      ONLY for the terminal skipOnboarding=true branch. The
 *      skipOnboarding=false branch still routes to /onboarding without
 *      a popup (continuation form, not terminal — popup fires after
 *      `completeOnboardingWithId` instead).
 *   2. `completeOnboardingWithId` redirects to
 *      `/join/[code]/welcome?submitted=completeOnboardingWithId`.
 *   3. `submitIdUpload` redirects to
 *      `/join/[code]/welcome?submitted=submitIdUpload`.
 *   4. `skipIdUpload` redirects to
 *      `/join/[code]/welcome?submitted=skipIdUpload`.
 *   5. `<SuccessConfirmationGate>` is mounted on
 *      `src/app/join/[code]/welcome/page.tsx` (under <Suspense> so the
 *      `useSearchParams()` boundary is satisfied on a server-component
 *      page).
 *   6. `MESSAGES` map in `SuccessConfirmationGate.tsx` has copy entries
 *      for all four new descriptors.
 *
 * `submitOnboarding` is dead code (no caller in src/) so it is NOT
 * wired — surfaced as a deletion candidate in the PR description.
 *
 * Source-string assertions (project convention, mirrors v1.81.0).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')

const JOIN_ACTIONS_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/join/[code]/actions.ts'),
  'utf8',
)
const GATE_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/SuccessConfirmationGate.tsx'),
  'utf8',
)
const WELCOME_PAGE_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/join/[code]/welcome/page.tsx'),
  'utf8',
)
const VERSION_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/version.ts'),
  'utf8',
)

// Helper: scope a regex to a single named export's body so we don't get
// false matches from sibling functions in the same file.
function bodyOf(src: string, exportName: string): string {
  const start = src.indexOf(`export async function ${exportName}`)
  if (start < 0) throw new Error(`export ${exportName} not found`)
  // Slice to the next top-level `export ` (or EOF).
  const next = src.indexOf('\nexport ', start + 1)
  return next < 0 ? src.slice(start) : src.slice(start, next)
}

// ────────────────────────────────────────────────────────────────────────
// 0) Version
// ────────────────────────────────────────────────────────────────────────
describe('v1.81.2 — APP_VERSION bumped', () => {
  it('APP_VERSION is at least 1.81.2', () => {
    expect(VERSION_SRC).toMatch(
      /APP_VERSION\s*=\s*['"](?:1\.(?:81\.[2-9]|81\.\d{2,}|8[2-9]\.\d+|9\d?\.\d+)|2\.\d+\.\d+)['"]/,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────
// 1) redeemInvite — popup only on terminal skipOnboarding=true branch
// ────────────────────────────────────────────────────────────────────────
describe('v1.81.2 — redeemInvite redirectTo wiring', () => {
  it('terminal branch (skipOnboarding=true) appends ?submitted=redeemInvite', () => {
    const body = bodyOf(JOIN_ACTIONS_SRC, 'redeemInvite')
    expect(body).toMatch(
      /skipOnboarding[\s\S]*?\/join\/\$\{invite\.code\}\/welcome\?submitted=redeemInvite/,
    )
  })

  it('continuation branch (skipOnboarding=false) routes to /onboarding without ?submitted=', () => {
    const body = bodyOf(JOIN_ACTIONS_SRC, 'redeemInvite')
    // Find the redirectTo ternary block.
    const idx = body.indexOf('const redirectTo =')
    expect(idx).toBeGreaterThan(0)
    const ternary = body.slice(idx, idx + 400)
    // The /onboarding arm has no ?submitted= query param.
    expect(ternary).toMatch(/\/join\/\$\{invite\.code\}\/onboarding[`'"]/)
    // Defensive: make sure the /onboarding arm specifically does NOT
    // carry a `submitted=` query string.
    expect(ternary).not.toMatch(/\/onboarding\?submitted=/)
  })

  it('legacy literal `/welcome` (no query) is GONE from the redirectTo ternary', () => {
    // Regression target: re-introducing the bare /welcome literal would
    // break the popup on terminal redemptions.
    const body = bodyOf(JOIN_ACTIONS_SRC, 'redeemInvite')
    const idx = body.indexOf('const redirectTo =')
    expect(idx).toBeGreaterThan(0)
    const ternary = body.slice(idx, idx + 400)
    expect(ternary).not.toMatch(/\/welcome[`'"]/)
  })
})

// ────────────────────────────────────────────────────────────────────────
// 2) completeOnboardingWithId — server-side redirect with descriptor
// ────────────────────────────────────────────────────────────────────────
describe('v1.81.2 — completeOnboardingWithId redirect wiring', () => {
  it('redirect appends ?submitted=completeOnboardingWithId', () => {
    const body = bodyOf(JOIN_ACTIONS_SRC, 'completeOnboardingWithId')
    expect(body).toMatch(
      /redirect\(\s*[`'"]\/join\/\$\{input\.code\}\/welcome\?submitted=completeOnboardingWithId[`'"]/,
    )
  })

  it('legacy bare /welcome redirect is GONE', () => {
    const body = bodyOf(JOIN_ACTIONS_SRC, 'completeOnboardingWithId')
    expect(body).not.toMatch(/redirect\(\s*[`'"]\/join\/\$\{input\.code\}\/welcome[`'"]\s*\)/)
  })
})

// ────────────────────────────────────────────────────────────────────────
// 3) submitIdUpload — legacy ID-upload path's terminal redirect
// ────────────────────────────────────────────────────────────────────────
describe('v1.81.2 — submitIdUpload redirect wiring', () => {
  it('redirect appends ?submitted=submitIdUpload', () => {
    const body = bodyOf(JOIN_ACTIONS_SRC, 'submitIdUpload')
    expect(body).toMatch(
      /redirect\(\s*[`'"]\/join\/\$\{code\}\/welcome\?submitted=submitIdUpload[`'"]/,
    )
  })

  it('legacy bare /welcome redirect is GONE', () => {
    const body = bodyOf(JOIN_ACTIONS_SRC, 'submitIdUpload')
    expect(body).not.toMatch(/redirect\(\s*[`'"]\/join\/\$\{code\}\/welcome[`'"]\s*\)/)
  })
})

// ────────────────────────────────────────────────────────────────────────
// 4) skipIdUpload — soft-skip and BLOB-unconfigured fallback
// ────────────────────────────────────────────────────────────────────────
describe('v1.81.2 — skipIdUpload redirect wiring', () => {
  it('redirect appends ?submitted=skipIdUpload', () => {
    const body = bodyOf(JOIN_ACTIONS_SRC, 'skipIdUpload')
    expect(body).toMatch(
      /redirect\(\s*[`'"]\/join\/\$\{input\.code\}\/welcome\?submitted=skipIdUpload[`'"]/,
    )
  })

  it('legacy bare /welcome redirect is GONE', () => {
    const body = bodyOf(JOIN_ACTIONS_SRC, 'skipIdUpload')
    expect(body).not.toMatch(/redirect\(\s*[`'"]\/join\/\$\{input\.code\}\/welcome[`'"]\s*\)/)
  })
})

// ────────────────────────────────────────────────────────────────────────
// 5) MESSAGES — descriptor copy in the gate
// ────────────────────────────────────────────────────────────────────────
describe('v1.81.2 — SuccessConfirmationGate MESSAGES descriptors', () => {
  it('declares redeemInvite copy', () => {
    expect(GATE_SRC).toMatch(/redeemInvite:\s*\{/)
    expect(GATE_SRC).toMatch(/Invite redeemed/)
    expect(GATE_SRC).toMatch(/You're now a member of the league\./)
  })

  it('declares completeOnboardingWithId copy', () => {
    expect(GATE_SRC).toMatch(/completeOnboardingWithId:\s*\{/)
  })

  it('declares submitIdUpload copy', () => {
    expect(GATE_SRC).toMatch(/submitIdUpload:\s*\{/)
    expect(GATE_SRC).toMatch(/ID uploaded/)
  })

  it('declares skipIdUpload copy', () => {
    expect(GATE_SRC).toMatch(/skipIdUpload:\s*\{/)
    expect(GATE_SRC).toMatch(/Application complete/)
  })
})

// ────────────────────────────────────────────────────────────────────────
// 6) Welcome page mounts the gate
// ────────────────────────────────────────────────────────────────────────
describe('v1.81.2 — welcome page mounts SuccessConfirmationGate', () => {
  it('imports SuccessConfirmationGate', () => {
    expect(WELCOME_PAGE_SRC).toMatch(
      /import\s+SuccessConfirmationGate\s+from\s+['"]@\/components\/SuccessConfirmationGate['"]/,
    )
  })

  it('renders <SuccessConfirmationGate /> in the JSX tree', () => {
    expect(WELCOME_PAGE_SRC).toMatch(/<SuccessConfirmationGate\s*\/>/)
  })

  it('wraps the gate in <Suspense> for the useSearchParams() boundary', () => {
    // Server-component pages need <Suspense> around any client child that
    // uses useSearchParams(); without it, Next.js wraps the entire page
    // in suspense at build time.
    expect(WELCOME_PAGE_SRC).toMatch(
      /<Suspense\s+fallback=\{null\}>\s*<SuccessConfirmationGate\s*\/>/,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────
// 7) submitOnboarding stays untouched (dead-code surface)
// ────────────────────────────────────────────────────────────────────────
describe('v1.81.2 — submitOnboarding is dead code (no popup wiring)', () => {
  it('still redirects to /id-upload (legacy multi-step path body unchanged)', () => {
    // Pre-v1.68.0 submitOnboarding redirected name-only writes to a
    // separate /id-upload page. v1.81.2 does NOT wire a popup here
    // because the function has no caller in src/. Surfaced for
    // deletion in a future cleanup PR. This test simply confirms the
    // function body is unchanged from origin/main, so the cleanup PR
    // gets the deletion-candidate marker noted in actions.ts comments.
    const body = bodyOf(JOIN_ACTIONS_SRC, 'submitOnboarding')
    expect(body).toMatch(
      /redirect\(\s*`\/join\/\$\{input\.code\}\/id-upload`\s*\)/,
    )
  })
})
