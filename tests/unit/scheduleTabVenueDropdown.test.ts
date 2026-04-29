import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * v1.18.0 — Venue dropdown regression test.
 *
 * Pre-v1.18.0 the matchday venue cell in ScheduleTab.tsx was an
 * InlineEditCell with type="text" that called the legacy
 * `updateGameWeekVenue(id, leagueId, venueName)` server action. That
 * action did find-or-create-by-name on Venue, so admins typing a new
 * venue silently created it. v1.18.0 replaces the cell with a `<select>`
 * dropdown sourced from the global venues list, calling
 * `updateGameWeek({ venueId })` directly — venues are now managed
 * exclusively from `/admin/venues`.
 *
 * This is the regression-prevention shape: assert the cell is a
 * `<select>` with `data-venue-select`, the dropdown maps over the
 * `venues` prop, and the legacy free-text path is gone. A regression
 * to the InlineEditCell-with-text shape would fail multiple assertions
 * here.
 *
 * Render-parity testing would need RTL + jsdom (not set up in this
 * project); the structural pin matches the established matchScoreEditor
 * pattern.
 */

const REPO = process.cwd()
const SCHEDULE_TAB = join(REPO, 'src/components/admin/ScheduleTab.tsx')
const LEAGUES_ACTIONS = join(REPO, 'src/app/admin/leagues/actions.ts')
const VENUES_PAGE = join(REPO, 'src/app/admin/venues/page.tsx')
const VENUES_ACTIONS = join(REPO, 'src/app/admin/venues/actions.ts')
const VENUES_LIST = join(REPO, 'src/components/admin/VenuesList.tsx')
const ADMIN_NAV = join(REPO, 'src/components/admin/AdminNav.tsx')

describe('v1.18.0 — venue dropdown in ScheduleTab', () => {
  it('matchday venue cell is a <select data-venue-select>, not an InlineEditCell text input', () => {
    const text = readFileSync(SCHEDULE_TAB, 'utf8')
    expect(text).toMatch(/data-venue-select/)
    // The free-text "Venue name…" placeholder from the InlineEditCell
    // path is gone.
    expect(text).not.toMatch(/Venue name…/)
  })

  it('the dropdown is populated from the `venues` prop', () => {
    const text = readFileSync(SCHEDULE_TAB, 'utf8')
    // The select must map over venues to render <option> elements with
    // venue id as value and venue name as label.
    expect(text).toMatch(/venues\.map\(\(v\)\s*=>\s*<option/)
    expect(text).toMatch(/key=\{v\.id\}\s+value=\{v\.id\}/)
  })

  it('the dropdown calls updateGameWeek with { venueId }, not the legacy updateGameWeekVenue', () => {
    const text = readFileSync(SCHEDULE_TAB, 'utf8')
    expect(text).toMatch(/updateGameWeek\([^)]*\{\s*venueId\s*\}/)
    // Pre-v1.18.0 import used updateGameWeekVenue.
    expect(text).not.toMatch(/updateGameWeekVenue/)
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
