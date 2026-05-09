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
 *      into `/id/[slug]` and `/id/[slug]/md/[id]`.
 *   5. `setUserDefaultLeague(...)` server action invoked by the
 *      switcher tab strip.
 *
 * Tests are a mix of source-string structural pins (project convention)
 * and runtime assertions through hoisted mocks (mirrors v1.84.0's
 * `applyToLeague` shape). Each runtime assertion is a regression
 * target — stash-pop verified the suite fails when the corresponding
 * production code is reverted to the broken pre-v1.85.0 state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
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
const SWITCHER_TABS_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/homepage/LeagueSwitcherTabs.tsx'),
  'utf8',
)
const RECRUITING_HANDOFF_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/homepage/RecruitingHandoff.tsx'),
  'utf8',
)
const ACTIONS_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/homepage/actions.ts'),
  'utf8',
)
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
  it('reads session via getServerSession + authOptions', () => {
    expect(HOMEPAGE_ROUTER_SRC).toMatch(/getServerSession\s*\(\s*authOptions\s*\)/)
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
    expect(HOMEPAGE_ROUTER_SRC).toMatch(/resolveHomepagePersona\(\s*\{\s*userId,\s*lineId\s*\}/)
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

  it('passes switcher + handoff via Dashboard topSlot prop (no Header double-mount)', () => {
    // Regression target: rendering switcher OUTSIDE Dashboard would
    // be hidden behind the fixed Header. The topSlot prop is the
    // contract that makes the layout work.
    expect(MULTI_HUB_SRC).toMatch(/topSlot=\{topSlot\}/)
    expect(MULTI_HUB_SRC).toMatch(/<LeagueSwitcherTabs/)
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

describe('v1.85.0 — LeagueSwitcherTabs (Option A pill strip)', () => {
  it('is a client component (uses "use client")', () => {
    expect(SWITCHER_TABS_SRC).toMatch(/^['"]use client['"]/)
  })

  it('hides itself when memberships < 2 (defense; persona resolver should not even reach this)', () => {
    expect(SWITCHER_TABS_SRC).toMatch(/memberships\.length\s*<\s*2/)
    expect(SWITCHER_TABS_SRC).toMatch(/return\s+null/)
  })

  it('calls setUserDefaultLeague server action + router.refresh on pick', () => {
    expect(SWITCHER_TABS_SRC).toMatch(/setUserDefaultLeague\(leagueId\)/)
    expect(SWITCHER_TABS_SRC).toMatch(/router\.refresh\(\)/)
  })

  it('renders pill testids per league for switcher targeting', () => {
    expect(SWITCHER_TABS_SRC).toMatch(/data-testid=\{`league-switcher-tab-\$\{m\.slug\}`\}/)
  })

  it('marks the active tab via data-active + aria-pressed', () => {
    expect(SWITCHER_TABS_SRC).toMatch(/data-active=\{selected\s*\?\s*['"]true['"]\s*:\s*['"]false['"]\}/)
    expect(SWITCHER_TABS_SRC).toMatch(/aria-pressed=\{selected\}/)
  })

  it('uses overflow-x-auto so 5+ leagues scroll horizontally on mobile', () => {
    expect(SWITCHER_TABS_SRC).toMatch(/overflow-x-auto/)
  })
})

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
// 8) setUserDefaultLeague server action — runtime gates
// ────────────────────────────────────────────────────────────────────────────

const {
  sessionMock,
  userFindUniqueMock,
  playerFindFirstMock,
  userUpdateMock,
} = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  playerFindFirstMock: vi.fn(),
  userUpdateMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: userFindUniqueMock, update: userUpdateMock },
    player: { findFirst: playerFindFirstMock },
  },
}))

const { setUserDefaultLeague } = await import('@/components/homepage/actions')

beforeEach(() => {
  vi.clearAllMocks()
  sessionMock.mockResolvedValue({ userId: 'u-1', lineId: null })
  userFindUniqueMock.mockResolvedValue({
    id: 'u-1',
    playerId: 'p-1',
    defaultLeagueId: null,
  })
  playerFindFirstMock.mockResolvedValue({
    leagueAssignments: [{ id: 'plm-1' }],
  })
})

describe('v1.85.0 — setUserDefaultLeague server action gates', () => {
  it('declares "use server" so it can be invoked from the client switcher', () => {
    expect(ACTIONS_SRC).toMatch(/^['"]use server['"]/)
  })

  it('rejects unauthenticated callers (no session)', async () => {
    sessionMock.mockResolvedValue(null)
    const result = await setUserDefaultLeague('league-1')
    expect(result).toEqual({ ok: false, error: 'unauthenticated' })
    expect(userUpdateMock).not.toHaveBeenCalled()
  })

  it('rejects admin-credentials sessions (no userId AND no lineId)', async () => {
    sessionMock.mockResolvedValue({ userId: null, lineId: null })
    const result = await setUserDefaultLeague('league-1')
    expect(result).toEqual({ ok: false, error: 'unauthenticated' })
    expect(userUpdateMock).not.toHaveBeenCalled()
  })

  it('rejects empty leagueId (defensive — the client should never send this)', async () => {
    const result = await setUserDefaultLeague('')
    expect(result).toEqual({ ok: false, error: 'invalid_input' })
    expect(userUpdateMock).not.toHaveBeenCalled()
  })

  it('rejects when the user has no APPROVED PLM in the picked league (regression target)', async () => {
    playerFindFirstMock.mockResolvedValue({ leagueAssignments: [] })
    const result = await setUserDefaultLeague('league-stranger')
    expect(result).toEqual({ ok: false, error: 'not_a_member' })
    expect(userUpdateMock).not.toHaveBeenCalled()
  })

  it('writes User.defaultLeagueId on success', async () => {
    const result = await setUserDefaultLeague('league-pick')
    expect(result).toEqual({ ok: true })
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { defaultLeagueId: 'league-pick' },
    })
  })

  it('skips the write when defaultLeagueId already equals the picked id (no-op fast path)', async () => {
    userFindUniqueMock.mockResolvedValue({
      id: 'u-1',
      playerId: 'p-1',
      defaultLeagueId: 'league-pick',
    })
    const result = await setUserDefaultLeague('league-pick')
    expect(result).toEqual({ ok: true })
    expect(userUpdateMock).not.toHaveBeenCalled()
  })

  it('admin-orthogonal — accepts lineId-only sessions (no userId)', async () => {
    // The action skips the userId branch entirely when userId is null, so
    // the lineId fallback is the ONLY call into user.findUnique. Mirrors
    // the v1.80.10 admin-orthogonal-UX fix shape: legacy LINE sessions
    // with no userId on the JWT must not dead-end at the directory.
    sessionMock.mockResolvedValue({ userId: null, lineId: 'L1' })
    userFindUniqueMock.mockResolvedValueOnce({
      id: 'u-1',
      playerId: 'p-1',
      defaultLeagueId: null,
    })
    const result = await setUserDefaultLeague('league-pick')
    expect(result).toEqual({ ok: true })
    expect(userUpdateMock).toHaveBeenCalled()
    expect(userFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { lineId: 'L1' } }),
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 9) getApprovedMembershipsAndDefault — source-string pins
//    Runtime tests would require a third Prisma mock layered on top of the
//    one already wired for setUserDefaultLeague; keeping these as
//    structural pins avoids mock contention while still guarding the
//    contract that classifyPersona depends on.
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
