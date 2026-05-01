import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * v1.27.0 — Identity rework α (additive schema only).
 *
 * Stage 1 of the account-player-rework. See
 * outputs/account-player-rework-plan.md for the full plan.
 *
 * This stage adds:
 *   - User.playerId       (nullable @unique)  — 1:1 link to canonical Player
 *   - Player.userId       (nullable @unique)  — mirror of User.playerId
 *   - LeagueInvite        (new table)         — code/personal join gates
 *   - InviteKind          (new enum)          — CODE | PERSONAL
 *
 * No code in src/ reads or writes any of these in stage 1. The structural
 * assertions below pin the additive schema delta so a regression that drops
 * one of the columns or merges in the table without the FK fails CI.
 *
 * Pattern matches v1.25.0's rendererConvergence.test.ts: read the schema +
 * migration source files at test time and assert on their text. We strip
 * comments before matching so doc-strings that legitimately reference
 * deleted/changed symbols don't trip false positives.
 */

const repoRoot = join(__dirname, '..', '..')
const schemaRaw = readFileSync(join(repoRoot, 'prisma/schema.prisma'), 'utf8')
const migrationRaw = readFileSync(
  join(
    repoRoot,
    'prisma/migrations/20260501000000_identity_rework_alpha/migration.sql',
  ),
  'utf8',
)

function stripPrismaComments(src: string): string {
  // Prisma comments are `//` only (no block-comment form); the schema doesn't
  // use `/* */`. Strip line comments while preserving the rest of the file.
  return src.replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

function stripSqlComments(src: string): string {
  // Postgres line comments only (`--`); the migration file has no /* */ blocks.
  return src.replace(/--[^\n]*/g, '')
}

const schema = stripPrismaComments(schemaRaw)
const migration = stripSqlComments(migrationRaw)

describe('v1.27.0 — Identity rework α: User.playerId additive column', () => {
  it('schema declares User.playerId as nullable @unique', () => {
    // The User model block must contain `playerId String? @unique`.
    const userModel = schema.match(/model User\s*\{[^}]*\}/m)
    expect(userModel).not.toBeNull()
    expect(userModel![0]).toMatch(/playerId\s+String\?\s+@unique/)
  })

  it('schema does NOT add @relation between User and Player in stage 1', () => {
    // Stage 2 wires the @relation; stage 1 keeps the column independent so
    // the migration is fully additive (no FK to fail). A regression that
    // adds the @relation prematurely would break the additive guarantee.
    const userModel = schema.match(/model User\s*\{[^}]*\}/m)
    expect(userModel).not.toBeNull()
    expect(userModel![0]).not.toMatch(/playerId.*@relation/)
  })

  it('migration adds User.playerId as nullable TEXT column with unique index', () => {
    expect(migration).toMatch(/ALTER TABLE "User" ADD COLUMN "playerId" TEXT;/)
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "User_playerId_key" ON "User"\("playerId"\);/,
    )
  })

  it('migration does NOT mark User.playerId as NOT NULL', () => {
    // Existing User rows would block a NOT NULL add; the column must be
    // nullable to stay additive.
    expect(migration).not.toMatch(
      /ALTER TABLE "User" ADD COLUMN "playerId" TEXT NOT NULL/,
    )
  })

  it('migration does NOT add a User → Player foreign key in stage 1', () => {
    // Stage 2 adds the FK alongside the @relation. Stage 1 keeps the
    // column independent.
    expect(migration).not.toMatch(/ADD CONSTRAINT "User_playerId_fkey"/)
  })
})

