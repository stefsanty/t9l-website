/**
 * v2.1.0 — multi-boundary Suspense streaming on `/id/<slug>`.
 *
 * Pre-v2.1.0 (v1.99.0) the body was wrapped in ONE Suspense gated on
 * the slowest call in the 7-fetch Promise.all (`getPublicLeagueData`,
 * the Redis-RSVP fanout). v2.1.0 splits the body into two independent
 * Suspense boundaries — a fast banner wave + a slow matchday wave —
 * so each region paints as soon as ITS data resolves. Each fallback
 * pairs the `animate-pulse` skeleton with an `<LoadingSpinner>`
 * rotating cue.
 *
 * Each assertion is a regression target. v2.0.0 (Redis cache) was
 * reverted in v2.0.1 due to Upstash quota exhaustion; v2.1.0 is the
 * forward path the user redirected toward: change WHAT the loading
 * window LOOKS LIKE, not how long it lasts.
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
const LEDGER_MD = readFileSync(join(REPO_ROOT, 'docs/ledger.md'), 'utf8')
const ID_SLUG_PAGE_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/id/[slug]/page.tsx'),
  'utf8',
)
const BANNERS_BLOCK_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/LeagueBannersBlock.tsx'),
  'utf8',
)
const BANNERS_SKELETON_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/LeagueBannersSkeleton.tsx'),
  'utf8',
)
const MATCHDAY_CONTENT_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/LeagueMatchdayContent.tsx'),
  'utf8',
)
const MATCHDAY_SKELETON_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/LeagueMatchdayContentSkeleton.tsx'),
  'utf8',
)
const MATCHDAY_CLIENT_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/LeagueMatchdayClient.tsx'),
  'utf8',
)
const SPINNER_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/LoadingSpinner.tsx'),
  'utf8',
)

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

// ────────────────────────────────────────────────────────────────────────────
// 1) Version + release pins
// ────────────────────────────────────────────────────────────────────────────

describe('v2.1.0 — version pin', () => {
  it('APP_VERSION reads 2.1.0+', () => {
    expect(VERSION_SRC).toMatch(
      /APP_VERSION\s*=\s*['"](?:2\.1\.\d+|2\.[2-9]\.\d+|[3-9]\.\d+\.\d+)['"]/,
    )
  })

  it('CLAUDE.md header reflects v2.1.0+ release', () => {
    expect(CLAUDE_MD).toMatch(
      /\*\*Current release:\*\*\s*(?:v2\.1\.\d+|v2\.[2-9]\.\d+|v[3-9]\.\d+\.\d+)/,
    )
  })

  it('docs/ledger.md top entry is v2.1.0', () => {
    const firstBullet = LEDGER_MD.split('\n').find((line) =>
      line.startsWith('- **v'),
    )
    expect(firstBullet).toBeDefined()
    expect(firstBullet).toMatch(/^- \*\*v2\.1\.\d+\*\*/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 2) /id/[slug]/page.tsx — two independent Suspense boundaries
// ────────────────────────────────────────────────────────────────────────────

