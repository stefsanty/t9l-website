/**
 * v1.65.2 — Read-source flag.
 *
 * Tests pin:
 *   1. APP_VERSION bumped to 1.65.2.
 *   2. New `Setting('player-data.read-source')` helper exists with the
 *      right discriminated-union shape ('legacy' | 'plm') and defaults to
 *      'legacy'.
 *   3. `getRecruitingViewerState` honors the flag — branches on the
 *      Setting value before consulting legacy Player.* fields.
 *   4. Defensive fallback to 'legacy' on Settings read failure.
 *   5. Parity: under v1.65.1 dual-write, legacy and plm paths return
 *      the same result for the same fixture (no behavior shift on flag
 *      flip).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  resolvePlayerDataReadSource,
  SETTING_ID_PLAYER_DATA_READ_SOURCE,
  type PlayerDataReadSource,
} from '@/lib/settings'

const REPO_ROOT = join(__dirname, '..', '..')
const VERSION_SRC = readFileSync(join(REPO_ROOT, 'src/lib/version.ts'), 'utf8')
const SETTINGS_SRC = readFileSync(join(REPO_ROOT, 'src/lib/settings.ts'), 'utf8')
const VIEWER_STATE_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/recruitingViewerState.ts'),
  'utf8',
)

describe('v1.65.2 — APP_VERSION bumped (chain ships sequentially)', () => {
  it('APP_VERSION is at least 1.65.2', () => {
    // Match any v1.65.[2-9] OR any higher minor.
    expect(VERSION_SRC).toMatch(/APP_VERSION\s*=\s*['"](?:1\.(?:65\.[2-9]|6[6-9]\.\d+|[7-9]\d?\.\d+)|2\.\d+\.\d+)['"]/)
  })
})

describe('v1.65.2 — Setting helper', () => {
  it('exports the discriminated PlayerDataReadSource union type', () => {
    expect(SETTINGS_SRC).toMatch(
      /export type PlayerDataReadSource\s*=\s*['"]legacy['"]\s*\|\s*['"]plm['"]/,
    )
  })

  it('exports the canonical Setting row id constant', () => {
    expect(SETTING_ID_PLAYER_DATA_READ_SOURCE).toBe(
      's-playerData-readSource-global',
    )
    expect(SETTINGS_SRC).toMatch(
      /SETTING_ID_PLAYER_DATA_READ_SOURCE\s*=\s*['"]s-playerData-readSource-global['"]/,
    )
  })

  it('exports getPlayerDataReadSource cached helper', () => {
    expect(SETTINGS_SRC).toMatch(/export const getPlayerDataReadSource\s*=\s*unstable_cache/)
    expect(SETTINGS_SRC).toMatch(/setting:playerData:readSource:global/)
  })

  it('caches under the settings tag with 30s TTL', () => {
    expect(SETTINGS_SRC).toMatch(/revalidate:\s*30,\s*tags:\s*\[['"]settings['"]\]/)
  })
})

describe('v1.65.3 — resolvePlayerDataReadSource pure helper (default flipped)', () => {
  // v1.65.3 — default flipped from 'legacy' to 'plm'. Only literal
  // 'legacy' returns 'legacy'; everything else returns 'plm'.
  it('returns "plm" on the literal "plm" string', () => {
    expect(resolvePlayerDataReadSource('plm')).toBe('plm')
  })

  it('returns "plm" on null (v1.65.3 default flip)', () => {
    expect(resolvePlayerDataReadSource(null)).toBe('plm')
  })

  it('returns "plm" on undefined (v1.65.3 default flip)', () => {
    expect(resolvePlayerDataReadSource(undefined)).toBe('plm')
  })

  it('returns "legacy" on the literal "legacy" string (revert path)', () => {
    expect(resolvePlayerDataReadSource('legacy')).toBe('legacy')
  })

  it('returns "plm" on any unknown string (typos land on the new default)', () => {
    expect(resolvePlayerDataReadSource('some-other-value')).toBe('plm')
    expect(resolvePlayerDataReadSource('LEGACY')).toBe('plm') // case-sensitive — only literal lowercase 'legacy' reverts
    expect(resolvePlayerDataReadSource('Legacy')).toBe('plm')
    expect(resolvePlayerDataReadSource('')).toBe('plm')
  })

  it('return type narrows to the union literal', () => {
    const v: PlayerDataReadSource = resolvePlayerDataReadSource('plm')
    expect(v === 'plm' || v === 'legacy').toBe(true)
  })
})

describe('v1.65.3 — getPlayerDataReadSource defensive fallback (default flipped)', () => {
  it('falls back to "plm" on Settings read failure (v1.65.3 default)', () => {
    // v1.65.3 — Settings outage falls back to 'plm' (the new default),
    // not 'legacy'. The dual-write through v1.65.4 keeps Player.* in
    // sync so a transient Settings outage doesn't break reads.
    expect(SETTINGS_SRC).toMatch(/getPlayerDataReadSource[\s\S]*?try\s*\{/)
    expect(SETTINGS_SRC).toMatch(
      /catch\s*\(err\)[\s\S]*?return\s+['"]plm['"]/,
    )
  })
})

describe('v1.65.4 — getRecruitingViewerState is PLM-only (flag dispatch removed)', () => {
  // v1.65.2 added a `getPlayerDataReadSource()` flag dispatch into the
  // viewer-state resolver to gate the legacy Player.* fallback. v1.65.4
  // dropped the legacy fields, so the flag dispatch is gone — only the
  // PLM path remains. The Setting helper is preserved in lib/settings.ts
  // for backwards compat (no consumer reads it post-v1.65.4).
  it('viewer-state no longer imports getPlayerDataReadSource', () => {
    const exec = VIEWER_STATE_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(exec).not.toMatch(/getPlayerDataReadSource/)
  })

  it('viewer-state no longer references readSource', () => {
    const exec = VIEWER_STATE_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(exec).not.toMatch(/readSource/)
  })

  it('Setting helper survives in lib/settings.ts for backwards compat', () => {
    // The helper itself stays exported (other code may still import it).
    expect(SETTINGS_SRC).toMatch(/export const getPlayerDataReadSource/)
  })

  it('PLM signals still fire (PENDING + APPROVED) — only path post-v1.65.4', () => {
    // approvedPlm and pendingPlm are not gated on readSource — they always fire
    // when the PLM data says so.
    expect(VIEWER_STATE_SRC).toMatch(/const approvedPlm\s*=/)
    expect(VIEWER_STATE_SRC).toMatch(/const pendingPlm\s*=/)
  })
})
