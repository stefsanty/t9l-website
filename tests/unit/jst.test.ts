/**
 * Unit tests for the canonical JST helpers in `src/lib/jst.ts`.
 *
 * Covers the load-bearing v1.9.0 fix: every parser must be independent of
 * `process.env.TZ` so that an admin in any timezone produces the same UTC
 * instant from a JST clock string. The historical bug was bare
 * `new Date("2026-04-16T14:30")` in server actions, which on Vercel
 * (TZ=UTC) parsed the string as UTC clock time → 9-hour skew on every
 * scheduled match. These tests would fail on the broken state.
 */
import { describe, it, expect } from 'vitest'
import {
  formatJstDate,
  formatJstTime,
  formatJstDateTimeLocal,
  formatJstFriendly,
  formatJstShort,
  formatJstDayMonth,
  parseJstDateTimeLocal,
  parseJstDateOnly,
  combineJstDateAndTime,
  jstIsoString,
} from '@/lib/jst'

describe('formatJstDate', () => {
  it('formats UTC midnight as the same JST calendar date when JST = UTC + 9h still on that day', () => {
    // 2026-04-16T00:00:00Z → JST 09:00 on 2026-04-16 → "2026-04-16"
    expect(formatJstDate(new Date('2026-04-16T00:00:00Z'))).toBe('2026-04-16')
  })

  it('rolls over the calendar date when UTC late-evening is JST early-morning of the next day', () => {
    // 2026-04-16T15:00:00Z → JST 00:00 on 2026-04-17 → "2026-04-17"
    expect(formatJstDate(new Date('2026-04-16T15:00:00Z'))).toBe('2026-04-17')
  })

  it('accepts ISO strings (unstable_cache JSON round-trip)', () => {
    expect(formatJstDate('2026-04-16T05:30:00Z' as unknown as Date)).toBe('2026-04-16')
  })

  it('handles year boundary correctly', () => {
    // 2025-12-31T16:00:00Z = 2026-01-01T01:00 JST
    expect(formatJstDate(new Date('2025-12-31T16:00:00Z'))).toBe('2026-01-01')
  })

  it('handles leap day correctly', () => {
    expect(formatJstDate(new Date('2028-02-29T00:00:00Z'))).toBe('2028-02-29')
  })
})

describe('formatJstTime', () => {
  it('formats a JST kickoff as HH:MM 24-hour', () => {
    // 2026-04-16T05:30:00Z = 14:30 JST
    expect(formatJstTime(new Date('2026-04-16T05:30:00Z'))).toBe('14:30')
  })

  it('uses 24-hour format with no AM/PM ambiguity', () => {
    expect(formatJstTime(new Date('2026-04-16T15:00:00Z'))).toBe('00:00') // JST midnight next day
    expect(formatJstTime(new Date('2026-04-16T03:00:00Z'))).toBe('12:00') // JST noon
    expect(formatJstTime(new Date('2026-04-16T15:30:00Z'))).toBe('00:30')
  })
})

describe('formatJstDateTimeLocal', () => {
  it('combines date and time as YYYY-MM-DDTHH:mm in JST', () => {
    expect(formatJstDateTimeLocal(new Date('2026-04-16T05:30:00Z'))).toBe('2026-04-16T14:30')
  })

  it('rolls over the date when JST late-night flips the calendar', () => {
    // UTC 15:30 on 2026-04-16 → JST 00:30 on 2026-04-17
    expect(formatJstDateTimeLocal(new Date('2026-04-16T15:30:00Z'))).toBe('2026-04-17T00:30')
  })
})

