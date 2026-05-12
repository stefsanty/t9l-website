/**
 * v1.99.0 — Suspense streaming for the league dashboard.
 *
 * Pre-v1.99.0 `/id/<slug>/page.tsx` + `<MultiLeagueHub>` were single
 * async functions that awaited the heavy bundle BEFORE flushing any
 * HTML. User report (prod measurement): warm 4-6 s of dead screen,
 * cold up to 10 s. Post-v1.99.0 those routes flush a streaming shell
 * (Header + LeagueSwitcher) immediately and wrap the heavy bundle in
 * `<Suspense fallback={<DashboardBodySkeleton />}>` so React streams
 * the body chunk in when ready.
 *
 * Companion changes:
 *   - Dashboard accepts a `noHeader` prop so the shell-rendered Header
 *     is the only one mounted on streaming routes.
 *   - Dashboard's v1.97.0 `useHubTransition`-driven body pulse is gone
 *     — the Suspense fallback IS the loading state. HubTransitionShell
 *     still renders its top-edge progress strip; LeagueSwitcher still
 *     reads `useHubTransition()` for that.
 *
 * Each assertion is a regression target. Stash-pop sanity verified.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')

const VERSION_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/version.ts'),
  'utf8',
)
const CLAUDE_MD = readFileSync(join(REPO_ROOT, 'CLAUDE.md'), 'utf8')
const LEDGER_MD = readFileSync(
  join(REPO_ROOT, 'docs/ledger.md'),
  'utf8',
)
const SKELETON_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/DashboardBodySkeleton.tsx'),
  'utf8',
)
const DASHBOARD_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/Dashboard.tsx'),
  'utf8',
)
const ID_SLUG_PAGE_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/id/[slug]/page.tsx'),
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

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

// ────────────────────────────────────────────────────────────────────────────
// 1) Version + release pins
// ────────────────────────────────────────────────────────────────────────────

describe('v1.99.0 — version pin', () => {
  it('APP_VERSION reads 1.99.0', () => {
    expect(VERSION_SRC).toMatch(/APP_VERSION\s*=\s*['"](?:1\.99\.0|[2-9]\.\d+\.\d+)['"]/)
  })

  it('CLAUDE.md header reflects current release', () => {
    expect(CLAUDE_MD).toMatch(/\*\*Current release:\*\*\s*(?:v1\.99\.0|v[2-9]\.\d+\.\d+)/)
  })

  it('docs/ledger.md top entry is v1.99.0', () => {
    // The active ledger's first bullet should be the newest.
    const firstBullet = LEDGER_MD.split('\n').find((line) =>
      line.startsWith('- **v'),
    )
    expect(firstBullet).toBeDefined()
    expect(firstBullet).toMatch(/^- \*\*v1\.99\.0\*\*/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 2) DashboardBodySkeleton — shape + footprint
// ────────────────────────────────────────────────────────────────────────────

