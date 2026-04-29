/**
 * Canonical JST (Asia/Tokyo, UTC+9, no DST) date/time helpers.
 *
 * Why this file exists
 * --------------------
 * The T9L public site is a Tokyo-based football league. Every match kickoff,
 * matchday date, and RSVP deadline that's displayed to a player is a JST clock
 * time. Internally the database stores `DateTime` columns as UTC instants
 * (Postgres TIMESTAMPTZ). The bridge between "UTC instant in DB" and "JST
 * clock time on screen" is the only thing this file does.
 *
 * The V8 / Vercel TZ=UTC trap
 * ---------------------------
 * On Vercel, the Node.js process runs with `process.env.TZ` defaulting to UTC.
 * That makes `new Date("2026-04-16T14:30")` parse the string as UTC clock time
 * (per the ECMAScript spec for ISO-without-Z forms, V8 uses the host TZ; on
 * Vercel that's UTC). So an admin in JST who types "14:30" into an admin form
 * has their submission interpreted as 14:30 UTC = 23:30 JST — a 9-hour skew.
 *
 * Browser `<input type="datetime-local">` is the same trap from the other end:
 * the input value is the user's *local* clock time as a tz-naive string, so
 * the server cannot infer the user's timezone from the wire format alone.
 *
 * Convention enforced by this file
 * --------------------------------
 * 1. Every `<input type="datetime-local">` value (rendered + parsed) represents
 *    JST clock time, regardless of the browser's local TZ. Use
 *    `formatJstDateTimeLocal(date)` to populate the input and
 *    `parseJstDateTimeLocal(string)` on the server to interpret submissions.
 * 2. Every `<input type="date">` value is a JST calendar date stored as UTC
 *    midnight (`Date.UTC(y, m, d)`) — the date-only convention used elsewhere
 *    in the codebase (cf. `lib/data.ts#normalizeDate`).
 * 3. Every display string of a date/time goes through one of the `formatJst*`
 *    helpers — never through bare `toLocaleString` / `toLocaleDateString` /
 *    `toLocaleTimeString` without an explicit `timeZone: 'Asia/Tokyo'`.
 *
 * If you find yourself writing `new Date(someUserSubmittedString)` in a server
 * action, `getHours()` / `getMinutes()` for display, or
 * `toISOString().slice(0, 16)` to populate an admin input — STOP. Use this
 * file. See CLAUDE.md "Time handling" section for the operator runbook.
 */

const JST_OFFSET_MINUTES = 9 * 60

/**
 * Coerce input to a Date instance. `unstable_cache` round-trips Date through
 * JSON and returns ISO strings, so most callers receive `Date | string`.
 */
function toDate(d: Date | string | number): Date {
  if (d instanceof Date) return d
  return new Date(d)
}

/**
 * Format a UTC instant as a JST calendar date string (YYYY-MM-DD).
 * Suitable for `<input type="date">` values and for any UI that needs the
 * date a JST viewer sees regardless of host TZ.
 */
export function formatJstDate(d: Date | string | number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Tokyo',
  }).formatToParts(toDate(d))
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/**
 * Format a UTC instant as a JST clock time string (HH:MM, 24h). Suitable
 * for `<input type="time">` values and for displaying kickoff/full-time.
 */
export function formatJstTime(d: Date | string | number): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Tokyo',
  }).format(toDate(d))
}

/**
 * Format a UTC instant as a JST datetime-local input value (YYYY-MM-DDTHH:mm).
 * MUST be used to populate `<input type="datetime-local">` values so the
 * widget displays JST clock time regardless of the browser's local TZ.
 *
 * Inverse: `parseJstDateTimeLocal`.
 */
export function formatJstDateTimeLocal(d: Date | string | number): string {
  return `${formatJstDate(d)}T${formatJstTime(d)}`
}

/**
 * Friendly display of a JST calendar date — "Apr 16 (Thu)" or "4月16日（木）"
 * depending on locale. Replaces `formatMatchDate` from MatchdayCard.
 */
