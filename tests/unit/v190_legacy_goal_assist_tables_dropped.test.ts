import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

/**
 * v1.90.0 — step 2 of the legacy table cleanup. Step 1 (PR #255 / v1.89.0)
 * removed every writer + reader of the `Goal` and `Assist` tables. This PR
 * drops the tables themselves via migration `drop_legacy_goal_assist`, and
 * removes the matching `model Goal` / `model Assist` blocks from
 * `prisma/schema.prisma` plus the four back-relation fields (LeagueTeam,
 * Player×2, Match×2) that pointed at them.
 *
 * Stash-pop sanity: re-introducing either model (or any of the back-relation
 * fields) re-fails the corresponding case below. Removing the migration
 * file or the DROP TABLE statements re-fails the migration cases.
 */

describe('v1.90.0 — Goal + Assist Prisma models removed from schema', () => {
  const repoRoot = process.cwd()
  const schema = readFileSync(join(repoRoot, 'prisma/schema.prisma'), 'utf8')

  it('no `model Goal {` block exists', () => {
    expect(schema).not.toMatch(/^\s*model\s+Goal\s*\{/m)
  })

  it('no `model Assist {` block exists', () => {
    expect(schema).not.toMatch(/^\s*model\s+Assist\s*\{/m)
  })

  it('no model declares a `Goal[]` back-relation field', () => {
    // Field declarations look like `  goals  Goal[]` (whitespace-prefixed,
    // identifier, type with `[]`). Comments mentioning Goal[] would have
    // a `//` somewhere on the line — exclude those.
    const lines = schema.split('\n')
    const offenders = lines.filter(
      (line) => /^\s*\w+\s+Goal\[\]/.test(line) && !/\/\//.test(line),
    )
    expect(offenders).toEqual([])
  })

  it('no model declares an `Assist[]` back-relation field', () => {
    const lines = schema.split('\n')
    const offenders = lines.filter(
      (line) => /^\s*\w+\s+Assist\[\]/.test(line) && !/\/\//.test(line),
    )
    expect(offenders).toEqual([])
  })
})

describe('v1.90.0 — drop_legacy_goal_assist migration is present', () => {
  const repoRoot = process.cwd()
  const migrationDir = join(
    repoRoot,
    'prisma/migrations/20260520000000_drop_legacy_goal_assist',
  )
  const migrationPath = join(migrationDir, 'migration.sql')

  it('migration directory exists', () => {
    expect(existsSync(migrationDir)).toBe(true)
  })

  it('migration.sql exists', () => {
    expect(existsSync(migrationPath)).toBe(true)
  })

  const sql = existsSync(migrationPath)
    ? readFileSync(migrationPath, 'utf8')
    : ''

  it('drops the Goal table', () => {
    expect(sql).toMatch(/DROP TABLE "Goal"\s*;/)
  })

  it('drops the Assist table', () => {
    expect(sql).toMatch(/DROP TABLE "Assist"\s*;/)
  })

  it('drops Goal foreign keys before the table', () => {
    expect(sql).toMatch(/ALTER TABLE "Goal" DROP CONSTRAINT "Goal_matchId_fkey"/)
    expect(sql).toMatch(/ALTER TABLE "Goal" DROP CONSTRAINT "Goal_playerId_fkey"/)
    expect(sql).toMatch(
      /ALTER TABLE "Goal" DROP CONSTRAINT "Goal_scoringTeamId_fkey"/,
    )
  })

  it('drops Assist foreign keys before the table', () => {
    expect(sql).toMatch(
      /ALTER TABLE "Assist" DROP CONSTRAINT "Assist_matchId_fkey"/,
    )
    expect(sql).toMatch(
      /ALTER TABLE "Assist" DROP CONSTRAINT "Assist_playerId_fkey"/,
    )
    expect(sql).toMatch(
      /ALTER TABLE "Assist" DROP CONSTRAINT "Assist_goalId_fkey"/,
    )
  })

  it('does not touch any table other than Goal + Assist', () => {
    // Surface every `ALTER TABLE` / `DROP TABLE` statement; require all of
    // them to target Goal or Assist. The migration must not reach beyond
    // its stated scope (a v1.86.1-style accident on a hand-edited migration
    // would surface as a stray table identifier here).
    const stmts = sql.match(
      /(?:ALTER|DROP)\s+TABLE\s+"([^"]+)"/g,
    ) ?? []
    const targets = new Set(
      stmts.map((m) => m.match(/"([^"]+)"/)![1]),
    )
    const allowed = new Set(['Goal', 'Assist'])
    const stray = [...targets].filter((t) => !allowed.has(t))
    expect(stray).toEqual([])
  })
})
