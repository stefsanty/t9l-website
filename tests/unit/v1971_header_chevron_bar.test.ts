/**
 * v1.97.1 — course-correct on v1.97.0 (PR #272).
 *
 * v1.97.0 added a NEW chevron trigger INSIDE the in-page multi-league
 * hub picker (`<LeagueSwitcherTabs>`), opening a wrap-pill dropdown.
 * User clarification: the chevron the user meant is the EXISTING
 * chevron in the Header navbar next to the league-name text, and the
 * open-state should be a HORIZONTAL 1-LINE SCROLLABLE BAR — not a
 * dropdown panel of wrapped pills.
 *
 * v1.97.1 unifies the two surfaces:
 *   1. The Header chevron (`src/components/LeagueSwitcher.tsx`) is the
 *      canonical league-picker UI. On click it opens a 1-line
 *      horizontal scrollable bar below the fixed Header, with the
 *      `.pill-scrollbar` styling.
 *   2. The in-page `<LeagueSwitcherTabs>` is deleted — duplicate
 *      surface. The body-skeleton overlay on Dashboard (v1.97.0) is
 *      preserved and is now driven by the Header chevron's
 *      `useHubTransition()` call.
 *   3. The `.pill-scrollbar` utility (v1.96.1, deleted by v1.97.0) is
 *      reintroduced in globals.css.
 *
 * Each assertion below is a regression target — stash-pop verifies the
 * load-bearing tests fail on the v1.97.0 baseline (chevron-in-component
 * + wrap-pill dropdown + no .pill-scrollbar).
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')

const VERSION_SRC = readFileSync(join(REPO_ROOT, 'src/lib/version.ts'), 'utf8')
const HEADER_SWITCHER_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/LeagueSwitcher.tsx'),
  'utf8',
)
const HEADER_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/Header.tsx'),
  'utf8',
)
const MULTI_HUB_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/homepage/MultiLeagueHub.tsx'),
  'utf8',
)
const DASHBOARD_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/Dashboard.tsx'),
  'utf8',
)
const GLOBALS_CSS = readFileSync(join(REPO_ROOT, 'src/app/globals.css'), 'utf8')
const CLAUDE_MD = readFileSync(join(REPO_ROOT, 'CLAUDE.md'), 'utf8')
const LEDGER_MD = readFileSync(join(REPO_ROOT, 'docs/ledger.md'), 'utf8')

const LEAGUE_SWITCHER_TABS_PATH = join(
  REPO_ROOT,
  'src/components/homepage/LeagueSwitcherTabs.tsx',
)

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// ────────────────────────────────────────────────────────────────────────────
// 1) Version pin
// ────────────────────────────────────────────────────────────────────────────

describe('v1.97.1 — version pin', () => {
  it('APP_VERSION at 1.97.1 or higher (later patches relax this regex)', () => {
    expect(VERSION_SRC).toMatch(/APP_VERSION\s*=\s*['"]1\.(97\.[1-9]|9[89]\.\d+|\d{3,}\.\d+)['"]/)
  })

  it('CLAUDE.md header reflects v1.97.1 or a later release', () => {
    expect(CLAUDE_MD).toMatch(/\*\*Current release:\*\* v1\.(97\.[1-9]|9[89]\.\d+|\d{3,}\.\d+)\./)
  })

  it('docs/ledger.md top entry is v1.97.1 or a later release', () => {
    // The active ledger's first bullet should be the newest. Migrated
    // from CLAUDE.md to docs/ledger.md as part of the v1.97.6 doc
    // modularisation — the recent-ledger paragraphs no longer live in
    // CLAUDE.md, but the "top bullet is newest" pin still holds in
    // their new home.
    const firstBullet = LEDGER_MD.match(/-\s+\*\*v(\d+\.\d+\.\d+)\*\*/)
    expect(firstBullet?.[1]).toMatch(/^1\.(97\.[1-9]|9[89]\.\d+|\d{3,}\.\d+)$/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 2) LeagueSwitcherTabs is removed
// ────────────────────────────────────────────────────────────────────────────