export function formatJstFriendly(
  d: Date | string | number,
  locale: 'en' | 'ja' = 'en',
): string {
  const date = toDate(d)
  if (locale === 'ja') {
    const parts = new Intl.DateTimeFormat('ja-JP', {
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      timeZone: 'Asia/Tokyo',
    }).formatToParts(date)
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)?.value ?? ''
    return `${get('month')}月${get('day')}日（${get('weekday')}）`
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Tokyo',
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? ''
  return `${get('month')} ${get('day')} (${get('weekday')})`
}

/**
 * Compact admin-dashboard date — "Sat 16 Apr" — always in JST.
 */
export function formatJstShort(d: Date | string | number): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(toDate(d))
}

/**
 * Compact admin-dashboard date with no weekday — "16 Apr".
 */
export function formatJstDayMonth(d: Date | string | number): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(toDate(d))
}

/**
 * Parse a tz-naive datetime-local string ("YYYY-MM-DDTHH:mm" or with seconds)
 * as JST clock time and return the corresponding UTC `Date`. Strict regex
 * parse + `Date.UTC` arithmetic, so the result is independent of the host
 * `process.env.TZ`. This is the load-bearing piece of the V8/Vercel trap fix.
 *
 * Examples:
 *   parseJstDateTimeLocal("2026-04-16T14:30") → 2026-04-16T05:30:00.000Z
 *
 * Invalid inputs throw — server actions should validate before calling.
 */
export function parseJstDateTimeLocal(s: string): Date {
  if (!s) throw new Error('parseJstDateTimeLocal: empty input')
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s)
  if (!m) throw new Error(`parseJstDateTimeLocal: invalid format '${s}'`)
  const [, y, mo, d, h, mi, se] = m
  const utcMs = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(se ?? 0),
  )
  // The string was JST clock time; subtract the JST offset to get the UTC
  // instant. `Date.UTC` does not interpret a timezone — it assumes the
  // arguments are UTC clock parts. So shifting by -9h aligns "JST 14:30" with
  // the UTC 05:30 instant the database actually stores.
  return new Date(utcMs - JST_OFFSET_MINUTES * 60 * 1000)
}

/**
 * Parse a date-only string ("YYYY-MM-DD") as JST midnight stored as UTC.
 * The codebase convention for date-only fields (matchday `startDate`,
 * league `startDate`/`endDate`) is UTC midnight that aligns with JST
 * morning of the same calendar date. Identical instant to
 * `parseJstDateTimeLocal("YYYY-MM-DDT00:00")` minus the offset baked in.
 *
 * Wait — actually the codebase convention for date-only fields predates this
 * file: `new Date("YYYY-MM-DD")` parses to UTC midnight directly. Calendar
 * date "2026-04-16" → UTC 2026-04-16 00:00:00 = JST 2026-04-16 09:00.
 * Display via `formatJstDate` round-trips correctly because UTC 00:00 is JST
 * 09:00 — the same calendar date in both zones. So this helper is a cheap
 * alias that documents the convention; we don't subtract the JST offset for
 * date-only values because doing so would shift the calendar date by one.
 */
export function parseJstDateOnly(s: string): Date {
  if (!s) throw new Error('parseJstDateOnly: empty input')
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) throw new Error(`parseJstDateOnly: invalid format '${s}'`)
  const [, y, mo, d] = m
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)))
}

/**
 * Build a UTC `Date` from a JST date string ("YYYY-MM-DD") and a JST time
 * string ("HH:MM"). Used by the admin schedule editor when the operator
 * sets full-time via `<input type="time">` against a known matchday date.
 */
export function combineJstDateAndTime(dateStr: string, timeStr: string): Date {
  if (!dateStr || !timeStr) {
    throw new Error('combineJstDateAndTime: dateStr and timeStr both required')
  }
  return parseJstDateTimeLocal(`${dateStr}T${timeStr}`)
}

/**
 * Hardcoded JST ISO-8601 string for use with `new Date(...)` parsing —
 * `2026-04-16T14:30:00+09:00`. Used by the public-facing countdown timer.
 * Accepts the same JST date + time strings the schedule editor produces.
 */
export function jstIsoString(dateStr: string, timeStr: string): string {
  return `${dateStr}T${timeStr}:00+09:00`
}

/**
 * Test seam: the JST UTC offset in minutes. Exported only for the unit
 * suite; production callers use the format/parse helpers.
 */
export const __test = { JST_OFFSET_MINUTES }
