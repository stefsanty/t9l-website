/**
 * v1.33.0 (PR ε) — schema invariants pinned by the new migration.
 *
 * Reads the prisma/schema.prisma + the migration SQL as text and asserts
 * the load-bearing shapes:
 *   1. `enum PlayerPosition { GK DF MF FW }` exists.
 *   2. `Player.position` is the enum (not free-form `String?`).
 *   3. `Player.name` is nullable (`String?`, no `@db.NotNull`).
 *   4. `LeagueInvite.skipOnboarding Boolean @default(false)`.
 *   5. Migration is purely additive / constraint-relaxing — no `DROP COLUMN`
 *      against existing data, no `DROP TYPE` against existing types.
 *   6. CASE WHEN backfill in the migration covers all 4 enum literals.
 *
 * No DB stand-up; structural file reads only.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const SCHEMA = readFileSync(join(ROOT, 'prisma', 'schema.prisma'), 'utf-8')
const MIGRATION_RAW = readFileSync(
  join(ROOT, 'prisma', 'migrations', '20260503000000_invite_generation_alpha', 'migration.sql'),
  'utf-8',
)
// Strip SQL line comments before structural checks so the "do not DROP TYPE"
// assertion doesn't trip on the migration's own rollback-recipe comment.
const MIGRATION = MIGRATION_RAW.split(/\r?\n/)
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n')

describe('v1.33.0 (PR ε) — schema deltas', () => {
  it('declares the PlayerPosition enum with exactly 4 values: GK / DF / MF / FW', () => {
    // Grab the enum block specifically. Don't accidentally match comments.
    const match = SCHEMA.match(/enum PlayerPosition\s*\{([^}]+)\}/)
    expect(match, 'PlayerPosition enum not found in schema').toBeTruthy()
    const body = match![1]
    // Strip line/inline comments before tokenising so doc text doesn't leak.
    const tokens = body
      .split(/\r?\n/)
      .map((line) => line.replace(/\/\/.*$/, '').trim())
      .filter(Boolean)
    expect(tokens).toEqual(['GK', 'DF', 'MF', 'FW'])
  })

  it('Player.position is the PlayerPosition enum (not String?)', () => {
    expect(SCHEMA).toMatch(/position\s+PlayerPosition\?/)
    // Make sure the prior `position String?` shape is gone.
    expect(SCHEMA).not.toMatch(/position\s+String\?\s*\n/)
  })

  it('Player.name is nullable (String?)', () => {
    // Match the actual model field, not any of the doc-comment "Player.name" mentions.
    const playerBlock = SCHEMA.match(/model Player\s*\{[^}]+\}/)
    expect(playerBlock, 'Player model not found').toBeTruthy()
    const body = playerBlock![0]
    expect(body).toMatch(/name\s+String\?/)
  })

  it('LeagueInvite.skipOnboarding Boolean @default(false)', () => {
    const inviteBlock = SCHEMA.match(/model LeagueInvite\s*\{[^}]+\}/)
    expect(inviteBlock, 'LeagueInvite model not found').toBeTruthy()
    expect(inviteBlock![0]).toMatch(/skipOnboarding\s+Boolean\s+@default\(false\)/)
  })
})

describe('v1.33.0 (PR ε) — migration SQL invariants', () => {
  it('creates the PlayerPosition enum with all four literals', () => {
    expect(MIGRATION).toMatch(/CREATE TYPE\s+"PlayerPosition"\s+AS ENUM\s*\('GK',\s*'DF',\s*'MF',\s*'FW'\)/)
  })

  it('drops NOT NULL on Player.name (constraint relaxation, not data loss)', () => {
    expect(MIGRATION).toMatch(/ALTER TABLE\s+"Player"\s+ALTER COLUMN\s+"name"\s+DROP NOT NULL/)
  })

  it('adds LeagueInvite.skipOnboarding with Boolean default false', () => {
    expect(MIGRATION).toMatch(
      /ALTER TABLE\s+"LeagueInvite"\s+ADD COLUMN\s+"skipOnboarding"\s+BOOLEAN\s+NOT NULL\s+DEFAULT\s+false/,
    )
  })

  it('CASE WHEN backfill covers all 4 enum literals', () => {
    for (const literal of ['GK', 'DF', 'MF', 'FW']) {
      expect(MIGRATION).toContain(`WHEN "position" = '${literal}'`)
    }
  })

  it('backfills via CASE WHEN before dropping the old column (data safety)', () => {
    const updateIdx = MIGRATION.indexOf('UPDATE "Player"')
    const dropIdx = MIGRATION.indexOf('DROP COLUMN "position"')
    expect(updateIdx).toBeGreaterThan(0)
    expect(dropIdx).toBeGreaterThan(updateIdx)
  })

  it('does not DROP TYPE / DROP TABLE against existing schema', () => {
    expect(MIGRATION).not.toMatch(/DROP TYPE/)
    expect(MIGRATION).not.toMatch(/DROP TABLE/)
  })

  it('does not destructively widen LeagueInvite (skipOnboarding is purely additive)', () => {
    expect(MIGRATION).not.toMatch(/DROP COLUMN "code"/)
    expect(MIGRATION).not.toMatch(/DROP COLUMN "kind"/)
    expect(MIGRATION).not.toMatch(/DROP COLUMN "targetPlayerId"/)
  })
})
