/**
 * v1.81.0 — Post-submit success confirmation popup.
 *
 * Pins:
 *   1. Component shape:
 *      - `<SuccessConfirmationModal>` accepts open / title / description /
 *        okHref / onClose; uses createPortal; role=dialog + aria-modal +
 *        focus-trap + body-scroll-lock + ESC + backdrop close.
 *      - Animated check uses pathLength={1} + the `success-check-stroke` /
 *        `success-check-ring` keyframes from globals.css. No Lottie / no
 *        new deps.
 *   2. Origin-redirect helper:
 *      - `safeOriginPath` rejects '', protocol-relative `//`,
 *        full URLs (no leading `/`), traversal `..`, control characters,
 *        and >512 chars; passes safe absolute paths.
 *      - `buildSuccessRedirect` appends `?submitted=<descriptor>`
 *        (URL-encoded), preserves existing query string, falls back to
 *        the configured fallback path on validation fail.
 *   3. Server action wiring:
 *      - `applyToLeague` accepts `originPath` and calls
 *        `redirect(buildSuccessRedirect(...))` on all 3 success branches
 *        (existingPlm idempotent, new PLM created, fresh Player+PLM).
 *      - `registerToLeague` accepts `originPath` and redirects to
 *        `<originPath>?submitted=registerToLeague`.
 *      - Fallback path is `/id/<league.subdomain>` (or DEFAULT_LEAGUE_SLUG).
 *   4. Gate component reads useSearchParams() and only renders for
 *      known descriptors (defensive against stale URLs).
 *   5. Dashboard mounts the gate lazily via dynamic().
 *
 * Source-string assertions (project convention for server-action +
 * component-shape pinning).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  safeOriginPath,
  buildSuccessRedirect,
} from '@/lib/successRedirect'

const REPO_ROOT = join(__dirname, '..', '..')

const MODAL_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/SuccessConfirmationModal.tsx'),
  'utf8',
)
const GATE_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/SuccessConfirmationGate.tsx'),
  'utf8',
)
const HELPER_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/successRedirect.ts'),
  'utf8',
)
const RECRUITING_ACTIONS_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/api/recruiting/actions.ts'),
  'utf8',
)
const APPLY_MODAL_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/ApplyToLeagueModal.tsx'),
  'utf8',
)
const REGISTRATION_FORM_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/recruit/[slug]/RegistrationForm.tsx'),
  'utf8',
)
const DASHBOARD_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/Dashboard.tsx'),
  'utf8',
)
const GLOBALS_CSS = readFileSync(
  join(REPO_ROOT, 'src/app/globals.css'),
  'utf8',
)
const VERSION_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/version.ts'),
  'utf8',
)

// ────────────────────────────────────────────────────────────────────────
// 0) Version
// ────────────────────────────────────────────────────────────────────────
describe('v1.81.0 — APP_VERSION bumped', () => {
  it('APP_VERSION is at least 1.81.0', () => {
    expect(VERSION_SRC).toMatch(
      /APP_VERSION\s*=\s*['"](?:1\.(?:81\.\d+|8[2-9]\.\d+|9\d?\.\d+)|2\.\d+\.\d+)['"]/,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────
// 1) <SuccessConfirmationModal> component shape
// ────────────────────────────────────────────────────────────────────────
describe('v1.81.0 — SuccessConfirmationModal component', () => {
  it("is 'use client'", () => {
    expect(MODAL_SRC.trim()).toMatch(/^['"]use client['"]/)
  })

  it('accepts the documented prop API (open, title, description?, okHref, onClose?)', () => {
    expect(MODAL_SRC).toMatch(/open:\s*boolean/)
    expect(MODAL_SRC).toMatch(/title:\s*string/)
    expect(MODAL_SRC).toMatch(/description\?:\s*string/)
    expect(MODAL_SRC).toMatch(/okHref:\s*string/)
    expect(MODAL_SRC).toMatch(/onClose\?:\s*\(\)\s*=>\s*void/)
  })

  it('renders via createPortal', () => {
    expect(MODAL_SRC).toMatch(/createPortal/)
  })

  it('has dialog a11y (role=dialog + aria-modal + aria-labelledby)', () => {
    expect(MODAL_SRC).toMatch(/role="dialog"/)
    expect(MODAL_SRC).toMatch(/aria-modal="true"/)
    expect(MODAL_SRC).toMatch(/aria-labelledby="success-modal-title"/)
  })

  it('exposes data-testids for E2E (modal, ok button, backdrop)', () => {
    expect(MODAL_SRC).toMatch(/data-testid="success-modal"/)
    expect(MODAL_SRC).toMatch(/data-testid="success-modal-ok"/)
    expect(MODAL_SRC).toMatch(/data-testid="success-modal-backdrop"/)
  })

  it('locks body scroll while open', () => {
    expect(MODAL_SRC).toMatch(/document\.body\.style\.overflow\s*=\s*['"]hidden['"]/)
  })

  it('closes on ESC', () => {
    expect(MODAL_SRC).toMatch(/e\.key\s*===\s*['"]Escape['"]/)
  })

  it('traps focus inside the card (Tab + Shift-Tab cycle)', () => {
    expect(MODAL_SRC).toMatch(/e\.shiftKey\s*&&\s*document\.activeElement\s*===\s*first/)
    expect(MODAL_SRC).toMatch(/document\.activeElement\s*===\s*last/)
  })

  it('OK button is a Next.js Link with replace + scroll=false to keep URL clean', () => {
    expect(MODAL_SRC).toMatch(/<Link\s+href=\{okHref\}/)
    expect(MODAL_SRC).toMatch(/replace/)
    expect(MODAL_SRC).toMatch(/scroll=\{false\}/)
  })

  it('animated check uses pathLength={1} + the success-check-stroke class', () => {
    expect(MODAL_SRC).toMatch(/pathLength=\{1\}/)
    expect(MODAL_SRC).toMatch(/success-check-stroke/)
    expect(MODAL_SRC).toMatch(/success-check-ring/)
  })
})

// ────────────────────────────────────────────────────────────────────────
// 2) Animation keyframes live in globals.css (no JSX styled-jsx)
// ────────────────────────────────────────────────────────────────────────
describe('v1.81.0 — animation keyframes in globals.css', () => {
  it('declares @keyframes success-check-draw', () => {
    expect(GLOBALS_CSS).toMatch(/@keyframes\s+success-check-draw/)
    expect(GLOBALS_CSS).toMatch(/stroke-dashoffset:\s*1/)
    expect(GLOBALS_CSS).toMatch(/stroke-dashoffset:\s*0/)
  })

  it('declares @keyframes success-check-ring', () => {
    expect(GLOBALS_CSS).toMatch(/@keyframes\s+success-check-ring/)
  })

  it('declares the .success-check-stroke + .success-check-ring rules', () => {
    expect(GLOBALS_CSS).toMatch(/\.success-check-stroke\s*\{/)
    expect(GLOBALS_CSS).toMatch(/\.success-check-ring\s*\{/)
  })
})

// ────────────────────────────────────────────────────────────────────────
// 3) safeOriginPath / buildSuccessRedirect — runtime tests
// ────────────────────────────────────────────────────────────────────────
describe('v1.81.0 — safeOriginPath rejects unsafe inputs', () => {
  it('returns the input on safe absolute paths', () => {
    expect(safeOriginPath('/id/t9l')).toBe('/id/t9l')
    expect(safeOriginPath('/id/t9l?foo=1')).toBe('/id/t9l?foo=1')
    expect(safeOriginPath('/')).toBe('/')
  })

  it('rejects empty / null / undefined / non-string', () => {
    expect(safeOriginPath('')).toBeNull()
    expect(safeOriginPath(null)).toBeNull()
    expect(safeOriginPath(undefined)).toBeNull()
    // @ts-expect-error — intentional bad input
    expect(safeOriginPath(123)).toBeNull()
  })

  it('rejects protocol-relative `//`', () => {
    expect(safeOriginPath('//evil.com')).toBeNull()
    expect(safeOriginPath('//evil.com/path')).toBeNull()
  })

  it('rejects full URLs (no leading slash)', () => {
    expect(safeOriginPath('https://evil.com/x')).toBeNull()
    expect(safeOriginPath('relative/path')).toBeNull()
  })

  it('rejects path-traversal sequences', () => {
    expect(safeOriginPath('/id/../secrets')).toBeNull()
    expect(safeOriginPath('/foo/..%2Fbar')).toBeNull()
  })

  it('rejects control characters (newline, carriage return)', () => {
    expect(safeOriginPath('/foo\nbar')).toBeNull()
    expect(safeOriginPath('/foo\rbar')).toBeNull()
  })

  it('rejects > 512 chars', () => {
    const long = '/' + 'a'.repeat(520)
    expect(safeOriginPath(long)).toBeNull()
  })
})

describe('v1.81.0 — buildSuccessRedirect appends `?submitted=` correctly', () => {
  it('uses originPath when safe', () => {
    expect(buildSuccessRedirect('/id/t9l', 'applyToLeague', '/id/fallback')).toBe(
      '/id/t9l?submitted=applyToLeague',
    )
  })

  it('uses fallback when originPath is missing', () => {
    expect(buildSuccessRedirect(null, 'applyToLeague', '/id/fallback')).toBe(
      '/id/fallback?submitted=applyToLeague',
    )
    expect(buildSuccessRedirect(undefined, 'applyToLeague', '/id/fallback')).toBe(
      '/id/fallback?submitted=applyToLeague',
    )
  })

  it('uses fallback when originPath is unsafe', () => {
    expect(buildSuccessRedirect('//evil.com', 'applyToLeague', '/id/fallback')).toBe(
      '/id/fallback?submitted=applyToLeague',
    )
    expect(buildSuccessRedirect('https://evil.com', 'applyToLeague', '/id/fallback')).toBe(
      '/id/fallback?submitted=applyToLeague',
    )
  })

  it('preserves existing query string with `&` separator', () => {
    expect(buildSuccessRedirect('/id/t9l?foo=1', 'applyToLeague', '/id/fallback')).toBe(
      '/id/t9l?foo=1&submitted=applyToLeague',
    )
  })

  it('URL-encodes the descriptor', () => {
    expect(buildSuccessRedirect('/id/t9l', 'has space&char', '/id/fallback')).toBe(
      '/id/t9l?submitted=has%20space%26char',
    )
  })
})

// ────────────────────────────────────────────────────────────────────────
// 4) Recruiting actions — origin-redirect wiring
// ────────────────────────────────────────────────────────────────────────
describe('v1.81.0 — applyToLeague origin-redirect wiring', () => {
  it('imports buildSuccessRedirect helper', () => {
    expect(RECRUITING_ACTIONS_SRC).toMatch(
      /import\s*\{\s*buildSuccessRedirect\s*\}\s*from\s*['"]@\/lib\/successRedirect['"]/,
    )
  })

  it('ApplyToLeagueInput accepts originPath?: string | null', () => {
    expect(RECRUITING_ACTIONS_SRC).toMatch(
      /ApplyToLeagueInput[\s\S]*?originPath\?:\s*string\s*\|\s*null/,
    )
  })

  it('selects league.subdomain for fallback path', () => {
    const idx = RECRUITING_ACTIONS_SRC.indexOf('export async function applyToLeague')
    expect(idx).toBeGreaterThan(0)
    const block = RECRUITING_ACTIONS_SRC.slice(idx, idx + 5000)
    expect(block).toMatch(/subdomain:\s*true/)
    expect(block).toMatch(/fallbackPath\s*=\s*`\/id\/\$\{league\.subdomain\s*\?\?\s*DEFAULT_LEAGUE_SLUG\}`/)
  })

  it('redirects on State D existingPlm idempotent branch', () => {
    const idx = RECRUITING_ACTIONS_SRC.indexOf('Either APPROVED')
    expect(idx).toBeGreaterThan(0)
    // Within ~500 chars after this comment we should see the
    // buildSuccessRedirect call.
    const block = RECRUITING_ACTIONS_SRC.slice(idx, idx + 600)
    expect(block).toMatch(/redirect\(\s*buildSuccessRedirect\(/)
    expect(block).toMatch(/['"]applyToLeague['"]/)
  })

  it('redirects on State D new-PLM-created branch', () => {
    // applyToLeague has 3 success branches (existingPlm idempotent,
    // create-new-PLM, fresh Player+PLM); each must redirect via
    // buildSuccessRedirect with descriptor 'applyToLeague'. Scope the
    // search to the applyToLeague function (between its declaration and
    // the next top-level `export async function`).
    const applyIdx = RECRUITING_ACTIONS_SRC.indexOf(
      'export async function applyToLeague',
    )
    const nextExportIdx = RECRUITING_ACTIONS_SRC.indexOf(
      'export ',
      applyIdx + 1,
    )
    expect(applyIdx).toBeGreaterThan(0)
    expect(nextExportIdx).toBeGreaterThan(applyIdx)
    const block = RECRUITING_ACTIONS_SRC.slice(applyIdx, nextExportIdx)
    const matches = block.match(
      /redirect\(buildSuccessRedirect\(input\.originPath,\s*['"]applyToLeague['"]/g,
    ) ?? []
    expect(matches.length).toBe(3)
  })

  it('redirects on State C fresh-Player branch', () => {
    const idx = RECRUITING_ACTIONS_SRC.indexOf('State C — fresh Player')
    expect(idx).toBeGreaterThan(0)
    const block = RECRUITING_ACTIONS_SRC.slice(idx, idx + 4000)
    expect(block).toMatch(/redirect\(\s*buildSuccessRedirect\(\s*input\.originPath,\s*['"]applyToLeague['"]/)
  })
})

describe('v1.81.0 — registerToLeague origin-redirect wiring', () => {
  it('RegisterToLeagueInput accepts originPath?: string | null', () => {
    expect(RECRUITING_ACTIONS_SRC).toMatch(
      /RegisterToLeagueInput[\s\S]*?originPath\?:\s*string\s*\|\s*null/,
    )
  })

  it('redirects via buildSuccessRedirect with descriptor `registerToLeague`', () => {
    const idx = RECRUITING_ACTIONS_SRC.indexOf(
      'export async function registerToLeague',
    )
    expect(idx).toBeGreaterThan(0)
    // registerToLeague has a long body (single-page intake + email
    // dispatch + transactional writes); slice to EOF rather than a
    // fixed-size window.
    const block = RECRUITING_ACTIONS_SRC.slice(idx)
    expect(block).toMatch(
      /redirect\(buildSuccessRedirect\(input\.originPath,\s*['"]registerToLeague['"]/,
    )
  })

  it('legacy `redirect(\\`/id/...\\`)` literal is GONE', () => {
    // Regression target: the v1.77.1 inline redirect template is replaced
    // by buildSuccessRedirect.  Re-introducing the literal would mean the
    // popup never fires.
    const regIdx = RECRUITING_ACTIONS_SRC.indexOf(
      'export async function registerToLeague',
    )
    const block = RECRUITING_ACTIONS_SRC.slice(regIdx)
    expect(block).not.toMatch(
      /redirect\(`\/id\/\$\{league\.subdomain\s*\?\?\s*DEFAULT_LEAGUE_SLUG\}`\s*\)/,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────
// 5) Form callers pass originPath
// ────────────────────────────────────────────────────────────────────────
describe('v1.81.0 — ApplyToLeagueModal captures originPath at mount', () => {
  it('captures window.location.pathname + search into local state', () => {
    expect(APPLY_MODAL_SRC).toMatch(/window\.location\.pathname\s*\+\s*window\.location\.search/)
  })

  it('passes originPath to applyToLeague', () => {
    // The applyToLeague call shape includes originPath (from local state).
    expect(APPLY_MODAL_SRC).toMatch(/applyToLeague\(\{[\s\S]*?originPath/)
  })

  it('re-throws Next.js redirect digest in catch block', () => {
    expect(APPLY_MODAL_SRC).toMatch(/'digest'\s+in\s+err/)
  })

  it('does not call session.update() or router.refresh() on success', () => {
    // The redirect handles re-render; calling these post-redirect
    // causes a flash. Regression target.
    expect(APPLY_MODAL_SRC).not.toMatch(/await update\(\)/)
    expect(APPLY_MODAL_SRC).not.toMatch(/router\.refresh\(\)/)
  })
})

describe('v1.81.0 — RegistrationForm hardcodes originPath to /id/<slug>', () => {
  it('passes originPath = `/id/<leagueSlug>`', () => {
    expect(REGISTRATION_FORM_SRC).toMatch(/originPath:\s*`\/id\/\$\{leagueSlug\}`/)
  })

  it('explains why we do not use window.location.pathname here', () => {
    // The page-level guard at /recruit/[slug] redirects bound users back
    // to /id/<slug>, so /recruit/<slug>?submitted= would re-bounce.
    expect(REGISTRATION_FORM_SRC).toMatch(/route-level guard|short-circuits|guard/i)
  })
})

// ────────────────────────────────────────────────────────────────────────
// 6) Gate component + Dashboard mount
// ────────────────────────────────────────────────────────────────────────
describe('v1.81.0 — SuccessConfirmationGate', () => {
  it("is 'use client' and reads useSearchParams", () => {
    expect(GATE_SRC.trim()).toMatch(/^['"]use client['"]/)
    expect(GATE_SRC).toMatch(/useSearchParams/)
  })

  it('only renders for known descriptors (returns null otherwise)', () => {
    expect(GATE_SRC).toMatch(/MESSAGES\[submitted\]/)
    expect(GATE_SRC).toMatch(/return null/)
  })

  it('strips the `submitted` param from okHref', () => {
    expect(GATE_SRC).toMatch(/next\.delete\(['"]submitted['"]\)/)
  })

  it('declares MESSAGES for both recruiting descriptors', () => {
    expect(GATE_SRC).toMatch(/applyToLeague:\s*\{/)
    expect(GATE_SRC).toMatch(/registerToLeague:\s*\{/)
    // Both copies say "Application submitted" since the underlying
    // event is the same from the user's perspective.
    expect(GATE_SRC).toMatch(/Application submitted/)
  })
})

describe('v1.81.0 — Dashboard mounts the gate (lazy)', () => {
  it('lazy-loads SuccessConfirmationGate via dynamic()', () => {
    expect(DASHBOARD_SRC).toMatch(
      /dynamic\(\s*\(\)\s*=>\s*import\(['"]\.\/SuccessConfirmationGate['"]\)/,
    )
  })

  it('renders <SuccessConfirmationGate /> in the JSX tree', () => {
    expect(DASHBOARD_SRC).toMatch(/<SuccessConfirmationGate\s*\/>/)
  })
})

// ────────────────────────────────────────────────────────────────────────
// 7) Helper file shape
// ────────────────────────────────────────────────────────────────────────
describe('v1.81.0 — successRedirect helper shape', () => {
  it('exports safeOriginPath and buildSuccessRedirect', () => {
    expect(HELPER_SRC).toMatch(/export function safeOriginPath/)
    expect(HELPER_SRC).toMatch(/export function buildSuccessRedirect/)
  })

  it('has no `use server` directive (pure utility, neutral module)', () => {
    expect(HELPER_SRC).not.toMatch(/^['"]use server['"]/)
  })
})
