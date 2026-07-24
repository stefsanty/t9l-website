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

  it('renders season-fee-row when plannedRosterStats is provided (v1.79.4 separate rows)', () => {
    // v1.79.4 — separate rows: season-fee-row and register-by-row.
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

  it('renders deadline inside register-by-row from plannedRosterStats when present (v1.79.4)', () => {
    // v1.79.4 — Register By is in its own register-by-row, gated by showDeadline
    expect(src).toMatch(/showDeadline[\s\S]*Register By/)
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

  it('stats section (fee row) appears AFTER offside row (v1.75.6 — stats moved to bottom)', () => {
    // v1.75.6 moved fee + planned roster + matchdays rows into a bottom
    // subsection. v1.79.4 testid: season-fee-row.
    const idxOffside = src.indexOf('league-details-offside-row')
    const idxFee = src.indexOf('"season-fee-row"')
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

describe('v2.3.0 tab behavior (replaces the v1.75.1 collapsible)', () => {
  const src = read('src/components/LeagueDetailsPanel.tsx')

  it('still accepts preseasonMode prop', () => {
    // v2.3.0 — prop kept; semantic shifted from "starts expanded" to
    // "default tab = season" (when the Season info tab exists).
    expect(src).toMatch(/preseasonMode\?:\s*boolean/)
  })

  it('preseasonMode drives the default tab to Season info when available', () => {
    // Regression target: pre-v2.3.0 wired preseasonMode into `useState(expanded)`.
    // Post-v2.3.0 it picks the initial tab id.
    expect(src).toMatch(/preseasonMode\s*&&\s*showSeasonTab\s*\?\s*'season'\s*:\s*'rules'/)
  })

  it('mounts the shared Tabs primitive with the league-details testid stem', () => {
    expect(src).toMatch(/import \{ Tabs[^}]*\} from '@\/components\/ui\/Tabs'/)
    expect(src).toMatch(/<Tabs[\s\S]+testid="league-details-tabs"/)
  })

  it('panel body wrapper has the league-details-panel-body testid + pt-4 spacing', () => {
    // Regression target — removing pt-4 re-introduces the tight spacing
    // (the v1.75.3 spacing fix). The body now lives inside the Tabs
    // render-prop child rather than behind an `expanded` gate.
    expect(src).toMatch(/data-testid="league-details-panel-body"/)
    expect(src).toMatch(/pt-4[^"]*"[^>]*league-details-panel-body/)
    expect(src).not.toMatch(/(?:pt-0|pt-1|pt-2|pt-3)\b[^"]*"[^>]*league-details-panel-body/)
  })

  it('drops the old accordion header + ChevronDown import (v2.3.0)', () => {
    // Regression target: reverting to the accordion would re-add these.
    expect(src).not.toMatch(/data-testid="league-details-panel-header"/)
    expect(src).not.toMatch(/aria-expanded=\{expanded\}/)
    expect(src).not.toMatch(/import \{ ChevronDown \} from 'lucide-react'/)
  })

  it('Rules tab renders the rules dl + its testid', () => {
    expect(src).toMatch(/active === 'rules'[\s\S]+league-details-rules-section/)
  })

  it('Season info tab renders the stats section + is conditional on showSeasonTab', () => {
    expect(src).toMatch(/active === 'season'[\s\S]+league-stats-section/)
    expect(src).toMatch(/showSeasonTab\s*&&\s*plannedRosterStats/)
  })

  it('Organizer tab only appears when organizerMessage is set', () => {
    // Tab list builds conditionally; the tab is pushed only when
    // `showMessage` is true (organizerMessage non-null + non-empty).
    expect(src).toMatch(/showMessage[\s\S]+id: 'organizer'/)
    expect(src).toMatch(/active === 'organizer'[\s\S]+league-details-organizer-message/)
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
    // v2.1.0 — /id/<slug> moved the data fetching into
    // LeagueMatchdayContent; read the full render tree for that route.
    const src =
      rel === 'src/app/id/[slug]/page.tsx'
        ? read(rel) +
          '\n' +
          read('src/components/LeagueBannersBlock.tsx') +
          '\n' +
          read('src/components/LeagueMatchdayContent.tsx') +
          '\n' +
          read('src/components/LeagueMatchdayClient.tsx')
        : read(rel)
    expect(src).not.toMatch(/flags\.preseasonMode \? _leagueDetails : null/)
    expect(src).not.toMatch(/flags\.preseasonMode\s*\?\s*leagueDetails\s*:\s*null/)
  })

  it.each(sources)('%s passes leagueDetails through unconditionally (no preseasonMode ternary)', (rel) => {
    // v2.1.0 — /id/<slug>'s `_leagueDetails` destructuring is gone (the
    // page no longer holds the Promise.all). The post-v2.1.0 contract:
    // the matchday content threads `leagueDetails={leagueDetails ?? null}`
    // into <LeagueMatchdayClient> with no preseasonMode gate at the
    // call site. Legacy paths keep the original `_leagueDetails` pin.
    if (rel === 'src/app/id/[slug]/page.tsx') {
      const tree =
        read('src/components/LeagueMatchdayContent.tsx') +
        '\n' +
        read('src/components/LeagueMatchdayClient.tsx')
      expect(tree).toMatch(/leagueDetails=\{leagueDetails\s*\?\?\s*null\}/)
    } else {
      expect(read(rel)).toMatch(/leagueDetails\s*=\s*_leagueDetails/)
    }
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
    // v1.78.0 — floor pin relaxed to accept any v1.75.4+ / v1.[76-99].x /
    // v2+ so future bumps don't churn this file. Same pattern as
    // v169_availability_toggle.test.ts.
    const v = read('src/lib/version.ts')
    expect(v).toMatch(
      /APP_VERSION\s*=\s*'(?:1\.75\.(?:[4-9]|\d{2,})|1\.(?:7[6-9]|[89]\d|\d{3,})\.\d+|[2-9]\.\d+\.\d+)'/,
    )
  })

  it('LeagueDetailsPanel does NOT carry the pre-v2.3.0 accordion-header markup', () => {
    const src = read('src/components/LeagueDetailsPanel.tsx')
    // v2.3.0 — the v1.75.1 accordion was replaced with a Tabs primitive.
    // Regression target: a revert to either the chevron-header button
    // or the v1.75.0 static <p> heading would re-introduce inconsistent
    // tab styling on this surface.
    expect(src).not.toMatch(/league-details-panel-header/)
    expect(src).not.toMatch(/<p[^>]*>[\s\S]*?League details[\s\S]*?<\/p>/)
  })
})

describe('v2.3.0 tab strip styling (replaces v1.75.2 header clickable-button styling)', () => {
  const tabs = read('src/components/ui/Tabs.tsx')

  it('shared Tabs primitive uses futcal underline-tab tokens', () => {
    // Verifies the active vs inactive tokens that the primitive emits.
    // Active: border-accent text-accent. Inactive: border-transparent
    // text-fg-mid hover:text-fg-high. Regression target — drifting away
    // would break the cross-surface visual consistency this primitive
    // is meant to enforce.
    expect(tabs).toMatch(/border-accent text-accent/)
    expect(tabs).toMatch(/border-transparent text-fg-mid hover:text-fg-high/)
  })

  it('shared Tabs primitive uses the canonical px-4 py-3 text-[13px] font-semibold tab metrics', () => {
    expect(tabs).toMatch(/px-4 py-3 text-\[13px\] font-semibold/)
  })

  it('shared Tabs primitive renders nav role="tablist" with border-b border-border-default', () => {
    expect(tabs).toMatch(/role="tablist"/)
    expect(tabs).toMatch(/flex border-b border-border-default/)
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
    // v1.78.0 — floor pin relaxed (see same-file note above).
    const v = read('src/lib/version.ts')
    expect(v).toMatch(
      /APP_VERSION\s*=\s*'(?:1\.75\.(?:[4-9]|\d{2,})|1\.(?:7[6-9]|[89]\d|\d{3,})\.\d+|[2-9]\.\d+\.\d+)'/,
    )
  })
})
