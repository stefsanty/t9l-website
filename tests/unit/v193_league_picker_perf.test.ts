/**
 * v1.93.0 — league switcher perf + UX rebuild.
 *
 * v1.85.0 shipped the multi-league hub with a `<button>` switcher that
 * called `setUserDefaultLeague` then `router.refresh()`. v1.92.x user
 * feedback was "no animation, no loading, takes too long" — the click
 * sat on three sequential Neon round-trips before the navigation even
 * started, and there was no visual cue in the meantime.
 *
 * The rebuild swaps that flow for `<Link prefetch>` + searchParam-
 * driven active league + `useOptimistic` + `useTransition`. The
 * persisted "last selection" is now written by `<MultiLeagueHub>` via
 * `touchUserDefaultLeague`, mirroring the existing `/id/<slug>` shape.
 *
 * Each runtime assertion below is a regression target — stash-pop
 * verified the relevant assertion fails when production code is
 * reverted to the v1.85.0 / v1.92.x state.
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')

const ROUTING_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/homepageRouting.ts'),
  'utf8',
)
const HOMEPAGE_ROUTER_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/homepage/HomepageRouter.tsx'),
  'utf8',
)
const TEST_PAGE_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/test/page.tsx'),
  'utf8',
)
const SWITCHER_TABS_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/homepage/LeagueSwitcherTabs.tsx'),
  'utf8',
)
const MULTI_HUB_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/homepage/MultiLeagueHub.tsx'),
  'utf8',
)
const HUB_SHELL_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/homepage/HubTransitionShell.tsx'),
  'utf8',
)
const GLOBALS_CSS = readFileSync(
  join(REPO_ROOT, 'src/app/globals.css'),
  'utf8',
)
const ACTIONS_PATH = join(REPO_ROOT, 'src/components/homepage/actions.ts')

/**
 * Strips // line comments and /* block comments *\/ so structural
 * "code does not mention X" assertions can quote the same identifiers
 * from the docstring without tripping themselves. The implementation
 * is intentionally simple — it does NOT understand string literals
 * containing comment-looking sequences, but the switcher source has
 * no such literals.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// ────────────────────────────────────────────────────────────────────────────
// 1) Old `setUserDefaultLeague` server action is GONE
// ────────────────────────────────────────────────────────────────────────────

describe('v1.93.0 — old server action surface is fully removed', () => {
  it('src/components/homepage/actions.ts no longer exists', () => {
    expect(existsSync(ACTIONS_PATH)).toBe(false)
  })

  it('switcher source carries no executable reference to setUserDefaultLeague (regression target)', () => {
    // Strip line comments so the historical mention in the docstring
    // explaining what changed in v1.93.0 doesn't false-positive.
    const code = stripComments(SWITCHER_TABS_SRC)
    expect(code).not.toMatch(/setUserDefaultLeague/)
  })

  it('switcher no longer triggers router.refresh on pick (regression target)', () => {
    // Pre-v1.93.0 the switcher chained server-action then refresh.
    // The new flow uses router.push to a search-param URL; refresh
    // would re-fetch the page WITHOUT updating the URL, defeating
    // the prefetch entirely.
    const code = stripComments(SWITCHER_TABS_SRC)
    expect(code).not.toMatch(/router\.refresh\(\)/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 2) `classifyPersona` honours the new `preferredLeagueId` override
// ────────────────────────────────────────────────────────────────────────────

describe('v1.93.0 — classifyPersona preferredLeagueId precedence', () => {
  it('preferredLeagueId pinned to a valid membership wins over stored default (regression target)', async () => {
    const { classifyPersona } = await import('@/lib/homepageRouting')
    const a = { leagueId: 'l-a', leagueName: 'Alpha', slug: 'alpha' }
    const b = { leagueId: 'l-b', leagueName: 'Beta', slug: 'beta' }
    const result = classifyPersona({
      memberships: [a, b],
      defaultLeagueId: 'l-a',
      preferredLeagueId: 'l-b',
    })
    expect(result.kind).toBe('multi')
    if (result.kind === 'multi') {
      expect(result.activeLeagueId).toBe('l-b')
      // Stored default is preserved on the persona shape — only the
      // active pick changed. The next visit (without a query param)
      // still lands on `l-a` until `touchUserDefaultLeague` writes
      // the new value.
      expect(result.defaultLeagueIdInDb).toBe('l-a')
    }
  })

  it('preferredLeagueId pointing at a non-membership is ignored (security regression target)', async () => {
    // Without this filter a malicious URL parameter could pin the
    // hub to any league id the attacker guesses, and the dashboard
    // bundle fetch would happen against that league. The attacker
    // wouldn't see private data — getLeaguePageBundle only returns
    // publicly-readable data — but the experience would be broken.
    const { classifyPersona } = await import('@/lib/homepageRouting')
    const a = { leagueId: 'l-a', leagueName: 'Alpha', slug: 'alpha' }
    const b = { leagueId: 'l-b', leagueName: 'Beta', slug: 'beta' }
    const result = classifyPersona({
      memberships: [a, b],
      defaultLeagueId: 'l-b',
      preferredLeagueId: 'l-not-a-member',
    })
    expect(result.kind).toBe('multi')
    if (result.kind === 'multi') {
      // Falls through: stored default → alphabetical-first.
      expect(result.activeLeagueId).toBe('l-b')
    }
  })

  it('preferredLeagueId null falls back to v1.85.0 behaviour (no regression for query-less visits)', async () => {
    const { classifyPersona } = await import('@/lib/homepageRouting')
    const a = { leagueId: 'l-a', leagueName: 'Alpha', slug: 'alpha' }
    const b = { leagueId: 'l-b', leagueName: 'Beta', slug: 'beta' }
    const result = classifyPersona({
      memberships: [a, b],
      defaultLeagueId: 'l-b',
      preferredLeagueId: null,
    })
    expect(result.kind).toBe('multi')
    if (result.kind === 'multi') {
      expect(result.activeLeagueId).toBe('l-b')
    }
  })

  it('preferredLeagueId never affects the directory persona (zero memberships)', async () => {
    const { classifyPersona } = await import('@/lib/homepageRouting')
    const result = classifyPersona({
      memberships: [],
      defaultLeagueId: null,
      preferredLeagueId: 'l-anything',
    })
    expect(result.kind).toBe('directory')
  })

  it('preferredLeagueId never affects the single persona (one membership)', async () => {
    const { classifyPersona } = await import('@/lib/homepageRouting')
    const m = { leagueId: 'l-only', leagueName: 'Only', slug: 'only' }
    const result = classifyPersona({
      memberships: [m],
      defaultLeagueId: null,
      // The "preferred" id matches NOTHING. With one membership we
      // still want the single → /id redirect, not a fallback to multi.
      preferredLeagueId: 'l-foo',
    })
    expect(result).toEqual({ kind: 'single', membership: m })
  })

  it('ResolveInput typed with preferredLeagueId so callers can pass searchParams.league', () => {
    expect(ROUTING_SRC).toMatch(
      /preferredLeagueId\?:\s*string\s*\|\s*null/,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 3) HomepageRouter accepts + forwards `preferredLeagueId`
// ────────────────────────────────────────────────────────────────────────────

describe('v1.93.0 — HomepageRouter wiring', () => {
  it('accepts preferredLeagueId prop with a sensible default (regression target)', () => {
    expect(HOMEPAGE_ROUTER_SRC).toMatch(
      /preferredLeagueId\?:\s*string\s*\|\s*null/,
    )
  })

  it('forwards preferredLeagueId into resolveHomepagePersona (regression target)', () => {
    expect(HOMEPAGE_ROUTER_SRC).toMatch(
      /resolveHomepagePersona\([\s\S]*?preferredLeagueId:\s*preferredLeagueId\s*\?\?\s*null/,
    )
  })

  it('passes viewer = { userId, lineId } to MultiLeagueHub so touchUserDefaultLeague can fire', () => {
    expect(HOMEPAGE_ROUTER_SRC).toMatch(/viewer=\{\{\s*userId,\s*lineId\s*\}\}/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 4) /test page reads + normalises searchParams.league
// ────────────────────────────────────────────────────────────────────────────

describe('v1.93.0 — /test page forwards searchParams.league', () => {
  it('takes a searchParams promise and forwards the normalised league id', () => {
    expect(TEST_PAGE_SRC).toMatch(/searchParams:\s*SearchParams/)
    expect(TEST_PAGE_SRC).toMatch(/await\s+searchParams/)
    expect(TEST_PAGE_SRC).toMatch(/preferredLeagueId=\{preferredLeagueId\}/)
  })

  it('normalises array / empty-string variants to null (regression target)', () => {
    // Without this the array form (`?league=a&league=b`) would slip
    // through as `string[]` and break the downstream typing. The empty
    // string is also rejected so an empty `?league=` doesn't shadow the
    // stored default.
    expect(TEST_PAGE_SRC).toMatch(
      /typeof\s+raw\s*===\s*['"]string['"]\s*&&\s*raw\.length\s*>\s*0\s*\?\s*raw\s*:\s*null/,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 5) Switcher uses Link + prefetch + useOptimistic + useTransition
// ────────────────────────────────────────────────────────────────────────────

describe('v1.93.0 — LeagueSwitcherTabs prefetch + optimistic flow', () => {
  it('imports next/link Link and renders prefetched links per pill (regression target)', () => {
    expect(SWITCHER_TABS_SRC).toMatch(
      /import\s+Link\s+from\s+['"]next\/link['"]/,
    )
    expect(SWITCHER_TABS_SRC).toMatch(/<Link[\s\S]*?prefetch[\s\S]*?>/)
  })

  it('href points at the apex with the league as a query param (regression target)', () => {
    // The switcher declares the URL as a `const href = …` so the same
    // string can be passed both to `<Link href>` and to the
    // `pickLeague` handler (router.push needs the same value). Pin
    // both: the const declaration AND the prop wiring.
    expect(SWITCHER_TABS_SRC).toMatch(
      /const\s+href\s*=\s*`\/test\?league=\$\{encodeURIComponent\(m\.leagueId\)\}`/,
    )
    expect(SWITCHER_TABS_SRC).toMatch(/href=\{href\}/)
  })

  it('uses React useOptimistic for instant active-pill swap (regression target)', () => {
    // Pre-v1.93.0 the switcher computed `selected` from
    // `activeLeagueId` directly, so during pending the OLD active
    // pill received the visual change — verified UX bug.
    expect(SWITCHER_TABS_SRC).toMatch(
      /import\s*\{[^}]*\buseOptimistic\b[^}]*\}\s+from\s+['"]react['"]/,
    )
    expect(SWITCHER_TABS_SRC).toMatch(/useOptimistic\(activeLeagueId\)/)
    expect(SWITCHER_TABS_SRC).toMatch(/m\.leagueId\s*===\s*optimisticActiveId/)
  })

  it('shares the hub transition (no duplicate useTransition in the switcher)', () => {
    expect(SWITCHER_TABS_SRC).toMatch(
      /import\s*\{\s*useHubTransition\s*\}\s+from\s+['"]\.\/HubTransitionShell['"]/,
    )
    expect(SWITCHER_TABS_SRC).toMatch(/useHubTransition\(\)/)
    // Switcher must not own its own useTransition — the shell is the
    // single owner so the page-level progress strip stays in sync.
    expect(SWITCHER_TABS_SRC).not.toMatch(/useTransition\(\)/)
  })

  it('navigates inside startNavigation so optimistic state and router.push share one transition', () => {
    expect(SWITCHER_TABS_SRC).toMatch(
      /startNavigation\(\(\)\s*=>\s*\{[\s\S]*?setOptimisticActiveId\(leagueId\)[\s\S]*?router\.push\(href[\s\S]*?\}\)/,
    )
  })

  it('preserves power-user gestures (cmd / ctrl / shift / alt / middle-click)', () => {
    // Without this the switcher would always preventDefault and break
    // "open in new tab" semantics for keyboard / power users.
    expect(SWITCHER_TABS_SRC).toMatch(/metaKey/)
    expect(SWITCHER_TABS_SRC).toMatch(/ctrlKey/)
    expect(SWITCHER_TABS_SRC).toMatch(/shiftKey/)
    expect(SWITCHER_TABS_SRC).toMatch(/altKey/)
    expect(SWITCHER_TABS_SRC).toMatch(/e\.button\s*!==\s*0/)
  })

  it('short-circuits same-league taps so we do not refetch the same RSC payload (regression target)', () => {
    expect(SWITCHER_TABS_SRC).toMatch(/leagueId\s*===\s*activeLeagueId/)
  })

  it('shows tactile press via active:scale (CSS-only, no JS)', () => {
    expect(SWITCHER_TABS_SRC).toMatch(/active:scale-\[0\.96\]/)
  })

  it('only spins the just-clicked pill (selected via OPTIMISTIC id, not stale active id)', () => {
    // The v1.85.0 implementation pulsed the OLD active pill because
    // `selected` was computed from `activeLeagueId`. With useOptimistic
    // the spinner now follows the user's tap. Regression target:
    // reverting `selected` back to `activeLeagueId` puts the spinner
    // on the wrong pill again.
    expect(SWITCHER_TABS_SRC).toMatch(
      /const\s+selected\s*=\s*m\.leagueId\s*===\s*optimisticActiveId/,
    )
    expect(SWITCHER_TABS_SRC).toMatch(/showSpinner\s*=\s*isPending\s*&&\s*selected/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 6) HubTransitionShell shape
// ────────────────────────────────────────────────────────────────────────────

describe('v1.93.0 — HubTransitionShell', () => {
  it('is a client component', () => {
    expect(HUB_SHELL_SRC).toMatch(/^['"]use client['"]/)
  })

  it('exposes useHubTransition + the default export shell', () => {
    expect(HUB_SHELL_SRC).toMatch(/export\s+function\s+useHubTransition/)
    expect(HUB_SHELL_SRC).toMatch(/export\s+default\s+function\s+HubTransitionShell/)
  })

  it('owns a single useTransition and exposes startNavigation through context', () => {
    expect(HUB_SHELL_SRC).toMatch(/useTransition\(\)/)
    expect(HUB_SHELL_SRC).toMatch(/startNavigation/)
    expect(HUB_SHELL_SRC).toMatch(/createContext/)
  })

  it('renders a top-edge progress strip while the transition is pending (regression target)', () => {
    expect(HUB_SHELL_SRC).toMatch(/isPending/)
    expect(HUB_SHELL_SRC).toMatch(/data-testid=["']hub-transition-progress["']/)
    expect(HUB_SHELL_SRC).toMatch(/animate-hub-progress/)
  })

  it('progress strip sits above the sticky Header (z >= 60)', () => {
    expect(HUB_SHELL_SRC).toMatch(/z-\[60\]/)
  })
})

describe('v1.93.0 — globals.css carries the hub-progress keyframe', () => {
  it('keyframes hub-progress is defined', () => {
    expect(GLOBALS_CSS).toMatch(/@keyframes\s+hub-progress\s*\{/)
  })

  it('animate-hub-progress utility class is defined', () => {
    expect(GLOBALS_CSS).toMatch(/\.animate-hub-progress\s*\{[\s\S]*?animation:\s*hub-progress/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 7) MultiLeagueHub fires touchUserDefaultLeague + wraps in HubTransitionShell
// ────────────────────────────────────────────────────────────────────────────

describe('v1.93.0 — MultiLeagueHub wiring', () => {
  it('imports touchUserDefaultLeague (regression target)', () => {
    expect(MULTI_HUB_SRC).toMatch(
      /import\s*\{\s*touchUserDefaultLeague\s*\}\s+from\s+['"]@\/lib\/userDefaultLeague['"]/,
    )
  })

  it('calls touchUserDefaultLeague with the active league + viewer identifiers', () => {
    expect(MULTI_HUB_SRC).toMatch(
      /touchUserDefaultLeague\(\{[\s\S]*?userId:\s*viewer\.userId[\s\S]*?lineId:\s*viewer\.lineId[\s\S]*?leagueId:\s*activeLeagueId[\s\S]*?\}\)/,
    )
  })

  it('accepts viewer prop typed { userId, lineId }', () => {
    expect(MULTI_HUB_SRC).toMatch(
      /viewer:\s*\{\s*userId:\s*string\s*\|\s*null;\s*lineId:\s*string\s*\|\s*null\s*\}/,
    )
  })

  it('wraps the Dashboard in HubTransitionShell so the switcher transition surfaces visually', () => {
    expect(MULTI_HUB_SRC).toMatch(
      /import\s+HubTransitionShell\s+from\s+['"]\.\/HubTransitionShell['"]/,
    )
    expect(MULTI_HUB_SRC).toMatch(/<HubTransitionShell>[\s\S]*?<Dashboard/)
  })

  it('switcher prop wiring is unchanged: memberships + activeLeagueId still flow through topSlot', () => {
    expect(MULTI_HUB_SRC).toMatch(/topSlot=\{topSlot\}/)
    expect(MULTI_HUB_SRC).toMatch(/<LeagueSwitcherTabs/)
  })
})
