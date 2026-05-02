/**
 * v1.34.0 (PR ζ) — schema invariants pinned by the redemption-foundation
 * migration. Reads prisma/schema.prisma + the migration SQL as text and
 * asserts the load-bearing shapes:
 *
 *   1. `enum OnboardingStatus { NOT_YET COMPLETED }`
 *   2. `enum JoinSource { ADMIN SELF_SERVE CODE PERSONAL }`
 *   3. `PlayerLeagueAssignment.onboardingStatus OnboardingStatus @default(NOT_YET)`
 *   4. `PlayerLeagueAssignment.joinSource JoinSource?` (nullable)
 *   5. `Player.onboardingPreferences Json?` (nullable jsonb)
 *   6. Migration is purely additive: COMPLETED-default-then-flip-to-NOT_YET
 *      backfill so existing rows aren't gated, no DROP COLUMN against any
 *      existing column.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const SCHEMA = readFileSync(join(ROOT, 'prisma', 'schema.prisma'), 'utf-8')
const MIGRATION_RAW = readFileSync(
  join(ROOT, 'prisma', 'migrations', '20260503010000_redemption_foundation', 'migration.sql'),
  'utf-8',
)
// Strip SQL comments so doc text doesn't trip the asserts (matches ε's
// inviteGenerationSchema test pattern).
const MIGRATION = MIGRATION_RAW.split(/\r?\n/)
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n')

describe('v1.34.0 (PR ζ) — schema enums', () => {
  it('OnboardingStatus enum has NOT_YET + COMPLETED, in that order', () => {
    const block = SCHEMA.match(/enum OnboardingStatus\s*\{([^}]+)\}/)
    expect(block, 'OnboardingStatus not found').toBeTruthy()
    const tokens = block![1]
      .split(/\r?\n/)
      .map((l) => l.replace(/\/\/.*$/, '').trim())
      .filter(Boolean)
    expect(tokens).toEqual(['NOT_YET', 'COMPLETED'])
  })

  it('JoinSource enum has all four audit values', () => {
    const block = SCHEMA.match(/enum JoinSource\s*\{([^}]+)\}/)
    expect(block, 'JoinSource not found').toBeTruthy()
    const tokens = block![1]
      .split(/\r?\n/)
      .map((l) => l.replace(/\/\/.*$/, '').trim())
      .filter(Boolean)
    expect(tokens).toEqual(['ADMIN', 'SELF_SERVE', 'CODE', 'PERSONAL'])
  })
})

describe('v1.34.0 (PR ζ) — PlayerLeagueAssignment columns', () => {
  it('onboardingStatus is OnboardingStatus with default NOT_YET (post-migration default)', () => {
    const block = SCHEMA.match(/model PlayerLeagueAssignment\s*\{[^}]+\}/)
    expect(block).toBeTruthy()
    expect(block![0]).toMatch(/onboardingStatus\s+OnboardingStatus\s+@default\(NOT_YET\)/)
  })

  it('joinSource is nullable JoinSource? (existing rows backfill to null)', () => {
    const block = SCHEMA.match(/model PlayerLeagueAssignment\s*\{[^}]+\}/)
    expect(block![0]).toMatch(/joinSource\s+JoinSource\?/)
  })
})

describe('v1.34.0 (PR ζ) — Player.onboardingPreferences', () => {
  it('Json? — nullable, untyped JSON shape', () => {
    const block = SCHEMA.match(/model Player\s*\{[^}]+\}/)
    expect(block).toBeTruthy()
    expect(block![0]).toMatch(/onboardingPreferences\s+Json\?/)
  })
})

describe('v1.34.0 (PR ζ) — migration SQL invariants', () => {
  it('creates both enums with all literals', () => {
    expect(MIGRATION).toMatch(
      /CREATE TYPE\s+"OnboardingStatus"\s+AS ENUM\s*\('NOT_YET',\s*'COMPLETED'\)/,
    )
    expect(MIGRATION).toMatch(
      /CREATE TYPE\s+"JoinSource"\s+AS ENUM\s*\('ADMIN',\s*'SELF_SERVE',\s*'CODE',\s*'PERSONAL'\)/,
    )
  })

  it('adds onboardingStatus with default COMPLETED first (existing rows backfill to onboarded)', () => {
    expect(MIGRATION).toMatch(
      /ALTER TABLE\s+"PlayerLeagueAssignment"\s+ADD COLUMN\s+"onboardingStatus"\s+"OnboardingStatus"\s+NOT NULL\s+DEFAULT\s+'COMPLETED'/,
    )
  })

  it('flips the onboardingStatus default to NOT_YET for new rows AFTER backfill', () => {
    const addIdx = MIGRATION.indexOf("ADD COLUMN \"onboardingStatus\"")
    const flipIdx = MIGRATION.indexOf("ALTER COLUMN \"onboardingStatus\" SET DEFAULT 'NOT_YET'")
    expect(addIdx).toBeGreaterThan(0)
    expect(flipIdx).toBeGreaterThan(addIdx) // flip happens AFTER add
  })

  it('adds joinSource as nullable (no NOT NULL — existing rows leave null)', () => {
    expect(MIGRATION).toMatch(
      /ALTER TABLE\s+"PlayerLeagueAssignment"\s+ADD COLUMN\s+"joinSource"\s+"JoinSource"\s*;/,
    )
    // Sanity: NOT NULL absent from this specific ADD COLUMN line
    const joinSourceLine = MIGRATION.split('\n').find((l) => l.includes('ADD COLUMN "joinSource"'))
    expect(joinSourceLine).toBeTruthy()
    expect(joinSourceLine).not.toMatch(/NOT NULL/)
  })

  it('adds Player.onboardingPreferences as nullable JSONB', () => {
    expect(MIGRATION).toMatch(
      /ALTER TABLE\s+"Player"\s+ADD COLUMN\s+"onboardingPreferences"\s+JSONB/,
    )
    // The line shouldn't have NOT NULL (it's nullable per design)
    const prefsLine = MIGRATION.split('\n').find((l) =>
      l.includes('ADD COLUMN "onboardingPreferences"'),
    )
    expect(prefsLine).not.toMatch(/NOT NULL/)
  })

  it('does not destructively DROP any existing column or table', () => {
    expect(MIGRATION).not.toMatch(/DROP COLUMN/)
    expect(MIGRATION).not.toMatch(/DROP TABLE/)
    expect(MIGRATION).not.toMatch(/DROP TYPE/)
  })
})
