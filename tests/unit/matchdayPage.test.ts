/**
 * v1.45.0 (epic match events PR ε) — per-matchday public page structural
 * pins. The page is a server component reading `getPublicLeagueData`;
 * full-render testing is heavyweight, so this file pins the load-bearing
 * shape (file presence, testid hooks, route subdomain-aware via
 * `getLeagueIdFromRequest`, MatchdayCard wiring to the new route).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { goalTypeLabel } from '@/app/matchday/[id]/page'

const ROOT = join(__dirname, '..', '..')
const PAGE_PATH = join(ROOT, 'src/app/matchday/[id]/page.tsx')
const CARD_PATH = join(ROOT, 'src/components/MatchdayCard.tsx')

describe('PR ε page — file shape', () => {
  it('the route file exists', () => {
    expect(existsSync(PAGE_PATH)).toBe(true)
  })

  const PAGE = readFileSync(PAGE_PATH, 'utf-8')

  it('uses getLeagueIdFromRequest for subdomain awareness', () => {
    expect(PAGE).toMatch(/getLeagueIdFromRequest/)
    expect(PAGE).toMatch(/getPublicLeagueData/)
  })

  it('404s when the matchday is not in the resolved league', () => {
    expect(PAGE).toMatch(/notFound/)
  })

  it('exposes the testid hooks the e2e specs key off', () => {
    expect(PAGE).toContain('data-testid="matchday-back"')
    expect(PAGE).toContain('data-testid="matchday-label"')
    expect(PAGE).toContain('data-testid="matchday-date"')
    expect(PAGE).toContain('data-testid="matchday-matches"')
    expect(PAGE).toMatch(/data-testid=\{`match-section-\$\{match\.id\}`\}/)
    expect(PAGE).toMatch(/data-testid=\{`match-score-\$\{match\.id\}`\}/)
    expect(PAGE).toMatch(/data-testid=\{`event-\$\{goal\.id\}`\}/)
  })

  it('formats the date via formatJstFriendly when present, "TBD" when null', () => {
    expect(PAGE).toMatch(/formatJstFriendly/)
    expect(PAGE).toMatch(/'TBD'/)
  })

  it('reads goalType + minute from the public Goal shape', () => {
    expect(PAGE).toMatch(/goal\.minute/)
    expect(PAGE).toMatch(/goal\.goalType/)
  })

  it('uses getPublicLeagueData NOT getLeagueStats (events-derived per PR δ)', () => {
    expect(PAGE).not.toMatch(/getLeagueStats/)
  })
})

describe('PR ε MatchdayCard wiring', () => {
  const CARD = readFileSync(CARD_PATH, 'utf-8')

  it('wires the new "View matchday" link to /matchday/<id>', () => {
    expect(CARD).toMatch(/href=\{`\/matchday\/\$\{matchday\.id\}`\}/)
    expect(CARD).toMatch(/data-testid=\{`matchday-card-view-\$\{matchday\.id\}`\}/)
  })

  it('still renders the legacy "See full schedule" link when showScheduleLink is true', () => {
    expect(CARD).toMatch(/showScheduleLink/)
    expect(CARD).toMatch(/href="\/schedule"/)
  })
})

describe('goalTypeLabel', () => {
  it('returns null for OPEN_PLAY (no decoration on the timeline)', () => {
    expect(goalTypeLabel('OPEN_PLAY')).toBeNull()
  })

  it('returns "set piece" for SET_PIECE', () => {
    expect(goalTypeLabel('SET_PIECE')).toBe('set piece')
  })

  it('returns "pen" for PENALTY', () => {
    expect(goalTypeLabel('PENALTY')).toBe('pen')
  })

  it('returns "OG" for OWN_GOAL', () => {
    expect(goalTypeLabel('OWN_GOAL')).toBe('OG')
  })

  it('returns null for null/undefined goalType (Sheets path / pre-δ data)', () => {
    expect(goalTypeLabel(null)).toBeNull()
    expect(goalTypeLabel(undefined)).toBeNull()
  })
})
