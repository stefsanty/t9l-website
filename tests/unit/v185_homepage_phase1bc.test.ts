/**
 * v1.85.0 — homepage redesign phase 1b/1c.
 *
 * Phase 1a (v1.84.0) shipped the schema foundation: `LeagueVisibility`
 * enum + `User.defaultLeagueId` nullable FK. This phase wires the
 * persona-aware apex on top of those columns:
 *
 *   1. `<HomepageRouter>` — server component that classifies a viewer
 *      into one of three personas (directory / single / multi) and
 *      renders the right surface, mounted at `/test` for preview.
 *   2. `<LeagueDirectory>` — public listing of every non-PRIVATE
 *      league. Mounted by `<HomepageRouter>` for the directory persona
 *      AND directly at `/test/directory` for shareability.
 *   3. `<MultiLeagueHub>` + `<LeagueSwitcherTabs>` +
 *      `<RecruitingHandoff>` — multi-league surface for users with ≥ 2
 *      APPROVED memberships.
 *   4. `touchUserDefaultLeague(...)` — last-selected tracking wired
 *      into `/id/[slug]` and `/id/[slug]/md/[id]`. v1.93.0 also wires
 *      it into `<MultiLeagueHub>` itself; that pin lives in the v1.93
 *      regression-target file.
 *   5. `setUserDefaultLeague(...)` server action — REMOVED in v1.93.0.
 *      The new prefetch-based switcher is pinned separately.
 *
 * Tests are a mix of source-string structural pins (project convention)
 * and runtime assertions through hoisted mocks (mirrors v1.84.0's
 * `applyToLeague` shape). Each runtime assertion is a regression
 * target — stash-pop verified the suite fails when the corresponding
 * production code is reverted to the broken pre-v1.85.0 state.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')
const VERSION_SRC = readFileSync(join(REPO_ROOT, 'src/lib/version.ts'), 'utf8')
const ROUTING_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/homepageRouting.ts'),
  'utf8',
)
const TOUCH_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/userDefaultLeague.ts'),
  'utf8',
)
const DIRECTORY_DATA_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/leagueDirectoryData.ts'),
  'utf8',
)
const HOMEPAGE_ROUTER_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/homepage/HomepageRouter.tsx'),
  'utf8',
)
const LEAGUE_DIRECTORY_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/homepage/LeagueDirectory.tsx'),
  'utf8',
)
const MULTI_HUB_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/homepage/MultiLeagueHub.tsx'),
  'utf8',
)
// v1.97.1 — `LeagueSwitcherTabs.tsx` deleted. The canonical league picker
// is the Header chevron (`src/components/LeagueSwitcher.tsx`) which opens
// a 1-line scrollable bar. The behaviour previously pinned on the tabs
// source (useOptimistic, useHubTransition, prefetch links, power-user
// gestures, same-league short-circuit) is pinned on the new chevron in
// `tests/unit/v1971_header_chevron_bar.test.ts`.
const RECRUITING_HANDOFF_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/homepage/RecruitingHandoff.tsx'),
  'utf8',
)
// v1.93.0 — `src/components/homepage/actions.ts` deleted. The switcher
// no longer routes through `setUserDefaultLeague`; `MultiLeagueHub`
// fires `touchUserDefaultLeague` via `waitUntil` instead. The new
// behaviour is pinned in `tests/unit/v193_league_picker_perf.test.ts`.
const TEST_PAGE_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/test/page.tsx'),
  'utf8',
)
const TEST_DIRECTORY_PAGE_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/test/directory/page.tsx'),
  'utf8',
)
const APEX_SRC = readFileSync(join(REPO_ROOT, 'src/app/page.tsx'), 'utf8')
const ID_SLUG_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/id/[slug]/page.tsx'),
  'utf8',
)
const ID_SLUG_MD_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/id/[slug]/md/[id]/page.tsx'),
  'utf8',
)
const DASHBOARD_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/Dashboard.tsx'),
  'utf8',
)

// ────────────────────────────────────────────────────────────────────────────
// 1) Version bump
// ────────────────────────────────────────────────────────────────────────────

describe('v1.85.0 — APP_VERSION bumped', () => {
  it('APP_VERSION is at least 1.85.0', () => {
    expect(VERSION_SRC).toMatch(
      /APP_VERSION\s*=\s*['"]1\.(85\.\d+|8[6-9]\.\d+|9\d?\.\d+)['"]/,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 2) Preview mounts at /test (NOT at apex /)
// ────────────────────────────────────────────────────────────────────────────

describe('v1.85.0 — preview mount at /test, apex untouched', () => {
  it('/test page renders <HomepageRouter />', () => {
    expect(TEST_PAGE_SRC).toMatch(
      /import\s+HomepageRouter\s+from\s+['"]@\/components\/homepage\/HomepageRouter['"]/,
    )
    expect(TEST_PAGE_SRC).toMatch(/<HomepageRouter\s*\/>/)
  })

  it('/test/directory page renders <LeagueDirectory /> directly (shareable URL)', () => {
    expect(TEST_DIRECTORY_PAGE_SRC).toMatch(
      /import\s+LeagueDirectory\s+from\s+['"]@\/components\/homepage\/LeagueDirectory['"]/,
    )
    expect(TEST_DIRECTORY_PAGE_SRC).toMatch(
      /import\s*\{\s*getDirectoryLeagues\s*\}\s+from\s+['"]@\/lib\/leagueDirectoryData['"]/,
    )
    expect(TEST_DIRECTORY_PAGE_SRC).toMatch(/<LeagueDirectory\s+leagues=\{leagues\}/)
  })

  it('apex `/page.tsx` is untouched — does NOT mount HomepageRouter (preview is /test only)', () => {
    expect(APEX_SRC).not.toMatch(/HomepageRouter/)
    // Sanity — apex still mounts the legacy default-league Dashboard.
    expect(APEX_SRC).toMatch(/import\s+Dashboard\s+from\s+['"]@\/components\/Dashboard['"]/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 3) Persona resolver — pure classifier
// ────────────────────────────────────────────────────────────────────────────

describe('v1.85.0 — homepageRouting.classifyPersona', () => {
  it('exists as an exported pure function alongside the async resolver', () => {
    expect(ROUTING_SRC).toMatch(/export\s+function\s+classifyPersona\s*\(/)
    expect(ROUTING_SRC).toMatch(
      /export\s+async\s+function\s+resolveHomepagePersona\s*\(/,
    )
    expect(ROUTING_SRC).toMatch(
      /export\s+async\s+function\s+getApprovedMembershipsAndDefault\s*\(/,
    )
  })

  it('zero memberships → directory persona', async () => {
    const { classifyPersona } = await import('@/lib/homepageRouting')
    const result = classifyPersona({ memberships: [], defaultLeagueId: null })
    expect(result).toEqual({ kind: 'directory' })
  })

  it('one membership → single persona, regardless of defaultLeagueId', async () => {
    const { classifyPersona } = await import('@/lib/homepageRouting')
    const m = { leagueId: 'l-1', leagueName: 'Alpha', slug: 'alpha' }
    expect(classifyPersona({ memberships: [m], defaultLeagueId: null })).toEqual({
      kind: 'single',
      membership: m,
    })
    expect(classifyPersona({ memberships: [m], defaultLeagueId: 'l-1' })).toEqual({
      kind: 'single',
      membership: m,
    })
  })

  it('two+ memberships → multi persona, honours stored defaultLeagueId when valid', async () => {
    const { classifyPersona } = await import('@/lib/homepageRouting')
    const a = { leagueId: 'l-a', leagueName: 'Alpha', slug: 'alpha' }
    const b = { leagueId: 'l-b', leagueName: 'Beta', slug: 'beta' }
    const result = classifyPersona({
      memberships: [a, b],
      defaultLeagueId: 'l-b',
    })
    expect(result).toEqual({
      kind: 'multi',
      memberships: [a, b],
      activeLeagueId: 'l-b',
      defaultLeagueIdInDb: 'l-b',
    })
  })

  it('two+ memberships, null defaultLeagueId → falls back to alphabetical-first (the input is sorted)', async () => {
    const { classifyPersona } = await import('@/lib/homepageRouting')
    const a = { leagueId: 'l-a', leagueName: 'Alpha', slug: 'alpha' }
    const b = { leagueId: 'l-b', leagueName: 'Beta', slug: 'beta' }
    const result = classifyPersona({
      memberships: [a, b],
      defaultLeagueId: null,
    })
    expect(result.kind).toBe('multi')
    if (result.kind === 'multi') {
      expect(result.activeLeagueId).toBe('l-a')
      expect(result.defaultLeagueIdInDb).toBeNull()
    }
  })

  it('two+ memberships, STALE defaultLeagueId (not in memberships) → fallback (regression target)', async () => {
    const { classifyPersona } = await import('@/lib/homepageRouting')
    const a = { leagueId: 'l-a', leagueName: 'Alpha', slug: 'alpha' }
    const b = { leagueId: 'l-b', leagueName: 'Beta', slug: 'beta' }
    const result = classifyPersona({
      memberships: [a, b],
      defaultLeagueId: 'l-removed',
    })
    expect(result.kind).toBe('multi')
    if (result.kind === 'multi') {
      // Falls back to first alphabetical, NOT the stale stored value.
      // Without this guard a user removed from their preferred league
      // would crash the hub render (active league not in memberships).
      expect(result.activeLeagueId).toBe('l-a')
      // The DB value is preserved on the persona shape so the
      // switcher / future migration code can decide whether to clear
      // it explicitly.
      expect(result.defaultLeagueIdInDb).toBe('l-removed')
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 4) HomepageRouter wires session → persona → render shape
// ────────────────────────────────────────────────────────────────────────────

describe('v1.85.0 — HomepageRouter render decisions', () => {
  it('reads session via getViewer() (v1.98.0 collapse) — session lookup canonicalised in src/lib/viewer.ts', () => {
    // v1.98.0 — HomepageRouter no longer calls getServerSession directly.
    // The session+user+player resolution is centralised in the shared
    // `getViewer()` helper (request-scoped via React `cache()`) so the
    // three per-render readers that all needed it (HomepageRouter,
    // getRecruitingViewerState, getUnpaidFeeBannerData) dedupe onto a
    // single Promise. The actual `getServerSession(authOptions)` call
    // now lives in `src/lib/viewer.ts` and is asserted in v198 regression tests.
    expect(HOMEPAGE_ROUTER_SRC).toMatch(/getViewer\s*\(\s*\)/)
    expect(HOMEPAGE_ROUTER_SRC).toMatch(
      /import\s*\{\s*getViewer\s*\}\s*from\s*['"]@\/lib\/viewer['"]/,
    )
  })

  it('imports redirect from next/navigation', () => {
    expect(HOMEPAGE_ROUTER_SRC).toMatch(
      /import\s*\{\s*redirect\s*\}\s+from\s+['"]next\/navigation['"]/,
    )
  })

  it('single persona → server-side redirect to /id/<slug>', () => {
    // Regression target: removing the redirect call would surface
    // single-membership users on the multi hub with one tab.
    expect(HOMEPAGE_ROUTER_SRC).toMatch(
      /persona\.kind\s*===\s*['"]single['"][\s\S]*?redirect\(`\/id\/\$\{persona\.membership\.slug\}`\)/,
    )
  })

  it('multi persona → mounts <MultiLeagueHub> with memberships + activeLeagueId', () => {
    expect(HOMEPAGE_ROUTER_SRC).toMatch(/<MultiLeagueHub/)
    expect(HOMEPAGE_ROUTER_SRC).toMatch(/memberships=\{persona\.memberships\}/)
    expect(HOMEPAGE_ROUTER_SRC).toMatch(/activeLeagueId=\{persona\.activeLeagueId\}/)
    // v1.93.0 — `viewer` is the new prop carrying the resolved session
    // identifiers so MultiLeagueHub can fire touchUserDefaultLeague
    // without a second getServerSession round-trip.
    expect(HOMEPAGE_ROUTER_SRC).toMatch(/viewer=\{\{\s*userId,\s*lineId\s*\}\}/)
  })

  it('directory fallthrough → renders <LeagueDirectory> with directory data', () => {
    expect(HOMEPAGE_ROUTER_SRC).toMatch(/getDirectoryLeagues\(\)/)
    expect(HOMEPAGE_ROUTER_SRC).toMatch(/<LeagueDirectory\s+leagues=\{leagues\}/)
  })

  it('passes both userId AND lineId from the session (admin-orthogonal — supports legacy LINE sessions)', () => {
    // Mirrors the v1.80.10 admin-orthogonal-UX fix shape — the gate
    // accepts EITHER identifier so grandfathered LINE sessions don't
    // dead-end at the directory.
    expect(HOMEPAGE_ROUTER_SRC).toMatch(/userId/)
    expect(HOMEPAGE_ROUTER_SRC).toMatch(/lineId/)
    // v1.93.0 added a third arg (preferredLeagueId). Match the leading
    // shape only — the v1.93 file pins the full call shape.
    expect(HOMEPAGE_ROUTER_SRC).toMatch(/resolveHomepagePersona\(\s*\{\s*userId,\s*lineId,/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 5) LeagueDirectory — public listing semantics
// ────────────────────────────────────────────────────────────────────────────

describe('v1.85.0 — LeagueDirectory + getDirectoryLeagues', () => {
  it('directory data filters out PRIVATE leagues (regression target)', () => {
    expect(DIRECTORY_DATA_SRC).toMatch(
      /visibility:\s*\{\s*not:\s*['"]PRIVATE['"]\s*\}/,
    )
  })

  it('directory data caches for 60s under the leagues tag', () => {
    expect(DIRECTORY_DATA_SRC).toMatch(/unstable_cache/)
    expect(DIRECTORY_DATA_SRC).toMatch(/revalidate:\s*60/)
    expect(DIRECTORY_DATA_SRC).toMatch(/tags:\s*\[['"]leagues['"]\]/)
  })

  it('PUBLIC_OPEN → status "recruiting", PUBLIC_CLOSED → status "closed"', () => {
    expect(DIRECTORY_DATA_SRC).toMatch(
      /row\.visibility\s*===\s*['"]PUBLIC_OPEN['"]\s*\?\s*['"]recruiting['"]\s*:\s*['"]closed['"]/,
    )
  })

  it('LeagueDirectory renders the literal "League Directory" heading', () => {
    expect(LEAGUE_DIRECTORY_SRC).toMatch(/data-testid=["']league-directory-heading["']/)
    expect(LEAGUE_DIRECTORY_SRC).toMatch(/League Directory/)
  })

  it('LeagueDirectory cards link to /id/<slug>', () => {
    expect(LEAGUE_DIRECTORY_SRC).toMatch(/href=\{`\/id\/\$\{league\.slug\}`\}/)
  })

  it('LeagueDirectory differentiates recruiting / closed via status pill', () => {
    expect(LEAGUE_DIRECTORY_SRC).toMatch(/Recruiting/)
    expect(LEAGUE_DIRECTORY_SRC).toMatch(/Closed/)
    expect(LEAGUE_DIRECTORY_SRC).toMatch(
      /league\.status\s*===\s*['"]recruiting['"]/,
    )
  })

  it('deriveSeasonLabel — JST month 4 (April) maps to spring', async () => {
    const { deriveSeasonLabel } = await import('@/lib/leagueDirectoryData')
    // Date in early April 2026 JST.
    const apr = new Date(Date.UTC(2026, 3, 1, 0, 0, 0))
    expect(deriveSeasonLabel(apr)).toBe("'26 春")
  })

  it('deriveSeasonLabel — JST month 10 (October) maps to autumn', async () => {
    const { deriveSeasonLabel } = await import('@/lib/leagueDirectoryData')
    const oct = new Date(Date.UTC(2025, 9, 1, 0, 0, 0))
    expect(deriveSeasonLabel(oct)).toBe("'25 秋")
  })

  it('deriveSeasonLabel — null in, null out', async () => {
    const { deriveSeasonLabel } = await import('@/lib/leagueDirectoryData')
    expect(deriveSeasonLabel(null)).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 6) Multi-league hub — switcher + handoff
// ────────────────────────────────────────────────────────────────────────────

describe('v1.85.0 — MultiLeagueHub composition', () => {
  it('mounts Dashboard with the active league bundle', () => {
    expect(MULTI_HUB_SRC).toMatch(
      /import\s+Dashboard\s+from\s+['"]@\/components\/Dashboard['"]/,
    )
    expect(MULTI_HUB_SRC).toMatch(/getLeaguePageBundle/)
    expect(MULTI_HUB_SRC).toMatch(/<Dashboard/)
  })

  it('passes handoff via Dashboard topSlot prop (no Header double-mount)', () => {
    // Regression target: rendering the handoff OUTSIDE Dashboard would
    // be hidden behind the fixed Header. The topSlot prop is the
    // contract that makes the layout work.
    //
    // v1.97.1 — the in-page LeagueSwitcherTabs that previously also
    // rode the topSlot has been removed; the canonical league picker is
    // now the Header chevron (`<LeagueSwitcher />`). The Header is
    // already rendered by Dashboard, so no double-mount happens.
    expect(MULTI_HUB_SRC).toMatch(/topSlot=\{topSlot\}/)
    expect(MULTI_HUB_SRC).toMatch(/<RecruitingHandoff/)
  })

  it('Dashboard exposes the topSlot prop with a sensible default', () => {
    // Pin the prop on the consumer side — Dashboard.tsx grew a
    // `topSlot?: ReactNode` param threaded through to <main>.
    expect(DASHBOARD_SRC).toMatch(/topSlot\?:\s*ReactNode/)
    expect(DASHBOARD_SRC).toMatch(/\{topSlot\}/)
  })

  it('passes excludeLeagueIds to RecruitingHandoff = the user\'s memberships (so they aren\'t re-suggested)', () => {
    expect(MULTI_HUB_SRC).toMatch(
      /excludeLeagueIds=\{excludeIds\}/,
    )
    expect(MULTI_HUB_SRC).toMatch(
      /memberships\.map\(\(m\)\s*=>\s*m\.leagueId\)/,
    )
  })
})

// v1.97.1 — the `<LeagueSwitcherTabs>` regression block previously here
// has moved to `tests/unit/v1971_header_chevron_bar.test.ts`, which
// re-pins the equivalent behaviour on the Header chevron
// (`src/components/LeagueSwitcher.tsx`). `LeagueSwitcherTabs.tsx`
// itself was deleted in v1.97.1 — the canonical league-picker is now
// the Header chevron open-state 1-line scrollable bar.

describe('v1.85.0 — RecruitingHandoff capped at 2 PUBLIC_OPEN cards', () => {
  it('reads only PUBLIC_OPEN leagues, take: 2', () => {
    expect(RECRUITING_HANDOFF_SRC).toMatch(/visibility:\s*['"]PUBLIC_OPEN['"]/)
    expect(RECRUITING_HANDOFF_SRC).toMatch(/take:\s*2/)
  })

  it('excludes leagues the user already belongs to', () => {
    expect(RECRUITING_HANDOFF_SRC).toMatch(
      /id:\s*\{\s*notIn:\s*\[\.\.\.excludeLeagueIds\]\s*\}/,
    )
  })

  it('orders by updatedAt DESC as the recency proxy', () => {
    expect(RECRUITING_HANDOFF_SRC).toMatch(
      /orderBy:\s*\[\s*\{\s*updatedAt:\s*['"]desc['"]\s*\}/,
    )
  })

  it('returns null when no candidates remain (clean look for users in every PUBLIC_OPEN league)', () => {
    expect(RECRUITING_HANDOFF_SRC).toMatch(/candidates\.length\s*===\s*0/)
    expect(RECRUITING_HANDOFF_SRC).toMatch(/return\s+null/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 7) Last-selected tracking on /id/[slug] + /id/[slug]/md/[id]
// ────────────────────────────────────────────────────────────────────────────

describe('v1.85.0 — touchUserDefaultLeague wired into league pages', () => {
  it('helper exists + uses waitUntil so the write is fire-and-forget', () => {
    expect(TOUCH_SRC).toMatch(
      /import\s*\{\s*waitUntil\s*\}\s+from\s+['"]@vercel\/functions['"]/,
    )
    expect(TOUCH_SRC).toMatch(
      /export\s+function\s+touchUserDefaultLeague\s*\(/,
    )
    expect(TOUCH_SRC).toMatch(/waitUntil\(/)
  })

  it('helper short-circuits when defaultLeagueId already matches (no needless write)', () => {
    expect(TOUCH_SRC).toMatch(/defaultLeagueId\s*===\s*leagueId/)
  })

  it('helper short-circuits without a session identifier (no userId AND no lineId)', () => {
    expect(TOUCH_SRC).toMatch(/!userId\s*&&\s*!lineId/)
  })

  it('helper requires APPROVED + current PLM in THIS league before writing (regression target)', () => {
    expect(TOUCH_SRC).toMatch(/applicationStatus:\s*['"]APPROVED['"]/)
    expect(TOUCH_SRC).toMatch(/toGameWeek:\s*null/)
    expect(TOUCH_SRC).toMatch(/leagueTeamId:\s*\{\s*not:\s*null\s*\}/)
  })

  it('/id/[slug]/page.tsx imports + invokes touchUserDefaultLeague', () => {
    expect(ID_SLUG_SRC).toMatch(
      /import\s*\{\s*touchUserDefaultLeague\s*\}\s+from\s+['"]@\/lib\/userDefaultLeague['"]/,
    )
    expect(ID_SLUG_SRC).toMatch(/touchUserDefaultLeague\(\{[\s\S]*?leagueId,?\s*\}\)/)
  })

  it('/id/[slug]/md/[id]/page.tsx imports + invokes touchUserDefaultLeague', () => {
    expect(ID_SLUG_MD_SRC).toMatch(
      /import\s*\{\s*touchUserDefaultLeague\s*\}\s+from\s+['"]@\/lib\/userDefaultLeague['"]/,
    )
    expect(ID_SLUG_MD_SRC).toMatch(/touchUserDefaultLeague\(\{[\s\S]*?leagueId,?\s*\}\)/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 8) v1.93.0 — `setUserDefaultLeague` server action and its runtime
//    gates were deleted alongside the actions module. The replacement
//    flow (Link-prefetch + searchParam-driven active league) is pinned
//    in `tests/unit/v193_league_picker_perf.test.ts`.
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// 9) getApprovedMembershipsAndDefault — source-string pins
// ────────────────────────────────────────────────────────────────────────────

describe('v1.85.0 — getApprovedMembershipsAndDefault structural pins', () => {
  it('selects defaultLeagueId from the User row', () => {
    expect(ROUTING_SRC).toMatch(/defaultLeagueId:\s*true/)
  })

  it('only counts APPROVED + toGameWeek=null + leagueTeam non-null PLMs (matches viewer-state semantics)', () => {
    expect(ROUTING_SRC).toMatch(/applicationStatus:\s*['"]APPROVED['"]/)
    expect(ROUTING_SRC).toMatch(/toGameWeek:\s*null/)
    expect(ROUTING_SRC).toMatch(/leagueTeamId:\s*\{\s*not:\s*null\s*\}/)
  })

  it('sorts memberships alphabetically by league name (deterministic fallback)', () => {
    expect(ROUTING_SRC).toMatch(/localeCompare/)
  })

  it('falls back to DEFAULT_LEAGUE_SLUG when subdomain is null but isDefault=true', () => {
    expect(ROUTING_SRC).toMatch(/DEFAULT_LEAGUE_SLUG/)
    expect(ROUTING_SRC).toMatch(/isDefault\s*\?\s*DEFAULT_LEAGUE_SLUG/)
  })
})
