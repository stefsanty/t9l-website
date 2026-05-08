/**
 * v1.79.3 — Season Fee + Register By on ONE combined row using dual dt/dd pairs.
 *
 * When both values are present: a single flex justify-between row with
 * two dt/dd pairs (Season Fee label → value → Register By label → value).
 * When only one is present: the same row element is rendered with just
 * that one dt/dd pair (gate is `showFee || showDeadline`).
 *
 * Regression target: v1.79.2 used separate rows (season-fee-row +
 * deadline-row each with col-span-2). Those testids must be gone.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('v1.79.3 Season Fee + Register By combined row', () => {
  const src = read('src/components/LeagueDetailsPanel.tsx')

  it('season-fee-register-by-row testid exists', () => {
    expect(src).toContain('"season-fee-register-by-row"')
  })

  it('season-fee-register-by-row uses flex justify-between items-baseline', () => {
    const idx = src.indexOf('"season-fee-register-by-row"')
    const nearTag = src.slice(Math.max(0, idx - 150), idx + 30)
    expect(nearTag).toMatch(/flex/)
    expect(nearTag).toMatch(/justify-between/)
    expect(nearTag).toMatch(/items-baseline/)
  })

  it('season-fee-register-by-row is gated on (showFee || showDeadline)', () => {
    expect(src).toMatch(/\(showFee \|\| showDeadline\)[\s\S]{0,200}season-fee-register-by-row/)
  })

  it('Season Fee dt is inside the combined row', () => {
    const rowIdx = src.indexOf('"season-fee-register-by-row"')
    const afterRow = src.slice(rowIdx)
    // find closing div of the combined row — Season Fee dt should appear before it
    const feeIdx = afterRow.indexOf('Season Fee')
    const registerIdx = afterRow.indexOf('Register By')
    expect(feeIdx).toBeGreaterThan(-1)
    expect(registerIdx).toBeGreaterThan(-1)
  })

  it('Season Fee label appears before Register By label', () => {
    const rowIdx = src.indexOf('"season-fee-register-by-row"')
    const afterRow = src.slice(rowIdx)
    const feeIdx = afterRow.indexOf('Season Fee')
    const registerIdx = afterRow.indexOf('Register By')
    expect(feeIdx).toBeLessThan(registerIdx)
  })

  it('both Season Fee and Register By use <dt> elements (not <p> or <span>)', () => {
    const rowIdx = src.indexOf('"season-fee-register-by-row"')
    // Use a 1200-char window to cover both dt/dd pairs (multi-line JSX)
    const block = src.slice(rowIdx, rowIdx + 1200)
    expect(block).toMatch(/<dt[^>]*>[\s\S]*?Season Fee/)
    expect(block).toMatch(/<dt[^>]*>[\s\S]*?Register By/)
  })
})

describe('v1.79.3 regression targets — v1.79.2 separate-row testids are gone', () => {
  const src = read('src/components/LeagueDetailsPanel.tsx')

  it('season-fee-row testid is GONE (regression: re-introducing separate row)', () => {
    expect(src).not.toContain('"season-fee-row"')
  })

  it('deadline-row testid is GONE (regression: re-introducing separate row)', () => {
    expect(src).not.toContain('"deadline-row"')
  })
})

describe('v1.79.3 single-value fallback', () => {
  const src = read('src/components/LeagueDetailsPanel.tsx')

  it('showFee inner fragment is gated on showFee (only renders fee when fee present)', () => {
    // Within the combined row block, showFee gates the Season Fee dt/dd pair
    const rowIdx = src.indexOf('"season-fee-register-by-row"')
    const block = src.slice(rowIdx, rowIdx + 1200)
    expect(block).toMatch(/showFee[\s\S]{0,300}Season Fee/)
  })

  it('showDeadline inner fragment is gated on showDeadline (only renders deadline when present)', () => {
    const rowIdx = src.indexOf('"season-fee-register-by-row"')
    const block = src.slice(rowIdx, rowIdx + 1200)
    expect(block).toMatch(/showDeadline[\s\S]{0,400}Register By/)
  })
})

describe('v1.79.3 version bump', () => {
  it('APP_VERSION is 1.79.3', () => {
    const v = read('src/lib/version.ts')
    expect(v).toMatch(/APP_VERSION\s*=\s*'1\.79\.3'/)
  })

  it('stash-pop gate: combined row exists, separate rows are gone', () => {
    const src = read('src/components/LeagueDetailsPanel.tsx')
    expect(src).toContain('"season-fee-register-by-row"')
    expect(src).not.toContain('"season-fee-row"')
    expect(src).not.toContain('"deadline-row"')
  })
})
