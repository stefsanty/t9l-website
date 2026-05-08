# Time handling (JST)

T9L is a Tokyo-based football league. Every match kickoff, matchday date, and RSVP deadline displayed to a player or entered by an admin is **JST clock time** (Asia/Tokyo, UTC+9, no DST). Postgres stores `DateTime` columns as UTC instants (TIMESTAMPTZ); the bridge between "UTC instant in DB" and "JST clock time on screen / in form" is the only thing the canonical helpers in [`src/lib/jst.ts`](../src/lib/jst.ts) do.

## The traps

**V8 / Vercel TZ=UTC** — the bug v1.9.0 fixed. See [known-infra-issues.md](known-infra-issues.md). Admin-entered "14:30" got parsed as UTC on Vercel; round-trip displayed back as 23:30 JST or "14:30 UTC" depending on viewer.

**Browser `<input type="datetime-local">`** — the input value is the user's *local* clock time as a tz-naive string, so the server cannot infer the user's timezone from the wire format alone. Convention enforced by `lib/jst.ts`: every `<input type="datetime-local">` value (rendered + parsed) represents JST clock time, regardless of the browser's local TZ.

## Convention

1. **Every `<input type="datetime-local">` value (rendered + parsed) represents JST clock time** regardless of browser local TZ. Use `formatJstDateTimeLocal(date)` to populate the input and `parseJstDateTimeLocal(string)` on the server to interpret submissions.
2. **Every `<input type="date">` value is a JST calendar date** stored as UTC midnight (`Date.UTC(y, m, d)`). Helper: `parseJstDateOnly(string)` for the server, `formatJstDate(date)` for the client.
3. **Every display string of a date/time goes through one of the `formatJst*` helpers** in `lib/jst.ts` — never through bare `toLocaleString` / `toLocaleDateString` / `toLocaleTimeString` without an explicit `timeZone: 'Asia/Tokyo'`.
4. **Avoid `Date#getHours()` / `getMinutes()` / `getDate()`** in component code — these read the host's local TZ, not JST. Use `formatJstTime(date)` etc.
5. **Avoid `toISOString().slice(0, 16)` to populate datetime-local inputs** — that's UTC clock time, not JST. Use `formatJstDateTimeLocal(date)`.

## Canonical helpers

| Helper | Purpose |
|--------|---------|
| `formatJstDate(d)` | "YYYY-MM-DD" in JST. For `<input type="date">` values + display. |
| `formatJstTime(d)` | "HH:MM" 24h in JST. For display + `<input type="time">` values. |
| `formatJstDateTimeLocal(d)` | "YYYY-MM-DDTHH:mm" in JST. For `<input type="datetime-local">` values. |
| `formatJstFriendly(d, locale)` | "Apr 16 (Thu)" or "4月16日（木）". Replaces legacy `formatMatchDate`. |
| `formatJstShort(d)` | "Sat 16 Apr" admin dashboard short date. |
| `formatJstDayMonth(d)` | "16 Apr" no weekday. |
| `parseJstDateTimeLocal(s)` | Inverse of `formatJstDateTimeLocal`. **Load-bearing** — server actions must use this for `playedAt` / `endedAt`. |
| `parseJstDateOnly(s)` | "YYYY-MM-DD" → UTC midnight Date. |
| `combineJstDateAndTime(date, time)` | "YYYY-MM-DD" + "HH:MM" → UTC Date. |
| `jstIsoString(date, time)` | "YYYY-MM-DDTHH:MM:00+09:00" for use with countdown timers. |