describe('v1.27.0 — Identity rework α: Player.userId additive column', () => {
  it('schema declares Player.userId as nullable @unique', () => {
    const playerModel = schema.match(/model Player\s*\{[^}]*\}/m)
    expect(playerModel).not.toBeNull()
    expect(playerModel![0]).toMatch(/userId\s+String\?\s+@unique/)
  })

  it('schema preserves Player.lineId @unique through stage 1', () => {
    // Player.lineId is the legacy identity column; it stays through stage 3
    // for backward-compat. Dropping it is a stage 4 concern. A regression
    // that removes it prematurely would break the existing auth path.
    const playerModel = schema.match(/model Player\s*\{[^}]*\}/m)
    expect(playerModel).not.toBeNull()
    expect(playerModel![0]).toMatch(/lineId\s+String\?\s+@unique/)
  })

  it('migration adds Player.userId as nullable TEXT column with unique index', () => {
    expect(migration).toMatch(/ALTER TABLE "Player" ADD COLUMN "userId" TEXT;/)
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "Player_userId_key" ON "Player"\("userId"\);/,
    )
  })

  it('migration does NOT mark Player.userId as NOT NULL', () => {
    expect(migration).not.toMatch(
      /ALTER TABLE "Player" ADD COLUMN "userId" TEXT NOT NULL/,
    )
  })

  it('migration does NOT add a Player → User foreign key in stage 1', () => {
    expect(migration).not.toMatch(/ADD CONSTRAINT "Player_userId_fkey"/)
  })
})

describe('v1.27.0 — Identity rework α: LeagueInvite table', () => {
  it('schema declares the LeagueInvite model with all expected fields', () => {
    const inviteModel = schema.match(/model LeagueInvite\s*\{[^}]*\}/m)
    expect(inviteModel).not.toBeNull()
    const m = inviteModel![0]
    expect(m).toMatch(/id\s+String\s+@id\s+@default\(cuid\(\)\)/)
    expect(m).toMatch(/leagueId\s+String/)
    expect(m).toMatch(/code\s+String\s+@unique/)
    expect(m).toMatch(/kind\s+InviteKind/)
    expect(m).toMatch(/targetPlayerId\s+String\?/)
    expect(m).toMatch(/createdById\s+String\?/)
    expect(m).toMatch(/expiresAt\s+DateTime\?/)
    expect(m).toMatch(/maxUses\s+Int\?/)
    expect(m).toMatch(/usedCount\s+Int\s+@default\(0\)/)
    expect(m).toMatch(/revokedAt\s+DateTime\?/)
    expect(m).toMatch(/createdAt\s+DateTime\s+@default\(now\(\)\)/)
  })

  it('schema declares a cascade-on-delete relation from LeagueInvite to League', () => {
    const inviteModel = schema.match(/model LeagueInvite\s*\{[^}]*\}/m)
    expect(inviteModel).not.toBeNull()
    expect(inviteModel![0]).toMatch(
      /league\s+League\s+@relation\(fields:\s*\[leagueId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/,
    )
  })

  it('schema declares the back-relation field on League', () => {
    // Without the back-relation, Prisma's relation graph fails to compile.
    const leagueModel = schema.match(/model League\s*\{[^}]*\}/m)
    expect(leagueModel).not.toBeNull()
    expect(leagueModel![0]).toMatch(/invites\s+LeagueInvite\[\]/)
  })

  it('schema declares the LeagueInvite indexes', () => {
    const inviteModel = schema.match(/model LeagueInvite\s*\{[^}]*\}/m)
    expect(inviteModel).not.toBeNull()
    expect(inviteModel![0]).toMatch(/@@index\(\[leagueId\]\)/)
    expect(inviteModel![0]).toMatch(/@@index\(\[code\]\)/)
  })

  it('migration creates the LeagueInvite table with the expected columns', () => {
    expect(migration).toMatch(/CREATE TABLE "LeagueInvite"/)
    expect(migration).toMatch(/"id" TEXT NOT NULL/)
    expect(migration).toMatch(/"leagueId" TEXT NOT NULL/)
    expect(migration).toMatch(/"code" TEXT NOT NULL/)
    expect(migration).toMatch(/"kind" "InviteKind" NOT NULL/)
    expect(migration).toMatch(/"targetPlayerId" TEXT,/)
    expect(migration).toMatch(/"createdById" TEXT,/)
    expect(migration).toMatch(/"expiresAt" TIMESTAMP\(3\),/)
    expect(migration).toMatch(/"maxUses" INTEGER,/)
    expect(migration).toMatch(/"usedCount" INTEGER NOT NULL DEFAULT 0,/)
    expect(migration).toMatch(/"revokedAt" TIMESTAMP\(3\),/)
    expect(migration).toMatch(
      /"createdAt" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP,/,
    )
    expect(migration).toMatch(
      /CONSTRAINT "LeagueInvite_pkey" PRIMARY KEY \("id"\)/,
    )
  })

  it('migration declares the unique-code index and per-column indexes', () => {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "LeagueInvite_code_key" ON "LeagueInvite"\("code"\);/,
    )
    expect(migration).toMatch(
      /CREATE INDEX "LeagueInvite_leagueId_idx" ON "LeagueInvite"\("leagueId"\);/,
    )
    expect(migration).toMatch(
      /CREATE INDEX "LeagueInvite_code_idx" ON "LeagueInvite"\("code"\);/,
    )
  })

  it('migration creates the cascade-on-delete FK from LeagueInvite to League', () => {
    expect(migration).toMatch(
      /ALTER TABLE "LeagueInvite" ADD CONSTRAINT "LeagueInvite_leagueId_fkey" FOREIGN KEY \("leagueId"\) REFERENCES "League"\("id"\) ON DELETE CASCADE ON UPDATE CASCADE;/,
    )
  })
})

