import { describe, it, expect } from 'vitest'
import {
  validatePreferredSecondary,
  MAX_PREFERRED_POSITIONS,
} from '@/lib/positions'

/**
 * v1.93.0 regression tests for:
 *   (A) max-3 cap on preferred positions, enforced server-side via
 *       `validatePreferredSecondary`.
 *   (B) presence of `League.idRequired` in the Prisma schema and the
 *       migration directory (existence-pin so the additive boolean stays
 *       in place).
 *   (C) admin LeagueDetailsEditor surface — the visible toggle wiring
 *       defended via grep against the source file.
 *   (D) onboarding form (RegistrationFields) — preferred/secondary
 *       split, max-3 cap UI, conditional ID upload, required-preferred
 *       gating. Defended via source-grep so the regression target is
 *       independent of jsdom rendering.
 *   (E) admin EditPlayerPanel + AddPlayerDialog + ApplyToLeagueModal —
 *       all carry the preferred/secondary split + cap.
 *
 * The behavioural pins go through `validatePreferredSecondary` directly;
 * the wiring pins use `fs.readFileSync` to assert the load-bearing
 * lines exist in the source (mirrors v1.85.0 `v1755_*` style).
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..', '..')

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

describe('[v1.93.0] MAX_PREFERRED_POSITIONS', () => {
  it('exports a constant equal to 3', () => {
    expect(MAX_PREFERRED_POSITIONS).toBe(3)
  })
})

describe('[v1.93.0] validatePreferredSecondary — preferred max cap', () => {
  it('accepts exactly 3 preferred', () => {
    const r = validatePreferredSecondary(['CB', 'CM', 'ST'], [], 'SOCCER')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.preferred).toEqual(['CB', 'CM', 'ST'])
  })

  it('rejects 4 preferred', () => {
    const r = validatePreferredSecondary(
      ['LB', 'CB', 'RB', 'CM'],
      [],
      'SOCCER',
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/at most 3/)
  })

  it('accepts 0 preferred (server-side enforces only the upper bound)', () => {
    const r = validatePreferredSecondary([], ['CB'], 'SOCCER')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.preferred).toEqual([])
    expect(r.secondary).toEqual(['CB'])
  })

  it('rejects 4 preferred even when secondary is empty', () => {
    const r = validatePreferredSecondary(
      ['LB', 'CB', 'RB', 'CM'],
      [],
      'SOCCER',
    )
    expect(r.ok).toBe(false)
  })

  it('dedup-within-preferred runs before cap (CM,CM,CM → 1, allowed)', () => {
    const r = validatePreferredSecondary(['CM', 'CM', 'CM'], [], 'SOCCER')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.preferred).toEqual(['CM'])
  })

  it('cap also applies to FUTSAL vocabulary', () => {
    // FUTSAL only has 4 codes; sending all 4 as preferred trips the cap.
    const r = validatePreferredSecondary(
      ['GK', 'FIXO', 'ALA', 'PIVOT'],
      [],
      'FUTSAL',
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/at most 3/)
  })

  it('invalid-code error still wins when cap would also fail', () => {
    const r = validatePreferredSecondary(
      ['BADCODE', 'CM', 'CB', 'ST'],
      [],
      'SOCCER',
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    // The cap message includes "at most 3"; the invalid-code message
    // does not — pin the invalid-code path so the cap doesn't shadow
    // upstream errors.
    expect(r.error).not.toMatch(/at most 3/)
  })
})

describe('[v1.93.0] League.idRequired — schema + migration presence', () => {
  it('prisma/schema.prisma declares `idRequired Boolean @default(true)`', () => {
    const src = read('prisma/schema.prisma')
    expect(src).toMatch(/idRequired\s+Boolean\s+@default\(true\)/)
  })

  it('migration directory exists with offline-diff SQL', () => {
    const dir = path.join(
      ROOT,
      'prisma',
      'migrations',
      '20260601000000_league_id_required',
    )
    expect(fs.existsSync(dir)).toBe(true)
    const sql = fs.readFileSync(path.join(dir, 'migration.sql'), 'utf8')
    expect(sql).toMatch(/ALTER TABLE "League" ADD COLUMN\s+"idRequired" BOOLEAN NOT NULL DEFAULT true/)
  })
})

describe('[v1.93.0] LeagueDetailsEditor wires idRequired toggle', () => {
  it('renders the toggle row with the expected testid', () => {
    const src = read('src/components/admin/LeagueDetailsEditor.tsx')
    expect(src).toContain('data-testid="league-details-id-required-toggle"')
    expect(src).toContain('data-testid="league-details-id-required-button"')
    expect(src).toContain('Require ID document on onboarding')
  })

  it('persists idRequired in handleSave via updateLeagueDetails', () => {
    const src = read('src/components/admin/LeagueDetailsEditor.tsx')
    // The save handler threads `idRequired` into the updateLeagueDetails
    // payload so the toggle actually persists.
    expect(src).toMatch(/idRequired,/)
  })

  it('SettingsTab accepts `idRequired` on the league prop shape', () => {
    const src = read('src/components/admin/SettingsTab.tsx')
    expect(src).toMatch(/idRequired: boolean/)
    expect(src).toContain('initialIdRequired={league.idRequired}')
  })

  it('updateLeagueDetails server action accepts + persists idRequired', () => {
    const src = read('src/app/admin/leagues/actions.ts')
    // Accepts the new field…
    expect(src).toMatch(/idRequired\?: boolean/)
    // …validates the type…
    expect(src).toMatch(/idRequired must be a boolean/)
    // …and writes it on the update.
    expect(src).toContain('data.idRequired = input.idRequired')
  })
})

describe('[v1.93.0] RegistrationFields — preferred/secondary + idRequired', () => {
  const src = read('src/components/registration/RegistrationFields.tsx')

  it('RegistrationFieldsSubmit shape exposes preferred + secondary', () => {
    expect(src).toContain('preferredPositions: string[]')
    expect(src).toContain('secondaryPositions: string[]')
    // Legacy single `positions: string[]` field is gone from the submit shape.
    expect(src).not.toMatch(/\n\s*positions: string\[\]\s*\n/)
  })

  it('accepts `idRequired` prop (defaults true) — hides ID UI when false', () => {
    expect(src).toMatch(/idRequired\?: boolean/)
    expect(src).toMatch(/idRequired\s*=\s*true,?/)
    // v2.2.15 — submit gate is driven by the `selectIdSectionMode()`
    // pure helper. `mustUpload` widens the v2.2.12 `!reusing` semantic
    // to also cover the new `reupload-requested` mode (admin-forced
    // fresh upload). The `mustUpload && !idFrontFile` / `!idBackFile`
    // shape replaces the v2.2.12 `idRequired && !reusing && …` pair.
    expect(src).toMatch(/mustUpload\s*&&\s*!idFrontFile/)
    expect(src).toMatch(/mustUpload\s*&&\s*!idBackFile/)
    // v2.2.15 — ID section wrapped in `{sectionMode !== 'none' && (`
    // (replaces v2.2.12's `{idRequired && (` — same semantic since
    // `selectIdSectionMode` returns `'none'` iff `!idRequired`).
    expect(src).toMatch(/\{sectionMode !== 'none' && \(/)
  })

  it('preferred picker is capped via maxSelected={MAX_PREFERRED_POSITIONS}', () => {
    expect(src).toContain('maxSelected={MAX_PREFERRED_POSITIONS}')
    expect(src).toContain('data-testid="registration-preferred-counter"')
    expect(src).toContain('testIdPrefix="registration-preferred"')
    expect(src).toContain('testIdPrefix="registration-secondary"')
  })

  it('blocks submission with 0 preferred (form-level required)', () => {
    expect(src).toMatch(/Pick at least one preferred position/)
    expect(src).toMatch(/preferredPositions\.length === 0/)
  })

  it('blocks submission with > 3 preferred (server-side cap mirrored in form)', () => {
    expect(src).toMatch(/preferredPositions\.length > MAX_PREFERRED_POSITIONS/)
  })

  it('strips secondary codes that overlap preferred at submit time', () => {
    expect(src).toMatch(/filteredSecondary = secondaryPositions\.filter/)
  })
})

describe('[v1.93.0] PositionMultiSelect — maxSelected cap', () => {
  const src = read('src/components/PositionMultiSelect.tsx')

  it('declares `maxSelected?: number` prop', () => {
    expect(src).toMatch(/maxSelected\?: number/)
  })

  it('toggle() is a no-op for new selections at cap', () => {
    expect(src).toMatch(/if \(atCap\) return/)
  })

  it('chips disable themselves when cap is reached and chip is unselected', () => {
    expect(src).toMatch(/chipDisabled = !!disabled \|\| \(!isOn && atCap\)/)
  })
})

describe('[v1.93.0] AccountPlayerForm — cap on preferred', () => {
  const src = read('src/app/account/player/AccountPlayerForm.tsx')

  it('threads maxSelected={MAX_PREFERRED_POSITIONS} into the preferred picker', () => {
    expect(src).toContain('maxSelected={MAX_PREFERRED_POSITIONS}')
    expect(src).toContain('Preferred positions (up to ')
  })

  it('renders a per-league counter with a stable testid pattern', () => {
    expect(src).toMatch(/league-card-preferred-counter-\$\{league\.leagueId\}/)
  })
})

describe('[v1.93.0] admin EditPlayerPanel — preferred + secondary split', () => {
  const src = read('src/components/admin/PlayersTab.tsx')

  it('PlayerRow shape exposes preferredPositions + secondaryPositions', () => {
    expect(src).toContain('preferredPositions: string[]')
    expect(src).toContain('secondaryPositions: string[]')
  })

  it('renders two pickers and the counter for preferred', () => {
    expect(src).toContain('testIdPrefix={`player-edit-preferred-${player.id}`}')
    expect(src).toContain('testIdPrefix={`player-edit-secondary-${player.id}`}')
    expect(src).toMatch(/player-edit-preferred-counter-\$\{player\.id\}/)
    expect(src).toContain('maxSelected={MAX_PREFERRED_POSITIONS}')
  })

  it('blocks save when preferred is oversize', () => {
    expect(src).toMatch(/preferredOversize/)
    expect(src).toMatch(/disabled=\{!dirty \|\| nameInvalid \|\| preferredOversize \|\| pending\}/)
  })

  it('adminUpdatePlayerPosition is called with the split shape', () => {
    expect(src).toContain('preferredPositions: preferred,')
    expect(src).toContain('secondaryPositions: secondaryFiltered,')
  })
})

describe('[v1.93.0] admin AddPlayerDialog — preferred + secondary split', () => {
  const src = read('src/components/admin/AddPlayerDialog.tsx')

  it('renders two pickers + counter for preferred', () => {
    expect(src).toContain('testIdPrefix="add-player-preferred"')
    expect(src).toContain('testIdPrefix="add-player-secondary"')
    expect(src).toContain('data-testid="add-player-preferred-counter"')
    expect(src).toContain('maxSelected={MAX_PREFERRED_POSITIONS}')
  })

  it('adminCreatePlayer is called with the split shape', () => {
    expect(src).toContain('preferredPositions: preferred,')
    expect(src).toContain('secondaryPositions: secondaryFiltered,')
  })
})

describe('[v1.93.0] ApplyToLeagueModal — preferred + secondary split', () => {
  const src = read('src/components/ApplyToLeagueModal.tsx')

  it('renders two pickers + counter for preferred', () => {
    expect(src).toContain('testIdPrefix="apply-preferred"')
    expect(src).toContain('testIdPrefix="apply-secondary"')
    expect(src).toContain('data-testid="apply-preferred-counter"')
    expect(src).toContain('maxSelected={MAX_PREFERRED_POSITIONS}')
  })

  it('blocks submission with 0 preferred (matches form-level required)', () => {
    expect(src).toMatch(/Pick at least one preferred position/)
    expect(src).toMatch(/preferred\.length === 0/)
  })

  it('calls applyToLeague with the split shape (preferredPositions / secondaryPositions)', () => {
    expect(src).toContain('preferredPositions: preferred,')
    expect(src).toContain('secondaryPositions: secondaryFiltered,')
  })
})

describe('[v1.93.0] server actions — preferred cap + idRequired gates', () => {
  it('applyToLeague accepts preferred/secondary and goes through validatePreferredSecondary', () => {
    const src = read('src/app/api/recruiting/actions.ts')
    expect(src).toContain('preferredPositions?: ReadonlyArray<string>')
    expect(src).toContain('secondaryPositions?: ReadonlyArray<string>')
    expect(src).toContain('validatePreferredSecondary')
    // legacy `positions` is preserved as deprecated.
    expect(src).toMatch(/@deprecated v1\.93\.0/)
  })

  it('registerToLeague gates ID-required writes on league.idRequired', () => {
    const src = read('src/app/api/recruiting/actions.ts')
    expect(src).toContain("idRequired: true")
    // The id-upload validation block is conditional on the server-side
    // `league.idRequired` flag (not a form-supplied prop).
    expect(src).toMatch(/if \(league\.idRequired\) \{/)
  })

  it('completeOnboardingWithId gates ID-required writes on invite.league.idRequired', () => {
    const src = read('src/app/join/[code]/actions.ts')
    expect(src).toMatch(/idRequired: true/)
    expect(src).toMatch(/invite\.league\?\.idRequired \?\? true/)
  })

  it('adminUpdatePlayerPosition accepts the split and enforces the cap', () => {
    const src = read('src/app/admin/leagues/actions.ts')
    expect(src).toContain('preferredPositions?: ReadonlyArray<string>')
    expect(src).toContain('secondaryPositions?: ReadonlyArray<string>')
    // Cap enforcement comes via validatePreferredSecondary.
    expect(src).toContain('validatePreferredSecondary')
  })

  it('adminCreatePlayer accepts the split and enforces the cap', () => {
    const src = read('src/app/admin/leagues/actions.ts')
    // Search for the function block; both args present.
    const idx = src.indexOf('export async function adminCreatePlayer(')
    expect(idx).toBeGreaterThan(0)
    const block = src.slice(idx, idx + 4000)
    expect(block).toContain('preferredPositions?: ReadonlyArray<string> | null')
    expect(block).toContain('secondaryPositions?: ReadonlyArray<string> | null')
  })
})

describe('[v1.93.0] /recruit page + /join onboarding page — thread idRequired', () => {
  it('recruit page selects + passes idRequired through to RegistrationForm', () => {
    const src = read('src/app/recruit/[slug]/page.tsx')
    expect(src).toMatch(/idRequired: true/)
    expect(src).toContain('idRequired={league.idRequired}')
  })

  it('join onboarding page selects + passes idRequired through to OnboardingForm', () => {
    const src = read('src/app/join/[code]/onboarding/page.tsx')
    expect(src).toMatch(/idRequired: true/)
    expect(src).toContain('idRequired={league.idRequired}')
  })
})
