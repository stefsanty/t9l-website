/**
 * v1.65.3 — Membership-spec rework, stage 3 default flip.
 *
 * v1.65.2 shipped the read-source flag with default 'legacy' (inert).
 * v1.65.3 flips the default to 'plm' — every authenticated session
 * post-deploy reads from the new PlayerLeagueMembership.* fields by
 * default. Operator can revert via Setting row override.
 *
 * Tests pin:
 *   1. APP_VERSION bumped to 1.65.3.
 *   2. resolvePlayerDataReadSource defaults to 'plm' on null/undefined/unknown.
 *   3. Only the literal 'legacy' string returns 'legacy'.
 *   4. Defensive fallback returns 'plm' (not 'legacy') on Settings read failure.
 *
 * These pins together prove the "v1.65.3 deployed = reads use PLM by
 * default" invariant. A regression that flips the default back to
 * 'legacy' (without explicit Setting row override) would fail every
 * pin.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  resolvePlayerDataReadSource,
  type PlayerDataReadSource,
} from '@/lib/settings'

const REPO_ROOT = join(__dirname, '..', '..')
const VERSION_SRC = readFileSync(join(REPO_ROOT, 'src/lib/version.ts'), 'utf8')
const SETTINGS_SRC = readFileSync(join(REPO_ROOT, 'src/lib/settings.ts'), 'utf8')

describe('v1.65.3 — APP_VERSION bumped', () => {
  it('APP_VERSION is at least 1.65.3 (chain ships sequentially)', () => {
    // Match any v1.65.[3-9] OR any higher minor.
    expect(VERSION_SRC).toMatch(/APP_VERSION\s*=\s*['"]1\.(65\.[3-9]|6[6-9]\.\d+|[7-9]\d?\.\d+)['"]/)
  })
})

describe('v1.65.3 — resolvePlayerDataReadSource default flip', () => {
  it('null defaults to plm', () => {
    expect(resolvePlayerDataReadSource(null)).toBe('plm')
  })

  it('undefined defaults to plm', () => {
    expect(resolvePlayerDataReadSource(undefined)).toBe('plm')
  })

  it('only the literal "legacy" string returns legacy (revert path)', () => {
    expect(resolvePlayerDataReadSource('legacy')).toBe('legacy')
    // Case-sensitive — only lowercase exact match reverts.
    expect(resolvePlayerDataReadSource('LEGACY')).toBe('plm')
    expect(resolvePlayerDataReadSource('Legacy')).toBe('plm')
    expect(resolvePlayerDataReadSource('legacy ')).toBe('plm') // trailing space
    expect(resolvePlayerDataReadSource(' legacy')).toBe('plm') // leading space
  })

  it('"plm" returns plm (no-op for explicit operator-set value)', () => {
    expect(resolvePlayerDataReadSource('plm')).toBe('plm')
  })

  it('unknown strings default to plm (typos land safely)', () => {
    expect(resolvePlayerDataReadSource('foo')).toBe('plm')
    expect(resolvePlayerDataReadSource('')).toBe('plm')
    expect(resolvePlayerDataReadSource('null')).toBe('plm')
  })
})

describe('v1.65.3 — defensive fallback path', () => {
  it('catch branch returns plm (not legacy)', () => {
    // Pin the v1.65.3 fallback shape. A regression to v1.65.2's
    // `return 'legacy'` in the catch would re-introduce the
    // pre-flip default behavior on Settings outage.
    const catchBranchMatch = SETTINGS_SRC.match(
      /getPlayerDataReadSource[\s\S]*?catch\s*\(err\)\s*\{[\s\S]*?return\s+(['"][^'"]+['"])/,
    )
    expect(catchBranchMatch).not.toBeNull()
    expect(catchBranchMatch![1]).toBe(`'plm'`)
  })
})

describe('v1.65.3 — return-type sanity', () => {
  it('return type is PlayerDataReadSource', () => {
    const v: PlayerDataReadSource = resolvePlayerDataReadSource(undefined)
    expect(v === 'plm' || v === 'legacy').toBe(true)
    expect(v).toBe('plm') // v1.65.3 default
  })
})