describe('v1.27.0 — Identity rework α: InviteKind enum', () => {
  it('schema declares the InviteKind enum with CODE and PERSONAL variants', () => {
    expect(schema).toMatch(/enum InviteKind\s*\{[^}]*\bCODE\b[^}]*\}/m)
    expect(schema).toMatch(/enum InviteKind\s*\{[^}]*\bPERSONAL\b[^}]*\}/m)
  })

  it('migration creates the InviteKind type', () => {
    expect(migration).toMatch(
      /CREATE TYPE "InviteKind" AS ENUM \('CODE', 'PERSONAL'\);/,
    )
  })
})

describe('v1.27.0 — Identity rework α: stage-1 invariants', () => {
  it('schema does NOT introduce JoinSource enum yet (that is stage 2)', () => {
    // Surface a regression where someone tries to land stage 2 work in this
    // PR — the JoinSource enum and PlayerLeagueAssignment.joinSource column
    // are explicitly stage 2 per outputs/account-player-rework-plan.md §3.
    expect(schema).not.toMatch(/enum JoinSource/)
    const plaModel = schema.match(/model PlayerLeagueAssignment\s*\{[^}]*\}/m)
    expect(plaModel).not.toBeNull()
    expect(plaModel![0]).not.toMatch(/joinSource/)
  })

  it('schema does NOT rename PlayerLeagueAssignment to LeagueMembership', () => {
    // Per user-decided 2026-05-01: keep the name unchanged across all stages.
    // A regression that lands the @@map rename here must fail CI.
    expect(schema).not.toMatch(/model LeagueMembership\s*\{/)
    expect(schema).toMatch(/model PlayerLeagueAssignment\s*\{/)
  })

  it('migration is purely additive: no DROP COLUMN, DROP TABLE, or ALTER TYPE', () => {
    // Stage 1 must be trivially revertible. A regression that includes a
    // destructive statement breaks the additive guarantee. We accept the
    // schema-level CREATE TYPE / CREATE TABLE / ADD COLUMN, but reject any
    // DROP or ALTER on existing schema objects.
    expect(migration).not.toMatch(/\bDROP COLUMN\b/i)
    expect(migration).not.toMatch(/\bDROP TABLE\b/i)
    expect(migration).not.toMatch(/\bDROP TYPE\b/i)
    expect(migration).not.toMatch(/\bALTER TYPE\b/i)
    // The only ALTER TABLE statements should be ADD COLUMN or ADD CONSTRAINT.
    const alterTableLines = migration
      .split('\n')
      .filter((l) => /^\s*ALTER TABLE/.test(l))
    for (const line of alterTableLines) {
      expect(line).toMatch(/ADD (COLUMN|CONSTRAINT)/)
    }
  })
})
