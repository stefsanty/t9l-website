/**
 * v1.97.0 — chevron-collapsible league switcher + body skeleton overlay.
 *
 * Replaces the v1.85.0 → v1.96.1 persistent pill strip with a
 * chevron-driven dropdown bar (open/close state, outside-click + Escape
 * close), and adds a body-skeleton overlay on the Dashboard that fires
 * during a `<LeagueSwitcherTabs>` navigation transition. Both behaviors
 * are wired through the existing `useHubTransition()` context.
 *
 * Each behavioural assertion below is a regression target — stash-pop
 * verified the relevant assertion fails on the v1.96.1 baseline (pre-
 * v1.97.0 switcher: no chevron trigger, no open/close state, no body
 * dim).
 *
 * Coverage:
 *   - APP_VERSION bumped to 1.97.0; CLAUDE.md "Current release" matches
 *   - LeagueSwitcherTabs:
 *       • chevron trigger renders (testid `league-switcher-trigger`)
 *       • dropdown bar renders ONLY when open (testid `league-switcher-bar`)
 *       • outside-click + Escape close (state machine via useState)
 *       • aria-expanded toggles, aria-controls wired to bar id
 *       • rectangular pills (rounded-lg, not rounded-full)
 *       • active pill primary glow + primary bg/border
 *       • inactive pill border-default
 *       • ≥44px touch target on trigger (h-11) and pills (min-h-[44px])
 *       • pills use no-underline (defeats the global a-tag underline)
 *       • animate-spin retained for in-flight pill (carries forward v1.96.1 fix #4)
 *       • `selected` computed against `optimisticActiveId` (v1.94.0 regression target)
 *       • useOptimistic still wraps activeLeagueId
 *       • same-league click short-circuits navigation
 *   - Dashboard body skeleton:
 *       • Dashboard imports useHubTransition from ./homepage/HubTransitionShell
 *       • Dashboard reads `isHubPending` from the hook
 *       • body wrapper renders with data-testid `dashboard-body`
 *       • aria-busy bound to isHubPending
 *       • animate-pulse + pointer-events-none gated on isHubPending
 *   - Dead-code cleanup:
 *       • `.pill-scrollbar` utility removed (no callers post-redesign)
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_VERSION } from '@/lib/version'

const REPO_ROOT = join(__dirname, '..', '..')

const SWITCHER_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/homepage/LeagueSwitcherTabs.tsx'),
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
const CLAUDE_MD = readFileSync(join(REPO_ROOT, 'CLAUDE.md'), 'utf8')

// Strip line + block comments so structural assertions can quote
// identifiers from docstrings without tripping themselves.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// ────────────────────────────────────────────────────────────────────────────
// Version + ledger pin
// ────────────────────────────────────────────────────────────────────────────

describe('v1.97.0 — version pin', () => {
  it('APP_VERSION bumped to 1.97.0', () => {
    expect(APP_VERSION).toBe('1.97.0')
  })

  it('CLAUDE.md header reflects v1.97.0', () => {
    expect(CLAUDE_MD).toMatch(/\*\*Current release:\*\*\s+v1\.97\.0\./)
  })

  it('CLAUDE.md ledger top entry is v1.97.0', () => {
    expect(CLAUDE_MD).toMatch(/- \*\*v1\.97\.0\*\*/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Chevron trigger + dropdown bar structure
// ────────────────────────────────────────────────────────────────────────────

