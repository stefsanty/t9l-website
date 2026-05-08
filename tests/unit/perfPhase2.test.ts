import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * v1.80.3 — Phase 2 of the perf audit (handover-perf-audit.md):
 *
 *   H3  Below-fold Dashboard widgets converted to `next/dynamic`:
 *         MatchdayAvailability, LeagueDetailsPanel, PlannedRosterStats,
 *         RsvpBar, SubmitGoalForm, CompressedMatchdaySchedule
 *   H4  Below-fold /stats widgets converted to `next/dynamic`:
 *         TopPerformers, SquadList
 *   H2  Font-weight pruning deferred — every candidate weight (Barlow
 *       Condensed 400, Barlow Sans 500, DM Mono 500) has explicit callers
 *       in the codebase (verified by grep). Pruning would either drop
 *       used weights or rely on synthetic-bold substitution that
 *       cannot be verified cleanly without rendering every page. Per
 *       the audit's stricter approach, deferred to phase 3+.
 *
 * Each assertion fails on the pre-fix state where the components were
 * statically imported in the route bundle. Verified by stash-pop sanity
 * check during PR authoring.
 *
 * Above-fold components MUST stay statically imported so they ship in
 * the initial route bundle and SSR with the route's HTML — these tests
 * also pin that invariant so a future "split everything" refactor
 * doesn't accidentally lazy-load the LCP banner.
 */

