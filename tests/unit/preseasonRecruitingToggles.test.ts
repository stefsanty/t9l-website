/**
 * v1.63.0 — per-league pre-season + recruiting toggles.
 *
 * Pins six load-bearing surfaces:
 *
 *   1. **Schema** — `League.preseasonMode Boolean @default(false)` and
 *      `League.recruiting Boolean @default(false)` are added to the Prisma
 *      schema and the migration is purely additive (no DROP, no ALTER
 *      COLUMN against existing data, no destructive backfill). Both
 *      defaults `false` preserve backward compat: every existing league
 *      behaves exactly as before v1.63.0.
 *
 *   2. **Server actions** — `setLeaguePreseasonMode` and
 *      `setLeagueRecruiting` exist in `app/admin/leagues/actions.ts`,
 *      gate via `assertAdmin`, validate the boolean type, write to
 *      Prisma, and bust the canonical admin caches.
 *
 *   3. **Flags helper** — `lib/leagueFlags.ts#getLeagueFlags(leagueId)`
 *      returns `{ preseasonMode, recruiting }`, defaults both to false
 *      on missing row or Prisma failure, cached 30s under the canonical
 *      `'leagues'` tag.
 *
 *   4. **Page wiring** — `/` and `/id/<slug>` and `/id/<slug>/md/<id>`
 *      fetch flags in parallel with public data and thread them through
 *      to `<Dashboard preseasonMode={...} recruiting={...} />`.
 *
 *   5. **Dashboard branching** — Dashboard mounts ClassicLeagueHomepage
 *      when preseasonMode is OFF and CompressedMatchdaySchedule when ON;
 *      mounts RecruitingBanner when recruiting is ON; threads
 *      `hideStatsLink={preseasonMode}` to Header.
 *
 *   6. **Stats route gate** — `/stats` page-level redirects to `/` when
 *      the default league has preseasonMode ON; Header hides the STATS
 *      nav when `hideStatsLink` is true.
 *
 *   7. **SettingsTab UI** — both toggles wired with the established
 *      optimistic-flip-with-rollback pattern; testid hooks pin the
 *      shape so the regression target is the file source content.
 *
 * Structural tests (file content) rather than render — same convention
 * as `leagueSelfLinkToggle.test.ts` from v1.60.0. The load-bearing
 * contract is "does the gate / wiring exist in the source," not "does
 * React render the right tree from a synthetic session." For the page-
 * level gate the Prisma + next-auth surface is non-trivial to mock; the
 * file-content shape is the correct gate for the additive-only contract.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PROJECT_ROOT = join(__dirname, '..', '..')

const SCHEMA_SRC = readFileSync(
  join(PROJECT_ROOT, 'prisma', 'schema.prisma'),
  'utf-8',
)
const MIGRATION_SRC = readFileSync(
  join(
    PROJECT_ROOT,
    'prisma',
    'migrations',
    '20260506000000_league_preseason_recruiting',
    'migration.sql',
  ),
  'utf-8',
)
const HELPER_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'lib', 'leagueFlags.ts'),
  'utf-8',
)
const ACTIONS_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'app', 'admin', 'leagues', 'actions.ts'),
  'utf-8',
)
const SETTINGS_TAB_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'components', 'admin', 'SettingsTab.tsx'),
  'utf-8',
)
const HEADER_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'components', 'Header.tsx'),
  'utf-8',
)
const DASHBOARD_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'components', 'Dashboard.tsx'),
  'utf-8',
)
const CLASSIC_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'components', 'ClassicLeagueHomepage.tsx'),
  'utf-8',
)
const COMPRESSED_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'components', 'CompressedMatchdaySchedule.tsx'),
  'utf-8',
)
const RECRUITING_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'components', 'RecruitingBanner.tsx'),
  'utf-8',
)
const PAGE_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'app', 'page.tsx'),
  'utf-8',
)
const ID_SLUG_PAGE_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'app', 'id', '[slug]', 'page.tsx'),
  'utf-8',
)
const ID_SLUG_MD_PAGE_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'app', 'id', '[slug]', 'md', '[id]', 'page.tsx'),
  'utf-8',
)
const STATS_PAGE_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'app', 'stats', 'page.tsx'),
  'utf-8',
)

// Strip docstring contents so docstrings that legitimately mention the
// toggles don't trip negative-regex assertions. Mirrors the convention in
// `assignPlayerNonLineGate.test.ts` and `leagueSelfLinkToggle.test.ts`.
// Handles JS/TS `/* ... */` and `//` plus SQL `-- ...` line comments so
// migration files with rollback recipes in their headers don't trip the
// "no DROP COLUMN" negative regex.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*--.*$/gm, '')
}

