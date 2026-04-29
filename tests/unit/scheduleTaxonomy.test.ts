import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { gwStatus } from '@/components/admin/ScheduleTab'

/**
 * v1.21.0 — Schedule-tab visual taxonomy regression tests.
 *
 * The v3 mockup codifies a tighter visual grammar for the admin schedule:
 *   - Picker pills have leading icon + trailing chevron
 *   - Empty pickers swap to dashed border + green prefix `+`
 *   - Number-edit (score) uses subtle bg + Barlow Condensed bold
 *   - Empty number shows `enter` placeholder with dotted outline
 *   - Inline text-edit (team picks) uses dotted underline, no bg, no chevron
 *   - Status badges have no border (status indicators, not interactive)
 *   - Match rows expose a kebab `⋯` overflow menu for status changes
 *
 * Structural test pattern (RTL not set up in this project): grep against
 * source files. Each test points at a load-bearing piece of the v1.21
 * contract that a regression would visibly break.
 */

const REPO = process.cwd()
const SCHEDULE_TAB = join(REPO, 'src/components/admin/ScheduleTab.tsx')
const PILL_EDITOR = join(REPO, 'src/components/admin/PillEditor.tsx')
const STATUS_BADGE = join(REPO, 'src/components/admin/StatusBadge.tsx')
const MATCH_SCORE_EDITOR = join(REPO, 'src/components/admin/MatchScoreEditor.tsx')
const MATCH_OVERFLOW_MENU = join(REPO, 'src/components/admin/MatchOverflowMenu.tsx')

describe('v1.21.0 — gwStatus taxonomy (Empty / Pending / Live / Done)', () => {
  const baseMatch = {
    id: 'm1',
    homeTeam: { id: 't1', team: { name: 'A' } },
    awayTeam: { id: 't2', team: { name: 'B' } },
    homeScore: 0,
    awayScore: 0,
    playedAt: new Date(),
    endedAt: null,
  }
  const baseGw = {
    id: 'gw1',
    weekNumber: 1,
    startDate: new Date(),
    endDate: new Date(),
    venue: null,
  }

  it('returns EMPTY when no matches are scheduled', () => {
    expect(gwStatus({ ...baseGw, matches: [] })).toBe('EMPTY')
  })

  it('returns PENDING when matches are scheduled but not yet played', () => {
    expect(
      gwStatus({
        ...baseGw,
        matches: [{ ...baseMatch, status: 'SCHEDULED' as const }],
      }),
    ).toBe('PENDING')
  })

  it('returns LIVE when at least one match is in progress', () => {
    expect(
      gwStatus({
        ...baseGw,
        matches: [
          { ...baseMatch, status: 'SCHEDULED' as const },
          { ...baseMatch, id: 'm2', status: 'IN_PROGRESS' as const },
        ],
      }),
    ).toBe('LIVE')
  })

  it('returns DONE when every match is COMPLETED / CANCELLED / POSTPONED', () => {
    expect(
      gwStatus({
        ...baseGw,
        matches: [
          { ...baseMatch, status: 'COMPLETED' as const },
          { ...baseMatch, id: 'm2', status: 'CANCELLED' as const },
          { ...baseMatch, id: 'm3', status: 'POSTPONED' as const },
        ],
      }),
    ).toBe('DONE')
  })

  it('LIVE wins over remaining DONE-eligible matches', () => {
    expect(
      gwStatus({
        ...baseGw,
        matches: [
          { ...baseMatch, status: 'COMPLETED' as const },
          { ...baseMatch, id: 'm2', status: 'IN_PROGRESS' as const },
        ],
      }),
    ).toBe('LIVE')
  })
})

