/**
 * v1.63.1 — Two bug fixes bundled.
 *
 * Bug A — Sign out button on user account menu doesn't work.
 *   Root cause: `signOut()` defaulted to `callbackUrl: window.location.href`.
 *   On the homepage `/`, redirect target equals the current URL; depending
 *   on Next's client router behavior the same-URL navigation may not trigger
 *   a full page reload, leaving the React tree showing stale session state.
 *   Fix: align with the working `AdminNav.tsx` pattern by passing explicit
 *   `callbackUrl: '/'` and dropping the redundant `setOpen(false)` (the page
 *   navigates away — the dropdown effectively closes via re-mount).
 *
 * Bug B — RSVP bar no longer anchored to bottom of screen.
 *   Root cause: v1.63.0 moved RsvpBar inside `<main>` (via ClassicLeagueHomepage).
 *   The `<div className="animate-in pt-2">` wrapper inside `<main>` runs the
 *   `fade-in` keyframes with `animation-fill-mode: forwards`. The final state
 *   has `transform: translateY(0)` — a non-`none` transform value, which
 *   establishes a containing block for `position: fixed` descendants per the
 *   CSS spec. RsvpBar's `fixed bottom-0` therefore anchored to the
 *   `.animate-in` div's bottom (i.e. in the regular flow visually) rather
 *   than the viewport. Fix: move RsvpBar back to Dashboard's outer wrapper
 *   level (sibling of `<main>` and `<footer>`) where it lived pre-v1.63.0.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')

const LINE_LOGIN_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/LineLoginButton.tsx'),
  'utf8',
)
const DASHBOARD_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/Dashboard.tsx'),
  'utf8',
)
const CLASSIC_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/ClassicLeagueHomepage.tsx'),
  'utf8',
)
const GLOBALS_CSS = readFileSync(
  join(REPO_ROOT, 'src/app/globals.css'),
  'utf8',
)

// ────────────────────────────────────────────────────────────────────────────
// Bug A — Sign out button uses explicit callbackUrl (matches AdminNav)
// ────────────────────────────────────────────────────────────────────────────

describe('v1.63.1 Bug A — sign out button uses explicit callbackUrl (updated v1.80.1)', () => {
  it('account-menu sign-out button passes a callbackUrl to signOut()', () => {
    // v1.80.1 upgraded from hardcoded "/" to getCurrentCallbackUrl() so the
    // user returns to the page they signed out from.
    const idx = LINE_LOGIN_SRC.indexOf('"Sign out"')
    expect(idx).toBeGreaterThan(0)
    const before = LINE_LOGIN_SRC.slice(Math.max(0, idx - 1500), idx)
    expect(before).toMatch(/signOut\(\{\s*callbackUrl:/)
  })

  it('account-menu sign-out onClick does NOT call setOpen(false) before signOut (regression target)', () => {
    // Pre-fix shape was `() => { setOpen(false); signOut(); }`. The
    // setOpen call is redundant because signOut redirects which
    // unmounts the dropdown.
    const idx = LINE_LOGIN_SRC.indexOf('"Sign out"')
    const before = LINE_LOGIN_SRC.slice(Math.max(0, idx - 1500), idx)
    expect(before).not.toMatch(/setOpen\(false\);\s*signOut\(\);/)
  })

  it('account-menu sign-out matches the getCurrentCallbackUrl() pattern', () => {
    // v1.80.1: both AdminNav and LineLoginButton use getCurrentCallbackUrl().
    const adminNavSrc = readFileSync(
      join(REPO_ROOT, 'src/components/admin/AdminNav.tsx'),
      'utf8',
    )
    expect(adminNavSrc).toMatch(/signOut\(\{\s*callbackUrl:\s*getCurrentCallbackUrl\(\)/)
    expect(LINE_LOGIN_SRC).toMatch(/signOut\(\{\s*callbackUrl:\s*getCurrentCallbackUrl\(\)/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Bug B — RsvpBar at Dashboard's outer wrapper level (viewport-anchored)
// ────────────────────────────────────────────────────────────────────────────

describe('v1.63.1 Bug B — RsvpBar anchors to viewport bottom', () => {
  it('Dashboard imports and renders RsvpBar', () => {
    expect(DASHBOARD_SRC).toMatch(/import\s+RsvpBar\s+from\s+['"]\.\/RsvpBar['"]/)
    expect(DASHBOARD_SRC).toMatch(/<RsvpBar\b/)
  })

  it('ClassicLeagueHomepage NO LONGER renders RsvpBar (regression target)', () => {
    // v1.63.1 — RsvpBar must NOT be a child of any element inside <main>
    // because the `.animate-in` ancestor div sets `transform: translateY(0)`
    // (animation-fill-mode: forwards) which establishes a containing block
    // for fixed descendants. Putting RsvpBar back inside ClassicLeagueHomepage
    // would re-introduce the bug.
    expect(CLASSIC_SRC).not.toMatch(/<RsvpBar\b/)
    expect(CLASSIC_SRC).not.toMatch(/import\s+RsvpBar\b/)
  })

  it('Dashboard renders RsvpBar OUTSIDE <main> (after </footer>, sibling of <main>)', () => {
    // Strip docstring/leading-comment block so it doesn't trip the regex
    // (the docstring describes the architecture but would match the
    // </footer> + <RsvpBar pattern textually if it referenced the JSX).
    const lines = DASHBOARD_SRC.split('\n')
    // Find the opening of the return JSX (the function's outer-wrapper div).
    const returnIdx = lines.findIndex((l) => /^\s*return\s*\(/.test(l))
    expect(returnIdx).toBeGreaterThan(0)
    const jsx = lines.slice(returnIdx).join('\n')
    // The RsvpBar JSX must come AFTER </footer> (i.e. after main has closed).
    const footerCloseIdx = jsx.indexOf('</footer>')
    const rsvpJsxIdx = jsx.indexOf('<RsvpBar')
    expect(footerCloseIdx).toBeGreaterThan(0)
    expect(rsvpJsxIdx).toBeGreaterThan(footerCloseIdx)
    // And the closing </main> must come BEFORE the RsvpBar JSX.
    const mainCloseIdx = jsx.indexOf('</main>')
    expect(mainCloseIdx).toBeGreaterThan(0)
    expect(rsvpJsxIdx).toBeGreaterThan(mainCloseIdx)
  })

  it('Dashboard gates RsvpBar render on !preseasonMode && selectedMatchday', () => {
    // Pre-season hides the bar (no scheduled matches to RSVP for); a missing
    // selectedMatchday means matchdays[] is empty (post-season).
    expect(DASHBOARD_SRC).toMatch(
      /\{!preseasonMode\s*&&\s*selectedMatchday\s*&&\s*\(\s*\n\s*<RsvpBar\b/,
    )
  })

  it('RsvpBar itself still uses fixed bottom-0 (untouched by v1.63.1)', () => {
    const rsvpBarSrc = readFileSync(
      join(REPO_ROOT, 'src/components/RsvpBar.tsx'),
      'utf8',
    )
    expect(rsvpBarSrc).toMatch(/fixed\s+bottom-0/)
  })

  it('explains the containing-block hazard via .animate-in', () => {
    // Pin the load-bearing CSS spec interaction. If `.animate-in`'s keyframes
    // ever drop the `transform` declaration (e.g. switch to opacity-only
    // fade), the containing-block hazard goes away and RsvpBar could be
    // re-nested. Until then, this is the load-bearing CSS reason RsvpBar
    // can't live inside `<main>`.
    expect(GLOBALS_CSS).toMatch(/\.animate-in\s*\{[^}]*animation:\s*fade-in/)
    expect(GLOBALS_CSS).toMatch(/@keyframes\s+fade-in[\s\S]*?transform:\s*translateY/)
  })
})
