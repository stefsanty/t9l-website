/**
 * v1.75.0 — League details settings + public preseason display.
 *
 * Structural tests over file content — these surface the load-bearing
 * contracts that would silently regress if a future PR re-introduced
 * the pre-v1.75.0 shape.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('v1.75.0 schema additions on League', () => {
  const schema = read('prisma/schema.prisma')

  it('declares ballType as BallType @default(SOCCER)', () => {
    expect(schema).toMatch(/ballType\s+BallType\s+@default\(SOCCER\)/)
  })

  it('declares goalSize as GoalSize @default(FULL_SIZE_SOCCER)', () => {
    expect(schema).toMatch(/goalSize\s+GoalSize\s+@default\(FULL_SIZE_SOCCER\)/)
  })

  it('declares throwInType as ThrowInType @default(THROW_IN)', () => {
    expect(schema).toMatch(/throwInType\s+ThrowInType\s+@default\(THROW_IN\)/)
  })

  it('declares offsideRule as Boolean @default(true)', () => {
    expect(schema).toMatch(/offsideRule\s+Boolean\s+@default\(true\)/)
  })

  it('declares backpassRule as Boolean @default(true)', () => {
    expect(schema).toMatch(/backpassRule\s+Boolean\s+@default\(true\)/)
  })

  it('declares matchDurationMinutes as nullable Int', () => {
    expect(schema).toMatch(/matchDurationMinutes\s+Int\?/)
  })

  it('declares playerFormat as nullable Int', () => {
    expect(schema).toMatch(/playerFormat\s+Int\?/)
  })

  it('declares unlimitedSubstitutions as Boolean @default(true)', () => {
    expect(schema).toMatch(/unlimitedSubstitutions\s+Boolean\s+@default\(true\)/)
  })

  it('declares organizerMessage as nullable String @db.Text', () => {
    expect(schema).toMatch(/organizerMessage\s+String\?\s+@db\.Text/)
  })

  it('declares showLeagueDetails as Boolean @default(true)', () => {
    expect(schema).toMatch(/showLeagueDetails\s+Boolean\s+@default\(true\)/)
  })

  it('declares the BallType enum with SOCCER + FUTSAL', () => {
    expect(schema).toMatch(/enum BallType\s*\{[^}]*SOCCER[^}]*FUTSAL[^}]*\}/)
  })

  it('declares the GoalSize enum with FUTSAL + YOUTH_SOCCER + FULL_SIZE_SOCCER', () => {
    expect(schema).toMatch(
      /enum GoalSize\s*\{[^}]*FUTSAL[^}]*YOUTH_SOCCER[^}]*FULL_SIZE_SOCCER[^}]*\}/,
    )
  })

  it('declares the ThrowInType enum with THROW_IN + KICK_IN', () => {
    expect(schema).toMatch(/enum ThrowInType\s*\{[^}]*THROW_IN[^}]*KICK_IN[^}]*\}/)
  })
})

describe('v1.75.0 migration is purely additive', () => {
  const sql = read('prisma/migrations/20260512000000_league_details/migration.sql')

  it('creates the three enum types', () => {
    expect(sql).toMatch(/CREATE TYPE "BallType"/)
    expect(sql).toMatch(/CREATE TYPE "GoalSize"/)
    expect(sql).toMatch(/CREATE TYPE "ThrowInType"/)
  })

  it('adds all ten League columns via ALTER TABLE ADD COLUMN', () => {
    expect(sql).toMatch(/ALTER TABLE "League" ADD COLUMN "ballType"/)
    expect(sql).toMatch(/ALTER TABLE "League" ADD COLUMN "goalSize"/)
    expect(sql).toMatch(/ALTER TABLE "League" ADD COLUMN "throwInType"/)
    expect(sql).toMatch(/ALTER TABLE "League" ADD COLUMN "offsideRule"/)
    expect(sql).toMatch(/ALTER TABLE "League" ADD COLUMN "backpassRule"/)
    expect(sql).toMatch(/ALTER TABLE "League" ADD COLUMN "matchDurationMinutes"/)
    expect(sql).toMatch(/ALTER TABLE "League" ADD COLUMN "playerFormat"/)
    expect(sql).toMatch(/ALTER TABLE "League" ADD COLUMN "unlimitedSubstitutions"/)
    expect(sql).toMatch(/ALTER TABLE "League" ADD COLUMN "organizerMessage"/)
    expect(sql).toMatch(/ALTER TABLE "League" ADD COLUMN "showLeagueDetails"/)
  })

  it('contains no DROP / ALTER COLUMN / TRUNCATE statements in executable SQL', () => {
    // Strip comments first so commentary about rollback recipes doesn't
    // trigger false positives.
    const code = sql.replace(/--.*$/gm, '')
    expect(code).not.toMatch(/DROP\s/i)
    expect(code).not.toMatch(/ALTER\s+COLUMN/i)
    expect(code).not.toMatch(/TRUNCATE/i)
  })
})

describe('v1.75.0 updateLeagueDetails server action', () => {
  const actions = read('src/app/admin/leagues/actions.ts')

  it('exports the server action', () => {
    expect(actions).toMatch(/export async function updateLeagueDetails/)
  })

  function getFn(): string {
    const after = actions.split('export async function updateLeagueDetails')[1]
    expect(after).toBeDefined()
    return after.split('export async function')[0]
  }

  it('gates on assertAdmin', () => {
    expect(getFn()).toMatch(/await assertAdmin/)
  })

  it('rejects empty leagueId', () => {
    expect(getFn()).toMatch(/leagueId is required/)
  })

  it('validates ball type / goal size / throw-in type against enum literals', () => {
    const fn = getFn()
    expect(fn).toMatch(/ballType must be one of/)
    expect(fn).toMatch(/goalSize must be one of/)
    expect(fn).toMatch(/throwInType must be one of/)
  })

  it('validates matchDurationMinutes is positive integer or null', () => {
    expect(getFn()).toMatch(/matchDurationMinutes must be a positive integer or null/)
  })

  it('validates playerFormat against the allowed set or null', () => {
    expect(getFn()).toMatch(/playerFormat must be one of/)
  })

  it('writes to League via prisma.league.update', () => {
    expect(getFn()).toMatch(/prisma\.league\.update/)
  })

  it('busts the admin cache via the canonical revalidate helper', () => {
    expect(getFn()).toMatch(/revalidate\(\{[\s\S]*domain:\s*'admin'/)
  })

  it('busts the public cache so the preseason homepage picks up new values', () => {
    expect(getFn()).toMatch(/revalidate\(\{\s*domain:\s*'public'\s*\}\)/)
  })
})

describe('v1.75.0 leagueDetails helper', () => {
  // v1.80.7 — server-only DB read split into `leagueDetailsServer.ts`;
  // pure label maps + types stay in `leagueDetails.ts`. Each assertion
  // reads from whichever file the moved/staying export lives in.
  const serverSrc = read('src/lib/leagueDetailsServer.ts')
  const pureSrc = read('src/lib/leagueDetails.ts')

  it('exports the cached getLeagueDetails reader', () => {
    expect(serverSrc).toMatch(/export const getLeagueDetails = unstable_cache/)
  })

  it('returns null when the league has showLeagueDetails === false', () => {
    expect(serverSrc).toMatch(/if \(!row\.showLeagueDetails\) return null/)
  })

  it('returns null on Prisma rejection (defensive)', () => {
    expect(serverSrc).toMatch(/leagueDetails.*read failed/)
    expect(serverSrc).toMatch(/return null/)
  })

  it('selects all ten new columns', () => {
    expect(serverSrc).toMatch(/ballType:\s*true/)
    expect(serverSrc).toMatch(/goalSize:\s*true/)
    expect(serverSrc).toMatch(/throwInType:\s*true/)
    expect(serverSrc).toMatch(/offsideRule:\s*true/)
    expect(serverSrc).toMatch(/backpassRule:\s*true/)
    expect(serverSrc).toMatch(/matchDurationMinutes:\s*true/)
    expect(serverSrc).toMatch(/playerFormat:\s*true/)
    expect(serverSrc).toMatch(/unlimitedSubstitutions:\s*true/)
    expect(serverSrc).toMatch(/organizerMessage:\s*true/)
    expect(serverSrc).toMatch(/showLeagueDetails:\s*true/)
  })

  it('uses the canonical leagues cache tag', () => {
    expect(serverSrc).toMatch(/tags:\s*\['leagues'\]/)
  })

  it('exports human-readable label maps for each enum (in the pure module)', () => {
    expect(pureSrc).toMatch(/BALL_TYPE_LABELS/)
    expect(pureSrc).toMatch(/GOAL_SIZE_LABELS/)
    expect(pureSrc).toMatch(/THROW_IN_TYPE_LABELS/)
  })

  it('pure module imports nothing prisma- or next/cache-related (perf phase 4b)', () => {
    // Regression target: `leagueDetails.ts` is imported by the
    // client-side `LeagueDetailsPanel` (lazy via next/dynamic). Re-adding
    // a `prisma` or `next/cache` import here would re-introduce the
    // ~47 KB Prisma browser-runtime leak into the LeagueDetailsPanel
    // chunk that v1.80.7 fixed by splitting DB reads into
    // `leagueDetailsServer.ts`.
    expect(pureSrc).not.toMatch(/from\s+['"]@\/lib\/prisma['"]/)
    expect(pureSrc).not.toMatch(/from\s+['"]next\/cache['"]/)
  })
})

describe('v1.75.0 LeagueDetailsEditor admin UI', () => {
  const src = read('src/components/admin/LeagueDetailsEditor.tsx')

  it('is a client component', () => {
    expect(src).toMatch(/^'use client'/)
  })

  it('imports updateLeagueDetails server action', () => {
    // v1.75.5 — broadened to multi-import shape since the editor now also
    // imports updateLeagueFeeSettings + updateLeaguePlannedRoster from the
    // same module. The original single-line shape is gone.
    expect(src).toMatch(/updateLeagueDetails/)
    expect(src).toMatch(/from '@\/app\/admin\/leagues\/actions'/)
  })

  it('conditionally renders backpass toggle only when ballType is FUTSAL', () => {
    // The literal pattern `{ballType === 'FUTSAL' &&` is the load-bearing
    // gate — flipping back to always-render would re-introduce the
    // futsal-specific rule on a soccer league.
    expect(src).toMatch(/ballType === 'FUTSAL' &&[\s\S]*league-details-backpass-toggle/)
  })

  it('drops backpassRule from the saved payload when ballType !== FUTSAL', () => {
    // Sending the current backpassRule value while the field is hidden
    // would silently overwrite a previously-saved value the admin can't
    // see. The conditional `ballType === 'FUTSAL' ? backpassRule : undefined`
    // is the load-bearing protection.
    expect(src).toMatch(/backpassRule:\s*ballType === 'FUTSAL' \? backpassRule : undefined/)
  })

  it('exposes all expected testids', () => {
    // Some testids are template literals (e.g. `league-details-ball-type-${opt}`)
    // so allow either `data-testid="..."` or `data-testid={`...`}` forms.
    expect(src).toMatch(/data-testid="settings-tab-league-details-section"/)
    expect(src).toMatch(/league-details-ball-type-/)
    expect(src).toMatch(/data-testid="league-details-goal-size"/)
    expect(src).toMatch(/league-details-throw-in-/)
    expect(src).toMatch(/data-testid="league-details-offside-toggle"/)
    expect(src).toMatch(/data-testid="league-details-backpass-toggle"/)
    expect(src).toMatch(/data-testid="league-details-match-duration"/)
    expect(src).toMatch(/data-testid="league-details-player-format"/)
    expect(src).toMatch(/data-testid="league-details-unlimited-subs-toggle"/)
    expect(src).toMatch(/data-testid="league-details-organizer-message"/)
    expect(src).toMatch(/data-testid="league-details-show-toggle"/)
    expect(src).toMatch(/data-testid="league-details-save"/)
  })

  it('player-format dropdown lists allowed values 5/6/7/9/11', () => {
    expect(src).toMatch(/value="5"/)
    expect(src).toMatch(/value="6"/)
    expect(src).toMatch(/value="7"/)
    expect(src).toMatch(/value="9"/)
    expect(src).toMatch(/value="11"/)
  })

  it('SettingsTab mounts LeagueDetailsEditor', () => {
    const tab = read('src/components/admin/SettingsTab.tsx')
    expect(tab).toMatch(/import LeagueDetailsEditor from '\.\/LeagueDetailsEditor'/)
    expect(tab).toMatch(/<LeagueDetailsEditor/)
    expect(tab).toMatch(/initialBallType=\{league\.ballType\}/)
    expect(tab).toMatch(/initialOrganizerMessage=\{league\.organizerMessage\}/)
  })
})

describe('v1.75.0 LeagueDetailsPanel public component', () => {
  const src = read('src/components/LeagueDetailsPanel.tsx')

  it('renders the LeagueDetailsPanel testid root', () => {
    expect(src).toMatch(/data-testid="league-details-panel"/)
  })

  it('hides the backpass row when ballType !== FUTSAL', () => {
    // Load-bearing display rule — the rule mirrors the admin-side hide.
    expect(src).toMatch(/data\.ballType === 'FUTSAL'/)
    expect(src).toMatch(/showBackpass &&[\s\S]*league-details-backpass-row/)
  })

  it('hides match-duration row when matchDurationMinutes is null', () => {
    expect(src).toMatch(/showDuration =\s*data\.matchDurationMinutes != null/)
  })

  it('hides player-format row when playerFormat is null', () => {
    expect(src).toMatch(/showFormat =\s*data\.playerFormat != null/)
  })

  it('renders organizer message with whitespace-pre-line so newlines survive', () => {
    expect(src).toMatch(/whitespace-pre-line/)
  })

  it('renders Yes/No for boolean rows (offside / subs)', () => {
    expect(src).toMatch(/data\.offsideRule \? 'Yes' : 'No'/)
    expect(src).toMatch(/data\.unlimitedSubstitutions \? 'Unlimited' : 'Limited'/)
  })

  it('is collapsible — renders expand/collapse toggle on the header (v1.75.1)', () => {
    expect(src).toMatch(/league-details-panel-header/)
    expect(src).toMatch(/expanded/)
  })
})

describe('v1.75.0 Dashboard wiring', () => {
  const dash = read('src/components/Dashboard.tsx')

  it('imports LeagueDetailsPanel and the helper type', () => {
    // v1.80.3 — LeagueDetailsPanel is below-fold so it ships as a
    // `next/dynamic` chunk; either the static or dynamic pull-in counts.
    expect(dash).toMatch(
      /import LeagueDetailsPanel from '\.\/LeagueDetailsPanel'|dynamic\(\(\) => import\('\.\/LeagueDetailsPanel'\)/
    )
    expect(dash).toMatch(/import type \{ LeagueDetails as LeagueDetailsData \} from '@\/lib\/leagueDetails'/)
  })

  it('declares the leagueDetails prop', () => {
    expect(dash).toMatch(/leagueDetails\?:\s*LeagueDetailsData \| null/)
  })

  it('renders LeagueDetailsPanel in the Dashboard body', () => {
    // v1.75.1 — LeagueDetailsPanel now contains PlannedRosterStats inline;
    // the ordering assertion is moved to v1751_league_details_consolidation.test.ts.
    expect(dash).toMatch(/<LeagueDetailsPanel/)
  })

  it('renders LeagueDetailsPanel when leagueDetails is non-null', () => {
    // v1.75.1 — uses a ternary (leagueDetails ? <LDP> : <PRS fallback>)
    // rather than the old unconditional `{leagueDetails && <LeagueDetailsPanel`.
    expect(dash).toMatch(/leagueDetails\s*\?\s*\(/)
    expect(dash).toMatch(/<LeagueDetailsPanel/)
  })
})

describe('v1.75.0 page-level wiring (apex + /id/<slug> + /id/<slug>/md/<id>)', () => {
  const sources = [
    'src/app/page.tsx',
    'src/app/id/[slug]/page.tsx',
    'src/app/id/[slug]/md/[id]/page.tsx',
  ]

  // v2.1.0 — /id/<slug> moved its data-fetching tree into
  // LeagueBannersBlock + LeagueMatchdayContent + LeagueMatchdayClient,
  // so per-call regression targets read the concat of all four files
  // for that one route. Legacy paths keep their inline-in-page reads.
  function readTree(rel: string): string {
    if (rel === 'src/app/id/[slug]/page.tsx') {
      return (
        read(rel) +
        '\n' +
        read('src/components/LeagueBannersBlock.tsx') +
        '\n' +
        read('src/components/LeagueMatchdayContent.tsx') +
        '\n' +
        read('src/components/LeagueMatchdayClient.tsx')
      )
    }
    return read(rel)
  }

  it.each(sources)('%s imports getLeagueDetails from leagueDetailsServer (v1.80.7 split)', (rel) => {
    // Apex page.tsx uses double quotes; /id pages use single quotes — both valid.
    expect(readTree(rel)).toMatch(/import \{ getLeagueDetails \} from ["']@\/lib\/leagueDetailsServer["']/)
  })

  it.each(sources)('%s threads leagueDetails to the matchday surface', (rel) => {
    expect(readTree(rel)).toMatch(/leagueDetails=\{leagueDetails \?\? null\}/)
  })

  it.each(sources)('%s threads leagueDetails unconditionally (no preseasonMode gate — v1.75.1)', (rel) => {
    // v1.75.1 removed the preseasonMode gate at the call site; the
    // details panel now renders on both classic and preseason homepages
    // when showLeagueDetails=true. v2.1.0 — /id/<slug>'s old
    // `_leagueDetails` destructure is gone with the page restructure;
    // the prop-thread form (`leagueDetails={leagueDetails ?? null}`)
    // is the post-v2.1.0 contract. Legacy paths keep the destructure.
    if (rel === 'src/app/id/[slug]/page.tsx') {
      const tree = readTree(rel)
      expect(tree).toMatch(/leagueDetails=\{leagueDetails \?\? null\}/)
      expect(tree).not.toMatch(/flags\.preseasonMode\s*\?\s*_leagueDetails/)
    } else {
      expect(read(rel)).toMatch(/leagueDetails\s*=\s*_leagueDetails/)
    }
  })
})

describe('v1.75.0 stash-pop regression target', () => {
  it('SettingsTab interface declares all ten new fields', () => {
    const tab = read('src/components/admin/SettingsTab.tsx')
    expect(tab).toMatch(/ballType:\s*'SOCCER' \| 'FUTSAL'/)
    expect(tab).toMatch(/goalSize:\s*'FUTSAL' \| 'YOUTH_SOCCER' \| 'FULL_SIZE_SOCCER'/)
    expect(tab).toMatch(/throwInType:\s*'THROW_IN' \| 'KICK_IN'/)
    expect(tab).toMatch(/offsideRule:\s*boolean/)
    expect(tab).toMatch(/backpassRule:\s*boolean/)
    expect(tab).toMatch(/matchDurationMinutes:\s*number \| null/)
    expect(tab).toMatch(/playerFormat:\s*number \| null/)
    expect(tab).toMatch(/unlimitedSubstitutions:\s*boolean/)
    expect(tab).toMatch(/organizerMessage:\s*string \| null/)
    expect(tab).toMatch(/showLeagueDetails:\s*boolean/)
  })

  it('version pin (any v1.75.x or later)', () => {
    const v = read('src/lib/version.ts')
    const m = v.match(/APP_VERSION\s*=\s*'(\d+)\.(\d+)\.(\d+)'/)
    expect(m).not.toBeNull()
    if (!m) return
    const [, major, minor] = m
    const majorN = parseInt(major, 10)
    const minorN = parseInt(minor, 10)
    expect(majorN > 1 || (majorN === 1 && minorN >= 75)).toBe(true)
  })
})
