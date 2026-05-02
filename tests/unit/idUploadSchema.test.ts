/**
 * v1.35.0 (PR η) — schema invariants for the ID-upload migration.
 *
 * Three additive nullable columns on Player. Reads schema.prisma + the
 * migration SQL as text and asserts the load-bearing shapes.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const SCHEMA = readFileSync(join(ROOT, 'prisma', 'schema.prisma'), 'utf-8')
const MIGRATION_RAW = readFileSync(
  join(ROOT, 'prisma', 'migrations', '20260503020000_id_upload', 'migration.sql'),
  'utf-8',
)
const MIGRATION = MIGRATION_RAW.split(/\r?\n/)
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n')

describe('v1.35.0 (PR η) — Player.idFront/idBack/idUploadedAt columns', () => {
  it('schema has all three nullable columns', () => {
    const block = SCHEMA.match(/model Player\s*\{[^}]+\}/)
    expect(block).toBeTruthy()
    expect(block![0]).toMatch(/idFrontUrl\s+String\?/)
    expect(block![0]).toMatch(/idBackUrl\s+String\?/)
    expect(block![0]).toMatch(/idUploadedAt\s+DateTime\?/)
  })
})

describe('v1.35.0 (PR η) — migration SQL is purely additive', () => {
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
