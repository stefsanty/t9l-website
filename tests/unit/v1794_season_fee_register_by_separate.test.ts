/**
 * v1.79.4 — Season Fee and Register By as TWO separate rows.
 *
 * Each is its own <div class="flex justify-between items-baseline"> with
 * one <dt>/<dd> pair, matching the Teams / Roster Size / Matchdays /
 * Spots Left pattern exactly.
 *
 * Regression target: v1.79.3 used a single combined row
 * (season-fee-register-by-row) with two dt/dd pairs and col-span-2.
 * That testid must be gone; the two separate testids must be present.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('v1.79.4 — season-fee-row exists as a separate row', () => {
  const src = read('src/components/LeagueDetailsPanel.tsx')

  it('season-fee-row testid exists', () => {
    expect(src).toContain('"season-fee-row"')
  })

  it('season-fee-row uses flex justify-between items-baseline', () => {
    const idx = src.indexOf('"season-fee-row"')
    const nearTag = src.slice(Math.max(0, idx - 150), idx + 30)
    expect(nearTag).toMatch(/flex/)
    expect(nearTag).toMatch(/justify-between/)
    expect(nearTag).toMatch(/items-baseline/)
  })

  it('season-fee-row does NOT have col-span-2', () => {
    const idx = src.indexOf('"season-fee-row"')
    const nearTag = src.slice(Math.max(0, idx - 150), idx + 30)
    expect(nearTag).not.toMatch(/col-span-2/)
  })

  it('season-fee-row is gated on showFee', () => {
    expect(src).toMatch(/showFee[\s\S]{0,200}season-fee-row/)
  })

  it('season-fee-row contains exactly one <dt> with Season Fee label', () => {
    const idx = src.indexOf('"season-fee-row"')
    const block = src.slice(idx, idx + 600)
    expect(block).toMatch(/<dt[^>]*>[\s\S]*?Season Fee/)
  })

  it('season-fee-row contains exactly one <dd> with fee value', () => {
    const idx = src.indexOf('"season-fee-row"')
    const block = src.slice(idx, idx + 600)
    expect(block).toMatch(/<dd[^>]*>[\s\S]*?formatJpyFee/)
  })
})

describe('v1.79.4 — register-by-row exists as a separate row', () => {
  const src = read('src/components/LeagueDetailsPanel.tsx')

  it('register-by-row testid exists', () => {
    expect(src).toContain('"register-by-row"')
  })

  it('register-by-row uses flex justify-between items-baseline', () => {
    const idx = src.indexOf('"register-by-row"')
    const nearTag = src.slice(Math.max(0, idx - 150), idx + 30)
    expect(nearTag).toMatch(/flex/)
    expect(nearTag).toMatch(/justify-between/)
    expect(nearTag).toMatch(/items-baseline/)
  })

  it('register-by-row does NOT have col-span-2', () => {
    const idx = src.indexOf('"register-by-row"')
    const nearTag = src.slice(Math.max(0, idx - 150), idx + 30)
    expect(nearTag).not.toMatch(/col-span-2/)
  })

  it('register-by-row is gated on showDeadline', () => {
    expect(src).toMatch(/showDeadline[\s\S]{0,200}register-by-row/)
  })

  it('register-by-row contains exactly one <dt> with Register By label', () => {
    const idx = src.indexOf('"register-by-row"')
    const block = src.slice(idx, idx + 600)
    expect(block).toMatch(/<dt[^>]*>[\s\S]*?Register By/)
  })

  it('register-by-row contains exactly one <dd> with deadline value', () => {
    const idx = src.indexOf('"register-by-row"')
    const block = src.slice(idx, idx + 600)
    expect(block).toMatch(/<dd[^>]*>[\s\S]*?formatJstFriendly/)
  })
})

describe('v1.79.4 — season-fee-row appears before register-by-row', () => {
  const src = read('src/components/LeagueDetailsPanel.tsx')

  it('Season Fee row comes before Register By row in source', () => {
    const feeIdx = src.indexOf('"season-fee-row"')
    const regIdx = src.indexOf('"register-by-row"')
    expect(feeIdx).toBeGreaterThan(-1)
    expect(regIdx).toBeGreaterThan(-1)
    expect(feeIdx).toBeLessThan(regIdx)
  })
})

describe('v1.79.4 regression targets — v1.79.3 combined-row testid is gone', () => {
  const src = read('src/components/LeagueDetailsPanel.tsx')

  it('season-fee-register-by-row testid is GONE (regression: combined row from v1.79.3)', () => {
    expect(src).not.toContain('"season-fee-register-by-row"')
  })

  it('deadline-row testid is GONE (was never in v1.79.3, stays gone)', () => {
    expect(src).not.toContain('"deadline-row"')
  })
})

describe('v1.79.4 version bump', () => {
  it('APP_VERSION is 1.79.4 or later', () => {
    const v = read('src/lib/version.ts')
    expect(v).toMatch(/APP_VERSION\s*=\s*'1\.(79\.[4-9]|[89]\d+\.\d+|\d{3,}\.\d+)'/)
  })

  it('stash-pop gate: separate rows exist, combined row is gone', () => {
    const src = read('src/components/LeagueDetailsPanel.tsx')
    expect(src).toContain('"season-fee-row"')
    expect(src).toContain('"register-by-row"')
    expect(src).not.toContain('"season-fee-register-by-row"')
  })
})