describe('v1.99.0 — DashboardBodySkeleton', () => {
  it('exists as a default-exported component', () => {
    expect(SKELETON_SRC).toMatch(
      /export\s+default\s+function\s+DashboardBodySkeleton/,
    )
  })

  it('renders a wrapper matching the live Dashboard column shape', () => {
    // Same outer flex column + max-w-lg centring as Dashboard so the
    // Suspense fallback → resolved swap is a content replace with no
    // column-width / CLS jump.
    expect(SKELETON_SRC).toMatch(/flex flex-col min-h-dvh/)
    expect(SKELETON_SRC).toMatch(/max-w-lg mx-auto/)
  })

  it('reserves header clearance via pt-12 on its inner main', () => {
    // Matches Dashboard's `<main className="flex-1 px-4 ... pt-12">`
    // so the skeleton body sits below the fixed Header band.
    expect(SKELETON_SRC).toMatch(/pt-12/)
  })

  it('uses animate-pulse on the placeholder cards', () => {
    expect(SKELETON_SRC).toMatch(/animate-pulse/)
  })

  it('tags the skeleton with aria-busy="true" + data-testid for selectors', () => {
    expect(SKELETON_SRC).toMatch(/aria-busy=["']true["']/)
    expect(SKELETON_SRC).toMatch(
      /data-testid=["']dashboard-body-skeleton["']/,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 3) Dashboard — noHeader prop + body-pulse removed
// ────────────────────────────────────────────────────────────────────────────

describe('v1.99.0 — Dashboard supports noHeader + no body-pulse', () => {
  it('declares a noHeader?: boolean prop on DashboardProps', () => {
    expect(DASHBOARD_SRC).toMatch(/noHeader\?\s*:\s*boolean/)
  })

  it('destructures noHeader with default false in the function signature', () => {
    expect(stripComments(DASHBOARD_SRC)).toMatch(/noHeader\s*=\s*false/)
  })

  it('skips Header render when noHeader is true', () => {
    // The Header invocation is gated on `!noHeader`. Pre-v1.99.0 it
    // was unconditional.
    expect(DASHBOARD_SRC).toMatch(/!noHeader\s*&&\s*\(\s*\n?\s*<Header/)
  })

  it('no longer imports useHubTransition (body-pulse is gone)', () => {
    expect(stripComments(DASHBOARD_SRC)).not.toMatch(
      /import\s*\{[^}]*useHubTransition[^}]*\}\s+from\s+['"]\.\/homepage\/HubTransitionShell['"]/,
    )
  })

  it('does NOT bind aria-busy={isHubPending} on the body wrapper', () => {
    // The v1.97.0 body-pulse pattern is replaced by the Suspense
    // fallback. Re-introducing this pattern would double-up with the
    // streaming skeleton.
    expect(stripComments(DASHBOARD_SRC)).not.toMatch(
      /aria-busy=\{isHubPending\}/,
    )
  })

  it('does NOT toggle animate-pulse + pointer-events-none on isHubPending', () => {
    expect(stripComments(DASHBOARD_SRC)).not.toMatch(
      /isHubPending[\s\S]{0,80}animate-pulse[\s\S]{0,80}pointer-events-none/,
    )
  })

  it('keeps the data-testid="dashboard-body" wrapper for downstream selectors', () => {
    expect(DASHBOARD_SRC).toMatch(/data-testid=["']dashboard-body["']/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 4) /id/[slug]/page.tsx — Suspense streaming shell
// ────────────────────────────────────────────────────────────────────────────

describe('v1.99.0 — /id/[slug]/page.tsx hoists Header + suspends body', () => {
  it('imports Suspense from react', () => {
    expect(ID_SLUG_PAGE_SRC).toMatch(
      /import\s*\{\s*Suspense\s*\}\s+from\s+['"]react['"]/,
    )
  })

  it('imports DashboardBodySkeleton + Header', () => {
    expect(ID_SLUG_PAGE_SRC).toMatch(
      /import\s+DashboardBodySkeleton\s+from\s+['"]@\/components\/DashboardBodySkeleton['"]/,
    )
    expect(ID_SLUG_PAGE_SRC).toMatch(
      /import\s+Header\s+from\s+['"]@\/components\/Header['"]/,
    )
  })

  it('renders <Header> in the page-level shell (outside Suspense)', () => {
    const stripped = stripComments(ID_SLUG_PAGE_SRC)
    // Header appears BEFORE the Suspense element in the JSX tree.
    const headerIdx = stripped.search(/<Header\s/)
    const suspenseIdx = stripped.search(/<Suspense\b/)
    expect(headerIdx).toBeGreaterThan(-1)
    expect(suspenseIdx).toBeGreaterThan(-1)
    expect(headerIdx).toBeLessThan(suspenseIdx)
  })

  it('wraps the heavy data fetch in <Suspense fallback={<DashboardBodySkeleton />}>', () => {
    expect(ID_SLUG_PAGE_SRC).toMatch(
      /<Suspense\s+fallback=\{<DashboardBodySkeleton\s*\/?>\s*\}>/,
    )
  })

  it('passes noHeader to Dashboard so the shell Header is the only one rendered', () => {
    expect(ID_SLUG_PAGE_SRC).toMatch(/<Dashboard[\s\S]*?\bnoHeader\b/)
  })

  it('defines an async LeagueDashboardContents server component as the suspense child', () => {
    expect(ID_SLUG_PAGE_SRC).toMatch(
      /async\s+function\s+LeagueDashboardContents/,
    )
  })

  it('the suspense child runs the heavy Promise.all data fetch', () => {
    // The legacy inline 7-call Promise.all moves into the suspended
    // child. Pin a representative pair of calls so the structure
    // can't accidentally regress to a single sequential await.
    expect(ID_SLUG_PAGE_SRC).toMatch(/await\s+Promise\.all\(\[/)
    expect(ID_SLUG_PAGE_SRC).toMatch(/getPublicLeagueData\(leagueId\)/)
  })

  it('regression target: heavy reads do NOT run in the outer page function', () => {
    // Pre-v1.99.0 the page itself awaited the Promise.all. After the
    // refactor the only awaits in the OUTER `LeagueByIdPage` are
    // params + slug → leagueId resolution. We slice the source on
    // `async function LeagueDashboardContents` and assert the heavy
    // calls live strictly in the child slice.
    const stripped = stripComments(ID_SLUG_PAGE_SRC)
    const idx = stripped.indexOf('async function LeagueDashboardContents')
    expect(idx).toBeGreaterThan(-1)
    const outer = stripped.slice(0, idx)
    const child = stripped.slice(idx)
    expect(outer).not.toMatch(/getPublicLeagueData\(/)
    expect(outer).not.toMatch(/Promise\.all\(/)
    expect(child).toMatch(/getPublicLeagueData\(/)
    expect(child).toMatch(/Promise\.all\(/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 5) <MultiLeagueHub> — Suspense streaming shell
// ────────────────────────────────────────────────────────────────────────────

describe('v1.99.0 — MultiLeagueHub hoists Header + suspends body', () => {
  it('imports Suspense from react', () => {
    expect(MULTI_HUB_SRC).toMatch(
      /import\s*\{\s*Suspense\s*\}\s+from\s+['"]react['"]/,
    )
  })

  it('imports DashboardBodySkeleton + Header', () => {
    expect(MULTI_HUB_SRC).toMatch(
      /import\s+DashboardBodySkeleton\s+from\s+['"]@\/components\/DashboardBodySkeleton['"]/,
    )
    expect(MULTI_HUB_SRC).toMatch(
      /import\s+Header\s+from\s+['"]@\/components\/Header['"]/,
    )
  })

  it('renders <Header leagueTitle={active.leagueName}> in the shell (outside Suspense)', () => {
    expect(MULTI_HUB_SRC).toMatch(
      /<Header[\s\S]*?leagueTitle=\{active\.leagueName\}/,
    )
    const stripped = stripComments(MULTI_HUB_SRC)
    const headerIdx = stripped.search(/<Header\s/)
    const suspenseIdx = stripped.search(/<Suspense\b/)
    expect(headerIdx).toBeGreaterThan(-1)
    expect(suspenseIdx).toBeGreaterThan(-1)
    expect(headerIdx).toBeLessThan(suspenseIdx)
  })

  it('wraps the body in <Suspense fallback={<DashboardBodySkeleton />}>', () => {
    expect(MULTI_HUB_SRC).toMatch(
      /<Suspense\s+fallback=\{<DashboardBodySkeleton\s*\/?>\s*\}>/,
    )
  })

  it('the outer MultiLeagueHub is NOT async (so the shell flushes synchronously)', () => {
    // Pre-v1.99.0 MultiLeagueHub was `export default async function`.
    // Post-refactor the heavy fetch moves into MultiLeagueHubBody and
    // the outer hub is a plain sync server component.
    expect(MULTI_HUB_SRC).toMatch(
      /export\s+default\s+function\s+MultiLeagueHub\b/,
    )
    expect(MULTI_HUB_SRC).not.toMatch(
      /export\s+default\s+async\s+function\s+MultiLeagueHub\b/,
    )
  })

  it('defines an async MultiLeagueHubBody server component as the suspense child', () => {
    expect(MULTI_HUB_SRC).toMatch(
      /async\s+function\s+MultiLeagueHubBody/,
    )
  })

  it('the suspense child awaits getLeaguePageBundle', () => {
    expect(MULTI_HUB_SRC).toMatch(/await\s+getLeaguePageBundle\(/)
  })

  it('still wraps everything in <HubTransitionShell> so the switcher progress strip survives', () => {
    expect(MULTI_HUB_SRC).toMatch(/<HubTransitionShell>/)
    expect(MULTI_HUB_SRC).toMatch(/<\/HubTransitionShell>/)
  })

  it('passes noHeader to Dashboard so the shell Header is the only one rendered', () => {
    expect(MULTI_HUB_SRC).toMatch(/<Dashboard[\s\S]*?\bnoHeader\b/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 6) HubTransitionShell preserved — top-edge progress strip survives
// ────────────────────────────────────────────────────────────────────────────

describe('v1.99.0 — HubTransitionShell still owns the switcher progress strip', () => {
  it('renders the top-edge progress strip when isPending', () => {
    expect(HUB_SHELL_SRC).toMatch(/data-testid=["']hub-transition-progress["']/)
    expect(HUB_SHELL_SRC).toMatch(/isPending\s*\?/)
  })

  it('still exports useHubTransition for LeagueSwitcher to read', () => {
    expect(HUB_SHELL_SRC).toMatch(/export\s+function\s+useHubTransition/)
  })
})
