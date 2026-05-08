/**
 * v1.80.0 — Comments free-text field on onboarding form + admin display.
 *
 * Test surface:
 *   - Schema: PlayerLeagueMembership.comments exists, is nullable
 *   - Migration: additive only (no DROP/ALTER COLUMN/TRUNCATE)
 *   - RegistrationFieldsSubmit declares `comments`
 *   - RegistrationFieldsProps declares `initialComments`
 *   - RegistrationFields renders the comments textarea
 *   - Server actions (registerToLeague + completeOnboardingWithId) persist comments
 *   - Admin Players display (PlayerRow.comments + EditPlayerPanel testid)
 *   - Regression targets
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const root = path.resolve(__dirname, '../../')

function readSrc(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

// ── Schema ────────────────────────────────────────────────────────────────────

describe('v1.80.0 — schema', () => {
  const schema = readSrc('prisma/schema.prisma')

  it('PlayerLeagueMembership has comments field', () => {
    // Must appear inside the model block and be nullable (no trailing ?)
    // The field is String? (nullable text via migration TEXT type).
    expect(schema).toMatch(/comments\s+String\?/)
  })

  it('comments field appears after feeOverride (correct ordering)', () => {
    const feePos = schema.indexOf('feeOverride Int?')
    const commentsPos = schema.indexOf('comments String?')
    expect(feePos).toBeGreaterThan(-1)
    expect(commentsPos).toBeGreaterThan(feePos)
  })
})

// ── Migration ─────────────────────────────────────────────────────────────────

describe('v1.80.0 — migration', () => {
  const migrationDir = path.join(root, 'prisma/migrations/20260514000000_plm_comments')
  const sql = fs.readFileSync(path.join(migrationDir, 'migration.sql'), 'utf8')
    // Strip SQL comments so rollback recipe doesn't false-positive.
    .replace(/--[^\n]*/g, '')

  it('migration file exists', () => {
    expect(fs.existsSync(path.join(migrationDir, 'migration.sql'))).toBe(true)
  })

  it('migration only adds the column (no DROP/TRUNCATE/DELETE FROM)', () => {
    const upper = sql.toUpperCase()
    expect(upper).not.toMatch(/\bDROP\b/)
    expect(upper).not.toMatch(/\bTRUNCATE\b/)
    expect(upper).not.toMatch(/\bDELETE FROM\b/)
  })

  it('migration adds comments to PlayerLeagueAssignment', () => {
    expect(sql).toMatch(/ALTER TABLE "PlayerLeagueAssignment" ADD COLUMN "comments" TEXT/)
  })
})

// ── RegistrationFields component ──────────────────────────────────────────────

