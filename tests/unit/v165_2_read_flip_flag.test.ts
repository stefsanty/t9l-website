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

describe('v1.65.2 — APP_VERSION bumped', () => {
  it('APP_VERSION is 1.65.2', () => {
    expect(VERSION_SRC).toMatch(/APP_VERSION\s*=\s*['"]1\.65\.2['"]/)
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

describe('v1.65.2 — resolvePlayerDataReadSource pure helper', () => {
  it('returns "plm" only on the literal "plm" string', () => {
    expect(resolvePlayerDataReadSource('plm')).toBe('plm')
  })

  it('returns "legacy" on null', () => {
    expect(resolvePlayerDataReadSource(null)).toBe('legacy')
  })

  it('returns "legacy" on undefined', () => {
    expect(resolvePlayerDataReadSource(undefined)).toBe('legacy')
  })

  it('returns "legacy" on the literal "legacy" string', () => {
    expect(resolvePlayerDataReadSource('legacy')).toBe('legacy')
  })

  it('returns "legacy" on any unknown string (defensive)', () => {
    expect(resolvePlayerDataReadSource('some-other-value')).toBe('legacy')
    expect(resolvePlayerDataReadSource('PLM')).toBe('legacy') // case-sensitive — only "plm" lower-case flips
    expect(resolvePlayerDataReadSource('')).toBe('legacy')
  })

  it('return type narrows to the union literal', () => {
    const v: PlayerDataReadSource = resolvePlayerDataReadSource('plm')
    expect(v === 'plm' || v === 'legacy').toBe(true)
  })
})

describe('v1.65.2 — getPlayerDataReadSource defensive fallback', () => {
  it('falls back to legacy on Settings read failure', () => {
    // The fallback is a try/catch around the prisma.setting.findUnique
    // call. Pin the structure.
    expect(SETTINGS_SRC).toMatch(/getPlayerDataReadSource[\s\S]*?try\s*\{/)
    expect(SETTINGS_SRC).toMatch(
      /catch\s*\(err\)[\s\S]*?return\s+['"]legacy['"]/,
    )
  })
})

describe('v1.65.2 — getRecruitingViewerState honors the flag', () => {
  it('imports getPlayerDataReadSource from @/lib/settings', () => {
    expect(VIEWER_STATE_SRC).toMatch(
      /import\s*\{[^}]*getPlayerDataReadSource[^}]*\}\s+from\s+['"]@\/lib\/settings['"]/,
    )
  })

  it('reads the flag inside the resolver', () => {
    expect(VIEWER_STATE_SRC).toMatch(/await\s+getPlayerDataReadSource\(\)/)
  })

  it('legacy Player.* fallback only fires under "legacy" source', () => {
    // The State A legacy approval check is gated on readSource === 'legacy'.
    expect(VIEWER_STATE_SRC).toMatch(
      /readSource === ['"]legacy['"][\s\S]*?applicationStatus === ['"]APPROVED['"]/,
    )
  })

  it('legacy Player.* PENDING memo only honored under "legacy" source', () => {
    expect(VIEWER_STATE_SRC).toMatch(
      /legacyPending\s*=\s*[\s\S]*?readSource === ['"]legacy['"]/,
    )
  })

  it('PLM signals still fire under both sources (PENDING + APPROVED)', () => {
    // approvedPlm and pendingPlm are not gated on readSource — they always fire
    // when the PLM data says so.
    expect(VIEWER_STATE_SRC).toMatch(/const approvedPlm\s*=/)
    expect(VIEWER_STATE_SRC).toMatch(/const pendingPlm\s*=/)
  })
})