describe('v1.97.0 — chevron trigger', () => {
  it('renders a button with data-testid league-switcher-trigger (regression target)', () => {
    // Pre-v1.97.0 the switcher was a flat pill strip; there was NO
    // trigger button. The chevron trigger is the v1.97.0 addition.
    expect(SWITCHER_SRC).toMatch(
      /data-testid="league-switcher-trigger"/,
    )
  })

  it('trigger is a <button type="button"> (avoids implicit form-submit)', () => {
    expect(SWITCHER_SRC).toMatch(/<button[\s\S]*?type="button"[\s\S]*?data-testid="league-switcher-trigger"/)
  })

  it('trigger imports ChevronDown from lucide-react', () => {
    expect(SWITCHER_SRC).toMatch(/import\s*\{[^}]*\bChevronDown\b[^}]*\}\s*from\s*['"]lucide-react['"]/)
  })

  it('ChevronDown rotates 180deg when open (visual open-state cue)', () => {
    expect(SWITCHER_SRC).toMatch(/<ChevronDown[\s\S]*?open\s*\?\s*'rotate-180'/)
  })

  it('trigger height is h-11 (≥44px touch target)', () => {
    expect(SWITCHER_SRC).toMatch(
      /data-testid="league-switcher-trigger"[\s\S]*?className="[^"]*\bh-11\b/,
    )
  })

  it('trigger labels the active league name (inline orientation cue)', () => {
    // The active league should appear inside the trigger button so the
    // user knows which league they are currently viewing without
    // expanding the dropdown.
    expect(SWITCHER_SRC).toMatch(/const\s+active\s*=\s*memberships\.find/)
    expect(SWITCHER_SRC).toMatch(/active\?\.leagueName\s*\?\?\s*'Switch league'/)
    expect(SWITCHER_SRC).toMatch(/\{activeLabel\}/)
  })

  it('trigger has aria-expanded bound to open state', () => {
    expect(SWITCHER_SRC).toMatch(/aria-expanded=\{open\}/)
  })

  it('trigger has aria-controls pointing at the bar id', () => {
    expect(SWITCHER_SRC).toMatch(/aria-controls="league-switcher-bar"/)
  })

  it('trigger has aria-haspopup="menu" for screen readers', () => {
    expect(SWITCHER_SRC).toMatch(/aria-haspopup="menu"/)
  })

  it('toggle handler flips open via setOpen((v) => !v)', () => {
    expect(SWITCHER_SRC).toMatch(/setOpen\(\(v\)\s*=>\s*!v\)/)
  })

  it('wrapper sits below the fixed header (pt-2)', () => {
    expect(SWITCHER_SRC).toMatch(
      /data-testid="league-switcher-tabs"[\s\S]*?className="[^"]*\bpt-2\b/,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Dropdown bar conditional rendering + structure
// ────────────────────────────────────────────────────────────────────────────

describe('v1.97.0 — dropdown bar', () => {
  it('bar is rendered ONLY when open (open ? <bar/> : null) (regression target)', () => {
    // Pre-v1.97.0 the pill strip was always rendered (no open state).
    // Pin the conditional so a regression to "always render" trips CI.
    expect(SWITCHER_SRC).toMatch(/\{open\s*\?[\s\S]*?id="league-switcher-bar"[\s\S]*?:\s*null\}/)
  })

  it('bar carries data-testid league-switcher-bar', () => {
    expect(SWITCHER_SRC).toMatch(/data-testid="league-switcher-bar"/)
  })

  it('bar has id="league-switcher-bar" matching trigger aria-controls', () => {
    expect(SWITCHER_SRC).toMatch(/id="league-switcher-bar"/)
  })

  it('bar uses role="menu" + aria-label="Switch league"', () => {
    expect(SWITCHER_SRC).toMatch(/role="menu"[\s\S]*?aria-label="Switch league"/)
  })

  it('bar is absolutely positioned below the trigger (absolute top-full)', () => {
    expect(SWITCHER_SRC).toMatch(
      /id="league-switcher-bar"[\s\S]*?className="[^"]*\babsolute\b[^"]*\btop-full\b/,
    )
  })

  it('bar uses flex-wrap so pills wrap inside the column on narrow viewports', () => {
    expect(SWITCHER_SRC).toMatch(/<div[^>]*className="[^"]*\bflex-wrap\b/)
  })

  it('wrapper carries data-open attribute reflecting the open state', () => {
    expect(SWITCHER_SRC).toMatch(/data-open=\{open\s*\?\s*'true'\s*:\s*'false'\}/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Outside-click + Escape close
// ────────────────────────────────────────────────────────────────────────────

describe('v1.97.0 — outside-click + Escape close', () => {
  it('uses a ref on the wrapper to detect outside clicks', () => {
    expect(SWITCHER_SRC).toMatch(/const\s+containerRef\s*=\s*useRef/)
    expect(SWITCHER_SRC).toMatch(/ref=\{containerRef\}/)
  })

  it('mousedown listener closes the bar on outside click (regression target)', () => {
    // Pre-v1.97.0 there was no outside-click handler. Pin the wiring.
    expect(SWITCHER_SRC).toMatch(/document\.addEventListener\(\s*'mousedown'/)
    expect(SWITCHER_SRC).toMatch(
      /containerRef\.current[\s\S]*?contains[\s\S]*?setOpen\(false\)/,
    )
  })

  it('touchstart listener mirrors mousedown for mobile outside-tap close', () => {
    expect(SWITCHER_SRC).toMatch(/document\.addEventListener\(\s*'touchstart'/)
  })

  it('Escape key closes the bar', () => {
    expect(SWITCHER_SRC).toMatch(/e\.key\s*===\s*'Escape'\s*\)\s*setOpen\(false\)/)
  })

  it('all three listeners are cleaned up in the effect return', () => {
    expect(SWITCHER_SRC).toMatch(/document\.removeEventListener\(\s*'mousedown'/)
    expect(SWITCHER_SRC).toMatch(/document\.removeEventListener\(\s*'touchstart'/)
    expect(SWITCHER_SRC).toMatch(/document\.removeEventListener\(\s*'keydown'/)
  })

  it('effect is gated on `open` (no listener mounted when closed)', () => {
    expect(SWITCHER_SRC).toMatch(/if\s*\(!open\)\s*return/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Pill visual treatment — rectangular, active glow, touch target
// ────────────────────────────────────────────────────────────────────────────

describe('v1.97.0 — rectangular pills + active glow', () => {
  it('pills use rounded-lg (rectangular feel), NOT rounded-full (regression target)', () => {
    // Pre-v1.97.0 pills used rounded-full (oval). The v1.97.0 redesign
    // uses rectangular pills (rounded-lg) for the "command palette" feel.
    expect(SWITCHER_SRC).toMatch(/className=\{`[^`]*\brounded-lg\b/)
    // Confirm rounded-full is no longer applied to pill elements.
    // (rounded-full may still appear on the spinner — exempt that.)
    const code = stripComments(SWITCHER_SRC)
    const pillBlock = code.match(/aria-pressed=\{selected\}[\s\S]*?<\/Link>/)
    expect(pillBlock).toBeTruthy()
    expect(pillBlock![0]).not.toMatch(/rounded-full[\s\S]*?\{m\.leagueName\}/)
  })

  it('pill height is ≥44px (min-h-[44px] for touch accessibility)', () => {
    expect(SWITCHER_SRC).toMatch(/className=\{`[^`]*\bmin-h-\[44px\]/)
  })

  it('pill carries a 2px border (visual depth)', () => {
    expect(SWITCHER_SRC).toMatch(/className=\{`[^`]*\bborder-2\b/)
  })

  it('active pill uses primary glow shadow (unambiguous selection)', () => {
    expect(SWITCHER_SRC).toMatch(/shadow-\[var\(--glow-primary-md\)\]/)
  })

  it('active pill has primary background + border', () => {
    expect(SWITCHER_SRC).toMatch(/selected[\s\S]*?bg-primary[\s\S]*?border-primary/)
  })

  it('inactive pill uses border-default + bg-surface (visible against bg-card dropdown)', () => {
    // bg-card on inactive would blend into the dropdown's bg-card panel.
    // bg-surface provides separation.
    expect(SWITCHER_SRC).toMatch(/bg-surface[\s\S]*?border-border-default/)
  })

  it('inactive pill hover bumps text + tints border (interactive affordance)', () => {
    expect(SWITCHER_SRC).toMatch(
      /hover:bg-surface-md[\s\S]*?hover:text-fg-high[\s\S]*?hover:border-primary\/40/,
    )
  })

  it('pills use no-underline (defeats the global a-tag underline)', () => {
    expect(SWITCHER_SRC).toMatch(/className=\{`[^`]*\bno-underline\b/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Spinner + optimistic-active id — preserved v1.94.0 + v1.96.1 fixes
// ────────────────────────────────────────────────────────────────────────────

describe('v1.97.0 — spinner + optimistic id preserved from prior fixes', () => {
  it('useOptimistic still wraps activeLeagueId (v1.94.0 behaviour intact)', () => {
    expect(SWITCHER_SRC).toMatch(/useOptimistic\(activeLeagueId\)/)
  })

  it('selected is computed against optimisticActiveId, NOT stale activeLeagueId (v1.94.0 regression target)', () => {
    expect(SWITCHER_SRC).toMatch(
      /const\s+selected\s*=\s*m\.leagueId\s*===\s*optimisticActiveId/,
    )
  })

  it('showSpinner gates on isPending && selected (v1.94.0 just-clicked-pill regression target)', () => {
    expect(SWITCHER_SRC).toMatch(
      /const\s+showSpinner\s*=\s*isPending\s*&&\s*selected/,
    )
  })

  it('spinner uses animate-spin (v1.96.1 standardisation preserved)', () => {
    expect(SWITCHER_SRC).toMatch(
      /data-testid=\{`league-switcher-tab-spinner-\$\{m\.slug\}`\}[\s\S]*?animate-spin/,
    )
  })

  it('no animate-pulse anywhere in the switcher (v1.96.1 regression target)', () => {
    const code = stripComments(SWITCHER_SRC)
    expect(code).not.toMatch(/animate-pulse/)
  })

  it('spinner ring uses the standard border-2 + transparent-top + rounded-full pattern', () => {
    expect(SWITCHER_SRC).toMatch(
      /border-2\s+border-current\s+border-t-transparent\s+rounded-full\s+animate-spin/,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Click handling — same-league, power-user, normal
// ────────────────────────────────────────────────────────────────────────────

describe('v1.97.0 — click handling', () => {
  it('same-league click closes the dropdown without navigating', () => {
    expect(SWITCHER_SRC).toMatch(
      /if\s*\(\s*leagueId\s*===\s*activeLeagueId\s*\)[\s\S]*?preventDefault\(\)[\s\S]*?setOpen\(false\)/,
    )
  })

  it('power-user gestures (meta/ctrl/shift/alt/non-primary) close the dropdown and let the browser navigate', () => {
    expect(SWITCHER_SRC).toMatch(
      /e\.metaKey\s*\|\|\s*e\.ctrlKey\s*\|\|\s*e\.shiftKey\s*\|\|\s*e\.altKey\s*\|\|\s*e\.button\s*!==\s*0/,
    )
  })

  it('normal click closes the dropdown, dispatches optimistic update + router.push inside startNavigation', () => {
    expect(SWITCHER_SRC).toMatch(
      /startNavigation\(\(\)\s*=>\s*\{[\s\S]*?setOptimisticActiveId\(leagueId\)[\s\S]*?router\.push\(href,\s*\{\s*scroll:\s*false\s*\}\)/,
    )
  })

  it('href is /test?league=<encoded id> (matches v1.93.0 + v1.94.0 link contract)', () => {
    expect(SWITCHER_SRC).toMatch(
      /const\s+href\s*=\s*`\/test\?league=\$\{encodeURIComponent\(m\.leagueId\)\}`/,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Dashboard body skeleton overlay
// ────────────────────────────────────────────────────────────────────────────

describe('v1.97.0 — Dashboard body skeleton overlay during pending', () => {
  it('Dashboard imports useHubTransition from ./homepage/HubTransitionShell (regression target)', () => {
    expect(DASHBOARD_SRC).toMatch(
      /import\s*\{\s*useHubTransition\s*\}\s*from\s*['"]\.\/homepage\/HubTransitionShell['"]/,
    )
  })

  it('Dashboard reads isPending under the alias isHubPending', () => {
    expect(DASHBOARD_SRC).toMatch(
      /const\s*\{\s*isPending:\s*isHubPending\s*\}\s*=\s*useHubTransition\(\)/,
    )
  })

  it('Dashboard renders a body wrapper with data-testid dashboard-body', () => {
    expect(DASHBOARD_SRC).toMatch(/data-testid="dashboard-body"/)
  })

  it('body wrapper binds aria-busy to isHubPending (regression target)', () => {
    expect(DASHBOARD_SRC).toMatch(/aria-busy=\{isHubPending\}/)
  })

  it('body wrapper exposes data-hub-busy attribute for stylesheet hooks + e2e probes', () => {
    expect(DASHBOARD_SRC).toMatch(
      /data-hub-busy=\{isHubPending\s*\?\s*'true'\s*:\s*'false'\}/,
    )
  })

  it('animate-pulse + pointer-events-none ONLY fire when isHubPending=true (regression target)', () => {
    expect(DASHBOARD_SRC).toMatch(
      /isHubPending[\s\S]*?'animate-pulse pointer-events-none transition-opacity duration-150'/,
    )
  })

  it('body wrapper carries transition-opacity duration-150 on both branches (smooth dim/undim)', () => {
    // Smoothness: avoid a hard snap when isHubPending flips to false.
    const matches = DASHBOARD_SRC.match(/transition-opacity duration-150/g)
    expect(matches).toBeTruthy()
    expect(matches!.length).toBeGreaterThanOrEqual(2)
  })

  it('body wrapper is rendered INSIDE the existing .animate-in pt-2 div (no animation conflict)', () => {
    // Wrapping inside `.animate-in pt-2` (rather than replacing it) keeps
    // the one-shot fade-in animation isolated from the conditional pulse,
    // so flipping isHubPending doesn't restart the fade-in.
    expect(DASHBOARD_SRC).toMatch(
      /className="animate-in pt-2"[\s\S]*?data-testid="dashboard-body"/,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Dead-code cleanup
// ────────────────────────────────────────────────────────────────────────────

describe('v1.97.0 — pill-scrollbar utility removed (no callers post-redesign)', () => {
  it('globals.css no longer defines .pill-scrollbar (regression target)', () => {
    expect(GLOBALS_CSS).not.toMatch(/\.pill-scrollbar\s*\{/)
    expect(GLOBALS_CSS).not.toMatch(/pill-scrollbar::-webkit-scrollbar/)
  })

  it('switcher source no longer references pill-scrollbar', () => {
    const code = stripComments(SWITCHER_SRC)
    expect(code).not.toMatch(/pill-scrollbar/)
  })
})
