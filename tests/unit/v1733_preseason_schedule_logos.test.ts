/**
 * v1.73.3 — Team logos in CompressedMatchdaySchedule.
 *
 * Regression targets (stash-pop verification):
 * - Component renders `data-testid="team-logo-{id}"` img when team.logo is set.
 * - Component renders `data-testid="team-logo-placeholder-{id}"` when logo is null.
 * - TeamLogo is rendered inline (before team name) inside the match row.
 * - No change to existing props shape (matchdays + teams still required).
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const src = fs.readFileSync(
  path.resolve(__dirname, '../../src/components/CompressedMatchdaySchedule.tsx'),
  'utf8',
)

describe('v1.73.3 — CompressedMatchdaySchedule team logos', () => {
  it('defines a TeamLogo helper component', () => {
    expect(src).toMatch(/function TeamLogo/)
  })

  it('renders an img with team-logo-{id} testid when logo is set', () => {
    expect(src).toMatch(/data-testid=\{`team-logo-\$\{team\.id\}`\}/)
  })

  it('img uses team.logo as src', () => {
    expect(src).toMatch(/src=\{team\.logo\}/)
  })

  it('img is 16px (w-4 h-4)', () => {
    expect(src).toMatch(/className="w-4 h-4 rounded-full object-cover/)
  })

  it('renders placeholder span with team-logo-placeholder-{id} testid when logo is null', () => {
    expect(src).toMatch(/data-testid=\{`team-logo-placeholder-\$\{/)
  })

  it('placeholder is also 16px (w-4 h-4)', () => {
    // both img and placeholder should be same size
    const placeholderBlock = src.slice(src.indexOf('team-logo-placeholder'))
    expect(placeholderBlock).toMatch(/w-4 h-4/)
  })

  it('placeholder shows first initial of team name', () => {
    expect(src).toMatch(/\.slice\(0, 1\)\.toUpperCase\(\)/)
  })

  it('TeamLogo is rendered before home team name in match row', () => {
    const homeBlock = src.slice(src.indexOf('homeTeamId}'))
    // TeamLogo should appear before the team name span text
    const logoIndex = src.indexOf('<TeamLogo team={home')
    const homeNameIndex = src.indexOf('{home?.name ?? match.homeTeamId}')
    expect(logoIndex).toBeGreaterThan(-1)
    expect(homeNameIndex).toBeGreaterThan(-1)
    expect(logoIndex).toBeLessThan(homeNameIndex)
  })

  it('TeamLogo is rendered before away team name in match row', () => {
    const logoAwayIndex = src.lastIndexOf('<TeamLogo team={away')
    const awayNameIndex = src.indexOf('{away?.name ?? match.awayTeamId}')
    expect(logoAwayIndex).toBeGreaterThan(-1)
    expect(awayNameIndex).toBeGreaterThan(-1)
    expect(logoAwayIndex).toBeLessThan(awayNameIndex)
  })

  it('match row span uses flex items-center gap-1 for inline logo alignment', () => {
    expect(src).toMatch(/flex items-center gap-1 font-display font-black/)
  })

  it('props shape unchanged — still takes matchdays and teams', () => {
    expect(src).toMatch(/matchdays: Matchday\[\]/)
    expect(src).toMatch(/teams: Team\[\]/)
  })

  it('img has aria-hidden (decorative logo)', () => {
    expect(src).toMatch(/aria-hidden/)
  })
})