describe('v1.97.1 — LeagueSwitcherTabs deleted (regression target)', () => {
  it('src/components/homepage/LeagueSwitcherTabs.tsx no longer exists', () => {
    expect(existsSync(LEAGUE_SWITCHER_TABS_PATH)).toBe(false)
  })

  it('MultiLeagueHub no longer imports LeagueSwitcherTabs', () => {
    // Strip comments so the historical mention in the v1.97.1 docstring
    // explaining what changed doesn't false-positive.
    expect(stripComments(MULTI_HUB_SRC)).not.toMatch(/LeagueSwitcherTabs/)
  })

  it('MultiLeagueHub topSlot no longer renders <LeagueSwitcherTabs', () => {
    // The Header chevron has taken over the league-picker role.
    expect(stripComments(MULTI_HUB_SRC)).not.toMatch(/<LeagueSwitcherTabs/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 3) Header chevron — trigger
// ────────────────────────────────────────────────────────────────────────────

describe('v1.97.1 — Header chevron is the canonical trigger', () => {
  it('Header still mounts <LeagueSwitcher .../> next to the brand title', () => {
    // v1.97.3 — LeagueSwitcher may now carry a `leagueTitle` prop when
    // it absorbs the brand-title surface. Accept either the prop-less
    // self-closing form OR a prop-bearing form.
    expect(HEADER_SRC).toMatch(/<LeagueSwitcher\b/)
  })

  it('LeagueSwitcher is a client component', () => {
    expect(HEADER_SWITCHER_SRC).toMatch(/^['"]use client['"]/)
  })

  it('renders a button with data-testid league-switcher-trigger', () => {
    expect(HEADER_SWITCHER_SRC).toMatch(
      /data-testid=["']league-switcher-trigger["']/,
    )
    expect(HEADER_SWITCHER_SRC).toMatch(/type=["']button["']/)
  })

  it('imports ChevronDown from lucide-react and rotates it 180deg when open', () => {
    expect(HEADER_SWITCHER_SRC).toMatch(
      /import\s*\{[^}]*\bChevronDown\b[^}]*\}\s+from\s+['"]lucide-react['"]/,
    )
    expect(HEADER_SWITCHER_SRC).toMatch(/rotate-180/)
  })

  it('hides itself entirely when memberships.length < 2', () => {
    expect(HEADER_SWITCHER_SRC).toMatch(/memberships\.length\s*<\s*2/)
    expect(HEADER_SWITCHER_SRC).toMatch(/return\s+null/)
  })

  it('trigger has aria-expanded, aria-haspopup="menu", and aria-controls=league-switcher-bar', () => {
    expect(HEADER_SWITCHER_SRC).toMatch(/aria-expanded=\{open\}/)
    expect(HEADER_SWITCHER_SRC).toMatch(/aria-haspopup=["']menu["']/)
    expect(HEADER_SWITCHER_SRC).toMatch(/aria-controls=["']league-switcher-bar["']/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 4) Open-state bar — horizontal 1-line scrollable, NOT wrap
// ────────────────────────────────────────────────────────────────────────────

describe('v1.97.1 — open-state bar is horizontal 1-line scrollable (regression target)', () => {
  it('bar carries data-testid league-switcher-bar + id="league-switcher-bar" matching aria-controls', () => {
    expect(HEADER_SWITCHER_SRC).toMatch(
      /data-testid=["']league-switcher-bar["']/,
    )
    expect(HEADER_SWITCHER_SRC).toMatch(/id=["']league-switcher-bar["']/)
  })

  it('bar uses role="menu" + aria-label="Switch league"', () => {
    expect(HEADER_SWITCHER_SRC).toMatch(/role=["']menu["']/)
    expect(HEADER_SWITCHER_SRC).toMatch(/aria-label=["']Switch league["']/)
  })

  it('bar uses overflow-x-auto (horizontal scroll) — NOT flex-wrap (v1.97.0 wrap regression target)', () => {
    expect(HEADER_SWITCHER_SRC).toMatch(/overflow-x-auto/)
    // v1.97.0's open-state used `flex-wrap` to reflow pills onto multiple
    // lines. The user explicitly wanted 1-line scrollable. Pin both
    // sides: `overflow-x-auto` MUST appear and `flex-wrap` MUST NOT.
    expect(stripComments(HEADER_SWITCHER_SRC)).not.toMatch(/flex-wrap/)
  })

  it('pills declare whitespace-nowrap + shrink-0 so the row never wraps', () => {
    // shrink-0 prevents flex shrinking; whitespace-nowrap prevents the
    // inner text wrapping. Together they guarantee a single line.
    expect(HEADER_SWITCHER_SRC).toMatch(/shrink-0/)
    expect(HEADER_SWITCHER_SRC).toMatch(/whitespace-nowrap/)
  })

  it('bar uses the .pill-scrollbar utility for styled horizontal scrollbar', () => {
    expect(HEADER_SWITCHER_SRC).toMatch(/pill-scrollbar/)
  })

  it('bar is fixed-positioned to sit below the fixed Header (top-12)', () => {
    expect(HEADER_SWITCHER_SRC).toMatch(/fixed\s+top-12/)
    expect(HEADER_SWITCHER_SRC).toMatch(/max-w-lg/)
  })

  it('bar is rendered only when open (open ? <bar/> : null) (regression target)', () => {
    const code = stripComments(HEADER_SWITCHER_SRC)
    expect(code).toMatch(/\{open\s*\?\s*\(/)
    expect(code).toMatch(/:\s*null\s*\}/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 5) Outside-click + Escape close
// ────────────────────────────────────────────────────────────────────────────

describe('v1.97.1 — outside-click + Escape close', () => {
  it('uses a ref on the wrapper to detect outside clicks', () => {
    expect(HEADER_SWITCHER_SRC).toMatch(/useRef<HTMLDivElement\s*\|\s*null>/)
    expect(HEADER_SWITCHER_SRC).toMatch(/containerRef\.current/)
  })

  it('mousedown + touchstart + keydown listeners are wired', () => {
    expect(HEADER_SWITCHER_SRC).toMatch(
      /addEventListener\(['"]mousedown['"]/,
    )
    expect(HEADER_SWITCHER_SRC).toMatch(
      /addEventListener\(['"]touchstart['"]/,
    )
    expect(HEADER_SWITCHER_SRC).toMatch(
      /addEventListener\(['"]keydown['"]/,
    )
  })

  it('Escape key closes the bar', () => {
    expect(HEADER_SWITCHER_SRC).toMatch(/['"]Escape['"]/)
    expect(HEADER_SWITCHER_SRC).toMatch(/setOpen\(false\)/)
  })

  it('all three listeners are cleaned up in the effect return', () => {
    expect(HEADER_SWITCHER_SRC).toMatch(
      /removeEventListener\(['"]mousedown['"]/,
    )
    expect(HEADER_SWITCHER_SRC).toMatch(
      /removeEventListener\(['"]touchstart['"]/,
    )
    expect(HEADER_SWITCHER_SRC).toMatch(
      /removeEventListener\(['"]keydown['"]/,
    )
  })

  it('effect is gated on `open` so no listeners attach when closed', () => {
    expect(HEADER_SWITCHER_SRC).toMatch(/if\s*\(!open\)\s+return/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 6) Click handling — power-user, same-league, normal-click via transition
// ────────────────────────────────────────────────────────────────────────────

describe('v1.97.1 — click handling', () => {
  it('preserves power-user gestures (cmd / ctrl / shift / alt / non-primary click)', () => {
    expect(HEADER_SWITCHER_SRC).toMatch(/metaKey/)
    expect(HEADER_SWITCHER_SRC).toMatch(/ctrlKey/)
    expect(HEADER_SWITCHER_SRC).toMatch(/shiftKey/)
    expect(HEADER_SWITCHER_SRC).toMatch(/altKey/)
    expect(HEADER_SWITCHER_SRC).toMatch(/e\.button\s*!==\s*0/)
  })

  it('short-circuits same-league taps (no RSC re-fetch) (regression target)', () => {
    expect(HEADER_SWITCHER_SRC).toMatch(
      /m\.leagueId\s*===\s*currentLeagueId/,
    )
  })

  it('normal click dispatches optimistic update + router.push inside startNavigation', () => {
    expect(HEADER_SWITCHER_SRC).toMatch(
      /startNavigation\(\(\)\s*=>\s*\{[\s\S]*?setOptimisticActiveId\(m\.leagueId\)[\s\S]*?router\.push\(href[\s\S]*?\}\)/,
    )
  })

  it('navigation on /test uses /test?league=<id> in-place; off-hub uses /id/<slug>', () => {
    // The buildHref helper toggles on the route. Pin both branches.
    expect(HEADER_SWITCHER_SRC).toMatch(
      /\/test\?league=\$\{encodeURIComponent\(m\.leagueId\)\}/,
    )
    expect(HEADER_SWITCHER_SRC).toMatch(/\/id\/\$\{m\.slug\}/)
    // pathname-aware discriminator
    expect(HEADER_SWITCHER_SRC).toMatch(
      /usePathname/,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 7) Optimistic + spinner preserved from v1.93.0 / v1.96.1
// ────────────────────────────────────────────────────────────────────────────

describe('v1.97.1 — optimistic id + spinner preserved (v1.93.0 / v1.96.1 regression targets)', () => {
  it('useOptimistic wraps the current league id (instant active swap)', () => {
    expect(HEADER_SWITCHER_SRC).toMatch(
      /import\s*\{[^}]*\buseOptimistic\b[^}]*\}\s+from\s+['"]react['"]/,
    )
    expect(HEADER_SWITCHER_SRC).toMatch(/useOptimistic\(currentLeagueId\)/)
  })

  it('selected is computed against optimisticActiveId, NOT currentLeagueId (regression target)', () => {
    expect(HEADER_SWITCHER_SRC).toMatch(
      /const\s+selected\s*=\s*m\.leagueId\s*===\s*optimisticActiveId/,
    )
  })

  it('showSpinner gates on isPending && selected (just-clicked-pill regression target)', () => {
    expect(HEADER_SWITCHER_SRC).toMatch(
      /showSpinner\s*=\s*isPending\s*&&\s*selected/,
    )
  })

  it('spinner uses animate-spin (standardised loading affordance)', () => {
    expect(HEADER_SWITCHER_SRC).toMatch(/animate-spin/)
    // No animate-pulse on the pill (v1.96.1 standardisation).
    expect(HEADER_SWITCHER_SRC).not.toMatch(/animate-pulse/)
  })

  it('Link prefetch is enabled on every pill', () => {
    expect(HEADER_SWITCHER_SRC).toMatch(
      /import\s+Link\s+from\s+['"]next\/link['"]/,
    )
    expect(HEADER_SWITCHER_SRC).toMatch(/<Link[\s\S]*?prefetch/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 8) Active vs inactive pill styling
// ────────────────────────────────────────────────────────────────────────────

describe('v1.97.1 — rectangular pills + active glow (v1.96.1 visual preserved)', () => {
  it('pills use rounded-lg (rectangular feel) — the spinner is allowed to keep rounded-full', () => {
    // The pill <Link> className declares rounded-lg; the spinner <span>
    // inside it uses rounded-full (standard ring shape) — that's the
    // only rounded-full callsite we tolerate.
    expect(HEADER_SWITCHER_SRC).toMatch(/rounded-lg/)
    const roundedFullMatches = HEADER_SWITCHER_SRC.match(/rounded-full/g) ?? []
    // At most one occurrence: the spinner ring. The pill itself must
    // be rectangular (rounded-lg).
    expect(roundedFullMatches.length).toBeLessThanOrEqual(1)
  })

  it('active pill carries the primary glow shadow (unambiguous selection)', () => {
    expect(HEADER_SWITCHER_SRC).toMatch(
      /shadow-\[var\(--glow-primary-md\)\]/,
    )
    expect(HEADER_SWITCHER_SRC).toMatch(
      /bg-primary[\s\S]{0,40}border-primary/,
    )
  })

  it('inactive pill uses border-default + bg-surface (visible against header chrome)', () => {
    expect(HEADER_SWITCHER_SRC).toMatch(/bg-surface\b/)
    expect(HEADER_SWITCHER_SRC).toMatch(/border-border-default/)
  })

  it('pills use no-underline (defeats the global <a> underline rule)', () => {
    expect(HEADER_SWITCHER_SRC).toMatch(/no-underline/)
  })

  it('pills show tactile press via active:scale (CSS-only, no JS)', () => {
    expect(HEADER_SWITCHER_SRC).toMatch(/active:scale-\[0\.96\]/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 9) Body skeleton overlay (v1.97.0) — superseded by v1.99.0 Suspense streaming
// ────────────────────────────────────────────────────────────────────────────
//
// v1.99.0 replaced the body-pulse dim with a real Suspense boundary that
// renders `<DashboardBodySkeleton />` while the heavy bundle streams in.
// Dashboard no longer reads `useHubTransition()` — the switcher's
// active-changing cue is now the top-edge progress strip owned by
// `<HubTransitionShell>` alone. The body-wrapper testid is preserved
// for downstream selectors, but the className flip is gone.

describe('v1.97.1 — Dashboard body wrapper testid preserved (v1.99.0 supersession)', () => {
  it('Dashboard renders a body wrapper with data-testid dashboard-body', () => {
    expect(DASHBOARD_SRC).toMatch(/data-testid=["']dashboard-body["']/)
  })

  it('Header chevron still reads useHubTransition so its in-place navigation drives the top progress strip', () => {
    expect(HEADER_SWITCHER_SRC).toMatch(
      /import\s*\{\s*useHubTransition\s*\}\s+from\s+['"]\.\/homepage\/HubTransitionShell['"]/,
    )
    expect(HEADER_SWITCHER_SRC).toMatch(/useHubTransition\(\)/)
    // No private useTransition in the switcher — the shell owns the
    // single transition so the LeagueSwitcher pill state and the
    // top-edge progress strip stay in sync.
    expect(HEADER_SWITCHER_SRC).not.toMatch(/useTransition\(\)/)
  })

  it('MultiLeagueHub still wraps the streaming hub body in <HubTransitionShell>', () => {
    // v1.99.0 — Dashboard is now rendered by an async child
    // (MultiLeagueHubBody) inside a Suspense, so the literal
    // `<HubTransitionShell>...<Dashboard` adjacency from v1.97.x is
    // gone. The contract is now: HubTransitionShell wraps the whole
    // streaming subtree (Header + Suspense + MultiLeagueHubBody).
    expect(MULTI_HUB_SRC).toMatch(/<HubTransitionShell>/)
    expect(MULTI_HUB_SRC).toMatch(/MultiLeagueHubBody/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 10) .pill-scrollbar utility restored in globals.css
// ────────────────────────────────────────────────────────────────────────────

describe('v1.97.1 — .pill-scrollbar utility reintroduced (regression target)', () => {
  it('globals.css defines .pill-scrollbar', () => {
    expect(GLOBALS_CSS).toMatch(/\.pill-scrollbar\s*\{/)
  })

  it('.pill-scrollbar uses scrollbar-width: thin', () => {
    expect(GLOBALS_CSS).toMatch(
      /\.pill-scrollbar\s*\{[\s\S]*?scrollbar-width:\s*thin/,
    )
  })

  it('.pill-scrollbar declares a 4px webkit scrollbar height (horizontal track)', () => {
    expect(GLOBALS_CSS).toMatch(
      /\.pill-scrollbar::-webkit-scrollbar\s*\{[\s\S]*?height:\s*4px/,
    )
  })

  it('.pill-scrollbar thumb uses --surface-md (token-driven theming)', () => {
    expect(GLOBALS_CSS).toMatch(
      /\.pill-scrollbar::-webkit-scrollbar-thumb\s*\{[\s\S]*?background:\s*var\(--surface-md\)/,
    )
  })
})
