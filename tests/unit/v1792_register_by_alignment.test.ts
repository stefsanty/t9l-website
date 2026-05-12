/**
 * v1.79.2 — Fix Register By row alignment in LeagueDetailsPanel.
 *
 * Originally asserted Season Fee and Register By were SEPARATE rows.
 * v1.79.3 combined them; v1.79.4 reverted back to SEPARATE rows.
 * Tests now pin the v1.79.4 contract: two independent rows,
 * season-fee-row and register-by-row, each with one dt/dd pair.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('v1.79.4 separate Season Fee and Register By rows (updated from v1.79.2)', () => {
  const src = read('src/components/LeagueDetailsPanel.tsx')

  it('season-fee-row element has flex justify-between items-baseline', () => {
    const idx = src.indexOf('"season-fee-row"')
    expect(idx).toBeGreaterThan(-1)
    const nearTag = src.slice(Math.max(0, idx - 120), idx + 30)
    expect(nearTag).toMatch(/flex/)
    expect(nearTag).toMatch(/justify-between/)
    expect(nearTag).toMatch(/items-baseline/)
  })

  it('register-by-row element has flex justify-between items-baseline', () => {
    const idx = src.indexOf('"register-by-row"')
    expect(idx).toBeGreaterThan(-1)
    const nearTag = src.slice(Math.max(0, idx - 120), idx + 30)
    expect(nearTag).toMatch(/flex/)
    expect(nearTag).toMatch(/justify-between/)
    expect(nearTag).toMatch(/items-baseline/)
  })

  it('season-fee-row is gated on showFee', () => {
    expect(src).toMatch(/showFee[\s\S]{0,200}season-fee-row/)
  })

  it('register-by-row is gated on showDeadline', () => {
    expect(src).toMatch(/showDeadline[\s\S]{0,200}register-by-row/)
  })

  it('Season Fee label is in season-fee-row', () => {
    const rowIdx = src.indexOf('"season-fee-row"')
    const block = src.slice(rowIdx, rowIdx + 600)
    expect(block).toMatch(/Season Fee/)
  })

  it('Register By label is in register-by-row', () => {
    const rowIdx = src.indexOf('"register-by-row"')
    const block = src.slice(rowIdx, rowIdx + 600)
    expect(block).toMatch(/Register By/)
  })
})

describe('v1.79.4 row ordering in stats section', () => {
  const src = read('src/components/LeagueDetailsPanel.tsx')

  it('season-fee-row appears before Teams row', () => {
    const feeIdx = src.indexOf('"season-fee-row"')
    const teamsIdx = src.indexOf('"planned-teams-row"')
    expect(feeIdx).toBeGreaterThan(-1)
    expect(teamsIdx).toBeGreaterThan(-1)
    expect(feeIdx).toBeLessThan(teamsIdx)
  })

  it('register-by-row appears before Teams row', () => {
    const regIdx = src.indexOf('"register-by-row"')
    const teamsIdx = src.indexOf('"planned-teams-row"')
    expect(regIdx).toBeGreaterThan(-1)
    expect(teamsIdx).toBeGreaterThan(-1)
    expect(regIdx).toBeLessThan(teamsIdx)
  })

  it('season-fee-row appears inside league-stats-section', () => {
    const statsIdx = src.indexOf('league-stats-section')
    expect(src.indexOf('"season-fee-row"')).toBeGreaterThan(statsIdx)
    expect(src.indexOf('"planned-teams-row"')).toBeGreaterThan(statsIdx)
    expect(src.indexOf('"matchdays-row"')).toBeGreaterThan(statsIdx)
  })
})

describe('v1.79.4 stash-pop regression targets', () => {
  it('APP_VERSION is 1.79.4 or later', () => {
    const v = read('src/lib/version.ts')
    expect(v).toMatch(/APP_VERSION\s*=\s*'1\.(79\.[4-9]|[89]\d+\.\d+|\d{3,}\.\d+)'|'[2-9]\.\d+\.\d+'/)
  })

  it('separate row testids exist (stash-pop gate)', () => {
    const src = read('src/components/LeagueDetailsPanel.tsx')
    expect(src).toContain('"season-fee-row"')
    expect(src).toContain('"register-by-row"')
  })

  it('combined row testid is gone (regression: re-combining would break separate layout)', () => {
    const src = read('src/components/LeagueDetailsPanel.tsx')
    expect(src).not.toContain('"season-fee-register-by-row"')
  })
})