// ────────────────────────────────────────────────────────────────────────────
// 1) Schema
// ────────────────────────────────────────────────────────────────────────────

describe('v1.63.0 — schema additions', () => {
  it('adds `preseasonMode Boolean @default(false)` to League', () => {
    expect(SCHEMA_SRC).toMatch(/preseasonMode\s+Boolean\s+@default\(false\)/)
  })

  it('adds `recruiting Boolean @default(false)` to League', () => {
    expect(SCHEMA_SRC).toMatch(/recruiting\s+Boolean\s+@default\(false\)/)
  })

  it('migration is purely additive (no DROP / ALTER COLUMN of existing data)', () => {
    const sqlOnly = stripComments(MIGRATION_SRC)
    expect(sqlOnly).not.toMatch(/\bDROP\s+TABLE\b/i)
    expect(sqlOnly).not.toMatch(/\bDROP\s+COLUMN\b/i)
    expect(sqlOnly).not.toMatch(/\bALTER\s+COLUMN\b/i)
    expect(sqlOnly).not.toMatch(/\bTRUNCATE\b/i)
    expect(sqlOnly).not.toMatch(/\bDELETE\s+FROM\b/i)
  })

  it('migration adds both columns with NOT NULL DEFAULT false', () => {
    expect(MIGRATION_SRC).toMatch(
      /ADD\s+COLUMN\s+"preseasonMode"\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+false/i,
    )
    expect(MIGRATION_SRC).toMatch(
      /ADD\s+COLUMN\s+"recruiting"\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+false/i,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 2) Server actions
// ────────────────────────────────────────────────────────────────────────────

describe('v1.63.0 — server actions exist with right shape', () => {
  it('exports setLeaguePreseasonMode', () => {
    expect(ACTIONS_SRC).toMatch(
      /export\s+async\s+function\s+setLeaguePreseasonMode\s*\(\s*leagueId:\s*string,\s*value:\s*boolean\s*\)/,
    )
  })

  it('exports setLeagueRecruiting', () => {
    expect(ACTIONS_SRC).toMatch(
      /export\s+async\s+function\s+setLeagueRecruiting\s*\(\s*leagueId:\s*string,\s*value:\s*boolean\s*\)/,
    )
  })

  it('both actions gate on assertAdmin', () => {
    // Find each action body and check assertAdmin is called inside.
    const preseasonMatch = ACTIONS_SRC.match(
      /export\s+async\s+function\s+setLeaguePreseasonMode[\s\S]+?\n\}/,
    )
    const recruitingMatch = ACTIONS_SRC.match(
      /export\s+async\s+function\s+setLeagueRecruiting[\s\S]+?\n\}/,
    )
    expect(preseasonMatch?.[0]).toMatch(/await\s+assertAdmin\(\)/)
    expect(recruitingMatch?.[0]).toMatch(/await\s+assertAdmin\(\)/)
  })

  it('both actions validate boolean type', () => {
    expect(ACTIONS_SRC).toMatch(
      /preseasonMode[\s\S]+?typeof\s+value\s*!==\s*['"]boolean['"]/,
    )
    expect(ACTIONS_SRC).toMatch(
      /recruiting[\s\S]+?typeof\s+value\s*!==\s*['"]boolean['"]/,
    )
  })

  it('both actions write to Prisma with the right shape', () => {
    expect(ACTIONS_SRC).toMatch(
      /setLeaguePreseasonMode[\s\S]+?prisma\.league\.update[\s\S]+?data:\s*\{\s*preseasonMode:\s*value\s*\}/,
    )
    expect(ACTIONS_SRC).toMatch(
      /setLeagueRecruiting[\s\S]+?prisma\.league\.update[\s\S]+?data:\s*\{\s*recruiting:\s*value\s*\}/,
    )
  })

  it('both actions use the canonical revalidate helper with admin domain', () => {
    expect(ACTIONS_SRC).toMatch(
      /setLeaguePreseasonMode[\s\S]+?revalidate\(\s*\{[\s\S]+?domain:\s*['"]admin['"]/,
    )
    expect(ACTIONS_SRC).toMatch(
      /setLeagueRecruiting[\s\S]+?revalidate\(\s*\{[\s\S]+?domain:\s*['"]admin['"]/,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 3) Flags helper (with mocked Prisma — uses the test seam)
// ────────────────────────────────────────────────────────────────────────────

describe('v1.63.0 — getLeagueFlags helper', () => {
  it('exports both the cached helper and the test-seam variant', () => {
    expect(HELPER_SRC).toMatch(/export\s+const\s+getLeagueFlags\s*=\s*unstable_cache/)
    expect(HELPER_SRC).toMatch(/__readLeagueFlags_for_testing/)
  })

  it('uses the canonical leagues cache tag and 30s TTL', () => {
    expect(HELPER_SRC).toMatch(/tags:\s*\[['"]leagues['"]\]/)
    expect(HELPER_SRC).toMatch(/revalidate:\s*30/)
  })

  it('selects only the flag columns from Prisma (v1.84.0 added `visibility`)', () => {
    expect(HELPER_SRC).toMatch(
      /select:\s*\{\s*preseasonMode:\s*true,\s*recruiting:\s*true,\s*visibility:\s*true\s*\}/,
    )
  })

  it('exports a LeagueFlags interface with the right shape', () => {
    expect(HELPER_SRC).toMatch(/export\s+interface\s+LeagueFlags\s*\{/)
    expect(HELPER_SRC).toMatch(/preseasonMode:\s*boolean/)
    expect(HELPER_SRC).toMatch(/recruiting:\s*boolean/)
  })

  describe('runtime behavior', () => {
    beforeEach(() => {
      vi.resetModules()
    })

    it('returns row values when row exists', async () => {
      vi.doMock('@/lib/prisma', () => ({
        prisma: {
          league: {
            findUnique: vi
              .fn()
              .mockResolvedValue({
                preseasonMode: true,
                recruiting: false,
                visibility: 'PUBLIC_OPEN',
              }),
          },
        },
      }))
      const { __readLeagueFlags_for_testing } = await import('../../src/lib/leagueFlags')
      const flags = await __readLeagueFlags_for_testing('l-foo')
      expect(flags).toEqual({
        preseasonMode: true,
        recruiting: false,
        visibility: 'PUBLIC_OPEN',
      })
    })

    it('defaults flags off / visibility PUBLIC_CLOSED on missing row', async () => {
      vi.doMock('@/lib/prisma', () => ({
        prisma: {
          league: { findUnique: vi.fn().mockResolvedValue(null) },
        },
      }))
      const { __readLeagueFlags_for_testing } = await import('../../src/lib/leagueFlags')
      const flags = await __readLeagueFlags_for_testing('nope')
      expect(flags).toEqual({
        preseasonMode: false,
        recruiting: false,
        visibility: 'PUBLIC_CLOSED',
      })
    })

    it('defaults flags off on Prisma rejection (does not throw)', async () => {
      vi.doMock('@/lib/prisma', () => ({
        prisma: {
          league: {
            findUnique: vi.fn().mockRejectedValue(new Error('boom')),
          },
        },
      }))
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { __readLeagueFlags_for_testing } = await import('../../src/lib/leagueFlags')
      const flags = await __readLeagueFlags_for_testing('l-foo')
      expect(flags).toEqual({
        preseasonMode: false,
        recruiting: false,
        visibility: 'PUBLIC_CLOSED',
      })
      expect(warn).toHaveBeenCalled()
      warn.mockRestore()
    })
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 4) Page wiring — flags fetched + threaded
// ────────────────────────────────────────────────────────────────────────────

describe('v1.63.0 — page wiring fetches + threads flags', () => {
  it('apex page imports getLeagueFlags', () => {
    expect(PAGE_SRC).toMatch(/from\s+["']@\/lib\/leagueFlags["']/)
    expect(PAGE_SRC).toMatch(/getLeagueFlags/)
  })

  it('apex page passes preseasonMode + visibility-derived recruiting to Dashboard', () => {
    expect(PAGE_SRC).toMatch(/preseasonMode=\{flags\.preseasonMode\}/)
    // v1.84.0 — banner gate is now `visibility === 'PUBLIC_OPEN'`.
    expect(PAGE_SRC).toMatch(/recruiting=\{flags\.visibility\s*===\s*['"]PUBLIC_OPEN['"]\}/)
  })

  it('/id/[slug] page fetches + threads flags', () => {
    expect(ID_SLUG_PAGE_SRC).toMatch(/getLeagueFlags/)
    expect(ID_SLUG_PAGE_SRC).toMatch(/preseasonMode=\{flags\.preseasonMode\}/)
    expect(ID_SLUG_PAGE_SRC).toMatch(
      /recruiting=\{flags\.visibility\s*===\s*['"]PUBLIC_OPEN['"]\}/,
    )
  })

  it('/id/[slug]/md/[id] page fetches + threads flags', () => {
    expect(ID_SLUG_MD_PAGE_SRC).toMatch(/getLeagueFlags/)
    expect(ID_SLUG_MD_PAGE_SRC).toMatch(/preseasonMode=\{flags\.preseasonMode\}/)
    expect(ID_SLUG_MD_PAGE_SRC).toMatch(
      /recruiting=\{flags\.visibility\s*===\s*['"]PUBLIC_OPEN['"]\}/,
    )
  })

  it('apex + /id/[slug] fetch flags in parallel with public data (Promise.all)', () => {
    // Avoids a serial Prisma round-trip — flags + LeagueData go together.
    expect(PAGE_SRC).toMatch(/Promise\.all\(\s*\[\s*getPublicLeagueData/)
    expect(ID_SLUG_PAGE_SRC).toMatch(/Promise\.all\(\s*\[\s*getPublicLeagueData/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 5) Dashboard branching
// ────────────────────────────────────────────────────────────────────────────

describe('v1.63.0 — Dashboard branches on flags', () => {
  it('accepts preseasonMode + recruiting props (both optional, default false)', () => {
    expect(DASHBOARD_SRC).toMatch(/preseasonMode\?:\s*boolean/)
    expect(DASHBOARD_SRC).toMatch(/recruiting\?:\s*boolean/)
    expect(DASHBOARD_SRC).toMatch(/preseasonMode\s*=\s*false/)
    expect(DASHBOARD_SRC).toMatch(/recruiting\s*=\s*false/)
  })

  it('mounts ClassicLeagueHomepage when preseasonMode is OFF', () => {
    // The branch reads `{preseasonMode ? <Compressed /> : <Classic />}`
    expect(DASHBOARD_SRC).toMatch(
      /preseasonMode\s*\?\s*\([\s\S]{0,500}<CompressedMatchdaySchedule\b[\s\S]{0,500}\)\s*:\s*\(\s*<ClassicLeagueHomepage\b/,
    )
  })

  it('mounts RecruitingBanner when recruiting is ON', () => {
    // v1.64.0 — banner now needs `league` + `recruitingState` props from
    // the page-level RSC, so the branch is `recruiting && league &&
    // recruitingState && <RecruitingBanner ...>`. Pin the chain.
    expect(DASHBOARD_SRC).toMatch(
      /recruiting\s*&&\s*league\s*&&\s*recruitingState\s*&&[\s\S]{0,200}<RecruitingBanner\b/,
    )
  })

  it('passes hideStatsLink={preseasonMode} to Header', () => {
    expect(DASHBOARD_SRC).toMatch(/<Header\s+hideStatsLink=\{preseasonMode\}/)
  })

  it('Dashboard no longer mounts NextMatchdayBanner / MatchdayAvailability directly (those moved into ClassicLeagueHomepage)', () => {
    // Strip JSX-like comments from a working copy so the docstring at the
    // top of the file doesn't trip the negative regex.
    const stripped = stripComments(DASHBOARD_SRC)
    // Allow `MatchdayAvailability` mentions in imports that may exist for
    // ergonomics, but the JSX usage tag must be gone.
    expect(stripped).not.toMatch(/<NextMatchdayBanner\b/)
    expect(stripped).not.toMatch(/<MatchdayAvailability\b/)
    // v1.63.1 — RsvpBar lives at Dashboard's outer wrapper level (NOT
    // inside <main>) because the `.animate-in` div sets a non-none
    // `transform` that establishes a containing block for fixed
    // descendants. Regression target: Dashboard MUST mount RsvpBar.
    expect(stripped).toMatch(/<RsvpBar\b/)
  })

  it('Dashboard suppresses the bottom RsvpBar padding when preseasonMode is on', () => {
    // `showRsvpBar` calc gates on `!preseasonMode &&` — when preseason is on,
    // pb-32 collapses to pb-2.
    expect(DASHBOARD_SRC).toMatch(/!preseasonMode\s*&&\s*!!\(session\?\.playerId/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 6) ClassicLeagueHomepage extraction
// ────────────────────────────────────────────────────────────────────────────

describe('v1.63.0 — ClassicLeagueHomepage', () => {
  it('renders the pair of NextMatchdayBanner + MatchdayAvailability', () => {
    // v1.63.1 — RsvpBar moved out of this wrapper back to Dashboard's
    // outer level. ClassicLeagueHomepage owns just the two surfaces that
    // are safe to nest inside the `.animate-in` ancestor (no fixed
    // positioning that would be broken by the containing-block rule).
    expect(CLASSIC_SRC).toMatch(/<NextMatchdayBanner\b/)
    expect(CLASSIC_SRC).toMatch(/<MatchdayAvailability\b/)
    expect(CLASSIC_SRC).not.toMatch(/<RsvpBar\b/)
  })

  it('accepts a submitGoalSlot prop and renders it between banner and availability', () => {
    expect(CLASSIC_SRC).toMatch(/submitGoalSlot\?:\s*ReactNode/)
    // submitGoalSlot is after NextMatchdayBanner and before MatchdayAvailability;
    // v1.75.4 added leagueDetailsPanelSlot between submitGoalSlot and MatchdayAvailability.
    expect(CLASSIC_SRC).toMatch(
      /<NextMatchdayBanner[\s\S]+?\/>\s*\n\s*\{submitGoalSlot\}[\s\S]*?<MatchdayAvailability\b/,
    )
  })

  it('is a client component', () => {
    expect(CLASSIC_SRC.trim()).toMatch(/^['"]use client['"]/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 7) CompressedMatchdaySchedule
// ────────────────────────────────────────────────────────────────────────────

describe('v1.63.0 — CompressedMatchdaySchedule', () => {
  it('is a client component', () => {
    expect(COMPRESSED_SRC.trim()).toMatch(/^['"]use client['"]/)
  })

  it('exposes the testid hook for Dashboard regression', () => {
    expect(COMPRESSED_SRC).toMatch(/data-testid="compressed-matchday-schedule"/)
  })

  it('renders one row per matchday with per-MD testid', () => {
    expect(COMPRESSED_SRC).toMatch(/data-testid=\{`compressed-md-\$\{md\.id\}`\}/)
  })

  it('uses formatJstFriendly for the date label (consistent JST formatting)', () => {
    expect(COMPRESSED_SRC).toMatch(/formatJstFriendly\(md\.date,\s*['"]en['"]\)/)
  })

  it('does NOT mount NextMatchdayBanner / MatchdayAvailability / RsvpBar (regression target — pre-season replaces those)', () => {
    expect(COMPRESSED_SRC).not.toMatch(/<NextMatchdayBanner\b/)
    expect(COMPRESSED_SRC).not.toMatch(/<MatchdayAvailability\b/)
    expect(COMPRESSED_SRC).not.toMatch(/<RsvpBar\b/)
  })

  it('handles empty matchday list with a "Schedule TBD" surface', () => {
    expect(COMPRESSED_SRC).toMatch(/Schedule TBD/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 8) RecruitingBanner
// ────────────────────────────────────────────────────────────────────────────

describe('v1.63.0 — RecruitingBanner', () => {
  it('is a client component', () => {
    expect(RECRUITING_SRC.trim()).toMatch(/^['"]use client['"]/)
  })

  it('renders the "Recruiting Now" copy', () => {
    expect(RECRUITING_SRC).toMatch(/Recruiting Now/)
  })

  it('exposes one of the v1.64.0 state-specific testids (CTA replaces the v1.63.0 TODO placeholder)', () => {
    // v1.64.0 — the v1.63.0 placeholder `recruiting-cta-todo` testid was
    // replaced by five state-specific testids:
    //   recruiting-banner-approved / recruiting-banner-pending /
    //   recruiting-banner-cta-unauth / recruiting-banner-cta-noplayer /
    //   recruiting-banner-cta-otherleague
    // Pin at least one to confirm the rewrite landed; the v1.64.0 unit
    // tests pin the rest exhaustively.
    expect(RECRUITING_SRC).toMatch(/data-testid="recruiting-banner-/)
  })

  it('renders as a button (clickable) for at least one CTA state', () => {
    expect(RECRUITING_SRC).toMatch(/<button[\s\S]+?onClick=/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 9) Header gate + /stats redirect
// ────────────────────────────────────────────────────────────────────────────

describe('v1.63.0 — Header hides STATS link when preseason on', () => {
  it('Header accepts hideStatsLink prop (optional, default false)', () => {
    expect(HEADER_SRC).toMatch(/hideStatsLink\?:\s*boolean/)
    expect(HEADER_SRC).toMatch(/hideStatsLink\s*=\s*false/)
  })

  it('STATS nav is wrapped in `!hideStatsLink &&` conditional', () => {
    expect(HEADER_SRC).toMatch(
      /\{!hideStatsLink\s*&&\s*\(\s*<nav[\s\S]+?data-testid="header-stats-nav"/,
    )
  })

  it('STATS Link itself still goes to /stats (route preserved)', () => {
    expect(HEADER_SRC).toMatch(/href="\/stats"/)
  })
})

describe('v1.63.0 — /stats redirects to home when preseason on', () => {
  it('imports getLeagueFlags + redirect from next/navigation', () => {
    expect(STATS_PAGE_SRC).toMatch(/from\s+["']next\/navigation["']/)
    expect(STATS_PAGE_SRC).toMatch(/redirect/)
    expect(STATS_PAGE_SRC).toMatch(/getLeagueFlags/)
  })

  it('redirects to / when flags.preseasonMode is true', () => {
    // v1.80.2 — flags can be null when leagueId is null (Promise.all leg
    // resolves to null in that case), so the access is via optional
    // chaining. Allow `flags.preseasonMode` and `flags?.preseasonMode`.
    expect(STATS_PAGE_SRC).toMatch(
      /flags\??\.preseasonMode[\s\S]{0,200}redirect\(\s*['"]\/['"]/,
    )
  })

  it('only checks flags when leagueId is non-null (defensive)', () => {
    // Catastrophic-config defense: if there's no default league, don't try to
    // fetch flags — the page already has a downstream "Data unavailable"
    // surface.
    //
    // v1.80.2 — defense moved from an `if (leagueId) { ... }` wrapper to a
    // ternary `leagueId ? getLeagueFlags(leagueId) : Promise.resolve(null)`
    // inline inside Promise.all so flags fetches in parallel with publicData
    // and unpaidFee. Allow either shape.
    expect(STATS_PAGE_SRC).toMatch(
      /(if\s*\(\s*leagueId\s*\)\s*\{[\s\S]+?getLeagueFlags|leagueId\s*\?\s*getLeagueFlags)/,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 10) SettingsTab toggles
// ────────────────────────────────────────────────────────────────────────────

describe('v1.63.0 — SettingsTab wires both toggles', () => {
  it('imports both server actions', () => {
    expect(SETTINGS_TAB_SRC).toMatch(/setLeaguePreseasonMode/)
    expect(SETTINGS_TAB_SRC).toMatch(/setLeagueRecruiting/)
  })

  it('League interface declares both flags', () => {
    expect(SETTINGS_TAB_SRC).toMatch(/preseasonMode:\s*boolean/)
    expect(SETTINGS_TAB_SRC).toMatch(/recruiting:\s*boolean/)
  })

  it('renders the pre-season toggle with the right testid', () => {
    expect(SETTINGS_TAB_SRC).toMatch(/data-testid="settings-tab-preseason-section"/)
    expect(SETTINGS_TAB_SRC).toMatch(/data-testid="settings-tab-preseason-on"/)
    expect(SETTINGS_TAB_SRC).toMatch(/data-testid="settings-tab-preseason-off"/)
  })

  it('renders the recruiting toggle with the right testid', () => {
    expect(SETTINGS_TAB_SRC).toMatch(/data-testid="settings-tab-recruiting-section"/)
    expect(SETTINGS_TAB_SRC).toMatch(/data-testid="settings-tab-recruiting-on"/)
    expect(SETTINGS_TAB_SRC).toMatch(/data-testid="settings-tab-recruiting-off"/)
  })

  it('both handlers follow the optimistic-flip-with-rollback pattern', () => {
    // The state setter is called BEFORE the await; on failure the previous
    // value is restored via setX(prev) in catch.
    expect(SETTINGS_TAB_SRC).toMatch(
      /setPreseasonModeState\(value\)[\s\S]+?await\s+setLeaguePreseasonMode[\s\S]+?catch[\s\S]+?setPreseasonModeState\(prev\)/,
    )
    expect(SETTINGS_TAB_SRC).toMatch(
      /setRecruitingState\(value\)[\s\S]+?await\s+setLeagueRecruiting[\s\S]+?catch[\s\S]+?setRecruitingState\(prev\)/,
    )
  })

  it('disables both buttons during save (savingToggle gate)', () => {
    expect(SETTINGS_TAB_SRC).toMatch(/savingToggle\s*===\s*['"]preseasonMode['"]/)
    expect(SETTINGS_TAB_SRC).toMatch(/savingToggle\s*===\s*['"]recruiting['"]/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 11) Default (both off) behavior is preserved — regression target
// ────────────────────────────────────────────────────────────────────────────

describe('v1.63.0 — defaults preserve pre-v1.63.0 behavior', () => {
  it('Dashboard defaults both props to false', () => {
    // Both are optional with `= false` defaults — the existing call sites
    // that don't pass them get the Classic homepage with no recruiting
    // banner. This is the regression target for "did v1.63.0 accidentally
    // flip an existing league into pre-season mode."
    expect(DASHBOARD_SRC).toMatch(/preseasonMode\s*=\s*false/)
    expect(DASHBOARD_SRC).toMatch(/recruiting\s*=\s*false/)
  })

  it('Header defaults hideStatsLink to false', () => {
    expect(HEADER_SRC).toMatch(/hideStatsLink\s*=\s*false/)
  })

  it('getLeagueFlags defaults flags off + visibility PUBLIC_CLOSED on missing row / failure', () => {
    expect(HELPER_SRC).toMatch(
      /DEFAULT_FLAGS:\s*LeagueFlags\s*=\s*\{[\s\S]*?preseasonMode:\s*false[\s\S]*?recruiting:\s*false[\s\S]*?visibility:\s*['"]PUBLIC_CLOSED['"][\s\S]*?\}/,
    )
  })
})