describe('parseJstDateTimeLocal — TZ-independence (the v1.9.0 load-bearing fix)', () => {
  it('"2026-04-16T14:30" parses to UTC 05:30 on 2026-04-16 (JST 14:30 - 9h)', () => {
    const d = parseJstDateTimeLocal('2026-04-16T14:30')
    // Hand-computed UTC ms: Date.UTC(2026, 3, 16, 5, 30) = 1776663000000
    expect(d.getTime()).toBe(Date.UTC(2026, 3, 16, 5, 30))
  })

  it('parses regardless of the host process timezone (regression target for the V8/Vercel TZ=UTC bug)', () => {
    // The v1.8.x bug used `new Date("2026-04-16T14:30")`, which V8 parses as
    // host-local. Under TZ=UTC that's UTC 14:30 (= JST 23:30) — wrong by 9h.
    // parseJstDateTimeLocal uses `Date.UTC(...)` arithmetic, so it produces
    // the same UTC ms whether the host is UTC, JST, NYC, or Mars.
    const expected = Date.UTC(2026, 3, 16, 5, 30)
    // The test asserts the explicit UTC ms; if the parser regressed back to
    // `new Date(str)`, the result would shift with `process.env.TZ` and this
    // assertion would fail under any non-UTC host or pass coincidentally
    // under UTC — either way the strict equality below is the contract.
    expect(parseJstDateTimeLocal('2026-04-16T14:30').getTime()).toBe(expected)
  })

  it('round-trips through formatJstDateTimeLocal', () => {
    const start = '2026-04-16T14:30'
    const parsed = parseJstDateTimeLocal(start)
    expect(formatJstDateTimeLocal(parsed)).toBe(start)
  })

  it('round-trips a date that crosses the calendar boundary', () => {
    // JST 00:30 on 2026-04-17 = UTC 15:30 on 2026-04-16
    const start = '2026-04-17T00:30'
    const parsed = parseJstDateTimeLocal(start)
    expect(parsed.getTime()).toBe(Date.UTC(2026, 3, 16, 15, 30))
    expect(formatJstDateTimeLocal(parsed)).toBe(start)
  })

  it('accepts trailing seconds (datetime-local with step support)', () => {
    expect(parseJstDateTimeLocal('2026-04-16T14:30:45').getTime()).toBe(
      Date.UTC(2026, 3, 16, 5, 30, 45),
    )
  })

  it('throws on empty input', () => {
    expect(() => parseJstDateTimeLocal('')).toThrow(/empty/)
  })

  it('throws on malformed input', () => {
    expect(() => parseJstDateTimeLocal('2026-04-16')).toThrow(/invalid format/)
    expect(() => parseJstDateTimeLocal('garbage')).toThrow(/invalid format/)
    expect(() => parseJstDateTimeLocal('04/16/2026 14:30')).toThrow(/invalid format/)
  })
})

describe('parseJstDateOnly', () => {
  it('parses YYYY-MM-DD as UTC midnight (date-only convention)', () => {
    expect(parseJstDateOnly('2026-04-16').getTime()).toBe(Date.UTC(2026, 3, 16))
  })

  it('round-trips through formatJstDate (UTC midnight is JST 09:00 same calendar day)', () => {
    const start = '2026-04-16'
    expect(formatJstDate(parseJstDateOnly(start))).toBe(start)
  })

  it('throws on malformed input', () => {
    expect(() => parseJstDateOnly('')).toThrow(/empty/)
    expect(() => parseJstDateOnly('2026-4-16')).toThrow(/invalid format/)
    expect(() => parseJstDateOnly('garbage')).toThrow(/invalid format/)
  })
})

