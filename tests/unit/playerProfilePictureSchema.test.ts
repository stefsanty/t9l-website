/**
 * v1.37.0 (PR ι) — schema invariants for the profile-picture migration.
 *
 * One additive nullable column on Player. Reads schema.prisma + the
 * migration SQL as text and asserts the load-bearing shapes.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const SCHEMA = readFileSync(join(ROOT, 'prisma', 'schema.prisma'), 'utf-8')
const MIGRATION_RAW = readFileSync(
  join(ROOT, 'prisma', 'migrations', '20260503040000_player_profile_picture', 'migration.sql'),
  'utf-8',
)
const MIGRATION = MIGRATION_RAW.split(/\r?\n/)
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n')

describe('v1.37.0 (PR ι) — Player.profilePictureUrl column', () => {
  it('schema has profilePictureUrl as nullable String', () => {
    const block = SCHEMA.match(/model Player\s*\{[\s\S]+?\n\}/)
    expect(block, 'Player model not found').toBeTruthy()
    expect(block![0]).toMatch(/profilePictureUrl\s+String\?/)
  })

  it('does NOT touch the legacy pictureUrl column (still present)', () => {
    const block = SCHEMA.match(/model Player\s*\{[\s\S]+?\n\}/)
    expect(block![0]).toMatch(/\bpictureUrl\s+String\?/)
  })
})

describe('v1.37.0 (PR ι) — migration SQL is purely additive', () => {
  it('adds profilePictureUrl as nullable TEXT', () => {
    expect(MIGRATION).toMatch(
      /ALTER TABLE\s+"Player"\s+ADD COLUMN\s+"profilePictureUrl"\s+TEXT\s*;/,
    )
  })

  it('does not destructively touch any existing column or table', () => {
    expect(MIGRATION).not.toMatch(/DROP COLUMN/)
    expect(MIGRATION).not.toMatch(/DROP TABLE/)
    expect(MIGRATION).not.toMatch(/DROP TYPE/)
    expect(MIGRATION).not.toMatch(/ALTER TYPE/)
  })

  it('does not add NOT NULL on the new column (existing rows have no asset)', () => {
    const lines = MIGRATION.split('\n')
    const addLine = lines.find((l) => l.includes('ADD COLUMN "profilePictureUrl"'))
    expect(addLine).toBeTruthy()
    expect(addLine).not.toMatch(/NOT NULL/)
  })
})

describe('v1.37.0 (PR ι) — render-priority helper', () => {
  it('pickPlayerAvatarUrl prefers profilePictureUrl over pictureUrl', async () => {
    const { pickPlayerAvatarUrl } = await import('@/lib/playerAvatar')
    expect(
      pickPlayerAvatarUrl({
        profilePictureUrl: 'https://blob/profile.jpg',
        pictureUrl: 'https://line/cdn.jpg',
      }),
    ).toBe('https://blob/profile.jpg')
  })

  it('falls back to pictureUrl when profilePictureUrl is null', async () => {
    const { pickPlayerAvatarUrl } = await import('@/lib/playerAvatar')
    expect(
      pickPlayerAvatarUrl({ profilePictureUrl: null, pictureUrl: 'https://line/cdn.jpg' }),
    ).toBe('https://line/cdn.jpg')
  })

  it('returns null when both are null/undefined', async () => {
    const { pickPlayerAvatarUrl } = await import('@/lib/playerAvatar')
    expect(pickPlayerAvatarUrl({ profilePictureUrl: null, pictureUrl: null })).toBeNull()
    expect(pickPlayerAvatarUrl({})).toBeNull()
  })

  it('treats empty string the same as the value (does not coerce to null)', async () => {
    const { pickPlayerAvatarUrl } = await import('@/lib/playerAvatar')
    // ?? only triggers on null/undefined, so empty string survives as-is.
    // Document this so a future reader knows the helper isn't doing
    // truthiness coercion. If we ever wanted "skip empty string too" that
    // would be a deliberate change.
    expect(
      pickPlayerAvatarUrl({ profilePictureUrl: '', pictureUrl: 'fallback' }),
    ).toBe('')
  })
})
