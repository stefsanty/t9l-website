import { describe, it, expect } from 'vitest'
import { computeMatchdayBoundsJst } from '@/components/MatchdayCountdown'
import type { Matchday, Match } from '@/types'

/**
 * v1.41.4 — regression target for "countdown timer not working for most
 * matchdays".
 *
 * Pre-v1.41.4 the countdown component derived `endDT` solely from the LAST
 * match's `fullTime`, which is empty whenever `Match.endedAt IS NULL` in DB.
 * The v1.21.0 schedule editor removed the FT picker, so admins can no longer
 * set `endedAt` from the UI; only matches imported from the legacy Sheets
 * backfill (with a `fullTime` column) had it set. As a result, newly created
 * matchdays universally lost their countdown.
 *
 * Verified against prod data 2026-05-03:
 *   MD3, MD5, MD7, MD8 — last match fullTime = "" → countdown returned null
 *   MD4, MD6 — last match fullTime set → countdown rendered ✓
 *
 * v1.41.4 falls back to `last_kickoff + 33min` (T9L match duration), then to
 * `start + 3h`, so the countdown renders for any matchday with at least the
 * first match's kickoff time.
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

describe('computeMatchdayBoundsJst (v1.41.4 regression target)', () => {
  it('returns null when matchday.date is null', () => {
    const md = mkMatchday({ date: null })
    expect(computeMatchdayBoundsJst(md)).toBeNull()
  })

  it('returns null when matches is empty', () => {
    const md = mkMatchday({ matches: [] })
    expect(computeMatchdayBoundsJst(md)).toBeNull()
  })

  it('returns null when first match has no kickoff (no signal for start)', () => {
    const md = mkMatchday({
      matches: [mkMatch({ kickoff: '', fullTime: '20:00' })],
    })
    expect(computeMatchdayBoundsJst(md)).toBeNull()
  })

  it('uses explicit fullTime when last match has it (legacy backfill data)', () => {
    const md = mkMatchday({
      matches: [
        mkMatch({ kickoff: '19:05', fullTime: '19:38' }),
        mkMatch({ kickoff: '20:15', fullTime: '20:48' }),
      ],
    })
    const bounds = computeMatchdayBoundsJst(md)
    expect(bounds).not.toBeNull()
    expect(bounds!.start.toISOString()).toBe('2026-06-01T10:05:00.000Z')
    expect(bounds!.end.toISOString()).toBe('2026-06-01T11:48:00.000Z')
  })

  it('LOAD-BEARING REGRESSION: falls back to last_kickoff + 33min when fullTime is empty (v1.41.4 fix)', () => {
    // This matches MD7 / MD8 shape on prod 2026-05-03: kickoffs set,
    // fullTimes empty. Pre-v1.41.4 this returned null and the countdown
    // rendered nothing — the user-visible bug. Post-fix it returns a
    // sensible 33-min-after-last-kickoff end time.
    const md = mkMatchday({
      matches: [
        mkMatch({ kickoff: '19:05', fullTime: '' }),
        mkMatch({ kickoff: '20:00', fullTime: '' }),
      ],
    })
    const bounds = computeMatchdayBoundsJst(md)
    expect(bounds).not.toBeNull()
    // 20:00 JST + 33min = 20:33 JST = 11:33 UTC
    expect(bounds!.end.toISOString()).toBe('2026-06-01T11:33:00.000Z')
    // Start unchanged: first kickoff 19:05 JST = 10:05 UTC
    expect(bounds!.start.toISOString()).toBe('2026-06-01T10:05:00.000Z')
  })

  it('handles single-match matchday with empty fullTime (edge case)', () => {
    const md = mkMatchday({
      matches: [mkMatch({ kickoff: '19:05', fullTime: '' })],
    })
    const bounds = computeMatchdayBoundsJst(md)
    expect(bounds).not.toBeNull()
    // last == first; end = 19:05 JST + 33min = 19:38 JST = 10:38 UTC
    expect(bounds!.end.toISOString()).toBe('2026-06-01T10:38:00.000Z')
  })

  it('falls back to start + 3h when LAST match kickoff is also missing (degenerate case)', () => {
    const md = mkMatchday({
      matches: [
        mkMatch({ kickoff: '19:05', fullTime: '' }),
        mkMatch({ kickoff: '', fullTime: '' }),
      ],
    })
    const bounds = computeMatchdayBoundsJst(md)
    expect(bounds).not.toBeNull()
    // start 19:05 JST = 10:05 UTC; +3h = 13:05 UTC
    expect(bounds!.end.toISOString()).toBe('2026-06-01T13:05:00.000Z')
  })

  it('REGRESSION: pre-v1.41.4 broken path would have returned null on missing fullTime; we now return bounds', () => {
    // This is the "would have failed pre-fix" assertion. Equivalent matchday
    // shape to prod MD3 / MD5 / MD7 / MD8.
    const md = mkMatchday({
      id: 'md7',
      label: 'MD7',
      date: '2026-07-15',
      matches: [
        mkMatch({ kickoff: '19:05', fullTime: '' }),
        mkMatch({ kickoff: '20:00', fullTime: '' }),
      ],
    })
    const bounds = computeMatchdayBoundsJst(md)
    expect(bounds).not.toBeNull()
    // The pre-fix code would have returned null here (no fullTime on last
    // match → endDT null → guard fires).
  })

  it('uses explicit fullTime even when it is BEFORE the kickoff (legacy data shape)', () => {
    // MD4 prod data 2026-05-03 has last match kickoff=20:00 fullTime=19:38
    // (broken legacy data — fullTime predates kickoff). The countdown still
    // works because endDT is parseable; the live/post-end branch logic
    // handles the math regardless of whether end < start.
    const md = mkMatchday({
      matches: [
        mkMatch({ kickoff: '19:05', fullTime: '20:13' }),
        mkMatch({ kickoff: '20:00', fullTime: '19:38' }),
      ],
    })
    const bounds = computeMatchdayBoundsJst(md)
    expect(bounds).not.toBeNull()
    expect(bounds!.end.toISOString()).toBe('2026-06-01T10:38:00.000Z')
  })
})
