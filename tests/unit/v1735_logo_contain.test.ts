/**
 * v1.73.5 — Team logo uses object-contain (scale-to-fit) in CompressedMatchdaySchedule.
 *
 * Regression target: object-cover was cropping logos with custom images (e.g.
 * Mariners FC). The fix flips the img to object-contain so logos scale to fit
 * the 16×16 container without cropping.
 *
 * Stash-pop: reverting the component fix makes the object-cover assertion fail.
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const src = fs.readFileSync(
  path.resolve(__dirname, '../../src/components/CompressedMatchdaySchedule.tsx'),
  'utf8',
)

describe('v1.73.5 — CompressedMatchdaySchedule logo object-contain', () => {
  it('team logo img uses object-contain (no cropping)', () => {
    expect(src).toMatch(/className="w-4 h-4 rounded-sm object-contain/)
  })

  it('object-cover is NOT present on the team logo img (regression target)', () => {
    // If this fails, the fix was reverted and logos will crop again.
    const imgBlock = src.slice(src.indexOf('function TeamLogo'), src.indexOf('function CompressedMatchdaySchedule'))
    expect(imgBlock).not.toMatch(/object-cover/)
  })

  it('version is at v1.73.5 or later (the floor where this fix landed)', () => {
    // Pinning the literal `1.73.5` would force every subsequent patch in the
    // same minor to also touch this file (see v1.69.1 ledger). Relaxed to a
    // floor check: any v1.73.x ≥ .5 OR any v1.74+ passes.
    const version = fs.readFileSync(
      path.resolve(__dirname, '../../src/lib/version.ts'),
      'utf8',
    )
    const m = version.match(/APP_VERSION = '(\d+)\.(\d+)\.(\d+)'/)
    expect(m).not.toBeNull()
    const [maj, min, patch] = [Number(m![1]), Number(m![2]), Number(m![3])]
    const ok = maj > 1 || (maj === 1 && min > 73) || (maj === 1 && min === 73 && patch >= 5)
    expect(ok).toBe(true)
  })
})