describe('v2.1.0 — /id/[slug]/page.tsx has TWO Suspense boundaries', () => {
  it('imports Suspense + the two block components + their skeletons', () => {
    expect(ID_SLUG_PAGE_SRC).toMatch(
      /import\s*\{\s*Suspense\s*\}\s+from\s+['"]react['"]/,
    )
    expect(ID_SLUG_PAGE_SRC).toMatch(
      /import\s+LeagueBannersBlock\s+from\s+['"]@\/components\/LeagueBannersBlock['"]/,
    )
    expect(ID_SLUG_PAGE_SRC).toMatch(
      /import\s+LeagueBannersSkeleton\s+from\s+['"]@\/components\/LeagueBannersSkeleton['"]/,
    )
    expect(ID_SLUG_PAGE_SRC).toMatch(
      /import\s+LeagueMatchdayContent\s+from\s+['"]@\/components\/LeagueMatchdayContent['"]/,
    )
    expect(ID_SLUG_PAGE_SRC).toMatch(
      /import\s+LeagueMatchdayContentSkeleton\s+from\s+['"]@\/components\/LeagueMatchdayContentSkeleton['"]/,
    )
  })

  it('renders exactly two <Suspense> nodes', () => {
    const stripped = stripComments(ID_SLUG_PAGE_SRC)
    const matches = stripped.match(/<Suspense\b/g) ?? []
    expect(matches.length).toBe(2)
  })

  it('wraps <LeagueBannersBlock> in <Suspense fallback={<LeagueBannersSkeleton />}>', () => {
    expect(ID_SLUG_PAGE_SRC).toMatch(
      /<Suspense\s+fallback=\{<LeagueBannersSkeleton\s*\/?>\s*\}>\s*\n?\s*<LeagueBannersBlock/,
    )
  })

  it('wraps <LeagueMatchdayContent> in <Suspense fallback={<LeagueMatchdayContentSkeleton />}>', () => {
    expect(ID_SLUG_PAGE_SRC).toMatch(
      /<Suspense\s+fallback=\{<LeagueMatchdayContentSkeleton\s*\/?>\s*\}>\s*\n?\s*<LeagueMatchdayContent/,
    )
  })

  it('renders <Header> in the page-level shell (outside both Suspense boundaries)', () => {
    const stripped = stripComments(ID_SLUG_PAGE_SRC)
    const headerIdx = stripped.search(/<Header\s/)
    const firstSuspenseIdx = stripped.search(/<Suspense\b/)
    expect(headerIdx).toBeGreaterThan(-1)
    expect(firstSuspenseIdx).toBeGreaterThan(-1)
    expect(headerIdx).toBeLessThan(firstSuspenseIdx)
  })

  it('no longer renders <Dashboard> on /id/<slug>', () => {
    const stripped = stripComments(ID_SLUG_PAGE_SRC)
    expect(stripped).not.toMatch(/<Dashboard\b/)
    expect(stripped).not.toMatch(
      /from\s+['"]@\/components\/Dashboard['"]/,
    )
  })

  it('no longer imports DashboardBodySkeleton (v1.99.0 single-boundary skeleton)', () => {
    expect(ID_SLUG_PAGE_SRC).not.toMatch(
      /from\s+['"]@\/components\/DashboardBodySkeleton['"]/,
    )
  })

  it('the heavy getPublicLeagueData call is NOT in the page file', () => {
    // v1.99.0 had Promise.all([getPublicLeagueData(leagueId), ...]) inline.
    // v2.1.0 moves it into <LeagueMatchdayContent>.
    expect(ID_SLUG_PAGE_SRC).not.toMatch(/getPublicLeagueData\(/)
  })

  it('still fires touchUserDefaultLeague at the page level (waitUntil-wrapped)', () => {
    expect(ID_SLUG_PAGE_SRC).toMatch(/touchUserDefaultLeague\(/)
  })

  it('preserves dashboard-body wrapper testid for downstream selectors', () => {
    expect(ID_SLUG_PAGE_SRC).toMatch(/data-testid=["']dashboard-body["']/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 3) LeagueBannersBlock — async server component with light reads only
// ────────────────────────────────────────────────────────────────────────────

describe('v2.1.0 — LeagueBannersBlock', () => {
  it('exists as a default-exported async function', () => {
    expect(BANNERS_BLOCK_SRC).toMatch(
      /export\s+default\s+async\s+function\s+LeagueBannersBlock/,
    )
  })

  it('fans out the 5 light fetches in a single Promise.all', () => {
    expect(BANNERS_BLOCK_SRC).toMatch(/await\s+Promise\.all\(\s*\[/)
    expect(BANNERS_BLOCK_SRC).toMatch(/getLeagueFlags\(/)
    expect(BANNERS_BLOCK_SRC).toMatch(/getRecruitingViewerState\(/)
    expect(BANNERS_BLOCK_SRC).toMatch(/getUnpaidFeeBannerData\(/)
    expect(BANNERS_BLOCK_SRC).toMatch(/getPlannedRosterStats\(/)
    expect(BANNERS_BLOCK_SRC).toMatch(/getLeagueDetails\(/)
  })

  it('does NOT import or call getPublicLeagueData (banners must stream fast)', () => {
    // Comments may reference the symbol; what matters is that no import
    // or call site exists in compiled JS.
    const stripped = stripComments(BANNERS_BLOCK_SRC)
    expect(stripped).not.toMatch(/getPublicLeagueData/)
  })

  it('renders UnpaidFeeBanner + RecruitingBanner + RegistrationCountdown', () => {
    expect(BANNERS_BLOCK_SRC).toMatch(/<UnpaidFeeBanner\b/)
    expect(BANNERS_BLOCK_SRC).toMatch(/<RecruitingBanner\b/)
    expect(BANNERS_BLOCK_SRC).toMatch(/<RegistrationCountdown\b/)
  })

  it('tags the rendered block with data-testid="league-banners-block"', () => {
    expect(BANNERS_BLOCK_SRC).toMatch(
      /data-testid=["']league-banners-block["']/,
    )
  })

  it('does NOT have the "use client" directive (it is a server component)', () => {
    expect(BANNERS_BLOCK_SRC).not.toMatch(/^['"]use client['"]/m)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 4) LeagueBannersSkeleton — pairs animate-pulse with a LoadingSpinner
// ────────────────────────────────────────────────────────────────────────────

describe('v2.1.0 — LeagueBannersSkeleton', () => {
  it('exists as a default-exported component', () => {
    expect(BANNERS_SKELETON_SRC).toMatch(
      /export\s+default\s+function\s+LeagueBannersSkeleton/,
    )
  })

  it('imports + renders <LoadingSpinner>', () => {
    expect(BANNERS_SKELETON_SRC).toMatch(
      /import\s+LoadingSpinner\s+from\s+['"]\.\/LoadingSpinner['"]/,
    )
    expect(BANNERS_SKELETON_SRC).toMatch(/<LoadingSpinner\b/)
  })

  it('uses animate-pulse on the placeholder rectangles', () => {
    expect(BANNERS_SKELETON_SRC).toMatch(/animate-pulse/)
  })

  it('tags itself with aria-busy="true" + data-testid', () => {
    expect(BANNERS_SKELETON_SRC).toMatch(/aria-busy=["']true["']/)
    expect(BANNERS_SKELETON_SRC).toMatch(
      /data-testid=["']league-banners-skeleton["']/,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 5) LeagueMatchdayContent — async server component owning the heavy fetch
// ────────────────────────────────────────────────────────────────────────────

describe('v2.1.0 — LeagueMatchdayContent', () => {
  it('exists as a default-exported async function', () => {
    expect(MATCHDAY_CONTENT_SRC).toMatch(
      /export\s+default\s+async\s+function\s+LeagueMatchdayContent/,
    )
  })

  it('calls getPublicLeagueData inside Promise.all', () => {
    expect(MATCHDAY_CONTENT_SRC).toMatch(/await\s+Promise\.all\(\s*\[/)
    expect(MATCHDAY_CONTENT_SRC).toMatch(/getPublicLeagueData\(leagueId\)/)
  })

  it('renders <LeagueMatchdayClient> with the resolved data', () => {
    expect(MATCHDAY_CONTENT_SRC).toMatch(/<LeagueMatchdayClient\b/)
    expect(MATCHDAY_CONTENT_SRC).toMatch(
      /import\s+LeagueMatchdayClient\s+from\s+['"]\.\/LeagueMatchdayClient['"]/,
    )
  })

  it('surfaces a data-unavailable testid on read failure', () => {
    expect(MATCHDAY_CONTENT_SRC).toMatch(
      /data-testid=["']matchday-data-unavailable["']/,
    )
  })

  it('does NOT have the "use client" directive', () => {
    expect(MATCHDAY_CONTENT_SRC).not.toMatch(/^['"]use client['"]/m)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 6) LeagueMatchdayContentSkeleton — bigger skeleton with centred spinner
// ────────────────────────────────────────────────────────────────────────────

describe('v2.1.0 — LeagueMatchdayContentSkeleton', () => {
  it('exists as a default-exported component', () => {
    expect(MATCHDAY_SKELETON_SRC).toMatch(
      /export\s+default\s+function\s+LeagueMatchdayContentSkeleton/,
    )
  })

  it('renders a <LoadingSpinner> (size="lg") inside the placeholder card', () => {
    expect(MATCHDAY_SKELETON_SRC).toMatch(
      /<LoadingSpinner[\s\S]*?size=["']lg["']/,
    )
  })

  it('uses animate-pulse on the surrounding placeholders', () => {
    expect(MATCHDAY_SKELETON_SRC).toMatch(/animate-pulse/)
  })

  it('tags itself with aria-busy="true" + data-testid', () => {
    expect(MATCHDAY_SKELETON_SRC).toMatch(/aria-busy=["']true["']/)
    expect(MATCHDAY_SKELETON_SRC).toMatch(
      /data-testid=["']league-matchday-skeleton["']/,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 7) LeagueMatchdayClient — owns matchday state + renders RsvpBar
// ────────────────────────────────────────────────────────────────────────────

describe('v2.1.0 — LeagueMatchdayClient', () => {
  it('starts with the "use client" directive', () => {
    expect(MATCHDAY_CLIENT_SRC).toMatch(/^['"]use client['"]/m)
  })

  it('imports useState + useMemo from react', () => {
    expect(MATCHDAY_CLIENT_SRC).toMatch(
      /import\s*\{[^}]*\buseState\b[^}]*\}\s*from\s*['"]react['"]/,
    )
    expect(MATCHDAY_CLIENT_SRC).toMatch(
      /import\s*\{[^}]*\buseMemo\b[^}]*\}\s*from\s*['"]react['"]/,
    )
  })

  it('owns a selectedMatchdayId useState', () => {
    expect(MATCHDAY_CLIENT_SRC).toMatch(
      /useState\([^)]*\)\s*[\s\S]{0,200}selectedMatchdayId/,
    )
  })

  it('dynamic-imports RsvpBar and renders it', () => {
    expect(MATCHDAY_CLIENT_SRC).toMatch(
      /dynamic\(\s*\(\s*\)\s*=>\s*import\(\s*['"]\.\/RsvpBar['"]/,
    )
    expect(MATCHDAY_CLIENT_SRC).toMatch(/<RsvpBar\b/)
  })

  it('renders ClassicLeagueHomepage and CompressedMatchdaySchedule (preseason branch)', () => {
    expect(MATCHDAY_CLIENT_SRC).toMatch(/<ClassicLeagueHomepage\b/)
    expect(MATCHDAY_CLIENT_SRC).toMatch(/<CompressedMatchdaySchedule\b/)
  })

  it('tags the rendered tree with data-testid="league-matchday-client"', () => {
    expect(MATCHDAY_CLIENT_SRC).toMatch(
      /data-testid=["']league-matchday-client["']/,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 8) LoadingSpinner — reusable animate-spin SVG
// ────────────────────────────────────────────────────────────────────────────

describe('v2.1.0 — LoadingSpinner', () => {
  it('exists as a default-exported component', () => {
    expect(SPINNER_SRC).toMatch(
      /export\s+default\s+function\s+LoadingSpinner/,
    )
  })

  it('renders an SVG with className containing animate-spin', () => {
    expect(SPINNER_SRC).toMatch(/animate-spin/)
    expect(SPINNER_SRC).toMatch(/<svg\b/)
  })

  it('tags itself with role="status" + a default aria-label', () => {
    expect(SPINNER_SRC).toMatch(/role=["']status["']/)
    expect(SPINNER_SRC).toMatch(/aria-label/)
  })

  it('exposes data-testid="loading-spinner" for selector use', () => {
    expect(SPINNER_SRC).toMatch(/data-testid=["']loading-spinner["']/)
  })

  it('does NOT have the "use client" directive (server-renderable SVG only)', () => {
    expect(SPINNER_SRC).not.toMatch(/^['"]use client['"]/m)
  })
})