describe('v1.21.0 — StatusBadge taxonomy + no-border', () => {
  it('exposes the new EMPTY / PENDING / LIVE / DONE labels', () => {
    const text = readFileSync(STATUS_BADGE, 'utf8')
    expect(text).toMatch(/EMPTY:\s*\{ label: 'Empty'/)
    expect(text).toMatch(/PENDING:\s*\{ label: 'Pending'/)
    expect(text).toMatch(/LIVE:\s*\{ label: 'Live'/)
    expect(text).toMatch(/DONE:\s*\{ label: 'Done'/)
  })

  it('does not render a border on any badge tone (badges are status, not interactive)', () => {
    const text = readFileSync(STATUS_BADGE, 'utf8')
    // Pre-v1.21.0 every config row had `border border-admin-XXX`. The
    // v3 taxonomy moves to tinted bg only — badges should communicate
    // status, not affordance. A regression that re-adds a border would
    // re-introduce the visual ambiguity the audit flagged.
    expect(text).not.toMatch(/border\s+border-admin-/)
  })
})

describe('v1.21.0 — PillEditor adornments (picker)', () => {
  it('imports and renders ChevronDown for picker variants', () => {
    const text = readFileSync(PILL_EDITOR, 'utf8')
    expect(text).toMatch(/import\s+\{[^}]*ChevronDown/)
    // Trailing chevron is the picker affordance — without it pills look
    // like static labels.
    expect(text).toMatch(/<ChevronDown/)
  })

  it('exposes optional `icon` and `placeholder` props on BasePillProps', () => {
    const text = readFileSync(PILL_EDITOR, 'utf8')
    expect(text).toMatch(/icon\?:\s*ReactNode/)
    expect(text).toMatch(/placeholder\?:\s*string/)
  })

  it('empty-state styling uses dashed border + transparent bg + green text', () => {
    const text = readFileSync(PILL_EDITOR, 'utf8')
    expect(text).toMatch(/border-dashed/)
    expect(text).toMatch(/text-admin-green/)
  })

  it('picker variants use 28px tap-target floor (smaller than text variant)', () => {
    const text = readFileSync(PILL_EDITOR, 'utf8')
    // Match-row pills are 28px per the v1.21 brief; text variant keeps
    // 40px for the heaviest tap target on the player-name row.
    expect(text).toMatch(/min-h-\[28px\]/)
    // 40px floor still preserved for the v1.20 text variant.
    expect(text).toMatch(/min-h-\[40px\]/)
  })

  it('renders a + prefix when value is empty (picker variants)', () => {
    const text = readFileSync(PILL_EDITOR, 'utf8')
    // The pre-fix shape ('Venue' as the empty placeholder) read as a
    // noun, not a call to action. The audit said "+ Set venue" or similar;
    // the v1.21 implementation uses a literal `+` prefix.
    expect(text).toMatch(/aria-hidden>\+</)
  })
})

describe('v1.21.0 — PillEditor team variant (inline-text-edit dropdown)', () => {
  it('exposes a team variant alongside date/time/datetime-local/venue/text', () => {
    const text = readFileSync(PILL_EDITOR, 'utf8')
    expect(text).toMatch(/variant: 'team'/)
    expect(text).toMatch(/TeamPillProps/)
  })

  it('team variant uses dotted-underline styling, NOT a bordered pill', () => {
    const text = readFileSync(PILL_EDITOR, 'utf8')
    expect(text).toMatch(/border-dotted/)
  })

  it('team variant renders a <select data-team-select> with options mapped from props', () => {
    const text = readFileSync(PILL_EDITOR, 'utf8')
    expect(text).toMatch(/data-team-select/)
  })
})

describe('v1.21.0 — MatchScoreEditor visual taxonomy', () => {
  it('filled-state score uses subtle bg + Barlow Condensed bold (no chevron)', () => {
    const text = readFileSync(MATCH_SCORE_EDITOR, 'utf8')
    expect(text).toMatch(/bg-admin-surface2/)
    expect(text).toMatch(/font-condensed font-bold/)
    // No chevron icon imported — score editor is not a picker
    expect(text).not.toMatch(/ChevronDown/)
  })

  it('empty-state score shows "enter" placeholder with dotted outline', () => {
    const text = readFileSync(MATCH_SCORE_EDITOR, 'utf8')
    expect(text).toMatch(/border-dotted/)
    // The literal placeholder text — whitespace-tolerant since JSX may
    // wrap it across lines.
    expect(text).toMatch(/>\s*enter\s*</)
  })

  it('empty placeholder replaces the old quiet "vs" text affordance', () => {
    const text = readFileSync(MATCH_SCORE_EDITOR, 'utf8')
    // Pre-v1.21 the empty state was `<span class="text-admin-text3">vs</span>`
    // — too quiet to read as editable. Audit flagged it; v1.21 replaces.
    expect(text).not.toMatch(/>vs</)
  })
})

describe('v1.21.0 — MatchOverflowMenu kebab', () => {
  it('the new file exists and is the default export', () => {
    const text = readFileSync(MATCH_OVERFLOW_MENU, 'utf8')
    expect(text).toMatch(/export default function MatchOverflowMenu/)
  })

  it('uses the MoreHorizontal lucide icon for the kebab trigger', () => {
    const text = readFileSync(MATCH_OVERFLOW_MENU, 'utf8')
    expect(text).toMatch(/import\s+\{\s*MoreHorizontal/)
  })

  it('dismisses on outside click and Escape', () => {
    const text = readFileSync(MATCH_OVERFLOW_MENU, 'utf8')
    expect(text).toMatch(/document\.addEventListener\('mousedown'/)
    expect(text).toMatch(/e\.key === 'Escape'/)
  })

  it('renders items via role=menu / role=menuitem (a11y)', () => {
    const text = readFileSync(MATCH_OVERFLOW_MENU, 'utf8')
    expect(text).toMatch(/role="menu"/)
    expect(text).toMatch(/role="menuitem"/)
  })

  it('supports a danger tone for destructive actions (Delete)', () => {
    const text = readFileSync(MATCH_OVERFLOW_MENU, 'utf8')
    expect(text).toMatch(/tone\?:\s*'default' \| 'danger'/)
  })

  it('supports disabled menu items (e.g. Mark complete on already-COMPLETED match)', () => {
    const text = readFileSync(MATCH_OVERFLOW_MENU, 'utf8')
    expect(text).toMatch(/disabled\?:\s*boolean/)
  })

  it('button is at least 32px (lighter than the 40px button floor)', () => {
    const text = readFileSync(MATCH_OVERFLOW_MENU, 'utf8')
    expect(text).toMatch(/w-8 h-8/)
  })
})

describe('v1.21.0 — ScheduleTab card layout (per v3 mockup)', () => {
  const text = readFileSync(SCHEDULE_TAB, 'utf8')

  it('imports MatchOverflowMenu', () => {
    expect(text).toMatch(/import\s+MatchOverflowMenu\s+from\s+['"]\.\/MatchOverflowMenu['"]/)
  })

  it('renders the matchday number as Barlow Condensed text-xl bold', () => {
    expect(text).toMatch(/font-condensed font-bold text-admin-text text-xl/)
  })

  it('renders date pill with leading Calendar icon', () => {
    expect(text).toMatch(/import\s+\{[^}]*Calendar/)
    expect(text).toMatch(/icon=\{<Calendar/)
  })

  it('renders venue pill with leading MapPin icon and Set venue placeholder', () => {
    expect(text).toMatch(/import\s+\{[^}]*MapPin/)
    expect(text).toMatch(/icon=\{<MapPin/)
    expect(text).toMatch(/placeholder="Set venue"/)
  })

  it('renders kickoff pill with leading Clock icon', () => {
    expect(text).toMatch(/import\s+\{[^}]*Clock/)
    expect(text).toMatch(/icon=\{<Clock/)
  })

  it('renders the Matches divider between header and match list', () => {
    expect(text).toMatch(/>Matches</)
  })

  it('uses formatJstFriendly for the date pill display (not the bare ISO format)', () => {
    expect(text).toMatch(/formatJstFriendly\(gw\.startDate/)
  })

  it('renders team picks via PillEditor variant="team" (not raw <select>)', () => {
    expect(text).toMatch(/variant="team"/)
    // The legacy TeamSelectCell with bare-span hover affordance is gone.
    expect(text).not.toMatch(/function TeamSelectCell/)
  })

  it('does NOT render the "X matches" tally on the matchday card header', () => {
    // Pre-v1.21 mobile: <span ...>{gw.matches.length}</span>. The mockup
    // removes the tally entirely (count is implicit from rendered rows).
    expect(text).not.toMatch(/\{gw\.matches\.length\}<\/span>/)
  })

  it('does NOT render the redundant "Edit" button on each matchday row', () => {
    // The v1.20 audit flagged this: clicking the row already toggled
    // expand; the dedicated Edit button was a duplicate affordance.
    // The kebab handles delete now.
    expect(text).not.toMatch(/>Edit<\/button>/)
  })

  it('exposes the matchday-level kebab for delete', () => {
    expect(text).toMatch(/Delete matchday/)
  })

  it('exposes the per-match kebab with status actions and delete', () => {
    expect(text).toMatch(/Mark complete/)
    expect(text).toMatch(/Cancel match/)
    expect(text).toMatch(/Postpone match/)
    expect(text).toMatch(/Delete match/)
  })

  it('passes status updates through updateMatch with the right status string', () => {
    expect(text).toMatch(/onSetStatus\('COMPLETED'\)/)
    expect(text).toMatch(/onSetStatus\('CANCELLED'\)/)
    expect(text).toMatch(/onSetStatus\('POSTPONED'\)/)
  })
})
