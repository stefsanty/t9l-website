/**
 * v1.75.8 — Consistent column alignment in CompressedMatchdaySchedule match rows.
 *
 * Regression targets (stash-pop verification):
 * - Match row uses CSS grid (grid grid-cols-[3rem_1fr_auto_1fr]) not flex.
 * - Home team column is right-aligned (justify-end).
 * - "vs" separator is centered (text-center).
 * - Away team column is left-aligned (no justify-end).
 * - Team name text is wrapped in a truncate span inside each team cell.
 * - data-testid="match-vs" on the separator span.
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const src = fs.readFileSync(
  path.resolve(__dirname, '../../src/components/CompressedMatchdaySchedule.tsx'),
  'utf8',
)

describe('v1.75.8 — CompressedMatchdaySchedule column alignment', () => {
  it('match row uses CSS grid layout (not flex)', () => {
    expect(src).toMatch(/grid grid-cols-\[3rem_1fr_auto_1fr\]/)
  })

  it('match row grid has items-center for vertical alignment', () => {
    expect(src).toMatch(/grid grid-cols-\[3rem_1fr_auto_1fr\] items-center/)
  })

  it('home team cell is right-aligned with justify-end', () => {
    expect(src).toMatch(/justify-end/)
  })

  it('"vs" separator has text-center for column centering', () => {
    expect(src).toMatch(/text-center/)
  })

  it('"vs" separator has data-testid="match-vs"', () => {
    expect(src).toMatch(/data-testid="match-vs"/)
  })

  it('away team cell does NOT have justify-end (left-aligned by default)', () => {
    // justify-end appears exactly once — on the home cell only
    const occurrences = (src.match(/justify-end/g) ?? []).length
    expect(occurrences).toBe(1)
  })

  it('home team name is wrapped in a truncate span', () => {
    // home name: truncate span wrapping {home?.name ?? match.homeTeamId}
    const homeNameBlock = src.slice(src.indexOf('justify-end'))
    expect(homeNameBlock).toMatch(/<span className="truncate">/)
  })

  it('away team name is wrapped in a truncate span', () => {
    // away name: truncate span wrapping {away?.name ?? match.awayTeamId}
    expect(src).toMatch(/away\?\.name \?\? match\.awayTeamId/)
    const awayBlock = src.slice(src.lastIndexOf('<TeamLogo team={away'))
    expect(awayBlock).toMatch(/<span className="truncate">/)
  })

  it('match row container no longer uses the old flex gap-3 layout', () => {
    expect(src).not.toMatch(/flex items-center gap-3/)
  })

  it('kickoff span no longer carries redundant w-12 shrink-0 (grid column handles sizing)', () => {
    expect(src).not.toMatch(/w-12 shrink-0/)
  })

  it('team cells use min-w-0 to allow truncation within grid', () => {
    const minW0Count = (src.match(/min-w-0/g) ?? []).length
    expect(minW0Count).toBe(2)
  })

  it('existing props shape unchanged — still takes matchdays and teams', () => {
    expect(src).toMatch(/matchdays: Matchday\[\]/)
    expect(src).toMatch(/teams: Team\[\]/)
  })

  it('version is bumped to 1.75.8 or later', () => {
    // v1.78.0 — floor pin relaxed to accept v1.75.8+ / v1.[76-99].x / v2+.
    const version = fs.readFileSync(
      path.resolve(__dirname, '../../src/lib/version.ts'),
      'utf8',
    )
    expect(version).toMatch(
      /APP_VERSION\s*=\s*'(?:1\.75\.(?:[89]|\d{2,})|1\.(?:7[6-9]|[89]\d|\d{3,})\.\d+|[2-9]\.\d+\.\d+)'/,
    )
  })
})
