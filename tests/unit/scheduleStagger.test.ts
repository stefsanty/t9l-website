import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { defaultMatchKickoffTime, __test } from '@/lib/scheduleStagger'
import { combineJstDateAndTime } from '@/lib/jst'

/**
 * v1.21.1 — Match time picker is time-only + new-match defaults stagger.
 *
 * Pre-v1.21.1 the match-row kickoff pill was a `datetime-local` picker
 * even though the match's date is implicitly the parent matchday's date —
 * admins had to (re)pick the date on every kickoff edit. v1.21.1 swaps
 * the pill to `time` and constructs the full datetime in the component
 * by combining the picked HH:MM with the matchday's startDate.
 *
 * Pre-v1.21.1 the "Add Match" form defaulted `playedAt` to
 * `${gw.startDate}T00:00` (midnight) — admins had to fix the time on
 * every add. v1.21.1 stages by match index (19:05 / 19:40 / 20:15 — the
 * v1.20 audit's recommendation, matching the 33-minute T9L cadence).
 */

const REPO = process.cwd()
const SCHEDULE_TAB = join(REPO, 'src/components/admin/ScheduleTab.tsx')

describe('v1.21.1 — defaultMatchKickoffTime helper', () => {
  it('first match defaults to 19:05 (idx 0)', () => {
    expect(defaultMatchKickoffTime(0)).toBe('19:05')
  })

  it('second match defaults to 19:40 (idx 1, 35-min step)', () => {
    expect(defaultMatchKickoffTime(1)).toBe('19:40')
  })

  it('third match defaults to 20:15 (idx 2, 35-min step)', () => {
    expect(defaultMatchKickoffTime(2)).toBe('20:15')
  })

  it('clamps to last stagger time for matches beyond the standard 3 (idx 5 → 20:15)', () => {
    // T9L is a 4-team round-robin with 3 matches per matchday — anything
    // beyond is non-standard and the operator adjusts manually. Better
    // to clamp than to wrap or crash.
    expect(defaultMatchKickoffTime(5)).toBe('20:15')
    expect(defaultMatchKickoffTime(99)).toBe('20:15')
  })

  it('handles negative index defensively (idx -1 → 19:05)', () => {
    expect(defaultMatchKickoffTime(-1)).toBe('19:05')
  })

  it('exposes the stagger array via __test for inspection', () => {
    expect(__test.STAGGER_TIMES_JST).toEqual(['19:05', '19:40', '20:15'])
  })
})

describe('v1.21.1 — combineJstDateAndTime produces the right UTC instant', () => {
  it('19:05 JST on 2026-04-29 → 2026-04-29T10:05:00.000Z (JST = UTC+9)', () => {
    const utc = combineJstDateAndTime('2026-04-29', '19:05')
    expect(utc.toISOString()).toBe('2026-04-29T10:05:00.000Z')
  })

  it('19:40 JST on 2026-04-29 → 2026-04-29T10:40:00.000Z', () => {
    const utc = combineJstDateAndTime('2026-04-29', '19:40')
    expect(utc.toISOString()).toBe('2026-04-29T10:40:00.000Z')
  })

  it('20:15 JST on 2026-04-29 → 2026-04-29T11:15:00.000Z', () => {
    const utc = combineJstDateAndTime('2026-04-29', '20:15')
    expect(utc.toISOString()).toBe('2026-04-29T11:15:00.000Z')
  })

  it('00:30 JST on 2026-04-29 → 2026-04-28T15:30:00.000Z (crosses date boundary)', () => {
    const utc = combineJstDateAndTime('2026-04-29', '00:30')
    expect(utc.toISOString()).toBe('2026-04-28T15:30:00.000Z')
  })
})

describe('v1.21.1 — ScheduleTab match time pill structural assertions', () => {
  const text = readFileSync(SCHEDULE_TAB, 'utf8')

  it('imports the scheduleStagger helper', () => {
    expect(text).toMatch(/import\s+\{\s*defaultMatchKickoffTime\s*\}\s+from\s+['"]@\/lib\/scheduleStagger['"]/)
  })

  it('the match-row time pill uses variant="time" (not datetime-local)', () => {
    // Inside MatchCardRow the kickoff pill must be time-only.
    expect(text).toMatch(/variant="time"[\s\S]*?value=\{fmtTime\(match\.playedAt\)\}/)
  })

  it('the match-row time pill onSave combines the new HH:MM with the matchday startDate', () => {
    // The combined string is constructed inline as `${fmtDate(gwStartDate)}T${val}`
    // so updateMatch can parse it via the canonical parseJstDateTimeLocal.
    expect(text).toMatch(/playedAt:\s*`\$\{fmtDate\(gwStartDate\)\}T\$\{val\}`/)
  })

  it('MatchCardRow receives gwStartDate as a prop', () => {
    expect(text).toMatch(/gwStartDate:\s*Date/)
    expect(text).toMatch(/gwStartDate=\{gw\.startDate\}/)
  })

  it('the "Add match" empty-state button defaults playedAt to the staggered time for index 0', () => {
    expect(text).toMatch(/playedAt:\s*`\$\{fmtDate\(gw\.startDate\)\}T\$\{defaultMatchKickoffTime\(0\)\}`/)
  })

  it('the "Add match" button for non-empty matchdays staggers by current match count', () => {
    expect(text).toMatch(/playedAt:\s*`\$\{fmtDate\(gw\.startDate\)\}T\$\{defaultMatchKickoffTime\(gw\.matches\.length\)\}`/)
  })

  it('does NOT use the v1.21.0 fmtDatetime(gw.startDate) midnight default (regression target)', () => {
    // Pre-v1.21.1 both add-match handlers used `fmtDatetime(gw.startDate)`
    // which produced `YYYY-MM-DDT00:00`. Admins had to edit the time on
    // every add. Regression target: re-introducing this would lose the
    // staggered defaults.
    expect(text).not.toMatch(/playedAt:\s*fmtDatetime\(gw\.startDate\)/)
  })
})
