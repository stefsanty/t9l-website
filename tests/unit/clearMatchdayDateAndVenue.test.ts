import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { computeRsvpExpireAt, RSVP_TTL_DAYS_AFTER_MATCH } from '@/lib/rsvpStoreSchema'

/**
 * v1.31.0 — Admin can clear the matchday date; public site shows "TBD" for
 * both null date and missing venue.
 *
 * Tests cover four surfaces:
 *   1. Schema: GameWeek.startDate / endDate are nullable; migration is
 *      additive (no DROP / NOT NULL re-introduction).
 *   2. RSVP TTL math: `computeRsvpExpireAt(null)` anchors on `now + 90d`
 *      (so a TBD matchday's RSVP store still expires reasonably).
 *   3. Server action: `updateGameWeek` accepts `null` for startDate /
 *      endDate and writes that null through to Prisma (the empty-string
 *      → null normalisation path is also covered).
 *   4. Public components: MatchdayCard + RsvpBar default to "TBD" instead
 *      of the legacy hardcoded "Tennozu Park C" when venueName is null;
 *      they conditionally render the map link only when a URL is set.
 */

const REPO = process.cwd()

describe('v1.31.0 — schema: GameWeek dates nullable', () => {
  const schema = readFileSync(join(REPO, 'prisma/schema.prisma'), 'utf8')

  it('GameWeek.startDate is nullable', () => {
    expect(schema).toMatch(/model GameWeek \{[\s\S]*?\n\s+startDate\s+DateTime\?/)
  })

  it('GameWeek.endDate is nullable', () => {
    expect(schema).toMatch(/model GameWeek \{[\s\S]*?\n\s+endDate\s+DateTime\?/)
  })

  it('migration drops NOT NULL from both columns (purely additive)', () => {
    const sql = readFileSync(
      join(REPO, 'prisma/migrations/20260502120000_gameweek_dates_nullable/migration.sql'),
      'utf8',
    )
    expect(sql).toMatch(/ALTER TABLE "GameWeek" ALTER COLUMN "startDate" DROP NOT NULL/)
    expect(sql).toMatch(/ALTER TABLE "GameWeek" ALTER COLUMN "endDate"\s+DROP NOT NULL/)
    // Regression target: the migration must not also include any DROP /
    // SET NOT NULL / data-mutating statement.
    expect(sql).not.toMatch(/SET NOT NULL/)
    expect(sql).not.toMatch(/DROP COLUMN/)
    expect(sql).not.toMatch(/DROP TABLE/)
  })
})

describe('v1.31.0 — computeRsvpExpireAt accepts null startDate', () => {
  it('null startDate anchors on `now + 90 days`', () => {
    const now = new Date('2026-05-01T00:00:00.000Z')
    const expireAt = computeRsvpExpireAt(null, now)
    const expected = Math.floor(
      (now.getTime() + RSVP_TTL_DAYS_AFTER_MATCH * 86_400_000) / 1000,
    )
    expect(expireAt).toBe(expected)
  })

  it('null startDate result equals `computeRsvpExpireAt(now, now)` (parity check)', () => {
    // When startDate === now, the `max(start, now)` branch reduces to now;
    // the null branch should produce the same value.
    const now = new Date('2026-06-15T12:34:56.000Z')
    const nullCase = computeRsvpExpireAt(null, now)
    const sameAsNow = computeRsvpExpireAt(now, now)
    expect(nullCase).toBe(sameAsNow)
  })

  it('non-null startDate path unchanged (existing contract preserved)', () => {
    const now = new Date('2026-05-01T00:00:00.000Z')
    const future = new Date('2026-06-15T00:00:00.000Z')
    const expireAt = computeRsvpExpireAt(future, now)
    const expected = Math.floor(
      (future.getTime() + RSVP_TTL_DAYS_AFTER_MATCH * 86_400_000) / 1000,
    )
    expect(expireAt).toBe(expected)
  })
})

describe('v1.31.0 — updateGameWeek admin action accepts null', () => {
  const actions = readFileSync(
    join(REPO, 'src/app/admin/leagues/actions.ts'),
    'utf8',
  )

  it('updateGameWeek startDate / endDate types accept `string | null`', () => {
    expect(actions).toMatch(/startDate\?:\s*string\s*\|\s*null/)
    expect(actions).toMatch(/endDate\?:\s*string\s*\|\s*null/)
  })

  it('null startDate writes Prisma null (not undefined, not skipped)', () => {
    // The implementation maps:
    //   undefined     → undefined  (field not in the patch)
    //   null / ''     → null       (clear it)
    //   "YYYY-MM-DD"  → parseJstDateOnly(...)
    // Regression target: a regression that maps null to undefined would
    // silently drop the clear request.
    expect(actions).toMatch(/data\.startDate === undefined[\s\S]*?\?\s*undefined[\s\S]*?:\s*data\.startDate[\s\S]*?\?\s*parseJstDateOnly\(data\.startDate\)[\s\S]*?:\s*null/)
  })

  it('null endDate follows the same shape', () => {
    expect(actions).toMatch(/data\.endDate === undefined[\s\S]*?\?\s*undefined[\s\S]*?:\s*data\.endDate[\s\S]*?\?\s*parseJstDateOnly\(data\.endDate\)[\s\S]*?:\s*null/)
  })
})

describe('v1.31.0 — dbToPublicLeagueData passes null date through', () => {
  const adapter = readFileSync(
    join(REPO, 'src/lib/dbToPublicLeagueData.ts'),
    'utf8',
  )

  it('GameWeekMeta.startDate is `Date | null`', () => {
    expect(adapter).toMatch(/startDate:\s*Date\s*\|\s*null/)
  })

  it('matchday.date is null when gw.startDate is null (consumer renders TBD)', () => {
    expect(adapter).toMatch(/const date = gw\.startDate \? formatJstDate\(gw\.startDate\) : null/)
  })
})

describe('v1.31.0 — ScheduleTab admin clear-date affordance', () => {
  const tab = readFileSync(
    join(REPO, 'src/components/admin/ScheduleTab.tsx'),
    'utf8',
  )

  it('GameWeekRow.startDate / endDate types accept null', () => {
    expect(tab).toMatch(/startDate:\s*Date\s*\|\s*null/)
    expect(tab).toMatch(/endDate:\s*Date\s*\|\s*null/)
  })

  it('imports the X (close/clear) icon', () => {
    expect(tab).toMatch(/import\s*\{[^}]*\bX\b[^}]*\}\s*from\s*['"]lucide-react['"]/)
  })

  it('renders the clear button next to the date pill when startDate is set', () => {
    // The button is gated on `gw.startDate &&` — only shows when there is
    // a value to clear. Regression target: showing the button on an
    // already-empty pill confuses the affordance.
    expect(tab).toMatch(/\{gw\.startDate && \(/)
    expect(tab).toMatch(/aria-label=\{`Clear MD\$\{gw\.weekNumber\} date`\}/)
  })

  it('clear button calls updateGameWeek with both startDate and endDate set to null', () => {
    expect(tab).toMatch(/updateGameWeek\(gw\.id, leagueId, \{ startDate: null, endDate: null \}\)/)
  })

  it('date pill empty-state placeholder is "Set date" (matches venue pattern)', () => {
    expect(tab).toMatch(/placeholder="Set date"/)
  })

  it('date pill value/display fall back to empty when startDate is null (renders pill empty state)', () => {
    expect(tab).toMatch(/value=\{gw\.startDate \? fmtDate\(gw\.startDate\) : ''\}/)
    expect(tab).toMatch(/display=\{gw\.startDate \? formatJstFriendly\(gw\.startDate, 'en'\) : ''\}/)
  })
})

describe('v1.31.0 — public components show TBD for empty venue', () => {
  it('MatchdayCard defaults venueName to "TBD" (was "Tennozu Park C")', () => {
    const card = readFileSync(join(REPO, 'src/components/MatchdayCard.tsx'), 'utf8')
    expect(card).toMatch(/const TBD_VENUE_NAME\s*=\s*'TBD'/)
    expect(card).toMatch(/matchday\.venueName \?\? TBD_VENUE_NAME/)
    // Regression target: the legacy default must not creep back in.
    expect(card).not.toMatch(/'Tennozu Park C'/)
    // venueUrl falls through to null when not set — anchor only renders
    // when URL is present. Without this guard, the link would take users
    // to the legacy Tennozu URL on every TBD matchday.
    expect(card).toMatch(/const venueUrl\s*=\s*matchday\.venueUrl \?\? null/)
  })

  it('MatchdayCard renders venue as a plain span (no anchor) when venueUrl is null', () => {
    const card = readFileSync(join(REPO, 'src/components/MatchdayCard.tsx'), 'utf8')
    expect(card).toMatch(/\{venueUrl \? \(/)
  })

  it('RsvpBar defaults venueName to "TBD" (was "Tennozu Park C")', () => {
    const bar = readFileSync(join(REPO, 'src/components/RsvpBar.tsx'), 'utf8')
    expect(bar).toMatch(/matchday\.venueName \?\? 'TBD'/)
    expect(bar).toMatch(/matchday\.venueUrl \?\? null/)
    expect(bar).not.toMatch(/'Tennozu Park C'/)
  })

  it('RsvpBar conditionally renders the venue map link based on venueUrl', () => {
    const bar = readFileSync(join(REPO, 'src/components/RsvpBar.tsx'), 'utf8')
    // Two link sites in RsvpBar (the going-state strip + the confirmation
    // modal). Both must guard on venueUrl.
    const matches = bar.match(/\{venueUrl \? \(/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })
})

describe('v1.31.0 — MatchdayCard already renders TBD for null date (regression-prevention)', () => {
  // The Matchday.date contract has been `string | null` since v1.0; this
  // test pins that the existing TBD branch survives the v1.31.0 schema
  // change so the new "admin clears date" path renders correctly without
  // any extra component-side change.
  it('MatchdayCard renders "TBD" when matchday.date is null', () => {
    const card = readFileSync(join(REPO, 'src/components/MatchdayCard.tsx'), 'utf8')
    expect(card).toMatch(/matchday\.date \? formatJstFriendly\(matchday\.date, locale\) : 'TBD'/)
  })
})
