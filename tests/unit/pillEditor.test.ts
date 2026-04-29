import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * v1.19.0 — Schedule pill editor regression test.
 *
 * Pre-v1.19.0 the matchday date / venue / kickoff cells were a mix of:
 *   - `<span>` display-only on mobile (date, venue) — admins could not
 *      edit those fields without switching to desktop;
 *   - InlineEditCell (text input swap-in) on desktop date / kickoff;
 *   - bare `<select>` for desktop venue (added v1.18.0).
 *
 * v1.19.0 introduces `PillEditor` (`src/components/admin/PillEditor.tsx`)
 * — a unified pill control with a platform-native picker overlaid as an
 * `opacity-0` input/select. The pill is mobile-friendly (≥40px tap target
 * on the default size, ≥28px on `md:` desktop overrides) and replaces all
 * three editor surfaces (date / venue / kickoff) on both mobile and
 * desktop. FT (full time) also moves to PillEditor variant="time".
 *
 * Test shape mirrors the matchScoreEditor.test.ts pattern: structural
 * grep-based regression assertions (RTL + jsdom not set up in this
 * project). Each assertion describes the load-bearing v1.19.0 contract a
 * regression would break.
 */

const REPO = process.cwd()
const SCHEDULE_TAB = join(REPO, 'src/components/admin/ScheduleTab.tsx')
const PILL_EDITOR = join(REPO, 'src/components/admin/PillEditor.tsx')

describe('v1.19.0 — PillEditor component', () => {
  it('exists and is the default export', () => {
    const text = readFileSync(PILL_EDITOR, 'utf8')
    expect(text).toMatch(/export default function PillEditor/)
  })

  it('supports four variants: date, time, datetime-local, venue', () => {
    const text = readFileSync(PILL_EDITOR, 'utf8')
    expect(text).toMatch(/variant: 'date'/)
    expect(text).toMatch(/variant: 'time'/)
    expect(text).toMatch(/variant: 'datetime-local'/)
    expect(text).toMatch(/variant: 'venue'/)
  })

  it('overlays a native input with opacity-0 absolute positioning so the pill is the tap target', () => {
    const text = readFileSync(PILL_EDITOR, 'utf8')
    // The overlaid native control is what gives us the platform picker on
    // mobile (iOS Safari + Android Chrome) without JS-level showPicker()
    // plumbing. Regression target: replacing this with a click-to-edit
    // swap-in would break the "tap the pill, native picker opens" UX.
    expect(text).toMatch(/className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"/)
  })

  it('hits the ≥40px mobile tap-target spec via min-h-[40px]', () => {
    const text = readFileSync(PILL_EDITOR, 'utf8')
    expect(text).toMatch(/min-h-\[40px\]/)
  })

  it('fires onSave only when the new value differs from the committed value', () => {
    const text = readFileSync(PILL_EDITOR, 'utf8')
    // Save-on-change requires a "skip if unchanged" guard — otherwise
    // spurious onSave fires when the user opens the picker and re-picks
    // the same value, generating extra Prisma writes + revalidates.
    expect(text).toMatch(/if \(newValue === props\.value\) return/)
  })

  it('rolls back the draft on save failure', () => {
    const text = readFileSync(PILL_EDITOR, 'utf8')
    // Without rollback, a transient network error would leave the pill
    // showing the unsaved value indefinitely (no error UI to clear it).
    expect(text).toMatch(/setDraft\(props\.value\)/)
  })

  it('venue variant maps the `null` sentinel to onSave when value is empty', () => {
    const text = readFileSync(PILL_EDITOR, 'utf8')
    // updateGameWeek({ venueId: null }) clears the venue. The pill must
    // pass null (not '') so the server action sets venueId to null.
    expect(text).toMatch(/onSave\(newValue \|\| null\)/)
  })

  it('uses useTransition for the pending state', () => {
    const text = readFileSync(PILL_EDITOR, 'utf8')
    // useTransition gives us pending tracking without owning a separate
    // boolean state that could desync with React's commit cycle.
    expect(text).toMatch(/useTransition/)
  })

  it('dims with opacity-50 + animate-pulse while pending', () => {
    const text = readFileSync(PILL_EDITOR, 'utf8')
    // Spec: "brief loading affordance while the update action is in
    // flight". opacity + pulse is the pill-internal spinner.
    expect(text).toMatch(/pending && 'opacity-50 pointer-events-none animate-pulse'/)
  })
})

describe('v1.19.0 — ScheduleTab uses PillEditor for date/venue/time on mobile and desktop', () => {
  it('imports PillEditor', () => {
    const text = readFileSync(SCHEDULE_TAB, 'utf8')
    expect(text).toMatch(/import\s+PillEditor\s+from\s+['"]\.\/PillEditor['"]/)
  })

  it('no longer imports InlineEditCell', () => {
    const text = readFileSync(SCHEDULE_TAB, 'utf8')
    // Every editor surface that was an InlineEditCell now uses PillEditor.
    // A regression that re-introduces InlineEditCell here would also
    // re-introduce a non-pill editor surface, defeating the point.
    expect(text).not.toMatch(/import\s+InlineEditCell/)
  })

  it('renders PillEditor variant="date" for matchday startDate', () => {
    const text = readFileSync(SCHEDULE_TAB, 'utf8')
    expect(text).toMatch(/variant="date"/)
  })

  it('renders PillEditor variant="venue" for matchday venue', () => {
    const text = readFileSync(SCHEDULE_TAB, 'utf8')
    expect(text).toMatch(/variant="venue"/)
  })

  it('renders PillEditor variant="datetime-local" for match kickoff', () => {
    const text = readFileSync(SCHEDULE_TAB, 'utf8')
    expect(text).toMatch(/variant="datetime-local"/)
  })

  // v1.21.0 — FT (full time) field is no longer surfaced in the schedule
  // tab UI per the v3 mockup. The data still exists on Match.endedAt but
  // editing has been removed pending a redesign of how it's surfaced
  // (likely via the match kebab in a future PR).

  it('match kickoff pill display includes the JST suffix', () => {
    const text = readFileSync(SCHEDULE_TAB, 'utf8')
    // Per CLAUDE.md "Time handling": every displayed time must read as
    // JST clock time. The pill makes that explicit on the visible label.
    expect(text).toMatch(/`\$\{fmtTime\(match\.playedAt\)\} JST`/)
  })

  it('matchday date pill onSave uses the canonical updateGameWeek action', () => {
    const text = readFileSync(SCHEDULE_TAB, 'utf8')
    expect(text).toMatch(/updateGameWeek\(gw\.id, leagueId, \{ startDate: val, endDate: val \}\)/)
  })

  it('matchday venue pill onSave uses updateGameWeek with venueId, supporting clear (null)', () => {
    const text = readFileSync(SCHEDULE_TAB, 'utf8')
    expect(text).toMatch(/updateGameWeek\(gw\.id, leagueId, \{ venueId \}\)/)
  })
})
