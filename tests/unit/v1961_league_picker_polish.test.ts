/**
 * v1.96.1 — LeagueSwitcherTabs visual polish.
 *
 * Four UI-only changes to the `/test` LeaguePicker (shipped in v1.93.0
 * PR #263):
 *
 *   1. Top-padding `pt-2` on the nav so the pill row gets 8px of
 *      breathing room below the fixed Header (was flush at the 48px
 *      line). `py-2` inside the scroll viewport reserves 8px above /
 *      below the pills so the active pill's glow shadow isn't clipped
 *      by `overflow-x-auto`.
 *
 *   2. `.picker-scrollbar` utility replaces `.no-scrollbar` so the
 *      horizontal scroll surfaces a styled thin scrollbar on overflow
 *      — mobile users now have a visual cue that the strip scrolls.
 *      Defined in `globals.css` with the design tokens (idle =
 *      `--fg-low`, hover = `--fg-mid`, active = `--primary`).
 *
 *   3. Pills bumped to `h-11 px-5 text-[12px]` for a ≥44px touch
 *      target and more visual weight. Inactive carries
 *      `border border-border-default`; active carries
 *      `border-2 border-primary` plus the primary glow shadow.
 *
 *   4. Just-clicked pill's pending cue switched from a
 *      `animate-pulse` dot to an `animate-spin` ring — matches the
 *      `<RsvpButton>` / `<RsvpBar>` inline pending pattern used across
 *      non-admin public UI.
 *
 * Each assertion is a regression target — stash-pop verified the
 * relevant assertion fails on the v1.96.0 baseline.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_VERSION } from '@/lib/version'

const REPO_ROOT = join(__dirname, '..', '..')

const SWITCHER_TABS_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/homepage/LeagueSwitcherTabs.tsx'),
  'utf8',
)
const GLOBALS_CSS = readFileSync(
  join(REPO_ROOT, 'src/app/globals.css'),
  'utf8',
)

/**
 * Strips // line comments and block comments so structural
 * "code does not mention X" assertions can quote the same
 * identifiers from the docstring without tripping themselves.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}
const SWITCHER_TABS_CODE = stripComments(SWITCHER_TABS_SRC)

// ────────────────────────────────────────────────────────────────────────────
// 0) Version pin
// ────────────────────────────────────────────────────────────────────────────

describe('v1.96.1 — APP_VERSION bumped', () => {
  it('APP_VERSION is at least 1.96.1', () => {
    const [maj, min, pat] = APP_VERSION.split('.').map(Number)
    expect([maj, min, pat]).not.toEqual([NaN, NaN, NaN])
    const ok =
      maj > 1 ||
      (maj === 1 && min > 96) ||
      (maj === 1 && min === 96 && pat >= 1)
    expect(ok).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 1) Spacing: `pt-2` above the pill row, `py-2` inside scroll viewport
// ────────────────────────────────────────────────────────────────────────────

describe('v1.96.1 — switcher spacing', () => {
  it('nav has `pt-2` so the pill row sits 8px below the fixed Header (regression target)', () => {
    // Pre-v1.96.1 the nav only had `mb-3` and no top padding, so the
    // pills sat flush at the 48px header line. Stash-pop verified
    // this assertion fails when `pt-2` is removed.
    expect(SWITCHER_TABS_SRC).toMatch(
      /<nav\b[^>]*className="[^"]*\bpt-2\b[^"]*"/,
    )
  })

  it('pill-row flex container has `py-2` so the active pill glow is not clipped by overflow-x-auto', () => {
    // overflow-x-auto forces overflow-y to clip even though we want
    // the vertical glow shadow visible. The fix: inner py-2 reserves
    // 8px of safety inside the scroll viewport so the shadow has
    // room to extend.
    expect(SWITCHER_TABS_SRC).toMatch(
      /<div\s+className="[^"]*\bflex\b[^"]*\bpy-2\b[^"]*"/,
    )
  })

  it('nav bumped its bottom margin from mb-3 → mb-4 for breathing room before banners', () => {
    expect(SWITCHER_TABS_SRC).toMatch(
      /<nav\b[^>]*className="[^"]*\bmb-4\b[^"]*"/,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 2) Scrollbar: `.picker-scrollbar` utility defined + applied
// ────────────────────────────────────────────────────────────────────────────

describe('v1.96.1 — styled scrollbar', () => {
  it('switcher nav uses `picker-scrollbar` (not the prior `no-scrollbar`)', () => {
    expect(SWITCHER_TABS_SRC).toMatch(/picker-scrollbar/)
    // Regression target: the prior class is gone from EXECUTABLE
    // source. Hiding the scrollbar entirely was the original bug —
    // mobile users had no visual cue that the strip scrolls. We
    // strip comments first so the docstring's historical reference
    // to `no-scrollbar` (explaining what changed) doesn't false-
    // positive against an honest cleanup.
    expect(SWITCHER_TABS_CODE).not.toMatch(/\bno-scrollbar\b/)
  })

  it('globals.css defines the `.picker-scrollbar` utility with Firefox + WebKit recipes', () => {
    // Firefox: two-value `scrollbar-color` shorthand with the design tokens.
    expect(GLOBALS_CSS).toMatch(/\.picker-scrollbar\s*\{[^}]*scrollbar-width:\s*thin/)
    expect(GLOBALS_CSS).toMatch(
      /\.picker-scrollbar\s*\{[^}]*scrollbar-color:\s*var\(--fg-low\)\s+transparent/,
    )
    // WebKit: 4px height thumb with rounded radius.
    expect(GLOBALS_CSS).toMatch(
      /\.picker-scrollbar::-webkit-scrollbar\s*\{[^}]*height:\s*4px/,
    )
    expect(GLOBALS_CSS).toMatch(
      /\.picker-scrollbar::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*var\(--fg-low\)/,
    )
  })

  it('hover + active thumb states use brighter foreground / primary tokens (visual feedback)', () => {
    expect(GLOBALS_CSS).toMatch(
      /\.picker-scrollbar::-webkit-scrollbar-thumb:hover\s*\{[^}]*background:\s*var\(--fg-mid\)/,
    )
    expect(GLOBALS_CSS).toMatch(
      /\.picker-scrollbar::-webkit-scrollbar-thumb:active\s*\{[^}]*background:\s*var\(--primary\)/,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 3) Distinct visual treatment: ≥44px touch target + border + glow
// ────────────────────────────────────────────────────────────────────────────

describe('v1.96.1 — distinct pill design', () => {
  it('pills are h-11 (44px) for iOS-compliant touch target (regression target)', () => {
    // Pre-v1.96.1 pills were h-9 (36px) — under the WCAG / iOS HIG
    // 44×44 touch-target minimum.
    expect(SWITCHER_TABS_SRC).toMatch(/\bh-11\b/)
    expect(SWITCHER_TABS_SRC).not.toMatch(/\bh-9\b/)
  })

  it('pills bumped to px-5 + text-[12px] for visual weight', () => {
    expect(SWITCHER_TABS_SRC).toMatch(/\bpx-5\b/)
    // `\b` doesn't anchor after `]` (non-word) followed by whitespace —
    // pin the literal class with explicit boundaries instead.
    expect(SWITCHER_TABS_SRC).toMatch(/text-\[12px\]/)
    // Old 11px text is gone from executable code (the docstring still
    // mentions it historically, so strip comments first).
    expect(SWITCHER_TABS_CODE).not.toMatch(/text-\[11px\]/)
  })

  it('inactive pill carries `border border-border-default` for shape definition', () => {
    expect(SWITCHER_TABS_SRC).toMatch(/border\s+border-border-default/)
  })

  it('active pill carries `border-2 border-primary` plus the primary glow shadow (regression target)', () => {
    // The active pill must be UNAMBIGUOUSLY selected — the prior
    // bg-only difference was easy to miss. Border-2 + glow makes
    // the selection obvious.
    expect(SWITCHER_TABS_SRC).toMatch(/border-2\s+border-primary/)
    // Matches the inline rgba recipe used for the active glow.
    // Pinned to the literal so a refactor to a different shadow
    // value flags here.
    expect(SWITCHER_TABS_SRC).toMatch(
      /shadow-\[0_2px_10px_rgba\(233,0,82,0\.4\)\]/,
    )
  })

  it('active pill still carries the primary background / foreground colours', () => {
    expect(SWITCHER_TABS_SRC).toMatch(/bg-primary\s+text-primary-foreground/)
  })

  it('transition uses `transition-all` so border + shadow + colour animate together (was transition-transform)', () => {
    // Pre-v1.96.1 only the scale transformed — colour/border
    // changes were instant. transition-all so the hover + active
    // state changes animate smoothly across all properties.
    expect(SWITCHER_TABS_SRC).toMatch(/transition-all/)
    expect(SWITCHER_TABS_SRC).not.toMatch(/transition-transform/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 4) Standardised loading animation: spinner ring (not pulse dot)
// ────────────────────────────────────────────────────────────────────────────

describe('v1.96.1 — pending-tab spinner standardised', () => {
  it('per-tab spinner uses the `animate-spin` ring pattern matching RsvpButton (regression target)', () => {
    // Predominant inline-pending pattern across non-admin public UI
    // (RsvpButton, RsvpBar): border-2 + border-t-transparent + animate-spin.
    expect(SWITCHER_TABS_SRC).toMatch(
      /border-2\s+border-current\s+border-t-transparent\s+rounded-full\s+animate-spin/,
    )
  })

  it('spinner is sized 3×3 for the new 44px-tall pill (was 1.5×1.5 dot)', () => {
    expect(SWITCHER_TABS_SRC).toMatch(/\bh-3\s+w-3\b/)
  })

  it('previous animate-pulse dot recipe is no longer used in the switcher (regression target)', () => {
    // Specific pin against the prior `bg-current opacity-70 animate-pulse`
    // recipe so a partial revert flags here. We still match
    // `animate-pulse` in the source if it returns later, but the
    // co-located `bg-current opacity-70` part is the load-bearing tell.
    expect(SWITCHER_TABS_SRC).not.toMatch(
      /bg-current\s+opacity-70\s+animate-pulse/,
    )
  })

  it('spinner testid + aria-hidden preserved so test selectors and a11y stay intact', () => {
    expect(SWITCHER_TABS_SRC).toMatch(
      /data-testid=\{`league-switcher-tab-spinner-\$\{m\.slug\}`\}/,
    )
    expect(SWITCHER_TABS_SRC).toMatch(/aria-hidden=["']true["']/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 5) Pending-tab bug re-pin: spinner follows the OPTIMISTIC id, not the
//    stale active id. Already pinned in v1.93.0 but reinforced here so a
//    future refactor that re-introduces the bug fails BOTH suites.
// ────────────────────────────────────────────────────────────────────────────

describe('v1.96.1 — pending-tab bug stays fixed (re-pin)', () => {
  it('selected is computed from optimisticActiveId, never from activeLeagueId directly', () => {
    expect(SWITCHER_TABS_SRC).toMatch(
      /const\s+selected\s*=\s*m\.leagueId\s*===\s*optimisticActiveId/,
    )
    // The wrong shape (computing selected from activeLeagueId) is
    // explicitly forbidden — would cause the spinner to fire on the
    // OLD active tab again.
    expect(SWITCHER_TABS_SRC).not.toMatch(
      /const\s+selected\s*=\s*m\.leagueId\s*===\s*activeLeagueId\b/,
    )
  })

  it('showSpinner gates on (isPending && selected) so the just-clicked tab gets the cue', () => {
    expect(SWITCHER_TABS_SRC).toMatch(
      /const\s+showSpinner\s*=\s*isPending\s*&&\s*selected/,
    )
  })

  it('optimistic id is updated INSIDE the same transition that pushes the URL', () => {
    // If setOptimisticActiveId fires OUTSIDE startNavigation,
    // React 19 logs "useOptimistic must be in a transition" and
    // the optimistic update is dropped — the visual cue then
    // lags the click again. Pin the call-shape co-location.
    expect(SWITCHER_TABS_SRC).toMatch(
      /startNavigation\(\(\)\s*=>\s*\{[\s\S]*?setOptimisticActiveId\(leagueId\)[\s\S]*?router\.push\(href[\s\S]*?\}\)/,
    )
  })
})