const ROOT = path.resolve(__dirname, '../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

const dynamicImportRegex = (modulePath: string) =>
  new RegExp(
    `dynamic\\(\\s*\\(\\)\\s*=>\\s*import\\(\\s*['"]${modulePath.replace(
      /\//g,
      '\\/'
    )}['"]\\s*\\)`
  )

const staticImportRegex = (componentName: string, modulePath: string) =>
  new RegExp(
    `^import\\s+${componentName}\\s+from\\s+['"]${modulePath.replace(
      /\//g,
      '\\/'
    )}['"]`,
    'm'
  )

describe('perf phase 2 — H3: Dashboard below-fold widgets are next/dynamic', () => {
  const dashboard = read('src/components/Dashboard.tsx')
  const classic = read('src/components/ClassicLeagueHomepage.tsx')

  it('Dashboard imports next/dynamic', () => {
    expect(dashboard).toMatch(/from\s+['"]next\/dynamic['"]/)
  })

  it('Dashboard lazy-loads LeagueDetailsPanel', () => {
    expect(dashboard).toMatch(dynamicImportRegex('./LeagueDetailsPanel'))
    expect(dashboard).not.toMatch(
      staticImportRegex('LeagueDetailsPanel', './LeagueDetailsPanel')
    )
  })

  it('Dashboard lazy-loads PlannedRosterStats', () => {
    expect(dashboard).toMatch(dynamicImportRegex('./PlannedRosterStats'))
    expect(dashboard).not.toMatch(
      staticImportRegex('PlannedRosterStats', './PlannedRosterStats')
    )
  })

  it('Dashboard lazy-loads RsvpBar', () => {
    expect(dashboard).toMatch(dynamicImportRegex('./RsvpBar'))
    expect(dashboard).not.toMatch(staticImportRegex('RsvpBar', './RsvpBar'))
  })

  it('Dashboard lazy-loads SubmitGoalForm', () => {
    expect(dashboard).toMatch(dynamicImportRegex('./matchday/SubmitGoalForm'))
    expect(dashboard).not.toMatch(
      staticImportRegex('SubmitGoalForm', './matchday/SubmitGoalForm')
    )
  })

  it('Dashboard lazy-loads CompressedMatchdaySchedule', () => {
    expect(dashboard).toMatch(dynamicImportRegex('./CompressedMatchdaySchedule'))
    expect(dashboard).not.toMatch(
      staticImportRegex(
        'CompressedMatchdaySchedule',
        './CompressedMatchdaySchedule'
      )
    )
  })

  it('ClassicLeagueHomepage lazy-loads MatchdayAvailability (the 522-line widget)', () => {
    expect(classic).toMatch(/from\s+['"]next\/dynamic['"]/)
    expect(classic).toMatch(dynamicImportRegex('./MatchdayAvailability'))
    expect(classic).not.toMatch(
      staticImportRegex('MatchdayAvailability', './MatchdayAvailability')
    )
  })

  it('Dashboard keeps Header, UnpaidFeeBanner, RecruitingBanner statically imported (above fold)', () => {
    // These render at the top of the dashboard and are LCP / first-paint
    // critical. Loading them via next/dynamic would defer the HTML they
    // render and re-trigger the very DCL bottleneck phase 2 is trying
    // to fix.
    expect(dashboard).toMatch(staticImportRegex('Header', './Header'))
    expect(dashboard).toMatch(staticImportRegex('UnpaidFeeBanner', './UnpaidFeeBanner'))
    expect(dashboard).toMatch(staticImportRegex('RecruitingBanner', './RecruitingBanner'))
  })

  it('ClassicLeagueHomepage keeps NextMatchdayBanner statically imported (LCP candidate)', () => {
    expect(classic).toMatch(
      staticImportRegex('NextMatchdayBanner', './NextMatchdayBanner')
    )
  })
})

describe('perf phase 2 — H4: /stats below-fold widgets are next/dynamic', () => {
  const stats = read('src/components/StatsDashboard.tsx')

  it('StatsDashboard imports next/dynamic', () => {
    expect(stats).toMatch(/from\s+['"]next\/dynamic['"]/)
  })

  it('StatsDashboard lazy-loads TopPerformers', () => {
    expect(stats).toMatch(dynamicImportRegex('./TopPerformers'))
    expect(stats).not.toMatch(staticImportRegex('TopPerformers', './TopPerformers'))
  })

  it('StatsDashboard lazy-loads SquadList', () => {
    expect(stats).toMatch(dynamicImportRegex('./SquadList'))
    expect(stats).not.toMatch(staticImportRegex('SquadList', './SquadList'))
  })

  it('StatsDashboard keeps LeagueTable statically imported (above fold)', () => {
    // LeagueTable is the first section users see on /stats and the table
    // is short enough that lazy-loading it would create flicker without
    // a payload win.
    expect(stats).toMatch(staticImportRegex('LeagueTable', './LeagueTable'))
  })
})

describe('perf phase 2 — skeletons reserve vertical space (CLS guard)', () => {
  // Each dynamic boundary above ships a `loading:` skeleton sized to
  // approximate the rendered component's footprint so scroll position
  // stays stable while the chunk fetches. Pin the testids of the
  // skeletons we expect — a future "skeleton: () => null" regression
  // would re-introduce CLS.
  const dashboard = read('src/components/Dashboard.tsx')
  const classic = read('src/components/ClassicLeagueHomepage.tsx')
  const stats = read('src/components/StatsDashboard.tsx')

  const skeletonTestIds = [
    { file: 'Dashboard', src: dashboard, testId: 'league-details-panel-skeleton' },
    { file: 'Dashboard', src: dashboard, testId: 'planned-roster-stats-skeleton' },
    { file: 'Dashboard', src: dashboard, testId: 'submit-goal-skeleton' },
    {
      file: 'Dashboard',
      src: dashboard,
      testId: 'compressed-matchday-schedule-skeleton',
    },
    {
      file: 'ClassicLeagueHomepage',
      src: classic,
      testId: 'matchday-availability-skeleton',
    },
    { file: 'StatsDashboard', src: stats, testId: 'top-performers-skeleton' },
    { file: 'StatsDashboard', src: stats, testId: 'squad-list-skeleton' },
  ]

  for (const { file, src, testId } of skeletonTestIds) {
    it(`${file} renders a skeleton with data-testid="${testId}"`, () => {
      expect(src).toMatch(new RegExp(`data-testid="${testId}"`))
    })
  }
})
