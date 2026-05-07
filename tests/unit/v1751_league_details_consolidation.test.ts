/**
 * v1.75.1 — LeagueDetailsPanel consolidation + preseason-mode decoupling
 * + field reorder + collapsible behavior.
 *
 * Structural tests over file content — pin the load-bearing contracts so
 * a future PR can't silently revert to the pre-v1.75.1 shape.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('v1.75.1 LeagueDetailsPanel includes planned-roster sub-section', () => {
  const src = read('src/components/LeagueDetailsPanel.tsx')

  it('imports PlannedRosterStats type from lib/plannedRosterStats', () => {
    expect(src).toMatch(/import type \{ PlannedRosterStats as PlannedRosterStatsData \} from '@\/lib\/plannedRosterStats'/)
  })

  it('accepts plannedRosterStats as optional prop', () => {
    expect(src).toMatch(/plannedRosterStats\?:\s*PlannedRosterStatsData \| null/)
  })

  it('renders season-fee-row when plannedRosterStats is provided and fee or deadline is configured', () => {
    // v1.75.6 — fee + deadline combined into one row, testid season-fee-row.
    expect(src).toMatch(/season-fee-row/)
  })

  it('renders planned-teams row when plannedRosterStats is provided', () => {
    expect(src).toMatch(/showPlannedTeams &&[\s\S]*planned-teams-row/)
  })

  it('renders spots-left row from plannedRosterStats', () => {
    expect(src).toMatch(/data-testid="spots-left-row"/)
  })

  it('does NOT render current-players-row (removed in v1.75.6)', () => {
    expect(src).not.toMatch(/data-testid="current-players-row"/)
  })

  it('renders deadline row from plannedRosterStats when present', () => {
    expect(src).toMatch(/showDeadline &&[\s\S]*deadline-row/)
  })

  it('imports formatJstFriendly for the deadline row', () => {
    expect(src).toMatch(/import \{ formatJstFriendly \} from '@\/lib\/jst'/)
  })

  it('imports formatJpyFee for the fee row', () => {
    expect(src).toMatch(/import \{ formatJpyFee \} from '@\/lib\/playerFee'/)
  })
})

describe('v1.75.1 field render order matches importance list', () => {
  const src = read('src/components/LeagueDetailsPanel.tsx')

  it('player format row appears before ball-type row', () => {
    const idxFormat = src.indexOf('league-details-format-row')
    const idxBall = src.indexOf('league-details-ball-row')
    expect(idxFormat).toBeGreaterThan(0)
    expect(idxBall).toBeGreaterThan(idxFormat)
  })

  it('match-duration row appears before ball-type row', () => {
    const idxDuration = src.indexOf('league-details-duration-row')
    const idxBall = src.indexOf('league-details-ball-row')
    expect(idxDuration).toBeGreaterThan(0)
    expect(idxBall).toBeGreaterThan(idxDuration)
  })

  it('ball-type row appears before goal-size row', () => {
    const idxBall = src.indexOf('league-details-ball-row')
    const idxGoal = src.indexOf('league-details-goal-row')
    expect(idxBall).toBeGreaterThan(0)
    expect(idxGoal).toBeGreaterThan(idxBall)
  })

  it('stats section (season-fee-row) appears AFTER offside row (v1.75.6 — stats moved to bottom)', () => {
    // v1.75.6 moved the fee + planned roster + matchdays rows into a
    // bottom subsection below the rule rows. Regression target: moving
    // them back above offside would re-introduce the old order.
    const idxOffside = src.indexOf('league-details-offside-row')
    const idxFee = src.indexOf('season-fee-row')
    expect(idxOffside).toBeGreaterThan(0)
    expect(idxFee).toBeGreaterThan(idxOffside)
  })

  it('offside row appears before throw-in row', () => {
    const idxOffside = src.indexOf('league-details-offside-row')
    const idxThrowIn = src.indexOf('league-details-throw-in-row')
    expect(idxOffside).toBeGreaterThan(0)
    expect(idxThrowIn).toBeGreaterThan(idxOffside)
  })

  it('throw-in row appears before backpass row', () => {
    const idxThrowIn = src.indexOf('league-details-throw-in-row')
    const idxBackpass = src.indexOf('league-details-backpass-row')
    expect(idxThrowIn).toBeGreaterThan(0)
    expect(idxBackpass).toBeGreaterThan(idxThrowIn)
  })

  it('subs row appears before organizer message', () => {
    const idxSubs = src.indexOf('league-details-subs-row')
    const idxMsg = src.indexOf('league-details-organizer-message')
    expect(idxSubs).toBeGreaterThan(0)
    expect(idxMsg).toBeGreaterThan(idxSubs)
  })
})

describe('v1.75.1 admin editor field order matches public panel', () => {
  const src = read('src/components/admin/LeagueDetailsEditor.tsx')

  it('player-format field appears before ball-type buttons', () => {
    const idxFormat = src.indexOf('league-details-player-format')
    const idxBall = src.indexOf('league-details-ball-type-')
    expect(idxFormat).toBeGreaterThan(0)
    expect(idxBall).toBeGreaterThan(idxFormat)
  })

  it('match-duration field appears before ball-type buttons', () => {
    const idxDuration = src.indexOf('league-details-match-duration')
    const idxBall = src.indexOf('league-details-ball-type-')
    expect(idxDuration).toBeGreaterThan(0)
    expect(idxBall).toBeGreaterThan(idxDuration)
  })

  it('offside toggle appears before throw-in buttons', () => {
    const idxOffside = src.indexOf('league-details-offside-toggle')
    const idxThrowIn = src.indexOf('league-details-throw-in-')
    expect(idxOffside).toBeGreaterThan(0)
    expect(idxThrowIn).toBeGreaterThan(idxOffside)
  })

  it('subs toggle appears before organizer message textarea', () => {
    const idxSubs = src.indexOf('league-details-unlimited-subs-toggle')
    const idxMsg = src.indexOf('league-details-organizer-message')
    expect(idxSubs).toBeGreaterThan(0)
    expect(idxMsg).toBeGreaterThan(idxSubs)
  })
})

describe('v1.75.1 collapsible behavior', () => {
  const src = read('src/components/LeagueDetailsPanel.tsx')

  it('accepts preseasonMode prop', () => {
    expect(src).toMatch(/preseasonMode\?:\s*boolean/)
  })

  it('uses useState for expanded/collapsed state', () => {
    expect(src).toMatch(/useState\(preseasonMode\)/)
  })

  it('renders a clickable header with aria-expanded', () => {
    expect(src).toMatch(/data-testid="league-details-panel-header"/)
    expect(src).toMatch(/aria-expanded=\{expanded\}/)
  })

  it('renders a chevron icon that rotates based on expanded state', () => {
    // ChevronDown with rotate-180 class when expanded
    expect(src).toMatch(/ChevronDown/)
    expect(src).toMatch(/rotate-180/)
  })

  it('panel body only renders when expanded', () => {
    expect(src).toMatch(/data-testid="league-details-panel-body"/)
    expect(src).toMatch(/expanded &&[\s\S]*league-details-panel-body/)
  })

  it('panel body has top padding (v1.75.3 spacing fix)', () => {
    // Regression target — removing pt-4 re-introduces the tight spacing.
    // className="... pt-4 ..." appears before data-testid="league-details-panel-body"
    // on the same div, so check the full line contains both.
    expect(src).toMatch(/pt-4[^"]*"[^>]*league-details-panel-body/)
    expect(src).not.toMatch(/(?:pt-0|pt-1|pt-2|pt-3)\b[^"]*"[^>]*league-details-panel-body/)
  })

  it('default state is expanded when preseasonMode=true', () => {
    // useState(preseasonMode) means:
    //   preseasonMode=true  → expanded=true  (starts open)
    //   preseasonMode=false → expanded=false (starts closed)
    expect(src).toMatch(/useState\(preseasonMode\)/)
  })
})

describe('v1.75.1 preseasonMode decoupled from LeagueDetailsPanel visibility', () => {
  const sources = [
    'src/app/page.tsx',
    'src/app/id/[slug]/page.tsx',
    'src/app/id/[slug]/md/[id]/page.tsx',
  ]

  it.each(sources)('%s does NOT gate leagueDetails on flags.preseasonMode', (rel) => {
    // Regression target: re-adding the preseasonMode gate would silently
    // hide the details panel on classic league homepages.
    expect(read(rel)).not.toMatch(/flags\.preseasonMode \? _leagueDetails : null/)
  })

  it.each(sources)('%s passes _leagueDetails directly without preseasonMode ternary', (rel) => {
    expect(read(rel)).toMatch(/leagueDetails\s*=\s*_leagueDetails/)
  })

  it.each(sources)('%s does NOT require flags.preseasonMode for plannedRosterStats', (rel) => {
    // Regression target: the old triple-condition gate is gone.
    expect(read(rel)).not.toMatch(/flags\.preseasonMode\s*&&\s*flags\.recruiting/)
  })

  // v1.75.5 — the userId + flags.recruiting gate was fully relaxed so the
  // public LeagueDetailsPanel can render the fee + planned teams + per-team +
  // spots-left mini-section regardless of recruiting flag. Per-row hides in
  // the panel ensure rows with unset/zero values stay hidden. The gate
  // assertion that previously pinned `userId && flags.recruiting` is now a
  // regression target in the OPPOSITE direction.
  it.each(sources)('%s does NOT gate plannedRosterStats on userId + flags.recruiting (v1.75.5 relaxation)', (rel) => {
    expect(read(rel)).not.toMatch(/userId\s*&&\s*flags\.recruiting\s*\?\s*_plannedRosterStats/)
  })
})

describe('v1.75.1 Dashboard wiring', () => {
  const dash = read('src/components/Dashboard.tsx')

  it('passes plannedRosterStats to LeagueDetailsPanel', () => {
    expect(dash).toMatch(/plannedRosterStats=\{plannedRosterStats\}/)
  })

  it('passes preseasonMode to LeagueDetailsPanel', () => {
    expect(dash).toMatch(/preseasonMode=\{preseasonMode\}/)
  })

  it('uses ternary: renders LeagueDetailsPanel when leagueDetails is present, standalone PlannedRosterStats as fallback', () => {
    // Regression target: re-adding a standalone PlannedRosterStats render
    // alongside LeagueDetailsPanel would show roster stats twice.
    expect(dash).toMatch(/leagueDetails\s*\?[\s\S]*LeagueDetailsPanel[\s\S]*:\s*\(/)
    expect(dash).toMatch(/plannedRosterStats &&\s*<PlannedRosterStats/)
  })
})

describe('v1.75.1 stash-pop regression target', () => {
  it('version is 1.75.4 or later', () => {
    const v = read('src/lib/version.ts')
    expect(v).toMatch(/APP_VERSION\s*=\s*'1\.75\.[4-9]'/)
  })

  it('LeagueDetailsPanel does NOT have the old non-collapsible header (plain <p> without toggle)', () => {
    const src = read('src/components/LeagueDetailsPanel.tsx')
    // The old header was just a <p> tag. Post v1.75.1 it's a <button>.
    // Regression: reverting to static <p> would break the expand/collapse UX.
    expect(src).toMatch(/league-details-panel-header/)
    expect(src).not.toMatch(/<p[^>]*>[\s\S]*?League details[\s\S]*?<\/p>/)
  })
})

describe('v1.75.2 header clickable-button styling', () => {
  const src = read('src/components/LeagueDetailsPanel.tsx')

  it('header button has bg-surface background (regression target: removing it loses the visual toggle cue)', () => {
    // Verifies the header has a slightly elevated tinted background to signal
    // it is interactive. Reverting to no background makes it look like plain text.
    const headerBlock = src.slice(src.indexOf('league-details-panel-header') - 200, src.indexOf('league-details-panel-header') + 400)
    expect(headerBlock).toMatch(/bg-surface\b/)
  })

  it('header button has hover:bg-surface-md for hover affordance', () => {
    const headerBlock = src.slice(src.indexOf('league-details-panel-header') - 200, src.indexOf('league-details-panel-header') + 400)
    expect(headerBlock).toMatch(/hover:bg-surface-md/)
  })

  it('header label span uses text-fg-high (more prominent than text-fg-mid)', () => {
    // fg-high makes the label text more visually prominent, reinforcing
    // that this is an actionable toggle rather than a passive section heading.
    // Regression target: reverting to text-fg-mid on the label span reduces visual prominence.
    // The span containing "League details" must use text-fg-high, not text-fg-mid.
    expect(src).toMatch(/<span className="[^"]*text-fg-high[^"]*">\s*League details/)
    expect(src).not.toMatch(/<span className="[^"]*text-fg-mid[^"]*">\s*League details/)
  })
})

describe('v1.75.4 LeagueDetailsPanel positioned between banner and availability in Classic mode', () => {
  const classic = read('src/components/ClassicLeagueHomepage.tsx')
  const dash = read('src/components/Dashboard.tsx')

  it('ClassicLeagueHomepage declares leagueDetailsPanelSlot prop', () => {
    expect(classic).toMatch(/leagueDetailsPanelSlot\?:\s*ReactNode/)
  })

  it('ClassicLeagueHomepage renders leagueDetailsPanelSlot between NextMatchdayBanner and MatchdayAvailability (source order)', () => {
    // Use render-site patterns (not import lines) for the order check.
    const bannerIdx = classic.indexOf('<NextMatchdayBanner')
    const slotIdx = classic.indexOf('{leagueDetailsPanelSlot}')
    const availIdx = classic.indexOf('<MatchdayAvailability')
    expect(bannerIdx).toBeGreaterThan(-1)
    expect(slotIdx).toBeGreaterThan(bannerIdx)
    expect(availIdx).toBeGreaterThan(slotIdx)
  })

  it('Dashboard passes leagueDetailsPanelSlot to ClassicLeagueHomepage', () => {
    expect(dash).toMatch(/leagueDetailsPanelSlot=/)
  })

  it('Dashboard does NOT render LeagueDetailsPanel at top level in classic mode — gated on preseasonMode', () => {
    // Regression target: rendering the panel both at top level and inside
    // ClassicLeagueHomepage would show it twice in classic mode.
    // Post v1.75.4 the top-level block is wrapped in {preseasonMode && ...}.
    expect(dash).toMatch(/preseasonMode &&\s*\(leagueDetails \?/)
  })

  it('stash-pop: version is 1.75.4 or later', () => {
    const v = read('src/lib/version.ts')
    expect(v).toMatch(/APP_VERSION\s*=\s*'1\.75\.[4-9]'/)
  })
})
