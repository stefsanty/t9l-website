/**
 * v1.75.6 — LeagueDetailsPanel: stats section moved to bottom, labels
 * renamed, "Current Players" removed, "Matchdays" row added, Season Fee +
 * Register By combined onto one line.
 *
 * Structural pins over file content to prevent regressions.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('v1.75.6 label renames in LeagueDetailsPanel', () => {
  const src = read('src/components/LeagueDetailsPanel.tsx')

  it('uses label "Season Fee" (not "Player fee" or "Player Fee")', () => {
    expect(src).toMatch(/Season Fee/)
    // Regression target: re-introducing the old label would undo the rename.
    expect(src).not.toMatch(/>\s*Player fee\s*</)
    expect(src).not.toMatch(/>\s*Player Fee\s*</)
  })

  it('uses label "Teams" for planned teams (not "Planned teams" or "Planned Teams")', () => {
    expect(src).toMatch(/label="Teams"/)
    // Regression target: old label must not reappear.
    expect(src).not.toMatch(/label="Planned teams"/)
    expect(src).not.toMatch(/label="Planned Teams"/)
    expect(src).not.toMatch(/label="Number of teams"/)
  })

  it('uses label "Roster Size" for per-team count (not "Per team" or "Per Team")', () => {
    expect(src).toMatch(/label="Roster Size"/)
    // Regression target: old label must not reappear.
    expect(src).not.toMatch(/label="Per team"/)
    expect(src).not.toMatch(/label="Per Team"/)
    expect(src).not.toMatch(/label="Players per team"/)
  })

  it('uses label "Register By" for the deadline (not "Registration deadline")', () => {
    expect(src).toMatch(/Register By/)
    // Regression target: old standalone label must not reappear as a separate row.
    // The string may appear in comments or old testids but not as a standalone row label.
    expect(src).not.toMatch(/label="Registration deadline"/)
  })
})

describe('v1.75.6 Current Players row removed', () => {
  const src = read('src/components/LeagueDetailsPanel.tsx')

  it('does NOT contain current-players-row testid (regression target — re-adding would re-introduce the row)', () => {
    expect(src).not.toMatch(/data-testid="current-players-row"/)
  })

  it('does NOT render "Current players" as a JSX label', () => {
    // Match JSX label text nodes only, not comments in the source file.
    expect(src).not.toMatch(/>\s*Current [Pp]layers\s*</)
    expect(src).not.toMatch(/label="Current [Pp]layers"/)
  })
})

describe('v1.75.6 Matchdays row added', () => {
  const src = read('src/components/LeagueDetailsPanel.tsx')

  it('renders matchdays-row testid (via Row component testid prop)', () => {
    // Row component accepts testid prop and renders data-testid in output.
    // Source file uses testid="matchdays-row" prop syntax.
    expect(src).toMatch(/testid="matchdays-row"/)
  })

  it('uses label "Matchdays"', () => {
    expect(src).toMatch(/label="Matchdays"/)
  })

  it('wires value from plannedRosterStats.matchdays', () => {
    expect(src).toMatch(/plannedRosterStats\.matchdays/)
  })

  it('gates matchdays row on showMatchdays', () => {
    expect(src).toMatch(/showMatchdays &&[\s\S]*matchdays-row/)
  })
})

describe('v1.75.6 Season Fee + Register By on one combined line', () => {
  const src = read('src/components/LeagueDetailsPanel.tsx')

  it('season-fee-row and deadline-row are nested inside the same container (col-span-2 block)', () => {
    // Both testids must appear inside the same season-fee-row block.
    const feeIdx = src.indexOf('season-fee-row')
    const deadlineIdx = src.indexOf('deadline-row')
    expect(feeIdx).toBeGreaterThan(-1)
    expect(deadlineIdx).toBeGreaterThan(-1)
    // deadline-row must come after season-fee-row opening tag
    expect(deadlineIdx).toBeGreaterThan(feeIdx)
    // Find the closing boundary: league-stats-section contains both
    const statsIdx = src.indexOf('league-stats-section')
    // Both are inside the stats section (below the rules section)
    expect(feeIdx).toBeGreaterThan(statsIdx)
    expect(deadlineIdx).toBeGreaterThan(statsIdx)
  })

  it('deadline-row is nested within the season-fee-row container', () => {
    // In the source the deadline-row div appears between the opening
    // data-testid="season-fee-row" and the next top-level row testid.
    const feeOpen = src.indexOf('season-fee-row')
    const deadlineOpen = src.indexOf('deadline-row')
    const teamsOpen = src.indexOf('planned-teams-row')
    expect(deadlineOpen).toBeGreaterThan(feeOpen)
    expect(deadlineOpen).toBeLessThan(teamsOpen)
  })

  it('season-fee-row uses col-span-2 (full width combined block)', () => {
    // Extract the area around season-fee-row to verify col-span-2.
    const idx = src.indexOf('season-fee-row')
    const surroundingBlock = src.slice(Math.max(0, idx - 200), idx + 50)
    expect(surroundingBlock).toMatch(/col-span-2/)
  })

  it('showFee gates the fee portion within season-fee-row', () => {
    expect(src).toMatch(/showFee &&[\s\S]{0,500}Season Fee/)
  })

  it('showDeadline gates the deadline portion within season-fee-row', () => {
    expect(src).toMatch(/showDeadline &&[\s\S]{0,500}Register By/)
  })
})

describe('v1.75.6 stats section is BELOW the rules section in DOM order', () => {
  const src = read('src/components/LeagueDetailsPanel.tsx')

  it('league-details-rules-section testid appears before league-stats-section testid', () => {
    const idxRules = src.indexOf('league-details-rules-section')
    const idxStats = src.indexOf('league-stats-section')
    expect(idxRules).toBeGreaterThan(-1)
    expect(idxStats).toBeGreaterThan(-1)
    expect(idxStats).toBeGreaterThan(idxRules)
  })

  it('offside row appears before the stats section', () => {
    const idxOffside = src.indexOf('league-details-offside-row')
    const idxStats = src.indexOf('league-stats-section')
    expect(idxOffside).toBeGreaterThan(-1)
    expect(idxStats).toBeGreaterThan(idxOffside)
  })

  it('subs row appears before the stats section', () => {
    const idxSubs = src.indexOf('league-details-subs-row')
    const idxStats = src.indexOf('league-stats-section')
    expect(idxSubs).toBeGreaterThan(-1)
    expect(idxStats).toBeGreaterThan(idxSubs)
  })

  it('season-fee-row appears inside the stats section (after league-stats-section)', () => {
    const idxStats = src.indexOf('league-stats-section')
    const idxFee = src.indexOf('season-fee-row')
    expect(idxFee).toBeGreaterThan(idxStats)
  })

  it('planned-teams-row appears inside the stats section', () => {
    const idxStats = src.indexOf('league-stats-section')
    const idxTeams = src.indexOf('planned-teams-row')
    expect(idxTeams).toBeGreaterThan(idxStats)
  })

  it('matchdays-row appears inside the stats section', () => {
    const idxStats = src.indexOf('league-stats-section')
    const idxMatchdays = src.indexOf('matchdays-row')
    expect(idxMatchdays).toBeGreaterThan(idxStats)
  })
})

describe('v1.75.6 plannedRosterStats helper gains matchdays field', () => {
  const src = read('src/lib/plannedRosterStats.ts')

  it('declares matchdays on the PlannedRosterStats interface', () => {
    expect(src).toMatch(/matchdays:\s*number/)
  })

  it('fetches matchdays via prisma.gameWeek.count', () => {
    expect(src).toMatch(/prisma\.gameWeek\.count\(\s*\{\s*where:\s*\{\s*leagueId\s*\}/)
  })

  it('returns matchdays in the success object', () => {
    expect(src).toMatch(/matchdays,?\s*\}/)
  })

  it('includes gameWeek.count in the Promise.all alongside the league query', () => {
    // Verify both the league query and the gameWeek count are fetched in parallel.
    const allBlock = src.slice(src.indexOf('Promise.all'), src.indexOf('if (!league)'))
    expect(allBlock).toMatch(/gameWeek\.count/)
    expect(allBlock).toMatch(/league\.findUnique/)
  })
})

describe('v1.75.6 stash-pop regression target', () => {
  it('APP_VERSION is 1.75.6 or later', () => {
    // v1.78.0 — floor pin relaxed to accept v1.75.6+ / v1.[76-99].x / v2+.
    const v = read('src/lib/version.ts')
    expect(v).toMatch(
      /APP_VERSION\s*=\s*'(?:1\.75\.(?:[6-9]|\d{2,})|1\.(?:7[6-9]|[89]\d|\d{3,})\.\d+|[2-9]\.\d+\.\d+)'/,
    )
  })

  it('LeagueDetailsPanel does NOT contain current-players-row (stash-pop gate)', () => {
    const src = read('src/components/LeagueDetailsPanel.tsx')
    expect(src).not.toMatch(/current-players-row/)
  })

  it('LeagueDetailsPanel contains league-stats-section (stash-pop gate)', () => {
    const src = read('src/components/LeagueDetailsPanel.tsx')
    expect(src).toMatch(/league-stats-section/)
  })

  it('plannedRosterStats.ts contains matchdays in the interface (stash-pop gate)', () => {
    const src = read('src/lib/plannedRosterStats.ts')
    expect(src).toMatch(/matchdays:\s*number/)
  })
})
