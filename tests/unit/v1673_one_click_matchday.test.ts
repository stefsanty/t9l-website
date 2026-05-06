/**
 * v1.67.3 — One-click "Add matchday".
 *
 * Pre-v1.67.3 the admin Schedule tab "Add matchday" button opened a modal
 * form requiring date + venue. v1.67.3 replaces that with a single click:
 * the new `adminAddMatchday(leagueId)` server action creates a GameWeek
 * with `weekNumber = max + 1` and all nullable fields null. Admins fill
 * date / venue inline via existing per-row pill editors.
 *
 * These tests are structural (file-shape grep) — they pin the action
 * surface and the ScheduleTab refactor (form state + handler + JSX block
 * gone). A regression that re-introduces the modal form would fail the
 * "absence" assertions; a regression that drops the action would fail
 * the "shape" assertions.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

// Strip line + block comments so docstrings describing pre-v1.67.3
// behavior don't trip the "must not contain" assertions.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('v1.67.3 adminAddMatchday server action', () => {
  const actions = read('src/app/admin/leagues/actions.ts')

  it('exports adminAddMatchday with single leagueId arg', () => {
    expect(actions).toMatch(/export async function adminAddMatchday\(\s*leagueId:\s*string\s*\)/)
  })

  it('gates on assertAdmin', () => {
    const block = actions.match(/export async function adminAddMatchday[\s\S]*?\n\}/)
    expect(block).not.toBeNull()
    expect(block![0]).toMatch(/await assertAdmin\(\)/)
  })

  it('computes weekNumber from the league\'s max + 1', () => {
    const block = actions.match(/export async function adminAddMatchday[\s\S]*?\n\}/)![0]
    expect(block).toMatch(/prisma\.gameWeek\.findFirst/)
    expect(block).toMatch(/where:\s*\{\s*leagueId\s*\}/)
    expect(block).toMatch(/orderBy:\s*\{\s*weekNumber:\s*'desc'\s*\}/)
    expect(block).toMatch(/\(last\?\.weekNumber\s*\?\?\s*0\)\s*\+\s*1/)
  })

  it('creates a GameWeek with startDate / endDate / venueId all null', () => {
    const block = actions.match(/export async function adminAddMatchday[\s\S]*?\n\}/)![0]
    expect(block).toMatch(/prisma\.gameWeek\.create/)
    expect(block).toMatch(/startDate:\s*null/)
    expect(block).toMatch(/endDate:\s*null/)
    expect(block).toMatch(/venueId:\s*null/)
  })

  it('seeds the Redis RSVP hash via seedGameWeek (handles null per v1.31.0)', () => {
    const block = actions.match(/export async function adminAddMatchday[\s\S]*?\n\}/)![0]
    expect(block).toMatch(/await seedGameWeek\(gw\.id,\s*gw\.startDate\)/)
  })

  it('busts the canonical admin cache for the schedule path', () => {
    const block = actions.match(/export async function adminAddMatchday[\s\S]*?\n\}/)![0]
    expect(block).toMatch(/revalidate\(\s*\{\s*domain:\s*'admin'/)
    expect(block).toMatch(/`\/admin\/leagues\/\$\{leagueId\}\/schedule`/)
  })
})

describe('v1.67.3 ScheduleTab one-click refactor', () => {
  const tab = read('src/components/admin/ScheduleTab.tsx')
  const stripped = stripComments(tab)

  it('imports adminAddMatchday from the leagues actions module', () => {
    expect(tab).toMatch(/import\s*\{[^}]*\badminAddMatchday\b[^}]*\}\s*from\s*'@\/app\/admin\/leagues\/actions'/)
  })

  it('does NOT import createGameWeek (regression target — modal form path)', () => {
    expect(stripped).not.toMatch(/\bcreateGameWeek\b/)
  })

  it('removes the `showAddMatchday` state hook (regression target)', () => {
    expect(stripped).not.toMatch(/\bshowAddMatchday\b/)
    expect(stripped).not.toMatch(/\bsetShowAddMatchday\b/)
  })

  it('removes the `handleAddMatchday` form handler (regression target)', () => {
    // The new one-click handler is `handleAddMatchdayClick` — distinct
    // identifier so this assertion pins the absence of the form-handler.
    expect(stripped).not.toMatch(/\bhandleAddMatchday\b(?!Click)/)
  })

  it('removes the `addMatchdayForm` JSX block (regression target)', () => {
    expect(stripped).not.toMatch(/\baddMatchdayForm\b/)
  })

  it('exposes a one-click handler that calls adminAddMatchday(leagueId)', () => {
    expect(tab).toMatch(/function handleAddMatchdayClick\(\)/)
    const handler = tab.match(/function handleAddMatchdayClick\(\)[\s\S]*?\n  \}/)
    expect(handler).not.toBeNull()
    expect(handler![0]).toMatch(/await adminAddMatchday\(leagueId\)/)
  })

  it('the Add matchday button click fires the new handler (no form toggle)', () => {
    expect(tab).toMatch(/onClick=\{handleAddMatchdayClick\}/)
    expect(tab).toMatch(/data-testid="schedule-tab-add-matchday"/)
  })

  it('drops the old `setShowAddMatchday(true)` toggle from the toolbar', () => {
    expect(stripped).not.toMatch(/setShowAddMatchday\(true\)/)
  })

  it('the empty-state copy no longer guards on `!showAddMatchday`', () => {
    // Regression target — the empty state should always render when there
    // are no GameWeeks; the v1.67.3 flow has nothing to hide it behind.
    expect(stripped).not.toMatch(/!\s*showAddMatchday/)
  })
})
