import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * v1.18.0 — Venue dropdown regression test, updated for v1.19.0 PillEditor.
 *
 * Pre-v1.18.0 the matchday venue cell in ScheduleTab.tsx was a free-text
 * InlineEditCell that called the legacy `updateGameWeekVenue` server
 * action — find-or-create-by-name on Venue, so admins typing a new venue
 * silently created it. v1.18.0 replaced the cell with a `<select>`
 * dropdown sourced from the global venues list, calling
 * `updateGameWeek({ venueId })` directly. v1.19.0 wraps that dropdown in
 * the new `PillEditor variant="venue"` for mobile-friendly tap targets.
 *
 * Load-bearing intent preserved across both refactors:
 *   1. The legacy `updateGameWeekVenue` find-or-create-by-name path is
 *      gone and venues are managed exclusively from `/admin/venues`.
 *   2. The matchday venue cell calls `updateGameWeek({ venueId })`.
 *   3. The dropdown is sourced from the `venues` prop.
 *
 * The `<select data-venue-select>` markup itself moved into PillEditor;
 * the structural assertion now points at the PillEditor implementation.
 */

const REPO = process.cwd()
const SCHEDULE_TAB = join(REPO, 'src/components/admin/ScheduleTab.tsx')
const PILL_EDITOR = join(REPO, 'src/components/admin/PillEditor.tsx')
const LEAGUES_ACTIONS = join(REPO, 'src/app/admin/leagues/actions.ts')
const VENUES_PAGE = join(REPO, 'src/app/admin/venues/page.tsx')
const VENUES_ACTIONS = join(REPO, 'src/app/admin/venues/actions.ts')
const VENUES_LIST = join(REPO, 'src/components/admin/VenuesList.tsx')
const ADMIN_NAV = join(REPO, 'src/components/admin/AdminNav.tsx')

describe('v1.18.0 — venue dropdown in ScheduleTab (via v1.19.0 PillEditor)', () => {
  it('matchday venue cell renders a PillEditor variant="venue", not a free-text input', () => {
    const text = readFileSync(SCHEDULE_TAB, 'utf8')
    expect(text).toMatch(/variant="venue"/)
    // The free-text "Venue name…" placeholder from the legacy InlineEditCell
    // path is gone.
    expect(text).not.toMatch(/Venue name…/)
  })

  it('the venue PillEditor receives the `venues` prop as its options', () => {
    const text = readFileSync(SCHEDULE_TAB, 'utf8')
    // The pill must be passed venues as its options list.
    expect(text).toMatch(/options=\{venues\}/)
  })

  it('the dropdown calls updateGameWeek with { venueId }, not the legacy updateGameWeekVenue', () => {
    const text = readFileSync(SCHEDULE_TAB, 'utf8')
    expect(text).toMatch(/updateGameWeek\([^)]*\{\s*venueId\s*\}/)
    // Pre-v1.18.0 import used updateGameWeekVenue.
    expect(text).not.toMatch(/updateGameWeekVenue/)
  })

  it('PillEditor renders a <select data-venue-select> with options mapped from its `options` prop', () => {
    const text = readFileSync(PILL_EDITOR, 'utf8')
    expect(text).toMatch(/data-venue-select/)
    expect(text).toMatch(/options\.map/)
    expect(text).toMatch(/key=\{v\.id\}\s+value=\{v\.id\}/)
  })
})

describe('v1.18.0 — legacy updateGameWeekVenue is removed', () => {
  it('the find-or-create-by-name server action no longer exists', () => {
    const text = readFileSync(LEAGUES_ACTIONS, 'utf8')
    expect(text).not.toMatch(/export\s+async\s+function\s+updateGameWeekVenue/)
  })
})

describe('v1.18.0 — /admin/venues page exists with CRUD scaffolding', () => {
  it('venues page renders VenuesList from getAllVenuesWithUsage', () => {
    const text = readFileSync(VENUES_PAGE, 'utf8')
    expect(text).toMatch(/getAllVenuesWithUsage/)
    expect(text).toMatch(/<VenuesList\s+venues=\{venues\}\s*\/>/)
  })

  it('venues actions file exports createVenue, updateVenue, deleteVenue', () => {
    const text = readFileSync(VENUES_ACTIONS, 'utf8')
    expect(text).toMatch(/export\s+async\s+function\s+createVenue/)
    expect(text).toMatch(/export\s+async\s+function\s+updateVenue/)
    expect(text).toMatch(/export\s+async\s+function\s+deleteVenue/)
  })

  it('VenuesList component imports the three CRUD actions', () => {
    const text = readFileSync(VENUES_LIST, 'utf8')
    expect(text).toMatch(/createVenue/)
    expect(text).toMatch(/updateVenue/)
    expect(text).toMatch(/deleteVenue/)
  })

  it("AdminNav exposes a 'Venues' link to /admin/venues", () => {
    const text = readFileSync(ADMIN_NAV, 'utf8')
    expect(text).toMatch(/href:\s*'\/admin\/venues'/)
    expect(text).toMatch(/label:\s*'Venues'/)
  })
})
