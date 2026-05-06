/**
 * v1.35.0 (PR η) — schema invariants for the original ID-upload migration.
 *
 * These columns LIVED on Player from v1.35.0 → v1.69.x. v1.70.0 moved
 * them to User (see `v170_id_to_user_migration.test.ts`). This test
 * keeps the historical assertion that the v1.35.0 migration file ITSELF
 * is purely additive — that file is immutable on disk and rolled into
 * production long ago. The v1.70.0 migration handles the move.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const MIGRATION_RAW = readFileSync(
  join(ROOT, 'prisma', 'migrations', '20260503020000_id_upload', 'migration.sql'),
  'utf-8',
)
const MIGRATION = MIGRATION_RAW.split(/\r?\n/)
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n')

describe('v1.35.0 (PR η) — original migration SQL is purely additive', () => {
  it('adds three columns as nullable TEXT/TIMESTAMP', () => {
    expect(MIGRATION).toMatch(/ALTER TABLE\s+"Player"\s+ADD COLUMN\s+"idFrontUrl"\s+TEXT\s*;/)
    expect(MIGRATION).toMatch(/ALTER TABLE\s+"Player"\s+ADD COLUMN\s+"idBackUrl"\s+TEXT\s*;/)
    expect(MIGRATION).toMatch(/ALTER TABLE\s+"Player"\s+ADD COLUMN\s+"idUploadedAt"\s+TIMESTAMP\(3\)\s*;/)
  })

  it('does NOT add NOT NULL on any of the three (admin pre-stages have no IDs)', () => {
    const lines = MIGRATION.split('\n')
    for (const col of ['idFrontUrl', 'idBackUrl', 'idUploadedAt']) {
      const line = lines.find((l) => l.includes(`ADD COLUMN "${col}"`))
      expect(line, `${col} ADD COLUMN line not found`).toBeTruthy()
      expect(line).not.toMatch(/NOT NULL/)
    }
  })

  it('does not destructively touch any existing column or table', () => {
    expect(MIGRATION).not.toMatch(/DROP COLUMN/)
    expect(MIGRATION).not.toMatch(/DROP TABLE/)
    expect(MIGRATION).not.toMatch(/DROP TYPE/)
    expect(MIGRATION).not.toMatch(/ALTER COLUMN/)
  })
})
