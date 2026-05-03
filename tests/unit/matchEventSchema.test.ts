/**
 * v1.42.0 (epic match events PR α) — schema invariants pinned by the new
 * migration.
 *
 * Reads `prisma/schema.prisma` + `prisma/migrations/.../migration.sql` and
 * asserts the load-bearing shapes:
 *   1. `enum EventKind { GOAL }`
 *   2. `enum GoalType { OPEN_PLAY SET_PIECE PENALTY OWN_GOAL }`
 *   3. `model MatchEvent` declared with the right fields and FKs.
 *   4. `Match.scoreOverride String?` added.
 *   5. Goal + Assist tables still exist (read paths still depend on them
 *      pre-PR-δ; their removal is out of this PR's scope).
 *   6. Migration is PURELY ADDITIVE — no `DROP TABLE`, `DROP COLUMN`,
 *      `DROP TYPE`, or `ALTER COLUMN ... DROP` against existing rows.
 *
 * No DB stand-up; structural file reads only.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const SCHEMA = readFileSync(join(ROOT, 'prisma', 'schema.prisma'), 'utf-8')
const MIGRATION_RAW = readFileSync(
  join(ROOT, 'prisma', 'migrations', '20260503100000_match_events', 'migration.sql'),
  'utf-8',
)
// Strip SQL line comments before structural checks so the rollback-recipe
// comment doesn't trip the "no DROP" assertions.
const MIGRATION = MIGRATION_RAW.split(/\r?\n/)
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n')

describe('v1.42.0 PR α — schema deltas', () => {
  it('declares EventKind enum with exactly one value (GOAL)', () => {
    const match = SCHEMA.match(/enum EventKind\s*\{([^}]+)\}/)
    expect(match, 'EventKind enum not found').toBeTruthy()
    const tokens = match![1]
      .split(/\r?\n/)
      .map((line) => line.replace(/\/\/.*$/, '').trim())
      .filter(Boolean)
    expect(tokens).toEqual(['GOAL'])
  })

  it('declares GoalType enum with the four goal types', () => {
    const match = SCHEMA.match(/enum GoalType\s*\{([^}]+)\}/)
    expect(match, 'GoalType enum not found').toBeTruthy()
    const tokens = match![1]
      .split(/\r?\n/)
      .map((line) => line.replace(/\/\/.*$/, '').trim())
      .filter(Boolean)
    expect(tokens).toEqual(['OPEN_PLAY', 'SET_PIECE', 'PENALTY', 'OWN_GOAL'])
  })

  it('declares MatchEvent model with required FKs and indexes', () => {
    const block = SCHEMA.match(/model MatchEvent\s*\{[\s\S]+?\n\}/)
    expect(block, 'MatchEvent model not found').toBeTruthy()
    const body = block![0]
    expect(body).toMatch(/matchId\s+String/)
    expect(body).toMatch(/kind\s+EventKind\s+@default\(GOAL\)/)
    expect(body).toMatch(/goalType\s+GoalType\?/)
    expect(body).toMatch(/scorerId\s+String\b/)
    expect(body).toMatch(/assisterId\s+String\?/)
    expect(body).toMatch(/minute\s+Int\?/)
    expect(body).toMatch(/createdById\s+String\?/)
    expect(body).toMatch(/match\s+Match\s+@relation\(fields: \[matchId\][^)]+onDelete: Cascade/)
    expect(body).toMatch(/scorer\s+Player\s+@relation\("EventScorer"/)
    expect(body).toMatch(/assister\s+Player\?\s+@relation\("EventAssister"/)
    expect(body).toMatch(/createdBy\s+User\?\s+@relation/)
    expect(body).toMatch(/@@index\(\[matchId\]\)/)
    expect(body).toMatch(/@@index\(\[scorerId\]\)/)
    expect(body).toMatch(/@@index\(\[assisterId\]\)/)
  })

  it('Match.scoreOverride is the new nullable String column', () => {
    const block = SCHEMA.match(/model Match\s*\{[\s\S]+?\n\}/)
    expect(block, 'Match model not found').toBeTruthy()
    expect(block![0]).toMatch(/scoreOverride\s+String\?/)
  })

  it('Match.events back-relation is declared', () => {
    const block = SCHEMA.match(/model Match\s*\{[\s\S]+?\n\}/)!
    expect(block[0]).toMatch(/events\s+MatchEvent\[\]/)
  })

  it('Player has scoredEvents + assistedEvents back-relations', () => {
    const block = SCHEMA.match(/model Player\s*\{[\s\S]+?\n\}/)!
    expect(block[0]).toMatch(/scoredEvents\s+MatchEvent\[\]\s+@relation\("EventScorer"\)/)
    expect(block[0]).toMatch(
      /assistedEvents\s+MatchEvent\[\]\s+@relation\("EventAssister"\)/,
    )
  })

  it('User has authoredEvents back-relation', () => {
    const block = SCHEMA.match(/model User\s*\{[\s\S]+?\n\}/)!
    expect(block[0]).toMatch(/authoredEvents\s+MatchEvent\[\]/)
  })

  it('Goal + Assist models are still in the schema (PR α does not remove them)', () => {
    expect(SCHEMA).toMatch(/model Goal\s*\{/)
    expect(SCHEMA).toMatch(/model Assist\s*\{/)
  })
})

describe('v1.42.0 PR α — migration is purely additive', () => {
  it('creates the new types + table', () => {
    expect(MIGRATION).toMatch(/CREATE TYPE "EventKind"/)
    expect(MIGRATION).toMatch(/CREATE TYPE "GoalType"/)
    expect(MIGRATION).toMatch(/CREATE TABLE "MatchEvent"/)
    expect(MIGRATION).toMatch(/ALTER TABLE "Match" ADD COLUMN "scoreOverride"/)
  })

  it('does NOT contain destructive statements against existing rows / types', () => {
    // Comment-stripped MIGRATION must have NO DROP / ALTER COLUMN ... DROP.
    expect(MIGRATION).not.toMatch(/\bDROP TABLE\b/i)
    expect(MIGRATION).not.toMatch(/\bDROP COLUMN\b/i)
    expect(MIGRATION).not.toMatch(/\bDROP TYPE\b/i)
    expect(MIGRATION).not.toMatch(/\bALTER COLUMN\s+\S+\s+DROP\b/i)
    // Existing tables must not be truncated by the migration.
    expect(MIGRATION).not.toMatch(/\bTRUNCATE\b/i)
  })

  it('FK from MatchEvent.matchId cascades on Match delete', () => {
    expect(MIGRATION).toMatch(
      /MatchEvent_matchId_fkey[\s\S]+?ON DELETE CASCADE/i,
    )
  })

  it('FK from MatchEvent.scorerId is RESTRICT (deleting a Player with events fails fast)', () => {
    expect(MIGRATION).toMatch(
      /MatchEvent_scorerId_fkey[\s\S]+?ON DELETE RESTRICT/i,
    )
  })

  it('FK from MatchEvent.assisterId is SET NULL (assister can be detached)', () => {
    expect(MIGRATION).toMatch(
      /MatchEvent_assisterId_fkey[\s\S]+?ON DELETE SET NULL/i,
    )
  })
})
