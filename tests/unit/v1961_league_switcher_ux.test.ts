/**
 * v1.96.1 — four UX fixes to <LeagueSwitcherTabs> on /test.
 *
 * After the v1.93.0 perf rebuild the user reported four issues:
 *   1. Pills hugged the bottom of the fixed Header (no top margin).
 *   2. Horizontal overflow used the browser default scrollbar — the
 *      `no-scrollbar` class applied to the nav DID NOT EXIST anywhere
 *      in globals.css (`scrollbar-hide` is the actual hide utility).
 *   3. Pills looked like generic chips; the active state was easy to
 *      miss against the inactive pills.
 *   4. The in-flight pulsing dot was inconsistent with the rest of the
 *      codebase, where `animate-spin` rings are the predominant pattern.
 *
 * Each runtime / structural assertion below is a regression target —
 * stash-pop verified the relevant assertion fails on the v1.96.0
 * baseline (the four fixes reverted, the `no-scrollbar` typo restored,
 * the `animate-pulse` dot restored).
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
const GLOBALS_CSS = readFileSync(
  join(REPO_ROOT, 'src/app/globals.css'),
  'utf8',
)
const CLAUDE_MD = readFileSync(join(REPO_ROOT, 'CLAUDE.md'), 'utf8')

// Strip line + block comments so structural "code does not mention X"
// assertions can quote the same identifiers from the docstring without
// tripping themselves.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// ────────────────────────────────────────────────────────────────────────────
// Version + ledger pin
// ────────────────────────────────────────────────────────────────────────────

describe('v1.96.1 — version pin', () => {
  it('APP_VERSION bumped to 1.96.1', () => {
    expect(APP_VERSION).toBe('1.96.1')
  })

  it('CLAUDE.md header reflects v1.96.1', () => {
    expect(CLAUDE_MD).toMatch(/\*\*Current release:\*\*\s+v1\.96\.1\./)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Fix #1 — top margin between Header and the picker tabs
// ────────────────────────────────────────────────────────────────────────────

describe('v1.96.1 — fix #1: top spacing below the fixed Header', () => {
  it('switcher nav carries pt-2 so it does not butt against the header bottom (regression target)', () => {
    // The fixed Header inside <main className="pt-12 ..."> reserves 48 px,
    // and the recruiting banner on /id/<slug> sits inside `.animate-in
    // pt-2` so it has 8 px of breathing room. Pre-v1.96.1 the nav had
    // `mb-3` only — no top padding — so the picker landed flush against
    // the header's bottom border. Pin the new pt-2 so this can't silently
    // regress to 0 spacing.
    expect(SWITCHER_SRC).toMatch(/<nav[\s\S]*?className="[^"]*\bpt-2\b/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Fix #2 — custom scrollbar matching the rest of the site
// ────────────────────────────────────────────────────────────────────────────

describe('v1.96.1 — fix #2: pill-scrollbar utility', () => {
  it('globals.css defines a .pill-scrollbar utility', () => {
    expect(GLOBALS_CSS).toMatch(/\.pill-scrollbar\s*\{/)
  })

  it('uses scrollbar-width: thin (Firefox)', () => {
    expect(GLOBALS_CSS).toMatch(
      /\.pill-scrollbar\s*\{[\s\S]*?scrollbar-width:\s*thin/,
    )
  })

  it('thumb uses surface-md token for theme parity (no hard-coded color)', () => {
    expect(GLOBALS_CSS).toMatch(
      /\.pill-scrollbar::-webkit-scrollbar-thumb\s*\{[\s\S]*?background:\s*var\(--surface-md\)/,
    )
  })

  it('track is transparent so the strip blends with the dashboard background', () => {
    expect(GLOBALS_CSS).toMatch(
      /\.pill-scrollbar::-webkit-scrollbar-track\s*\{[\s\S]*?background:\s*transparent/,
    )
  })

  it('thumb hover darkens to fg-low (visible interaction affordance)', () => {
    expect(GLOBALS_CSS).toMatch(
      /\.pill-scrollbar::-webkit-scrollbar-thumb:hover\s*\{[\s\S]*?background:\s*var\(--fg-low\)/,
    )
  })

  it('::-webkit-scrollbar height is 4px (thin track per spec)', () => {
    // Spec calls for 4–6 px. Pin the actual choice (4) so the picker
    // doesn't visually compete with the pills above it.
    expect(GLOBALS_CSS).toMatch(
      /\.pill-scrollbar::-webkit-scrollbar\s*\{[\s\S]*?height:\s*4px/,
    )
  })

  it('switcher nav uses the new utility (regression target)', () => {
    expect(SWITCHER_SRC).toMatch(/<nav[\s\S]*?className="[^"]*\bpill-scrollbar\b/)
  })

  it('switcher nav no longer references the non-existent no-scrollbar class', () => {
    // Pre-v1.96.1 the nav applied `no-scrollbar`, but globals.css only
    // defines `scrollbar-hide`. The browser default scrollbar leaked
    // through. Once-and-done: ban the typo so we can't slip back.
    const code = stripComments(SWITCHER_SRC)
    expect(code).not.toMatch(/\bno-scrollbar\b/)
  })

  it('switcher nav has bottom padding so the 4px scrollbar does not clip the pills', () => {
    expect(SWITCHER_SRC).toMatch(/<nav[\s\S]*?className="[^"]*\bpb-1\.5\b/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Fix #3 — distinct visual treatment, ≥44px touch target
// ────────────────────────────────────────────────────────────────────────────

describe('v1.96.1 — fix #3: pills look like proper tabs', () => {
  it('pill height is 44px (h-11) — WCAG AAA touch target (regression target)', () => {
    // Pre-v1.96.1 the pill was h-9 (36 px) — below the 44 px floor.
    // Pill uses a template-literal className, so anchor on the literal
    // utility tokens directly inside the className expression.
    expect(SWITCHER_SRC).toMatch(/className=\{`[^`]*\bh-11\b[^`]*`/)
    expect(SWITCHER_SRC).not.toMatch(/className=\{`[^`]*\bh-9\b[^`]*`/)
  })

  it('pill has min-w-[44px] so a one-letter league name still hits the 44px target', () => {
    expect(SWITCHER_SRC).toMatch(/className=\{`[^`]*min-w-\[44px\]/)
  })

  it('pill carries a 2px border for depth (regression target)', () => {
    // Pre-v1.96.1 inactive pills had no border at all — they read as
    // a flat colored chip indistinguishable from the surrounding card.
    expect(SWITCHER_SRC).toMatch(/className=\{`[^`]*\bborder-2\b/)
  })

  it('active pill uses the primary glow shadow for unambiguous selection', () => {
    // Glow shadow is a token already used by the primary brand button —
    // matching the existing visual vocabulary, not inventing new chrome.
    expect(SWITCHER_SRC).toMatch(/shadow-\[var\(--glow-primary-md\)\]/)
  })

  it('active pill has primary background + border (no ambiguity vs inactive)', () => {
    expect(SWITCHER_SRC).toMatch(
      /selected[\s\S]*?bg-primary[\s\S]*?border-primary/,
    )
  })

  it('inactive pill uses border-default + card surface (visible against background)', () => {
    expect(SWITCHER_SRC).toMatch(/bg-card[\s\S]*?border-border-default/)
  })

  it('inactive pill hover bumps text + adds primary border tint (interactive affordance)', () => {
    expect(SWITCHER_SRC).toMatch(
      /hover:bg-surface-md[\s\S]*?hover:text-fg-high[\s\S]*?hover:border-primary\/40/,
    )
  })

  it('Link carries no-underline so the global a-tag underline does not leak through', () => {
    // The global `a { text-decoration: underline }` rule from @layer
    // base would otherwise put a magenta underline on every pill.
    expect(SWITCHER_SRC).toMatch(/className=\{`[^`]*\bno-underline\b/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Fix #4 — standardize loading animation + verify v1.94.0 optimistic fix
// ────────────────────────────────────────────────────────────────────────────

describe('v1.96.1 — fix #4: spinner standardisation + optimistic-id regression target', () => {
  it('spinner uses animate-spin (the predominant in-flight pattern in this codebase)', () => {
    // Codebase audit: `animate-spin` rings are used by RsvpBar,
    // RsvpButton, every admin editor (LeagueDetailsEditor,
    // LeagueFeesEditor, etc.). `animate-pulse` is reserved for chunk-
    // loading skeletons. Pre-v1.96.1 the switcher used animate-pulse
    // on a 1.5 px dot — squarely inconsistent.
    expect(SWITCHER_SRC).toMatch(
      /data-testid=\{`league-switcher-tab-spinner-\$\{m\.slug\}`\}[\s\S]*?animate-spin/,
    )
  })

  it('spinner is no longer animate-pulse anywhere in the switcher (regression target)', () => {
    const code = stripComments(SWITCHER_SRC)
    expect(code).not.toMatch(/animate-pulse/)
  })

  it('spinner ring has the standard border + transparent-top pattern (matches RsvpBar)', () => {
    // `border-2 border-current border-t-transparent rounded-full
    // animate-spin` is the same shape used in RsvpBar.tsx — the canonical
    // "in-flight" affordance. Pin both the shape and the size so a future
    // refactor doesn't drift back to a dot.
    expect(SWITCHER_SRC).toMatch(
      /border-2\s+border-current\s+border-t-transparent\s+rounded-full\s+animate-spin/,
    )
  })

  it('selected is computed against optimisticActiveId, NOT the stale activeLeagueId (v1.94.0 regression target)', () => {
    // Pre-v1.85.0 the spinner fired on the OLD active pill because
    // `selected` was computed from the not-yet-updated server-supplied
    // `activeLeagueId`. v1.94.0 (PR #263) swung that to
    // `optimisticActiveId` so the just-clicked pill shows the spinner.
    // This test pins both halves of the gate so reverting either one
    // (the optimistic id OR the showSpinner predicate) trips CI.
    expect(SWITCHER_SRC).toMatch(
      /const\s+selected\s*=\s*m\.leagueId\s*===\s*optimisticActiveId/,
    )
    expect(SWITCHER_SRC).toMatch(
      /const\s+showSpinner\s*=\s*isPending\s*&&\s*selected/,
    )
  })

  it('useOptimistic still wraps activeLeagueId (no behavioural drift from v1.94.0)', () => {
    expect(SWITCHER_SRC).toMatch(/useOptimistic\(activeLeagueId\)/)
  })
})
