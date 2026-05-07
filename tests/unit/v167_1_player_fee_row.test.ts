/**
 * v1.67.1 — Player fee row in the PlannedRosterStats panel.
 *
 * Structural tests over the data fetcher + component shape. The fee
 * row hides when the league has no fee configured (defaultFee === 0
 * AND no per-position rows); per-position rows that match the default
 * are filtered out at the data layer to avoid noise.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('v1.67.1 PlannedRosterStats interface', () => {
  const src = read('src/lib/plannedRosterStats.ts')

  it('declares defaultFee on the interface', () => {
    expect(src).toMatch(/defaultFee:\s*number/)
  })

  it('declares positionFees as PlannedRosterPositionFee[]', () => {
    expect(src).toMatch(/positionFees:\s*PlannedRosterPositionFee\[\]/)
  })

  it('exports PlannedRosterPositionFee type with position + fee', () => {
    expect(src).toMatch(/export interface PlannedRosterPositionFee/)
    expect(src).toMatch(/position:\s*string/)
    expect(src).toMatch(/fee:\s*number/)
  })
})

describe('v1.67.1 getPlannedRosterStats fetches fee data', () => {
  const src = read('src/lib/plannedRosterStats.ts')

  it('selects defaultFee from League', () => {
    expect(src).toMatch(/defaultFee:\s*true/)
  })

  it('selects positionFees with position + fee', () => {
    expect(src).toMatch(/positionFees:\s*\{[\s\S]*select:\s*\{\s*position:\s*true,\s*fee:\s*true/)
  })

  it('filters position rows whose fee matches defaultFee (avoid noise)', () => {
    expect(src).toMatch(/\.filter\(\(p\)\s*=>\s*p\.fee\s*!==\s*league\.defaultFee\)/)
  })

  it('sorts position fees by position string for deterministic render', () => {
    expect(src).toMatch(/\.sort\(\(a,\s*b\)\s*=>\s*a\.position\.localeCompare\(b\.position\)\)/)
  })

  it('returns defaultFee + positionFees on the success path', () => {
    expect(src).toMatch(/defaultFee:\s*league\.defaultFee/)
    // positionFees is returned in the object (v1.75.6 adds matchdays after it).
    expect(src).toMatch(/positionFees,/)
  })
})

describe('v1.67.1 PlannedRosterStats component renders fee row', () => {
  const src = read('src/components/PlannedRosterStats.tsx')

  it('imports formatJpyFee from lib/playerFee', () => {
    expect(src).toMatch(/import\s+\{\s*formatJpyFee\s*\}\s+from\s+'@\/lib\/playerFee'/)
  })

  it('declares showFee gate based on defaultFee + positionFees.length', () => {
    expect(src).toMatch(
      /const showFee = data\.defaultFee > 0 \|\| data\.positionFees\.length > 0/,
    )
  })

  it('includes showFee in the all-empty hide rule', () => {
    // Regression: panel must hide when nothing is configured. Adding
    // fee data without updating the hide rule would cause an empty
    // panel to render whenever the panel is gated by auth + flags.
    expect(src).toMatch(/!showFee/)
  })

  it('renders the player-fee-row with the right testid', () => {
    expect(src).toMatch(/data-testid="player-fee-row"/)
  })

  it('renders the explanatory copy below the fee value', () => {
    expect(src).toMatch(/Player fee is used to pay referee volunteers/)
  })

  it('renders the position fee subtitles when positionFees is non-empty', () => {
    expect(src).toMatch(/data-testid="player-fee-position-rows"/)
    // Subtitle shape: "(GK – ¥5,000) (FP – ¥4,000)"
    expect(src).toMatch(/\(\{p\.position\} – \{formatJpyFee\(p\.fee\)\}\)/)
  })
})
