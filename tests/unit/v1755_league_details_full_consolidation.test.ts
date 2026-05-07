/**
 * v1.75.5 — Full consolidation: admin SettingsTab merges fee + planned
 * roster + league rules into a single LeagueDetailsEditor; public
 * LeagueDetailsPanel surfaces the fee + planned teams + per-team +
 * spots-left mini-section regardless of recruiting flag.
 *
 * Structural pins:
 *   1. SettingsTab no longer mounts standalone LeagueFeesEditor /
 *      LeaguePlannedRosterEditor — the fields thread through the
 *      unified LeagueDetailsEditor.
 *   2. LeagueDetailsEditor accepts the absorbed prop set + calls all
 *      three server actions in handleSave.
 *   3. LeagueDetailsPanel renders the stats mini-section (fee +
 *      teams + per-team + current/spots) per the v1.75.5 spec, with
 *      per-row hides on unset/zero values. current/spots-left rows
 *      are gated on BOTH planned targets being non-zero.
 *   4. The userId + flags.recruiting threading gate is gone — the
 *      panel renders unconditionally when plannedRosterStats is
 *      available.
 *   5. APP_VERSION bumped to 1.75.5.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('v1.75.5 SettingsTab consolidates three sections into LeagueDetailsEditor', () => {
  const tab = read('src/components/admin/SettingsTab.tsx')

  it('does NOT import LeagueFeesEditor (regression target — re-adding splits the section)', () => {
    expect(tab).not.toMatch(/import\s+LeagueFeesEditor/)
  })

  it('does NOT import LeaguePlannedRosterEditor (regression target)', () => {
    expect(tab).not.toMatch(/import\s+LeaguePlannedRosterEditor/)
  })

  it('does NOT mount <LeagueFeesEditor> as a standalone section', () => {
    expect(tab).not.toMatch(/<LeagueFeesEditor/)
  })

  it('does NOT mount <LeaguePlannedRosterEditor> as a standalone section', () => {
    expect(tab).not.toMatch(/<LeaguePlannedRosterEditor/)
  })

  it('mounts LeagueDetailsEditor with the unified prop set (details + fee + roster)', () => {
    expect(tab).toMatch(/<LeagueDetailsEditor/)
    // Details (existing v1.75.0)
    expect(tab).toMatch(/initialBallType=\{league\.ballType\}/)
    expect(tab).toMatch(/initialOrganizerMessage=\{league\.organizerMessage\}/)
    // Fee (absorbed in v1.75.5)
    expect(tab).toMatch(/initialDefaultFee=\{league\.defaultFee\}/)
    expect(tab).toMatch(/initialPositionFees=\{league\.positionFees\}/)
    // Planned roster (absorbed in v1.75.5)
    expect(tab).toMatch(/initialPlannedPlayersPerTeam=\{league\.plannedPlayersPerTeam\}/)
    expect(tab).toMatch(/initialPlannedNumberOfTeams=\{league\.plannedNumberOfTeams\}/)
    expect(tab).toMatch(/initialRegistrationDeadline=\{league\.registrationDeadline\}/)
  })
})

describe('v1.75.5 LeagueDetailsEditor unified form', () => {
  const src = read('src/components/admin/LeagueDetailsEditor.tsx')

  it('imports all three server actions', () => {
    expect(src).toMatch(/updateLeagueDetails/)
    expect(src).toMatch(/updateLeagueFeeSettings/)
    expect(src).toMatch(/updateLeaguePlannedRoster/)
  })

  it('declares the absorbed props on the Props interface', () => {
    expect(src).toMatch(/initialDefaultFee:\s*number/)
    expect(src).toMatch(/initialPositionFees:\s*ReadonlyArray</)
    expect(src).toMatch(/initialPlannedPlayersPerTeam:\s*number/)
    expect(src).toMatch(/initialPlannedNumberOfTeams:\s*number/)
    expect(src).toMatch(/initialRegistrationDeadline:\s*Date\s*\|\s*null/)
  })

  it('handleSave dispatches all three server actions in parallel via Promise.all', () => {
    // Pin the parallel-dispatch shape: regression would be calling them
    // sequentially or omitting one.
    expect(src).toMatch(/Promise\.all\(\[[\s\S]*updateLeagueDetails\([\s\S]*updateLeagueFeeSettings\([\s\S]*updateLeaguePlannedRoster\(/)
  })

  it('preserves all 14 testid surfaces (player format, fees, planned roster, rules, organizer)', () => {
    // 1-2 player format / match duration
    expect(src).toMatch(/data-testid="league-details-player-format"/)
    expect(src).toMatch(/data-testid="league-details-match-duration"/)
    // 3-4 ball / goal — ball-type testids built via template literal.
    expect(src).toMatch(/data-testid=\{`league-details-ball-type-/)
    expect(src).toMatch(/data-testid="league-details-goal-size"/)
    // 5 fee
    expect(src).toMatch(/data-testid="league-fees-editor"/)
    expect(src).toMatch(/data-testid="default-fee-input"/)
    expect(src).toMatch(/data-testid="fee-add-row"/)
    // 6-8 planned roster
    expect(src).toMatch(/data-testid="league-planned-roster-editor"/)
    expect(src).toMatch(/data-testid="planned-number-of-teams-input"/)
    expect(src).toMatch(/data-testid="planned-players-per-team-input"/)
    expect(src).toMatch(/data-testid="registration-deadline-input"/)
    // 9 offside / 10 throw-in / 12 subs / 13 show / 14 organizer
    expect(src).toMatch(/data-testid="league-details-offside-toggle"/)
    // throw-in testid is built via template literal so match the prefix.
    expect(src).toMatch(/data-testid=\{`league-details-throw-in-/)
    expect(src).toMatch(/data-testid="league-details-unlimited-subs-toggle"/)
    expect(src).toMatch(/data-testid="league-details-show-toggle"/)
    expect(src).toMatch(/data-testid="league-details-organizer-message"/)
    // Single save button
    expect(src).toMatch(/data-testid="league-details-save"/)
  })

  it('field render order: player format → ball → fee → planned roster → offside → organizer', () => {
    // Regression target: re-shuffling would break the user-spec interleaving.
    const idxFormat = src.indexOf('league-details-player-format')
    const idxBall = src.indexOf('league-details-ball-type-')
    const idxFee = src.indexOf('league-fees-editor')
    const idxRoster = src.indexOf('league-planned-roster-editor')
    const idxOffside = src.indexOf('league-details-offside-toggle')
    const idxOrganizer = src.indexOf('league-details-organizer-message')
    expect(idxFormat).toBeGreaterThan(0)
    expect(idxBall).toBeGreaterThan(idxFormat)
    expect(idxFee).toBeGreaterThan(idxBall)
    expect(idxRoster).toBeGreaterThan(idxFee)
    expect(idxOffside).toBeGreaterThan(idxRoster)
    expect(idxOrganizer).toBeGreaterThan(idxOffside)
  })

  it('section header reads "League details"', () => {
    expect(src).toMatch(/<h2[^>]*>League details<\/h2>/)
  })
})

describe('v1.75.5 LeagueDetailsPanel stats mini-section', () => {
  const src = read('src/components/LeagueDetailsPanel.tsx')

  it('renders the player-fee row when fee is configured', () => {
    expect(src).toMatch(/showFee &&[\s\S]*player-fee-row/)
  })

  it('player-fee row uses formatJpyFee for currency formatting', () => {
    expect(src).toMatch(/formatJpyFee\(plannedRosterStats\.defaultFee\)/)
  })

  it('per-position fee rows render after the default fee', () => {
    // Pattern: `(GK – ¥5,000)` per the v1.67.1 shape
    expect(src).toMatch(/data-testid="player-fee-position-rows"/)
    expect(src).toMatch(/\{p\.position\} – \{formatJpyFee\(p\.fee\)\}/)
  })

  it('renders planned-teams and planned-per-team rows when set', () => {
    expect(src).toMatch(/showPlannedTeams &&[\s\S]*planned-teams-row/)
    expect(src).toMatch(/showPlannedPerTeam &&[\s\S]*planned-per-team-row/)
  })

  it('current-players and spots-left rows are gated on BOTH planned targets being non-zero', () => {
    // v1.75.5 — gate added so non-recruiting leagues with no planned
    // targets don't surface "Spots left: 0" ghost rows.
    expect(src).toMatch(/const showCurrentAndSpots\s*=\s*showPlannedTeams && showPlannedPerTeam/)
    expect(src).toMatch(/showCurrentAndSpots && \(/)
    expect(src).toMatch(/data-testid="current-players-row"/)
    expect(src).toMatch(/data-testid="spots-left-row"/)
  })

  it('spots-left value reads from plannedRosterStats.spotsLeft (helper-side computation)', () => {
    // The helper computes spotsLeft as max(0, plannedTotal - currentPlayers)
    // where currentPlayers counts every active PLM regardless of
    // applicationStatus (PENDING + APPROVED). Pin the wiring.
    expect(src).toMatch(/plannedRosterStats\.spotsLeft/)
  })
})

describe('v1.75.5 plannedRosterStats helper counts PENDING + APPROVED PLMs', () => {
  const src = read('src/lib/plannedRosterStats.ts')

  it('counts memberships without filtering on applicationStatus', () => {
    // Regression target: adding `applicationStatus: 'APPROVED'` to the
    // where clause would silently break the spec — the user wants
    // remaining application spots = planned − (PENDING + APPROVED).
    expect(src).not.toMatch(/applicationStatus:\s*['"]APPROVED['"]/)
  })

  it('counts via PlayerLeagueMembership.count keyed on leagueId, toGameWeek=null', () => {
    expect(src).toMatch(/playerLeagueMembership\.count/)
    expect(src).toMatch(/toGameWeek:\s*null/)
  })

  it('spotsLeft floored at zero', () => {
    expect(src).toMatch(/Math\.max\(0,\s*plannedTotal\s*-\s*currentPlayers\)/)
  })
})

describe('v1.75.5 page-level threading: plannedRosterStats unconditional', () => {
  const sources = [
    'src/app/page.tsx',
    'src/app/id/[slug]/page.tsx',
    'src/app/id/[slug]/md/[id]/page.tsx',
  ]

  it.each(sources)('%s passes _plannedRosterStats directly without recruiting/userId gate', (rel) => {
    const src = read(rel)
    // Regression target: the old `userId && flags.recruiting ? _plannedRosterStats : null`
    // gate is gone.
    expect(src).not.toMatch(/userId\s*&&\s*flags\.recruiting\s*\?\s*_plannedRosterStats/)
    // The relaxed assignment threads through unconditionally.
    expect(src).toMatch(/plannedRosterStats\s*=\s*_plannedRosterStats/)
  })

  it.each(sources)('%s no longer pulls getServerSession into the public Promise.all', (rel) => {
    // The session was only consumed by the now-removed gate. Removing
    // it saves a Prisma round-trip on every public render. Regression
    // target — re-introducing it would re-hit the JWT/Prisma callback
    // path on every public page load.
    expect(read(rel)).not.toMatch(/getServerSession\(authOptions\)/)
  })
})

describe('v1.75.5 stash-pop regression target', () => {
  it('APP_VERSION is 1.75.5 or later', () => {
    const v = read('src/lib/version.ts')
    expect(v).toMatch(/APP_VERSION\s*=\s*'1\.75\.[5-9]'/)
  })
})
