import { describe, it, expect } from 'vitest'
import {
  computeLeagueStartCountdown,
  firstMatchdayStartInstant,
  formatLeagueStartCopy,
} from '@/components/LeagueStartCountdown'
import type { Matchday, Match } from '@/types'

/**
 * v1.83.1 — Regression target for the preseason "League starts in X days"
 * banner. Pre-v1.83.1 there was no such banner; the league hub at
 * `/id/<slug>` showed `LeagueDetailsPanel` straight after the recruiting
 * banner with no visual signal of when the first matchday actually starts.
 *
 * The countdown logic is a pure function of `(firstMatchdayStart, now)` so
 * the unit tests pin behavior without touching `useEffect` / `setInterval`.
 *
 * Time-unit thresholds (per scope):
 *   diff < 1 hour   → "League starts in X minutes"  (X = ceil(diff/60s_60s))
 *   diff < 24 hours → "League starts in X hours"    (X = ceil(diff/3600s))
 *   diff ≥ 24 hours → "League starts in X days"     (X = ceil(diff/86400s))
 *   diff ≤ 0        → null  (component hides itself once first kickoff has passed)
 */

function mkMatch(overrides: Partial<Match> = {}): Match {
  return {
    id: 'm1',
    matchNumber: 1,
    kickoff: '19:05',
    fullTime: '',
    homeTeamId: 't-a',
    awayTeamId: 't-b',
    homeGoals: null,
    awayGoals: null,
    ...overrides,
  }
}

function mkMatchday(overrides: Partial<Matchday> = {}): Matchday {
  return {
    id: 'md1',
    label: 'MD1',
    date: '2026-06-01',
    matches: [mkMatch()],
    sittingOutTeamId: 't-d',
    ...overrides,
  }
}

describe('firstMatchdayStartInstant — start-instant resolution', () => {
  it('returns null when matchday.date is null (matchday is TBD)', () => {
    const md = mkMatchday({ date: null })
    expect(firstMatchdayStartInstant(md)).toBeNull()
  })

  it('returns null when matches is empty', () => {
    const md = mkMatchday({ matches: [] })
    expect(firstMatchdayStartInstant(md)).toBeNull()
  })

  it('returns null when first match kickoff is empty (no time signal)', () => {
    const md = mkMatchday({ matches: [mkMatch({ kickoff: '' })] })
    expect(firstMatchdayStartInstant(md)).toBeNull()
  })

  it('parses date + kickoff as JST → UTC instant', () => {
    // 2026-06-01 19:05 JST == 2026-06-01 10:05 UTC
    const md = mkMatchday({ date: '2026-06-01', matches: [mkMatch({ kickoff: '19:05' })] })
    const start = firstMatchdayStartInstant(md)
    expect(start).not.toBeNull()
    expect(start!.toISOString()).toBe('2026-06-01T10:05:00.000Z')
  })

  it('uses the first match (matches[0]) — not nth — as the league-start anchor', () => {
    const md = mkMatchday({
      date: '2026-06-01',
      matches: [
        mkMatch({ kickoff: '19:05' }),
        mkMatch({ kickoff: '20:00' }),
        mkMatch({ kickoff: '20:55' }),
      ],
    })
    const start = firstMatchdayStartInstant(md)
    expect(start!.toISOString()).toBe('2026-06-01T10:05:00.000Z')
  })
})

