/**
 * v1.79.2 — Fix Register By row alignment in LeagueDetailsPanel.
 *
 * Originally asserted Season Fee and Register By were SEPARATE rows.
 * v1.79.3 reverted to combined row with dual dt/dd pairs
 * (season-fee-register-by-row). Tests updated to pin current contract:
 * the combined row uses col-span-2 + flex justify-between, with both
 * Season Fee and Register By inside it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('v1.79.3 combined Season Fee + Register By row (updated from v1.79.2)', () => {
  const src = read('src/components/LeagueDetailsPanel.tsx')

  it('season-fee-register-by-row element has col-span-2 (full-width grid row)', () => {
    const idx = src.indexOf('"season-fee-register-by-row"')
    expect(idx).toBeGreaterThan(-1)
    const nearTag = src.slice(Math.max(0, idx - 120), idx + 30)
    expect(nearTag).toMatch(/col-span-2/)
  })

  it('season-fee-register-by-row element has flex justify-between', () => {
    const idx = src.indexOf('"season-fee-register-by-row"')
    const nearTag = src.slice(Math.max(0, idx - 120), idx + 30)
    expect(nearTag).toMatch(/justify-between/)
  })

  it('combined row is gated on (showFee || showDeadline)', () => {
    expect(src).toMatch(/\(showFee \|\| showDeadline\)[\s\S]{0,200}season-fee-register-by-row/)
  })

  it('Season Fee appears before Register By inside combined row', () => {
    const rowIdx = src.indexOf('"season-fee-register-by-row"')
    const block = src.slice(rowIdx, rowIdx + 1200)
    const feeIdx = block.indexOf('Season Fee')
    const regIdx = block.indexOf('Register By')
    expect(feeIdx).toBeGreaterThan(-1)
    expect(regIdx).toBeGreaterThan(-1)
    expect(feeIdx).toBeLessThan(regIdx)
  })
})

describe('v1.79.3 row ordering in stats section', () => {
  const src = read('src/components/LeagueDetailsPanel.tsx')

  it('combined row appears before Teams row', () => {
    const feeIdx = src.indexOf('"season-fee-register-by-row"')
    const teamsIdx = src.indexOf('"planned-teams-row"')
    expect(feeIdx).toBeGreaterThan(-1)
    expect(teamsIdx).toBeGreaterThan(-1)
    expect(feeIdx).toBeLessThan(teamsIdx)
  })

  it('combined row appears inside league-stats-section', () => {
    const statsIdx = src.indexOf('league-stats-section')
    expect(src.indexOf('"season-fee-register-by-row"')).toBeGreaterThan(statsIdx)
    expect(src.indexOf('"planned-teams-row"')).toBeGreaterThan(statsIdx)
    expect(src.indexOf('"matchdays-row"')).toBeGreaterThan(statsIdx)
  })
})

describe('v1.79.3 stash-pop regression targets', () => {
  it('APP_VERSION is 1.79.3', () => {
    const v = read('src/lib/version.ts')
    expect(v).toMatch(/APP_VERSION\s*=\s*'1\.79\.3'/)
  })

  it('combined row testid exists (stash-pop gate)', () => {
    const src = read('src/components/LeagueDetailsPanel.tsx')
    expect(src).toContain('"season-fee-register-by-row"')
  })

  it('old separate-row testids are gone (regression: re-splitting would break combined layout)', () => {
    const src = read('src/components/LeagueDetailsPanel.tsx')
    expect(src).not.toContain('"season-fee-row"')
    expect(src).not.toContain('"deadline-row"')
  })
})