describe('14:30 JST end-to-end roundtrip — the regression test the bug class needs', () => {
  it('admin types "2026-04-16T14:30" → server parses → DB stores → display reads back as "14:30 JST"', () => {
    // Simulate the full v1.9.0 path:
    //   1. Admin form submits the JST clock string.
    //   2. Server action calls parseJstDateTimeLocal to get a UTC Date.
    //   3. Prisma stores the UTC instant in TIMESTAMPTZ.
    //   4. Public dashboard reads the UTC instant and renders via formatJstTime.
    //   5. Admin re-opens the editor and sees the value via formatJstDateTimeLocal.
    const adminInput = '2026-04-16T14:30'
    const parsedForDb = parseJstDateTimeLocal(adminInput)

    // Public dashboard kickoff display:
    expect(formatJstTime(parsedForDb)).toBe('14:30')
    // Public dashboard date display:
    expect(formatJstDate(parsedForDb)).toBe('2026-04-16')
    // Admin form re-render:
    expect(formatJstDateTimeLocal(parsedForDb)).toBe(adminInput)
  })

  it('regression: a buggy parser using `new Date(str)` would produce 23:30 JST on a TZ=UTC host, not 14:30', () => {
    // This is the failure that v1.8.x would have shown: bare `new Date(str)`
    // on Vercel (TZ=UTC) parses "2026-04-16T14:30" as UTC clock time, so the
    // stored Date is at 14:30 UTC = 23:30 JST. Sanity-check that our helper
    // does NOT do that.
    const adminInput = '2026-04-16T14:30'
    const parsedCorrectly = parseJstDateTimeLocal(adminInput)

    // The buggy parse would have given us 14:30 UTC = "23:30" JST display.
    // The correct parse gives us 05:30 UTC = "14:30" JST display.
    expect(formatJstTime(parsedCorrectly)).toBe('14:30')
    expect(formatJstTime(parsedCorrectly)).not.toBe('23:30')

    // Stronger statement: the stored UTC ms differs from the buggy path.
    const buggyMs = Date.UTC(2026, 3, 16, 14, 30) // what new Date(str) would have stored
    const correctMs = parsedCorrectly.getTime()
    expect(correctMs).not.toBe(buggyMs)
    expect(correctMs).toBe(Date.UTC(2026, 3, 16, 5, 30))
  })
})

describe('formatJstFriendly', () => {
  it('renders en-US weekday short form in JST', () => {
    // 2026-04-16T05:30:00Z = JST Thu 14:30 on 2026-04-16
    expect(formatJstFriendly(new Date('2026-04-16T05:30:00Z'), 'en')).toBe('Apr 16 (Thu)')
  })

  it('renders ja-JP form in JST', () => {
    expect(formatJstFriendly(new Date('2026-04-16T05:30:00Z'), 'ja')).toBe('4月16日（木）')
  })

  it('defaults to en when locale omitted', () => {
    expect(formatJstFriendly(new Date('2026-04-16T05:30:00Z'))).toBe('Apr 16 (Thu)')
  })
})

describe('formatJstShort and formatJstDayMonth', () => {
  it('formatJstShort produces "Thu 16 Apr"-style', () => {
    expect(formatJstShort(new Date('2026-04-16T05:30:00Z'))).toMatch(/Thu(rs)?\s*16 Apr/)
  })

  it('formatJstDayMonth produces "16 Apr" without weekday', () => {
    expect(formatJstDayMonth(new Date('2026-04-16T05:30:00Z'))).toBe('16 Apr')
  })
})

describe('combineJstDateAndTime', () => {
  it('combines date + time as JST clock', () => {
    const d = combineJstDateAndTime('2026-04-16', '14:30')
    expect(d.getTime()).toBe(Date.UTC(2026, 3, 16, 5, 30))
    expect(formatJstDateTimeLocal(d)).toBe('2026-04-16T14:30')
  })

  it('throws when either input is empty', () => {
    expect(() => combineJstDateAndTime('', '14:30')).toThrow()
    expect(() => combineJstDateAndTime('2026-04-16', '')).toThrow()
  })
})

describe('jstIsoString', () => {
  it('builds a +09:00 ISO-8601 string for direct new Date() consumption', () => {
    expect(jstIsoString('2026-04-16', '14:30')).toBe('2026-04-16T14:30:00+09:00')
    // This format IS timezone-aware so `new Date(...)` parses it correctly
    // regardless of host TZ.
    expect(new Date(jstIsoString('2026-04-16', '14:30')).getTime()).toBe(
      Date.UTC(2026, 3, 16, 5, 30),
    )
  })
})
