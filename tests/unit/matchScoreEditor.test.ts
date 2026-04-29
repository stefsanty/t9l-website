import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * v1.15.0 — extraction regression test for MatchScoreEditor.
 *
 * Pre-v1.15.0 the score-editing state machine + save logic was duplicated
 * across `MobileMatchRow` and `MatchSubrow` (mobile + desktop variants of
 * the admin schedule view) — both rows owned their own `editingScore` /
 * `homeScore` / `awayScore` state, `saveScore` function, Enter/Escape/onBlur
 * keyboard handlers, and parse-int validation. v1.15.0 extracts the common
 * shape into `MatchScoreEditor` (`src/components/admin/MatchScoreEditor.tsx`).
 *
 * This test pins the dedupe by asserting the duplicated symbols don't
 * reappear in `ScheduleTab.tsx`. A regression — adding back a per-row
 * score-editing state machine — would re-introduce the literal symbols and
 * fail this test.
 *
 * Behavioral correctness is verified by the type-checker (the component
 * compiles, both call sites pass the right props) and by the existing
 * admin smoke flow. Render-parity tests would need RTL + jsdom (not set up
 * in this project); the structural assertion below is the lighter
 * regression-prevention shape that fits the existing test surface.
 */

const REPO = process.cwd()
const SCHEDULE_TAB = join(REPO, 'src/components/admin/ScheduleTab.tsx')
const MATCH_SCORE_EDITOR = join(REPO, 'src/components/admin/MatchScoreEditor.tsx')

describe('v1.15.0 — MatchScoreEditor extraction', () => {
  it('the extracted component file exists and is a default export', () => {
    const text = readFileSync(MATCH_SCORE_EDITOR, 'utf8')
    expect(text).toMatch(/export default function MatchScoreEditor/)
  })

  it('ScheduleTab.tsx no longer owns score-editing state', () => {
    const text = readFileSync(SCHEDULE_TAB, 'utf8')
    // Pre-v1.15.0 each row had `setEditingScore` + `setHomeScore` +
    // `setAwayScore` declared locally. With the extraction those move into
    // MatchScoreEditor; ScheduleTab should not declare them anywhere.
    expect(text).not.toMatch(/setEditingScore/)
    expect(text).not.toMatch(/setHomeScore/)
    expect(text).not.toMatch(/setAwayScore/)
  })

  it('ScheduleTab.tsx no longer owns the saveScore helper', () => {
    const text = readFileSync(SCHEDULE_TAB, 'utf8')
    // saveScore was the duplicated function in both rows. Now lives only
    // in MatchScoreEditor.
    expect(text).not.toMatch(/function saveScore/)
    expect(text).not.toMatch(/saveScore\(\)/)
  })

  it('ScheduleTab.tsx imports MatchScoreEditor', () => {
    const text = readFileSync(SCHEDULE_TAB, 'utf8')
    expect(text).toMatch(/import\s+MatchScoreEditor\s+from\s+['"]\.\/MatchScoreEditor['"]/)
  })

  it('ScheduleTab.tsx renders MatchScoreEditor in the unified card row', () => {
    const text = readFileSync(SCHEDULE_TAB, 'utf8')
    // v1.21.0 — the v3 mockup unifies the mobile/desktop trees into a
    // single card layout. Only the desktop variant is rendered now (the
    // mobile/desktop split was a class-name difference; the card layout
    // works at both breakpoints with the desktop variant). The variant
    // prop on MatchScoreEditor is kept so a future split (e.g. compact
    // density) can re-introduce a mobile variant without an API change.
    expect(text).toMatch(/<MatchScoreEditor[^/>]*variant="desktop"/)
  })

  it('MatchScoreEditor calls updateMatch with status=COMPLETED on save', () => {
    const text = readFileSync(MATCH_SCORE_EDITOR, 'utf8')
    expect(text).toMatch(/updateMatch\(match\.id, leagueId, \{[\s\S]*?status: 'COMPLETED'/)
  })

  it("MatchScoreEditor wires Enter to save and Escape to cancel", () => {
    const text = readFileSync(MATCH_SCORE_EDITOR, 'utf8')
    expect(text).toMatch(/e\.key === 'Enter'/)
    expect(text).toMatch(/e\.key === 'Escape'/)
    // onBlur saves (mirrors the v1.14.x behavior — clicking outside the
    // input persists the entry).
    expect(text).toMatch(/onBlur=\{saveScore\}/)
  })
})
