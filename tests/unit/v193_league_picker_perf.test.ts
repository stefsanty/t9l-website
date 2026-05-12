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
// v1.97.1 — `LeagueSwitcherTabs.tsx` deleted. The Header chevron
// (`src/components/LeagueSwitcher.tsx`) inherits the v1.93.0 switcher
// behavior (Link prefetch, useOptimistic, useHubTransition,
// startNavigation, power-user gestures, same-league short-circuit).
// Those pins live in `tests/unit/v1971_header_chevron_bar.test.ts`.
const HEADER_SWITCHER_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/LeagueSwitcher.tsx'),
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

  // v1.97.1 — switcher source moved from
  // src/components/homepage/LeagueSwitcherTabs.tsx (deleted) to
  // src/components/LeagueSwitcher.tsx (Header chevron). The
  // "no setUserDefaultLeague" / "no router.refresh()" pins below
  // continue against the new source so the removed primitives stay
  // gone after the move.

  it('switcher source carries no executable reference to setUserDefaultLeague (regression target)', () => {
    const code = stripComments(HEADER_SWITCHER_SRC)
    expect(code).not.toMatch(/setUserDefaultLeague/)
  })

  it('switcher no longer triggers router.refresh on pick (regression target)', () => {
    // Pre-v1.93.0 the switcher chained server-action then refresh.
    // The new flow uses router.push to a search-param URL; refresh
    // would re-fetch the page WITHOUT updating the URL, defeating
    // the prefetch entirely.
    const code = stripComments(HEADER_SWITCHER_SRC)
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

// v1.97.1 — the "LeagueSwitcherTabs prefetch + optimistic flow"
// describe block previously here has moved to
// `tests/unit/v1971_header_chevron_bar.test.ts`, retargeted at the
// Header chevron (`src/components/LeagueSwitcher.tsx`) which now
// carries the same v1.93.0 behaviour (Link prefetch + useOptimistic +
// useHubTransition + power-user gestures + same-league short-circuit).

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

  it('topSlot prop wiring is preserved (handoff still threads through Dashboard)', () => {
    // v1.97.1 — pre-v1.97.1 this also asserted `<LeagueSwitcherTabs`;
    // the component is gone and the Header chevron has taken over,
    // but the topSlot contract still exists for the recruiting-handoff
    // card.
    expect(MULTI_HUB_SRC).toMatch(/topSlot=\{topSlot\}/)
  })
})
