/**
 * v2.3.0 — shared Tabs primitive + LeagueDetailsPanel tabification.
 *
 * Structural tests over file content. The Tabs primitive is the global
 * template for user-facing tab systems on t9l (ported from the
 * dev.futcal.com Discover-page style); these tests pin the load-bearing
 * visual + a11y contracts so a future PR can't silently drift away from
 * the shared style or regress the LeagueDetailsPanel migration.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('v2.3.0 shared Tabs primitive (src/components/ui/Tabs.tsx)', () => {
  const src = read('src/components/ui/Tabs.tsx')

  it('is a client component (declares "use client")', () => {
    expect(src).toMatch(/^'use client'/)
  })

  it('exports the Tabs component + TabDef type', () => {
    expect(src).toMatch(/export\s+(?:function|interface)\s+TabDef\b|export\s+interface\s+TabDef\b/)
    expect(src).toMatch(/export\s+function\s+Tabs\b/)
  })

  it('renders <nav role="tablist"> with the canonical wrapper classes', () => {
    expect(src).toMatch(/role="tablist"/)
    // border-b border-border-default is load-bearing; without it the
    // underline indicator collapses to a single coloured strip per tab
    // with no surrounding strip baseline.
    expect(src).toMatch(/flex border-b border-border-default/)
  })

  it('supports the optional sticky-top variant', () => {
    expect(src).toMatch(/sticky\?:\s*boolean/)
    expect(src).toMatch(/sticky top-0 bg-surface z-10/)
  })

  it('emits the futcal Discover-page tab metrics: px-4 py-3 / 13px / font-semibold / border-b-2 / -mb-px', () => {
    expect(src).toMatch(
      /px-4 py-3 text-\[13px\] font-semibold[\s\S]*border-b-2 -mb-px/,
    )
  })

  it('emits border-accent text-accent on the active tab', () => {
    expect(src).toMatch(/border-accent text-accent/)
  })

  it('emits border-transparent + text-fg-mid + hover:text-fg-high on inactive tabs', () => {
    expect(src).toMatch(/border-transparent text-fg-mid hover:text-fg-high/)
  })

  it('emits role="tab" with aria-selected + aria-controls + roving tabindex', () => {
    expect(src).toMatch(/role="tab"/)
    expect(src).toMatch(/aria-selected=\{active\}/)
    expect(src).toMatch(/aria-controls=\{panelId\}/)
    expect(src).toMatch(/tabIndex=\{active \? 0 : -1\}/)
  })

  it('supports keyboard arrow / Home / End navigation', () => {
    expect(src).toMatch(/ArrowRight/)
    expect(src).toMatch(/ArrowLeft/)
    expect(src).toMatch(/'Home'/)
    expect(src).toMatch(/'End'/)
  })

  it('emits one role="tabpanel" with matching id + aria-labelledby for the active tab', () => {
    expect(src).toMatch(/role="tabpanel"/)
    expect(src).toMatch(/aria-labelledby=\{idFor\('tab', t\.id\)\}/)
  })

  it('supports a "More" overflow dropdown via moreOverflowAfter prop', () => {
    expect(src).toMatch(/moreOverflowAfter\?:\s*number/)
    expect(src).toMatch(/aria-haspopup="true"/)
    expect(src).toMatch(/ChevronDown/)
  })

  it('More dropdown dismisses on click-outside + Escape', () => {
    expect(src).toMatch(/mousedown/)
    expect(src).toMatch(/'Escape'/)
  })
})

describe('v2.3.0 LeagueDetailsPanel tabification', () => {
  const src = read('src/components/LeagueDetailsPanel.tsx')

  it('imports the shared Tabs primitive', () => {
    expect(src).toMatch(/import \{ Tabs, type TabDef \} from '@\/components\/ui\/Tabs'/)
  })

  it('drops the v1.75.1 ChevronDown / expanded-state imports', () => {
    expect(src).not.toMatch(/import \{ ChevronDown \} from 'lucide-react'/)
    // useState is still imported for the active-tab state, but it must
    // NOT be called with `preseasonMode` (the pre-v2.3.0 collapsed-state
    // initializer).
    expect(src).not.toMatch(/useState\(preseasonMode\)/)
  })

  it('always builds a Rules tab (Rules is the baseline tab — never conditional)', () => {
    expect(src).toMatch(
      /tabs\.push\(\{ id: 'rules'[\s\S]*?testid: 'league-details-tab-rules' \}\)/,
    )
  })

  it('Season info tab is conditional on showSeasonTab', () => {
    expect(src).toMatch(
      /showSeasonTab\)\s*\{\s*tabs\.push\(\{ id: 'season'[\s\S]*?testid: 'league-details-tab-season' \}\)/,
    )
  })

  it('Organizer tab is conditional on showMessage', () => {
    expect(src).toMatch(
      /showMessage\)\s*\{\s*tabs\.push\(\{ id: 'organizer'[\s\S]*?testid: 'league-details-tab-organizer' \}\)/,
    )
  })

  it('default active tab is Season info in preseasonMode (when available), otherwise Rules', () => {
    expect(src).toMatch(
      /preseasonMode\s*&&\s*showSeasonTab\s*\?\s*'season'\s*:\s*'rules'/,
    )
  })

  it('safe-fallbacks the active tab id to Rules when the configured tab is gone', () => {
    // Defensive — preseasonMode + showSeasonTab=true → preselect 'season',
    // then plannedRosterStats may drop to null on a later render, removing
    // the Season tab. The fallback keeps the panel from rendering an empty
    // body.
    expect(src).toMatch(/tabs\.some\(\(t\) => t\.id === activeId\)\s*\?\s*activeId\s*:\s*'rules'/)
  })

  it('preserves the existing data-testid="league-details-panel" wrapper for outer-section tests', () => {
    expect(src).toMatch(/data-testid="league-details-panel"/)
  })

  it('preserves the league-details-rules-section + league-stats-section testids inside the tab panels', () => {
    expect(src).toMatch(/data-testid="league-details-rules-section"/)
    expect(src).toMatch(/data-testid="league-stats-section"/)
  })

  it('preserves the league-details-organizer-message wrapper testid', () => {
    expect(src).toMatch(/data-testid="league-details-organizer-message"/)
  })
})

describe('v2.3.0 Dashboard skeleton mirrors the new tab footprint', () => {
  const dash = read('src/components/Dashboard.tsx')

  it('keeps the league-details-panel-skeleton testid (perf-phase regression target)', () => {
    expect(dash).toMatch(/data-testid="league-details-panel-skeleton"/)
  })

  it('skeleton drops the v1.75.1 chevron-header silhouette in favor of a tab-strip silhouette', () => {
    // Find the skeleton block and assert it contains a tab-strip border
    // + multiple pill placeholders, not the single label + chevron.
    const idx = dash.indexOf('league-details-panel-skeleton')
    expect(idx).toBeGreaterThan(0)
    const block = dash.slice(idx, idx + 1200)
    expect(block).toMatch(/border-b border-border-default/)
    // Three tab placeholders (Rules / Season info / Organizer).
    const pillMatches = block.match(/h-3 w-\d+ rounded bg-surface-md/g) ?? []
    expect(pillMatches.length).toBeGreaterThanOrEqual(3)
  })
})

describe('v2.3.0 stash-pop regression target', () => {
  it('version is 2.3.0 or later', () => {
    const v = read('src/lib/version.ts')
    expect(v).toMatch(
      /APP_VERSION\s*=\s*'(?:2\.(?:[3-9]|\d{2,})\.\d+|[3-9]\.\d+\.\d+|\d{2,}\.\d+\.\d+)'/,
    )
  })
})
