import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * v1.25.0 — Renderer convergence: pre-v1.25.0 the apex (`t9l.me`) and
 * subdomain (`tamachi.t9l.me` etc.) public landing paths used two unrelated
 * renderers — `Dashboard` (full-feature: RSVP / NextMatchdayBanner /
 * UserTeamBadge / MatchdayAvailability) for apex, `LeaguePublicView` (3-tab
 * stripped-down schedule/standings/teams view, no auth, no RSVP) for
 * subdomains. v1.25.0 deletes `LeaguePublicView` and routes both paths
 * through `Dashboard`, fed by the v1.23.0 parameterized
 * `getPublicLeagueData(leagueId?)`.
 *
 * These tests are the regression target — a rollback to two-renderer mode
 * (or a partial rollback that re-introduces the subdomain branch in
 * `app/page.tsx`) fails one of these assertions, so the structural shape of
 * the converged page is pinned.
 */

const repoRoot = join(__dirname, '..', '..')
const pageSrcRaw = readFileSync(join(repoRoot, 'src/app/page.tsx'), 'utf8')

/**
 * Strip line + block comments so the structural assertions don't match
 * against documentation strings that legitimately reference the deleted
 * symbols (e.g. "pre-v1.25.0 page.tsx imported LeaguePublicView" in the
 * file header explanation). We're checking what the CODE references, not
 * what the comments mention.
 */
function stripComments(src: string): string {
  // Block comments first (greedy across lines), then line comments.
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const pageSrc = stripComments(pageSrcRaw)

describe('v1.25.0 — app/page.tsx renderer convergence', () => {
  it('renders the unified Dashboard component (apex + subdomain)', () => {
    expect(pageSrc).toMatch(/import\s+Dashboard\s+from\s+["']@\/components\/Dashboard["']/)
    expect(pageSrc).toMatch(/<Dashboard\b/)
  })

  it('does NOT import the deleted LeaguePublicView component', () => {
    // Regression target: pre-v1.25.0 page.tsx had
    //   `import LeaguePublicView from "@/components/LeaguePublicView"`
    // and conditionally rendered it for subdomain hosts.
    expect(pageSrc).not.toMatch(/LeaguePublicView/)
  })

  it('does NOT call the deleted getLeagueBySubdomain helper', () => {
    // Regression target: pre-v1.25.0 page.tsx called
    //   `await getLeagueBySubdomain(hostLeague.subdomain)`
    // to fetch the LeagueData blob in the LeaguePublicView Prisma include
    // shape. v1.25.0 fetches via getPublicLeagueData(leagueId) instead.
    expect(pageSrc).not.toMatch(/getLeagueBySubdomain/)
  })

  it('v1.53.0 — does NOT use the deleted getLeagueFromHost / getLeagueIdFromRequest helpers (subdomain teardown)', () => {
    // Regression target: PR 4 of the path-routing chain stripped the
    // host-header league resolver. The apex page now uses
    // `getDefaultLeagueId` from `@/lib/leagueSlug`.
    expect(pageSrc).not.toMatch(/getLeagueFromHost/)
    expect(pageSrc).not.toMatch(/getLeagueIdFromRequest/)
  })

  it('v1.53.0 — resolves leagueId via getDefaultLeagueId and threads it into getPublicLeagueData', () => {
    expect(pageSrc).toMatch(
      /import\s+\{[^}]*getDefaultLeagueId[^}]*\}\s+from\s+["']@\/lib\/leagueSlug["']/,
    )
    expect(pageSrc).toMatch(/await\s+getDefaultLeagueId\s*\(\s*\)/)
    expect(pageSrc).toMatch(/getPublicLeagueData\s*\(\s*leagueId\s*\)/)
  })

  it('v1.53.0 — handles null leagueId (no default-league configured) with the Data unavailable surface', () => {
    // Pre-v1.53.0 the apex page surfaced "League not found" for unknown
    // subdomains. PR 4 strips the subdomain code path; the only failure
    // mode now is "no default league flagged" — a catastrophic-config
    // scenario surfaced as the same Data unavailable copy the Prisma
    // catch block uses.
    expect(pageSrc).toMatch(/leagueId\s*===\s*null/)
    expect(pageSrc).toMatch(/Data unavailable/i)
  })
})

describe('v1.25.0 — LeaguePublicView deletion', () => {
  it('LeaguePublicView source file is gone from src/components/', () => {
    // Regression target: a re-introduction of the dual-renderer pattern
    // would have to re-add this file. Force the choice through a code
    // review by failing this test if the file reappears.
    const fs = require('node:fs') as typeof import('node:fs')
    const lpvPath = join(repoRoot, 'src/components/LeaguePublicView.tsx')
    expect(fs.existsSync(lpvPath)).toBe(false)
  })

  it('admin-data.ts no longer exports getLeagueBySubdomain', () => {
    const adminDataSrc = stripComments(
      readFileSync(join(repoRoot, 'src/lib/admin-data.ts'), 'utf8'),
    )
    expect(adminDataSrc).not.toMatch(/export\s+const\s+getLeagueBySubdomain\b/)
    expect(adminDataSrc).not.toMatch(/export\s+(async\s+)?function\s+getLeagueBySubdomain\b/)
  })

  it('v1.53.0 — getLeagueFromHost.ts is DELETED entirely (subdomain teardown)', () => {
    // Regression target: PR 4 of the path-routing chain deletes the
    // file entirely. The default-league resolver lives in
    // src/lib/leagueSlug.ts now.
    const fs = require('node:fs') as typeof import('node:fs')
    const helperPath = join(repoRoot, 'src/lib/getLeagueFromHost.ts')
    expect(fs.existsSync(helperPath)).toBe(false)
  })
})

describe('v1.25.0 — feature-parity surfaces present in unified Dashboard', () => {
  // Subdomain users now get the same set of components apex users have. Pin
  // the surfaces so a future refactor that drops one of them surfaces here.
  const dashboardSrc = readFileSync(
    join(repoRoot, 'src/components/Dashboard.tsx'),
    'utf8',
  )

  it('renders NextMatchdayBanner', () => {
    expect(dashboardSrc).toMatch(/<NextMatchdayBanner\b/)
  })

  it('renders MatchdayAvailability', () => {
    expect(dashboardSrc).toMatch(/<MatchdayAvailability\b/)
  })

  it('renders RsvpBar', () => {
    expect(dashboardSrc).toMatch(/<RsvpBar\b/)
  })

  it('renders UserTeamBadge', () => {
    expect(dashboardSrc).toMatch(/<UserTeamBadge\b/)
  })

  it('renders GuestLoginBanner', () => {
    expect(dashboardSrc).toMatch(/<GuestLoginBanner\b/)
  })
})
