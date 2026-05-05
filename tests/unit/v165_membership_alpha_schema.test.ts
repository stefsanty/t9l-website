/**
 * v1.65.0 — Membership-spec rework, stage 1 (additive). Tests pin:
 *
 *   1. Schema is purely additive: 5 new columns on PlayerLeagueAssignment
 *      (the SQL table name kept via @@map), 1 new column on Player,
 *      1 new enum, 1 new model, no DROPs against existing data, only one
 *      ALTER COLUMN (DROP NOT NULL on leagueTeamId).
 *   2. Prisma model rename: PlayerLeagueAssignment → PlayerLeagueMembership.
 *      SQL table name preserved via @@map("PlayerLeagueAssignment").
 *   3. Migration SQL is non-destructive (no DROP TABLE / DROP COLUMN /
 *      DROP TYPE / TRUNCATE / DELETE FROM in executable lines; comments
 *      describing rollback recipes are stripped before the regex check).
 *   4. Backfills run inline so existing reads through the new columns
 *      return the same value as the legacy columns (PLA.leagueId from
 *      LeagueTeam.leagueId; PLA.position from Player.position).
 *   5. The new MembershipStatus enum has the right three literals.
 *   6. The new PlayerLeagueStat model is keyed on (playerId, leagueId,
 *      seasonId?) per the spec.
 *
 * Reading these pins from a future-PR perspective:
 *   - v1.65.1 (dual-write) — these invariants stay; the dual-write PR
 *     just adds writes at every old write site.
 *   - v1.65.2 (read flip) — these invariants stay; reads gain a Setting
 *     flag, both code paths exist.
 *   - v1.65.4 (drop legacy) — these invariants change: Player.position,
 *     Player.applicationStatus, Player.applicationLeagueId get dropped.
 *     Update the test there.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')
const SCHEMA = readFileSync(join(REPO_ROOT, 'prisma/schema.prisma'), 'utf8')
const MIGRATION = readFileSync(
  join(REPO_ROOT, 'prisma/migrations/20260507100000_membership_alpha/migration.sql'),
  'utf8',
)

// Strip line + block comments before SQL regex checks so legitimate
// rollback-recipe documentation in comments doesn't trip "no DROP" assertions.
const MIGRATION_EXEC = MIGRATION.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

describe('v1.65.0 — schema rename via @@map', () => {
  it('Prisma model is now PlayerLeagueMembership', () => {
    expect(SCHEMA).toMatch(/model PlayerLeagueMembership\s*\{/)
  })

  it('SQL table name preserved via @@map("PlayerLeagueAssignment")', () => {
    // Inside the PlayerLeagueMembership model block.
    const modelBlock = SCHEMA.match(/model PlayerLeagueMembership\s*\{[\s\S]*?\n\}/)
    expect(modelBlock).not.toBeNull()
    expect(modelBlock![0]).toMatch(/@@map\("PlayerLeagueAssignment"\)/)
  })

  it('legacy model name PlayerLeagueAssignment is gone from the schema as a model declaration', () => {
    // Allow the legacy name in @@map / comments / doc strings, but not
    // as a `model X {` declaration.
    expect(SCHEMA).not.toMatch(/^\s*model PlayerLeagueAssignment\s*\{/m)
  })
})

describe('v1.65.0 — new columns on PlayerLeagueMembership', () => {
  let modelBlock: string

  it('locates the model block', () => {
    const m = SCHEMA.match(/model PlayerLeagueMembership\s*\{[\s\S]*?\n\}/)
    expect(m).not.toBeNull()
    modelBlock = m![0]
  })

  it('declares leagueId String? (nullable)', () => {
    const m = SCHEMA.match(/model PlayerLeagueMembership\s*\{[\s\S]*?\n\}/)
    expect(m![0]).toMatch(/^\s*leagueId\s+String\?/m)
  })

  it('declares position PlayerPosition? (per-league)', () => {
    const m = SCHEMA.match(/model PlayerLeagueMembership\s*\{[\s\S]*?\n\}/)
    expect(m![0]).toMatch(/^\s*position\s+PlayerPosition\?/m)
  })

  it('declares jerseyNumber Int? (new)', () => {
    const m = SCHEMA.match(/model PlayerLeagueMembership\s*\{[\s\S]*?\n\}/)
    expect(m![0]).toMatch(/^\s*jerseyNumber\s+Int\?/m)
  })

  it('declares status MembershipStatus @default(ACTIVE)', () => {
    const m = SCHEMA.match(/model PlayerLeagueMembership\s*\{[\s\S]*?\n\}/)
    expect(m![0]).toMatch(/^\s*status\s+MembershipStatus\s+@default\(ACTIVE\)/m)
  })

  it('declares applicationStatus PlayerApplicationStatus @default(APPROVED)', () => {
    const m = SCHEMA.match(/model PlayerLeagueMembership\s*\{[\s\S]*?\n\}/)
    expect(m![0]).toMatch(
      /^\s*applicationStatus\s+PlayerApplicationStatus\s+@default\(APPROVED\)/m,
    )
  })

  it('declares idShared Boolean @default(true) (per-league ID consent)', () => {
    const m = SCHEMA.match(/model PlayerLeagueMembership\s*\{[\s\S]*?\n\}/)
    expect(m![0]).toMatch(/^\s*idShared\s+Boolean\s+@default\(true\)/m)
  })

  it('makes leagueTeamId nullable (drops NOT NULL for PENDING-app rows)', () => {
    const m = SCHEMA.match(/model PlayerLeagueMembership\s*\{[\s\S]*?\n\}/)
    expect(m![0]).toMatch(/^\s*leagueTeamId\s+String\?/m)
  })
})

describe('v1.65.0 — new MembershipStatus enum', () => {
  it('has exactly the three lifecycle literals', () => {
    expect(SCHEMA).toMatch(/enum MembershipStatus\s*\{[\s\S]*ACTIVE[\s\S]*\}/)
    expect(SCHEMA).toMatch(/enum MembershipStatus\s*\{[\s\S]*INACTIVE[\s\S]*\}/)
    expect(SCHEMA).toMatch(/enum MembershipStatus\s*\{[\s\S]*SUSPENDED[\s\S]*\}/)
  })
})

describe('v1.65.0 — Player.dob added', () => {
  it('adds dob DateTime? to the Player model', () => {
    const m = SCHEMA.match(/model Player\s*\{[\s\S]*?\n\}/)
    expect(m).not.toBeNull()
    expect(m![0]).toMatch(/^\s*dob\s+DateTime\?/m)
  })
})

describe('v1.65.0 — PlayerLeagueStat model exists (empty at v1.65.0)', () => {
  let block: string

  it('declares the model', () => {
    const m = SCHEMA.match(/model PlayerLeagueStat\s*\{[\s\S]*?\n\}/)
    expect(m).not.toBeNull()
    block = m![0]
  })

  it('has the spec-defined fields', () => {
    const m = SCHEMA.match(/model PlayerLeagueStat\s*\{[\s\S]*?\n\}/)!
    block = m[0]
    expect(block).toMatch(/^\s*playerId\s+String/m)
    expect(block).toMatch(/^\s*leagueId\s+String/m)
    expect(block).toMatch(/^\s*seasonId\s+String\?/m)
    expect(block).toMatch(/^\s*goals\s+Int\s+@default\(0\)/m)
    expect(block).toMatch(/^\s*assists\s+Int\s+@default\(0\)/m)
    expect(block).toMatch(/^\s*yellowCards\s+Int\s+@default\(0\)/m)
    expect(block).toMatch(/^\s*redCards\s+Int\s+@default\(0\)/m)
    expect(block).toMatch(/^\s*appearances\s+Int\s+@default\(0\)/m)
  })

  it('has the right composite unique on (playerId, leagueId, seasonId)', () => {
    const m = SCHEMA.match(/model PlayerLeagueStat\s*\{[\s\S]*?\n\}/)!
    expect(m[0]).toMatch(/@@unique\(\[playerId,\s*leagueId,\s*seasonId\]\)/)
  })

  it('cascades on League and Player delete', () => {
    const m = SCHEMA.match(/model PlayerLeagueStat\s*\{[\s\S]*?\n\}/)!
    expect(m[0]).toMatch(/league\s+League\s+@relation\([^)]*onDelete:\s*Cascade/)
    expect(m[0]).toMatch(/player\s+Player\s+@relation\([^)]*onDelete:\s*Cascade/)
  })
})

describe('v1.65.0 — migration is non-destructive', () => {
  it('contains the new MembershipStatus enum', () => {
    expect(MIGRATION_EXEC).toMatch(
      /CREATE TYPE\s+"MembershipStatus"\s+AS ENUM\s*\(\s*'ACTIVE',\s*'INACTIVE',\s*'SUSPENDED'\s*\)/,
    )
  })

  it('adds five new columns to the existing PlayerLeagueAssignment SQL table', () => {
    // SQL table name stays "PlayerLeagueAssignment" via @@map. Migration
    // ALTER TABLE statements use the SQL name, not the new model name.
    expect(MIGRATION_EXEC).toMatch(/ALTER TABLE\s+"PlayerLeagueAssignment"[\s\S]*ADD COLUMN\s+"leagueId"/)
    expect(MIGRATION_EXEC).toMatch(/ADD COLUMN\s+"position"\s+"PlayerPosition"/)
    expect(MIGRATION_EXEC).toMatch(/ADD COLUMN\s+"jerseyNumber"\s+INTEGER/)
    expect(MIGRATION_EXEC).toMatch(/ADD COLUMN\s+"status"\s+"MembershipStatus"\s+NOT NULL\s+DEFAULT\s+'ACTIVE'/)
    expect(MIGRATION_EXEC).toMatch(
      /ADD COLUMN\s+"applicationStatus"\s+"PlayerApplicationStatus"\s+NOT NULL\s+DEFAULT\s+'APPROVED'/,
    )
    expect(MIGRATION_EXEC).toMatch(/ADD COLUMN\s+"idShared"\s+BOOLEAN\s+NOT NULL\s+DEFAULT\s+true/)
  })

  it('drops NOT NULL on leagueTeamId (so PENDING-app PLMs can have null teams)', () => {
    expect(MIGRATION_EXEC).toMatch(
      /ALTER TABLE\s+"PlayerLeagueAssignment"\s+ALTER COLUMN\s+"leagueTeamId"\s+DROP NOT NULL/,
    )
  })

  it('backfills leagueId from the LeagueTeam join', () => {
    expect(MIGRATION_EXEC).toMatch(/UPDATE\s+"PlayerLeagueAssignment"[\s\S]*SET\s+"leagueId"\s*=\s*lt\."leagueId"/)
  })

  it('backfills position from Player.position', () => {
    expect(MIGRATION_EXEC).toMatch(/UPDATE\s+"PlayerLeagueAssignment"[\s\S]*SET\s+"position"\s*=\s*p\."position"/)
  })

  it('adds the FK constraint for the new leagueId column with CASCADE on delete', () => {
    expect(MIGRATION_EXEC).toMatch(
      /ADD CONSTRAINT\s+"PlayerLeagueAssignment_leagueId_fkey"\s+FOREIGN KEY\s*\(\s*"leagueId"\s*\)\s+REFERENCES\s+"League"\(\s*"id"\s*\)\s+ON DELETE CASCADE/,
    )
  })

  it('adds Player.dob (nullable)', () => {
    expect(MIGRATION_EXEC).toMatch(/ALTER TABLE\s+"Player"\s+ADD COLUMN\s+"dob"\s+TIMESTAMP\(3\)/)
  })

  it('creates the PlayerLeagueStat table', () => {
    expect(MIGRATION_EXEC).toMatch(/CREATE TABLE\s+"PlayerLeagueStat"/)
  })

  it('contains no destructive operations against existing data', () => {
    // No DROP TABLE / DROP COLUMN / DROP TYPE / TRUNCATE / DELETE FROM
    // in the executable SQL (post-comment-strip).
    expect(MIGRATION_EXEC).not.toMatch(/\bDROP TABLE\b/i)
    expect(MIGRATION_EXEC).not.toMatch(/\bDROP COLUMN\b/i)
    expect(MIGRATION_EXEC).not.toMatch(/\bDROP TYPE\b/i)
    expect(MIGRATION_EXEC).not.toMatch(/\bTRUNCATE\b/i)
    expect(MIGRATION_EXEC).not.toMatch(/\bDELETE\s+FROM\b/i)
  })
})

describe('v1.65.0 — back-relations on Player and League', () => {
  it('Player has a playerStats back-relation to PlayerLeagueStat', () => {
    const m = SCHEMA.match(/model Player\s*\{[\s\S]*?\n\}/)!
    expect(m[0]).toMatch(/playerStats\s+PlayerLeagueStat\[\]/)
  })

  it('League has a memberships back-relation to PlayerLeagueMembership', () => {
    const m = SCHEMA.match(/model League\s*\{[\s\S]*?\n\}/)!
    expect(m[0]).toMatch(/memberships\s+PlayerLeagueMembership\[\]/)
  })

  it('League has a playerStats back-relation to PlayerLeagueStat', () => {
    const m = SCHEMA.match(/model League\s*\{[\s\S]*?\n\}/)!
    expect(m[0]).toMatch(/playerStats\s+PlayerLeagueStat\[\]/)
  })
})
