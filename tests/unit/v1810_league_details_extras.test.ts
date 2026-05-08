/**
 * v1.81.0 — League details extras.
 *
 * Four additive league fields surfaced in the LeagueDetailsPanel + admin
 * editor, plus a Season Fee caption explaining what the fee covers:
 *
 *   - skillLevel       — SkillLevel enum (BEGINNER | MIXED | INTERMEDIATE
 *                        | ADVANCED), nullable.
 *   - shoeTypes        — TEXT[] multi-select among TF / AG / FG / SG.
 *   - shinguardPolicy  — ShinguardPolicy enum (MANDATORY | VOLUNTARY),
 *                        nullable.
 *   - totalMatches     — Int? — sum of all matches across the season,
 *                        distinct from the matchday count.
 *
 * All four render "TBD" in the public panel when unset, matching the
 * matchday-TBD pattern used elsewhere on the homepage.
 *
 * Regression targets (file-content pins) so future refactors don't
 * silently drop these additions.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  SKILL_LEVEL_LABELS,
  SHINGUARD_POLICY_LABELS,
  ALLOWED_SHOE_TYPES,
} from '@/lib/leagueDetails'

const ROOT = join(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

// ── Schema migration ─────────────────────────────────────────────────────────

describe('v1.81.0 migration — additive league extras', () => {
  const sql = read(
    'prisma/migrations/20260515000000_league_details_extra/migration.sql',
  )

  it('creates SkillLevel enum with the four allowed values', () => {
    expect(sql).toMatch(
      /CREATE TYPE "SkillLevel" AS ENUM \('BEGINNER', 'MIXED', 'INTERMEDIATE', 'ADVANCED'\)/,
    )
  })

  it('creates ShinguardPolicy enum', () => {
    expect(sql).toMatch(
      /CREATE TYPE "ShinguardPolicy" AS ENUM \('MANDATORY', 'VOLUNTARY'\)/,
    )
  })

  it('adds skillLevel as nullable column (no NOT NULL)', () => {
    // Column must be nullable so unset rows render TBD.
    const line = sql.match(/ADD COLUMN "skillLevel".*$/m)?.[0] ?? ''
    expect(line).toContain('"SkillLevel"')
    expect(line).not.toMatch(/NOT NULL/)
  })

  it('adds shoeTypes as TEXT[] with default empty array', () => {
    expect(sql).toMatch(
      /ADD COLUMN "shoeTypes"\s+TEXT\[\][^\n]*DEFAULT '\{\}'/,
    )
  })

  it('adds shinguardPolicy as nullable column', () => {
    const line = sql.match(/ADD COLUMN "shinguardPolicy".*$/m)?.[0] ?? ''
    expect(line).toContain('"ShinguardPolicy"')
    expect(line).not.toMatch(/NOT NULL/)
  })

  it('adds totalMatches as nullable INTEGER', () => {
    const line = sql.match(/ADD COLUMN "totalMatches".*$/m)?.[0] ?? ''
    expect(line).toContain('INTEGER')
    expect(line).not.toMatch(/NOT NULL/)
  })

  it('is purely additive — no executable DROP COLUMN / ALTER COLUMN / DELETE / TRUNCATE', () => {
    // Strip leading "-- ..." comment lines (rollback recipes routinely
    // mention DROP COLUMN). We only care that no executable SQL line
    // performs a destructive operation.
    const executable = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
    expect(executable).not.toMatch(/DROP COLUMN/i)
    expect(executable).not.toMatch(/ALTER COLUMN/i)
    expect(executable).not.toMatch(/DELETE FROM/i)
    expect(executable).not.toMatch(/TRUNCATE/i)
  })
})

describe('v1.81.0 prisma schema declares the new fields', () => {
  const schema = read('prisma/schema.prisma')

  it('declares SkillLevel enum', () => {
    expect(schema).toMatch(
      /enum SkillLevel \{[\s\S]*?BEGINNER[\s\S]*?MIXED[\s\S]*?INTERMEDIATE[\s\S]*?ADVANCED[\s\S]*?\}/,
    )
  })

  it('declares ShinguardPolicy enum', () => {
    expect(schema).toMatch(
      /enum ShinguardPolicy \{[\s\S]*?MANDATORY[\s\S]*?VOLUNTARY[\s\S]*?\}/,
    )
  })

  it('declares all four league extras with safe nullable / default-empty', () => {
    expect(schema).toMatch(/skillLevel\s+SkillLevel\?/)
    // shoeTypes is the raw string array; admin/public both narrow to allowed values.
    expect(schema).toMatch(/shoeTypes\s+String\[\]\s+@default\(\[\]\)/)
    expect(schema).toMatch(/shinguardPolicy\s+ShinguardPolicy\?/)
    expect(schema).toMatch(/totalMatches\s+Int\?/)
  })
})

// ── Library labels + allowed-value tables ────────────────────────────────────

describe('v1.81.0 leagueDetails library exposes labels + allowed shoes', () => {
  it('SKILL_LEVEL_LABELS covers all four enum values with mixed-case labels', () => {
    expect(SKILL_LEVEL_LABELS.BEGINNER).toBe('Beginner')
    expect(SKILL_LEVEL_LABELS.MIXED).toBe('Mixed')
    expect(SKILL_LEVEL_LABELS.INTERMEDIATE).toBe('Intermediate')
    expect(SKILL_LEVEL_LABELS.ADVANCED).toBe('Advanced')
  })

  it('SHINGUARD_POLICY_LABELS covers both enum values', () => {
    expect(SHINGUARD_POLICY_LABELS.MANDATORY).toBe('Mandatory')
    expect(SHINGUARD_POLICY_LABELS.VOLUNTARY).toBe('Voluntary')
  })

  it('ALLOWED_SHOE_TYPES is exactly TF, AG, FG, SG (in that order)', () => {
    expect([...ALLOWED_SHOE_TYPES]).toEqual(['TF', 'AG', 'FG', 'SG'])
  })
})

// ── Public panel — TBD-fallback rendering pins ───────────────────────────────

describe('v1.81.0 LeagueDetailsPanel — top section adds skill level + shoes + shinguards', () => {
  const src = read('src/components/LeagueDetailsPanel.tsx')

  it('renders Skill level row inside the rules section', () => {
    // testid pin and label both present.
    expect(src).toMatch(/league-details-skill-level-row/)
    expect(src).toMatch(/label="Skill level"/)
  })

  it('renders Shoes row', () => {
    expect(src).toMatch(/league-details-shoe-types-row/)
    expect(src).toMatch(/label="Shoes"/)
  })

  it('renders Shinguards row', () => {
    expect(src).toMatch(/league-details-shinguard-row/)
    expect(src).toMatch(/label="Shinguards"/)
  })

  it('drives the values through TBD-fallback constants (not raw fields)', () => {
    // The component computes skillLevelValue / shoeTypesValue / shinguardValue
    // / totalMatchesValue with TBD-fallbacks; rows must reference those.
    expect(src).toMatch(/value=\{skillLevelValue\}/)
    expect(src).toMatch(/value=\{shoeTypesValue\}/)
    expect(src).toMatch(/value=\{shinguardValue\}/)
    expect(src).toMatch(/value=\{totalMatchesValue\}/)
  })

  it('falls back to the literal "TBD" when each field is null/empty', () => {
    // Verify the fallback expression literals exist in source.
    expect(src).toMatch(/data\.skillLevel \?[\s\S]*?: 'TBD'/)
    expect(src).toMatch(/data\.shoeTypes\.length > 0 \?[\s\S]*?: 'TBD'/)
    expect(src).toMatch(/data\.shinguardPolicy \?[\s\S]*?: 'TBD'/)
    expect(src).toMatch(/data\.totalMatches != null \?[\s\S]*?: 'TBD'/)
  })

  it('renders Total matches in the bottom stats section', () => {
    expect(src).toMatch(/total-matches-row/)
    expect(src).toMatch(/label="Total Matches"/)
  })

  it('renders the Season Fee caption right under the fee row', () => {
    expect(src).toMatch(/season-fee-caption/)
    expect(src).toMatch(/Covers referee fee, equipment, and league management costs/)
  })

  it('stats section always renders so Total matches has a home', () => {
    // The gate computed in the component should evaluate to true unconditionally.
    expect(src).toMatch(/const showStatsSection\s*=\s*true/)
  })
})

// ── Admin editor — UI controls for the four extras ───────────────────────────

describe('v1.81.0 LeagueDetailsEditor — admin controls for the four extras', () => {
  const src = read('src/components/admin/LeagueDetailsEditor.tsx')

  it('exposes a skill-level select with TBD option', () => {
    expect(src).toMatch(/league-details-skill-level/)
    // TBD blank option present.
    expect(src).toMatch(/<option value="">— TBD —<\/option>/)
  })

  it('exposes shoe-type toggle chips with testid prefix + iterates over the four allowed values', () => {
    // Testids are emitted as template literals over SHOE_TYPE_OPTIONS — pin
    // the prefix and the option set rather than each rendered string.
    expect(src).toMatch(/data-testid=\{`league-details-shoe-type-\$\{opt\.toLowerCase\(\)\}`\}/)
    // SHOE_TYPE_OPTIONS must include the four allowed values.
    expect(src).toMatch(/SHOE_TYPE_OPTIONS:[^=]*=\s*\['TF',\s*'AG',\s*'FG',\s*'SG'\]/)
  })

  it('exposes shinguard tri-state buttons (TBD / Mandatory / Voluntary)', () => {
    // Testid template covers all three values via the option mapping.
    expect(src).toMatch(/data-testid=\{`league-details-shinguard-/)
    // The TBD blank, MANDATORY and VOLUNTARY options must all appear.
    expect(src).toMatch(/value:\s*''[\s\S]*?label:\s*'TBD'/)
    expect(src).toMatch(/value:\s*'MANDATORY'[\s\S]*?label:\s*'Mandatory'/)
    expect(src).toMatch(/value:\s*'VOLUNTARY'[\s\S]*?label:\s*'Voluntary'/)
  })

  it('exposes a total-matches numeric input', () => {
    expect(src).toMatch(/league-details-total-matches/)
  })

  it('save handler forwards the four extras to updateLeagueDetails', () => {
    // The save call must propagate skillLevel / shoeTypes / shinguardPolicy /
    // totalMatches; otherwise admin edits would silently drop on the floor.
    const updateCall = src.match(/updateLeagueDetails\(\{[\s\S]*?\}\)/)?.[0] ?? ''
    expect(updateCall).toContain('skillLevel')
    expect(updateCall).toContain('shoeTypes')
    expect(updateCall).toContain('shinguardPolicy')
    expect(updateCall).toContain('totalMatches')
  })
})

// ── Server action validation ─────────────────────────────────────────────────

describe('v1.81.0 updateLeagueDetails action — validates the four extras', () => {
  const src = read('src/app/admin/leagues/actions.ts')

  it('declares allowed-value sets for the new fields', () => {
    expect(src).toMatch(/ALLOWED_SKILL_LEVELS\s*=\s*\['BEGINNER',\s*'MIXED',\s*'INTERMEDIATE',\s*'ADVANCED'\]/)
    expect(src).toMatch(/ALLOWED_SHOE_TYPES_ACTION\s*=\s*\['TF',\s*'AG',\s*'FG',\s*'SG'\]/)
    expect(src).toMatch(/ALLOWED_SHINGUARD_POLICIES\s*=\s*\['MANDATORY',\s*'VOLUNTARY'\]/)
  })

  it('extends updateLeagueDetails input with optional fields for each extra', () => {
    const sigMatch = src.match(/export async function updateLeagueDetails\(input:\s*\{[\s\S]*?\}\)/)
    expect(sigMatch).not.toBeNull()
    const sig = sigMatch![0]
    expect(sig).toMatch(/skillLevel\?:/)
    expect(sig).toMatch(/shoeTypes\?:/)
    expect(sig).toMatch(/shinguardPolicy\?:/)
    expect(sig).toMatch(/totalMatches\?:/)
  })

  it('rejects an out-of-range totalMatches value', () => {
    expect(src).toMatch(
      /totalMatches must be a non-negative integer or null/,
    )
  })

  it('deduplicates shoeTypes and rejects unknown values', () => {
    expect(src).toMatch(/shoeTypes entries must be among/)
    // Internal Set + cleaned[] pattern (regression target — admin sending the
    // same shoe twice should not double-write).
    expect(src).toMatch(/new Set<string>\(\)/)
  })
})