describe('computeLeagueStartCountdown — unit selection + ceil rounding', () => {
  const start = new Date('2026-06-01T10:05:00.000Z') // 19:05 JST

  it('returns null when start has already passed', () => {
    // REGRESSION TARGET: matchday-1 kickoff is in the past — banner must hide
    // entirely so it doesn't compete with `<MatchdayCountdown>` "Live" pill.
    expect(
      computeLeagueStartCountdown(start, new Date('2026-06-01T10:05:00.001Z')),
    ).toBeNull()
    expect(
      computeLeagueStartCountdown(start, new Date('2026-06-02T00:00:00.000Z')),
    ).toBeNull()
    // Matchday in the past by a week — still null.
    expect(
      computeLeagueStartCountdown(start, new Date('2026-06-08T10:05:00.000Z')),
    ).toBeNull()
  })

  it('returns null at the exact start instant (diff = 0)', () => {
    expect(computeLeagueStartCountdown(start, start)).toBeNull()
  })

  it('returns days when diff ≥ 24h and uses Math.ceil', () => {
    // Exactly 7 days out → "7 days"
    expect(
      computeLeagueStartCountdown(start, new Date('2026-05-25T10:05:00.000Z')),
    ).toEqual({ unit: 'days', value: 7 })
    // 6 days, 1 hour → ceil(6.04) = 7 days (per scope spec)
    expect(
      computeLeagueStartCountdown(start, new Date('2026-05-26T09:05:00.000Z')),
    ).toEqual({ unit: 'days', value: 7 })
    // Exactly 24h → 1 day
    expect(
      computeLeagueStartCountdown(start, new Date('2026-05-31T10:05:00.000Z')),
    ).toEqual({ unit: 'days', value: 1 })
  })

  it('returns hours when diff < 24h and uses Math.ceil', () => {
    // 23h 59m → ceil = 24h. "League starts in 24 hours" — copy choice.
    expect(
      computeLeagueStartCountdown(start, new Date('2026-05-31T10:06:00.000Z')),
    ).toEqual({ unit: 'hours', value: 24 })
    // Exactly 1h → 1 hour
    expect(
      computeLeagueStartCountdown(start, new Date('2026-06-01T09:05:00.000Z')),
    ).toEqual({ unit: 'hours', value: 1 })
    // 1h 1s → ceil = 2 hours
    expect(
      computeLeagueStartCountdown(start, new Date('2026-06-01T09:04:59.000Z')),
    ).toEqual({ unit: 'hours', value: 2 })
  })

  it('returns minutes when diff < 1h and uses Math.ceil', () => {
    // 30 min → 30 minutes
    expect(
      computeLeagueStartCountdown(start, new Date('2026-06-01T09:35:00.000Z')),
    ).toEqual({ unit: 'minutes', value: 30 })
    // 30 sec → ceil = 1 minute (Math.max guards floor-to-zero edge case)
    expect(
      computeLeagueStartCountdown(start, new Date('2026-06-01T10:04:30.000Z')),
    ).toEqual({ unit: 'minutes', value: 1 })
  })
})

describe('formatLeagueStartCopy — copy + plural handling', () => {
  it('renders "League starts in X days" for plural day count', () => {
    expect(formatLeagueStartCopy({ unit: 'days', value: 7 })).toBe(
      'League starts in 7 days',
    )
    expect(formatLeagueStartCopy({ unit: 'days', value: 14 })).toBe(
      'League starts in 14 days',
    )
  })

  it('renders "League starts in 1 day" (singular) when 1 day remaining', () => {
    expect(formatLeagueStartCopy({ unit: 'days', value: 1 })).toBe(
      'League starts in 1 day',
    )
  })

  it('renders "League starts in X hours" / "1 hour"', () => {
    expect(formatLeagueStartCopy({ unit: 'hours', value: 5 })).toBe(
      'League starts in 5 hours',
    )
    expect(formatLeagueStartCopy({ unit: 'hours', value: 1 })).toBe(
      'League starts in 1 hour',
    )
  })

  it('renders "League starts in X minutes" / "1 minute"', () => {
    expect(formatLeagueStartCopy({ unit: 'minutes', value: 30 })).toBe(
      'League starts in 30 minutes',
    )
    expect(formatLeagueStartCopy({ unit: 'minutes', value: 1 })).toBe(
      'League starts in 1 minute',
    )
  })
})

describe('end-to-end shape — TBD + past-start regression targets', () => {
  it('TBD case: matchday with no date → no countdown bounds', () => {
    const md = mkMatchday({ date: null, matches: [mkMatch({ kickoff: '19:05' })] })
    expect(firstMatchdayStartInstant(md)).toBeNull()
  })

  it('TBD case: matchday with date but empty kickoff → no countdown bounds', () => {
    const md = mkMatchday({
      date: '2026-06-01',
      matches: [mkMatch({ kickoff: '' })],
    })
    expect(firstMatchdayStartInstant(md)).toBeNull()
  })

  it('past-start case: full pipeline returns null when "now" is post-kickoff', () => {
    // Wires firstMatchdayStartInstant → computeLeagueStartCountdown to verify
    // the banner-hides-after-kickoff behavior (the user-visible regression
    // target — "When the start time has passed: hide the component").
    const md = mkMatchday({
      date: '2026-06-01',
      matches: [mkMatch({ kickoff: '19:05' })],
    })
    const start = firstMatchdayStartInstant(md)
    expect(start).not.toBeNull()
    // 1 minute after kickoff
    const now = new Date(start!.getTime() + 60 * 1000)
    expect(computeLeagueStartCountdown(start!, now)).toBeNull()
  })
})
