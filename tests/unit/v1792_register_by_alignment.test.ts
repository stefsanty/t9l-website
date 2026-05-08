/**
 * v1.79.2 — Fix Register By row alignment in LeagueDetailsPanel.
 *
 * Season Fee and Register By are now SEPARATE rows, each using the same
 * col-span-2 + flex justify-between pattern as the other stats rows.
 * Previously they were combined onto one flex line (v1.75.6), which caused
 * misalignment relative to the table-style Teams / Roster Size / etc. rows.
 *
 * Row order in the bottom stats subsection:
 *   1. Season Fee    (col-span-2, flex justify-between)
 *   2. Register By   (col-span-2, flex justify-between)  ← split out here
 *   3. Teams
 *   4. Roster Size
 *   5. Matchdays
 *   6. Spots Left
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('v1.79.2 Season Fee is a separate, table-aligned row', () => {
  const src = read('src/components/LeagueDetailsPanel.tsx')

  it('season-fee-row element itself has col-span-2 (full-width grid row)', () => {
    const idx = src.indexOf('"season-fee-row"')
    expect(idx).toBeGreaterThan(-1)
    // col-span-2 must appear on the same opening tag as the testid
    const nearTag = src.slice(Math.max(0, idx - 120), idx + 20)
    expect(nearTag).toMatch(/col-span-2/)
  })

  it('season-fee-row element itself has flex justify-between (matches Row pattern)', () => {
    const idx = src.indexOf('"season-fee-row"')
    const nearTag = src.slice(Math.max(0, idx - 120), idx + 20)
    expect(nearTag).toMatch(/justify-between/)
  })

  it('season-fee-row is gated on showFee alone (not the combined showFee || showDeadline)', () => {
    // Regression target: the old combined gate was (showFee || showDeadline).
    // In the split layout each row is gated independently.
    expect(src).not.toMatch(/\(showFee \|\| showDeadline\)/)
    expect(src).toMatch(/showFee &&[\s\S]{0,200}season-fee-row/)
  })
})

describe('v1.79.2 Register By is a separate, table-aligned row', () => {
  const src = read('src/components/LeagueDetailsPanel.tsx')

  it('deadline-row element itself has col-span-2 (own full-width grid row)', () => {
    const idx = src.indexOf('"deadline-row"')
    expect(idx).toBeGreaterThan(-1)
    // col-span-2 must appear on the same opening tag as the testid
    const nearTag = src.slice(Math.max(0, idx - 120), idx + 20)
    expect(nearTag).toMatch(/col-span-2/)
  })

  it('deadline-row element itself has flex justify-between (matches Row pattern)', () => {
    const idx = src.indexOf('"deadline-row"')
    const nearTag = src.slice(Math.max(0, idx - 120), idx + 20)
    expect(nearTag).toMatch(/justify-between/)
  })

  it('deadline-row is NOT nested inside season-fee-row (regression: combined line re-introduced)', () => {
    // In the split layout, season-fee-row closes before deadline-row opens.
    // The closing </div> of season-fee-row comes well before deadline-row.
    // Assert: within 200 chars after the season-fee-row testid, deadline-row does NOT appear.
    const feeIdx = src.indexOf('"season-fee-row"')
    const within = src.slice(feeIdx + '"season-fee-row"'.length, feeIdx + 200)
    expect(within).not.toMatch(/deadline-row/)
  })
})

describe('v1.79.2 row ordering in stats section', () => {
  const src = read('src/components/LeagueDetailsPanel.tsx')

  it('Season Fee row appears before Register By row', () => {
    const feeIdx = src.indexOf('"season-fee-row"')
    const deadlineIdx = src.indexOf('"deadline-row"')
    expect(feeIdx).toBeGreaterThan(-1)
    expect(deadlineIdx).toBeGreaterThan(-1)
    expect(feeIdx).toBeLessThan(deadlineIdx)
  })

  it('Register By row appears before Teams row', () => {
    const deadlineIdx = src.indexOf('"deadline-row"')
    const teamsIdx = src.indexOf('"planned-teams-row"')
    expect(deadlineIdx).toBeLessThan(teamsIdx)
  })

  it('all four rows appear inside league-stats-section', () => {
    const statsIdx = src.indexOf('league-stats-section')
    expect(src.indexOf('"season-fee-row"')).toBeGreaterThan(statsIdx)
    expect(src.indexOf('"deadline-row"')).toBeGreaterThan(statsIdx)
    expect(src.indexOf('"planned-teams-row"')).toBeGreaterThan(statsIdx)
    expect(src.indexOf('"matchdays-row"')).toBeGreaterThan(statsIdx)
  })
})

describe('v1.79.2 stash-pop regression targets', () => {
  it('APP_VERSION is 1.79.2', () => {
    const v = read('src/lib/version.ts')
    expect(v).toMatch(/APP_VERSION\s*=\s*'1\.79\.2'/)
  })

  it('deadline-row has col-span-2 on its own element (stash-pop gate)', () => {
    const src = read('src/components/LeagueDetailsPanel.tsx')
    const idx = src.indexOf('"deadline-row"')
    const nearTag = src.slice(Math.max(0, idx - 120), idx + 20)
    expect(nearTag).toMatch(/col-span-2/)
  })

  it('combined (showFee || showDeadline) gate is gone (stash-pop gate)', () => {
    const src = read('src/components/LeagueDetailsPanel.tsx')
    expect(src).not.toMatch(/\(showFee \|\| showDeadline\)/)
  })
})