describe('v1.80.0 — RegistrationFields', () => {
  const fields = readSrc('src/components/registration/RegistrationFields.tsx')

  it('RegistrationFieldsSubmit declares comments', () => {
    expect(fields).toMatch(/comments\s*:\s*string/)
  })

  it('RegistrationFieldsProps declares initialComments', () => {
    expect(fields).toMatch(/initialComments\?/)
  })

  it('comments textarea is rendered with correct testid', () => {
    expect(fields).toMatch(/data-testid="registration-comments"/)
  })

  it('comments textarea is a textarea element', () => {
    expect(fields).toMatch(/<textarea/)
  })

  it('helper text matches spec', () => {
    expect(fields).toMatch(/Anything you'd like the admin to know/)
  })

  it('comments state is initialized from initialComments prop', () => {
    expect(fields).toMatch(/useState\(initialComments\)/)
  })

  it('comments is passed to onSubmit', () => {
    expect(fields).toMatch(/comments\s*:\s*comments\.trim\(\)/)
  })

  it('comments textarea renders AFTER profile picture (correct order)', () => {
    const picPos = fields.indexOf('registration-profile-picture')
    const commentsPos = fields.indexOf('registration-comments')
    expect(picPos).toBeGreaterThan(-1)
    expect(commentsPos).toBeGreaterThan(picPos)
  })
})

// ── registerToLeague server action ────────────────────────────────────────────

describe('v1.80.0 — registerToLeague', () => {
  const src = readSrc('src/app/api/recruiting/actions.ts')

  it('RegisterToLeagueInput declares comments', () => {
    expect(src).toMatch(/comments\?.*string.*null/)
  })

  it('PLM creation includes comments in data block', () => {
    // Must contain `comments: input.comments` in the PLM create data.
    expect(src).toMatch(/comments\s*:\s*input\.comments/)
  })

  it('comments is trimmed before storage (regression target)', () => {
    expect(src).toMatch(/input\.comments\?\.trim\(\)/)
  })
})

// ── completeOnboardingWithId server action ────────────────────────────────────

describe('v1.80.0 — completeOnboardingWithId', () => {
  const src = readSrc('src/app/join/[code]/actions.ts')

  it('CompleteOnboardingWithIdInput declares comments', () => {
    expect(src).toMatch(/comments\?.*string.*null/)
  })

  it('PLM update includes comments in data block', () => {
    expect(src).toMatch(/comments\s*:\s*input\.comments/)
  })

  it('comments is trimmed before storage (regression target)', () => {
    expect(src).toMatch(/input\.comments\?\.trim\(\)/)
  })
})

// ── RegistrationForm (recruit slug) ──────────────────────────────────────────

describe('v1.80.0 — RegistrationForm threads comments', () => {
  const src = readSrc('src/app/recruit/[slug]/RegistrationForm.tsx')

  it('passes input.comments to registerToLeague', () => {
    expect(src).toMatch(/comments\s*:\s*input\.comments/)
  })
})

// ── OnboardingForm (join code) ────────────────────────────────────────────────

describe('v1.80.0 — OnboardingForm threads comments', () => {
  const src = readSrc('src/app/join/[code]/onboarding/OnboardingForm.tsx')

  it('passes input.comments to completeOnboardingWithId', () => {
    expect(src).toMatch(/comments\s*:\s*input\.comments/)
  })
})

// ── Admin Players display ─────────────────────────────────────────────────────

describe('v1.80.0 — admin Players display', () => {
  const playersTab = readSrc('src/components/admin/PlayersTab.tsx')
  const playersPage = readSrc('src/app/admin/leagues/[id]/players/page.tsx')
  const adminData = readSrc('src/lib/admin-data.ts')

  it('PlayerRow interface has comments field', () => {
    expect(playersTab).toMatch(/comments\?.*string.*null/)
  })

  it('EditPlayerPanel renders player-comments testid when comments present', () => {
    expect(playersTab).toMatch(/data-testid=\{`player-comments-\$\{player\.id\}`\}/)
  })

  it('EditPlayerPanel shows "Applicant comments" label', () => {
    expect(playersTab).toMatch(/Applicant comments/)
  })

  it('comments are conditionally rendered (hidden when null/empty)', () => {
    expect(playersTab).toMatch(/player\.comments\s*&&/)
  })

  it('players page threads comments for APPROVED members', () => {
    expect(playersPage).toMatch(/comments\s*:\s*a\.comments/)
  })

  it('players page threads comments for PENDING members', () => {
    expect(playersPage).toMatch(/comments\s*:\s*p\.comments/)
  })

  it('admin-data carries comments from pendingMemberships PLM', () => {
    expect(adminData).toMatch(/comments\s*:\s*plm\.comments/)
  })
})

// ── Version ───────────────────────────────────────────────────────────────────

describe('v1.80.0 — version bump', () => {
  const version = readSrc('src/lib/version.ts')

  it('APP_VERSION is 1.80.0 or later', () => {
    // v1.81.0 — relax the regex so any 1.MINOR≥80 release matches; the
    // original literal pinned 1.80.x and broke on the next bump.
    expect(version).toMatch(/APP_VERSION\s*=\s*'1\.(?:8\d|9\d|\d{3,})\.[0-9]+'/)
  })
})
