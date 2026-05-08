/**
 * v1.81.0 — per-league `idRequired` toggle for registration ID upload.
 *
 * Test surface (text-grep style, mirrors the v1.80.0 pattern):
 *   - Schema: League.idRequired exists, Boolean, defaults true
 *   - Migration: additive only (no DROP/ALTER COLUMN/TRUNCATE)
 *   - Admin: updateLeagueDetails accepts + validates idRequired
 *   - Admin: LeagueDetailsEditor + SettingsTab thread initialIdRequired
 *   - RegistrationFields: requireId prop gates ID segment + validation
 *   - registerToLeague: re-derives requireId server-side; conditionally
 *     validates URLs and skips User-row ID write on the no-id path
 *   - completeOnboardingWithId: same shape — re-derived gate
 *   - Pages: recruit + join onboarding compute requireId from
 *     league.idRequired AND user.idUploadedAt
 *   - "ID on file" === user.idUploadedAt non-null (strict)
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const root = path.resolve(__dirname, '../../')

function readSrc(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

// ── Schema ────────────────────────────────────────────────────────────────────

describe('v1.81.0 — schema', () => {
  const schema = readSrc('prisma/schema.prisma')

  it('League has idRequired Boolean field with @default(true)', () => {
    expect(schema).toMatch(/idRequired\s+Boolean\s+@default\(true\)/)
  })
})

// ── Migration ─────────────────────────────────────────────────────────────────

describe('v1.81.0 — migration', () => {
  const migrationDir = path.join(
    root,
    'prisma/migrations/20260515000000_league_id_required',
  )
  const sqlPath = path.join(migrationDir, 'migration.sql')

  it('migration file exists', () => {
    expect(fs.existsSync(sqlPath)).toBe(true)
  })

  it('migration only adds the column (no DROP/TRUNCATE/DELETE FROM)', () => {
    const sql = fs.readFileSync(sqlPath, 'utf8').replace(/--[^\n]*/g, '')
    const upper = sql.toUpperCase()
    expect(upper).not.toMatch(/\bDROP\b/)
    expect(upper).not.toMatch(/\bTRUNCATE\b/)
    expect(upper).not.toMatch(/\bDELETE FROM\b/)
  })

  it('migration adds idRequired to League with NOT NULL DEFAULT true', () => {
    const sql = fs.readFileSync(sqlPath, 'utf8')
    expect(sql).toMatch(
      /ALTER TABLE "League" ADD COLUMN "idRequired" BOOLEAN NOT NULL DEFAULT true/,
    )
  })
})

// ── Admin server action ───────────────────────────────────────────────────────

describe('v1.81.0 — updateLeagueDetails accepts idRequired', () => {
  const src = readSrc('src/app/admin/leagues/actions.ts')

  it('input shape declares idRequired', () => {
    // The handler signature includes `idRequired?: boolean`.
    expect(src).toMatch(/idRequired\?:\s*boolean/)
  })

  it('validates idRequired is a boolean', () => {
    expect(src).toMatch(/idRequired must be a boolean/)
  })

  it('writes idRequired into the update data block', () => {
    expect(src).toMatch(/data\.idRequired\s*=\s*input\.idRequired/)
  })
})

// ── Admin editor + SettingsTab plumbing ───────────────────────────────────────

describe('v1.81.0 — LeagueDetailsEditor + SettingsTab', () => {
  const editor = readSrc('src/components/admin/LeagueDetailsEditor.tsx')
  const settings = readSrc('src/components/admin/SettingsTab.tsx')

  it('LeagueDetailsEditor declares initialIdRequired prop', () => {
    expect(editor).toMatch(/initialIdRequired\s*:\s*boolean/)
  })

  it('LeagueDetailsEditor renders the toggle with the testid', () => {
    expect(editor).toMatch(/data-testid="league-details-id-required-toggle"/)
  })

  it('LeagueDetailsEditor passes idRequired through updateLeagueDetails', () => {
    expect(editor).toMatch(/idRequired,/)
  })

  it('SettingsTab threads initialIdRequired into LeagueDetailsEditor', () => {
    expect(settings).toMatch(/initialIdRequired=\{league\.idRequired\}/)
  })

  it('SettingsTab League type declares idRequired', () => {
    expect(settings).toMatch(/idRequired:\s*boolean/)
  })
})

// ── RegistrationFields conditional rendering + prettify ──────────────────────

describe('v1.81.0 — RegistrationFields gates the ID segment', () => {
  const src = readSrc('src/components/registration/RegistrationFields.tsx')

  it('RegistrationFieldsProps declares requireId optional with default true', () => {
    expect(src).toMatch(/requireId\?\s*:\s*boolean/)
    expect(src).toMatch(/requireId\s*=\s*true/)
  })

  it('idFrontUrl + idBackUrl are nullable strings on the submit shape', () => {
    // Empty strings on the no-id path; server actions accept null/empty.
    expect(src).toMatch(/idFrontUrl\s*:\s*string/)
    expect(src).toMatch(/idBackUrl\s*:\s*string/)
  })

  it('renders the ID segment ONLY when requireId is truthy', () => {
    expect(src).toMatch(/\{requireId\s*&&\s*\(/)
  })

  it('renders the prettify section dividers (FormSection)', () => {
    expect(src).toMatch(/function FormSection\(/)
    expect(src).toMatch(/border-t border-border-default first:border-t-0/)
  })

  it('renders the Callout helper for the privacy note + keeps the v1.76.1 ID callout literal', () => {
    expect(src).toMatch(/function Callout\(/)
    // v1.76.1 callout stays as a literal div so the operator copy + testid pins keep passing.
    expect(src).toMatch(/data-testid="registration-id-callout"/)
    // Privacy callout uses the new helper.
    expect(src).toMatch(/testid="registration-id-privacy"/)
  })

  it('uses uppercase tracked font-display headings on sections (matches site aesthetic)', () => {
    expect(src).toMatch(/font-display uppercase tracking-widest/)
  })

  it('client validation requires ID files only when requireId is true', () => {
    expect(src).toMatch(/if \(requireId\) \{/)
  })

  it('submit returns empty strings for ID urls on the no-id path', () => {
    // RegistrationFieldsSubmit returns '' when no upload happened.
    expect(src).toMatch(/idFrontUrl:\s*front\?\.url\s*\?\?\s*''/)
    expect(src).toMatch(/idBackUrl:\s*back\?\.url\s*\?\?\s*''/)
  })
})

// ── recruit /[slug] page + RegistrationForm ───────────────────────────────────

describe('v1.81.0 — recruit page threads requireId', () => {
  const page = readSrc('src/app/recruit/[slug]/page.tsx')
  const form = readSrc('src/app/recruit/[slug]/RegistrationForm.tsx')

  it('recruit page selects league.idRequired', () => {
    expect(page).toMatch(/idRequired:\s*true/)
  })

  it('recruit page selects user.idUploadedAt for the gate', () => {
    expect(page).toMatch(/idUploadedAt:\s*true/)
  })

  it('recruit page computes requireId = league.idRequired && !user.idUploadedAt', () => {
    expect(page).toMatch(
      /requireId\s*=\s*league\.idRequired\s*&&\s*!user\?\.idUploadedAt/,
    )
  })

  it('recruit page passes requireId to RegistrationForm', () => {
    expect(page).toMatch(/requireId=\{requireId\}/)
  })

  it('RegistrationForm declares the requireId prop', () => {
    expect(form).toMatch(/requireId:\s*boolean/)
  })

  it('RegistrationForm passes requireId through to RegistrationFields', () => {
    expect(form).toMatch(/requireId=\{requireId\}/)
  })
})

// ── registerToLeague server validation ────────────────────────────────────────

describe('v1.81.0 — registerToLeague re-derives requireId server-side', () => {
  const src = readSrc('src/app/api/recruiting/actions.ts')

  it('input idFrontUrl + idBackUrl are nullable (string | null)', () => {
    expect(src).toMatch(/idFrontUrl:\s*string\s*\|\s*null/)
    expect(src).toMatch(/idBackUrl:\s*string\s*\|\s*null/)
  })

  it('selects league.idRequired in the league fetch', () => {
    expect(src).toMatch(/idRequired:\s*true/)
  })

  it('selects user.idUploadedAt in the user fetch', () => {
    expect(src).toMatch(/idUploadedAt:\s*true/)
  })

  it('computes requireId = league.idRequired && !user.idUploadedAt', () => {
    expect(src).toMatch(
      /requireId\s*=\s*league\.idRequired\s*&&\s*!user\.idUploadedAt/,
    )
  })

  it('only validates ID urls when requireId is true', () => {
    expect(src).toMatch(/if \(requireId\) \{/)
  })

  it('only writes idFront/idBack/idUploadedAt when requireId is true', () => {
    // Conditional spread inside the User update data block.
    expect(src).toMatch(/\.\.\.\(requireId/)
  })

  it('rejects missing front URL when requireId is true (regression target)', () => {
    expect(src).toMatch(
      /!input\.idFrontUrl\s*\|\|\s*!isOwnedBlobUrl\(input\.idFrontUrl/,
    )
  })

  it('rejects missing back URL when requireId is true (regression target)', () => {
    expect(src).toMatch(
      /!input\.idBackUrl\s*\|\|\s*!isOwnedBlobUrl\(input\.idBackUrl/,
    )
  })
})

// ── completeOnboardingWithId server validation ────────────────────────────────

describe('v1.81.0 — completeOnboardingWithId re-derives requireId server-side', () => {
  const src = readSrc('src/app/join/[code]/actions.ts')

  it('input idFrontUrl + idBackUrl are nullable (string | null)', () => {
    expect(src).toMatch(/idFrontUrl:\s*string\s*\|\s*null/)
    expect(src).toMatch(/idBackUrl:\s*string\s*\|\s*null/)
  })

  it('selects league.idRequired in the invite/league fetch', () => {
    expect(src).toMatch(/idRequired:\s*true/)
  })

  it('selects user.idUploadedAt in the user fetch', () => {
    expect(src).toMatch(/idUploadedAt:\s*true/)
  })

  it('computes requireId = league.idRequired && !user.idUploadedAt', () => {
    expect(src).toMatch(/requireId\s*=\s*invite\.league\.idRequired\s*&&\s*!userRow\?\.idUploadedAt/)
  })

  it('only validates ID urls when requireId is true', () => {
    expect(src).toMatch(/if \(requireId\) \{/)
  })

  it('only writes idFront/idBack/idUploadedAt when requireId is true', () => {
    expect(src).toMatch(/\.\.\.\(requireId/)
  })
})

// ── join onboarding page + OnboardingForm ─────────────────────────────────────

describe('v1.81.0 — join onboarding page threads requireId', () => {
  const page = readSrc('src/app/join/[code]/onboarding/page.tsx')
  const form = readSrc('src/app/join/[code]/onboarding/OnboardingForm.tsx')

  it('join onboarding page selects league.idRequired', () => {
    expect(page).toMatch(/idRequired:\s*true/)
  })

  it('join onboarding page selects user.idUploadedAt for the gate', () => {
    expect(page).toMatch(/idUploadedAt:\s*true/)
  })

  it('join onboarding page computes requireId from league + user', () => {
    expect(page).toMatch(
      /requireId\s*=\s*league\.idRequired\s*&&\s*!userRow\?\.idUploadedAt/,
    )
  })

  it('join onboarding page passes requireId to OnboardingForm', () => {
    expect(page).toMatch(/requireId=\{requireId\}/)
  })

  it('OnboardingForm declares the requireId prop', () => {
    expect(form).toMatch(/requireId:\s*boolean/)
  })

  it('OnboardingForm passes requireId through to RegistrationFields', () => {
    expect(form).toMatch(/requireId=\{requireId\}/)
  })

  it('OnboardingForm sends nullable idFrontUrl/idBackUrl on submit', () => {
    expect(form).toMatch(/idFrontUrl:\s*input\.idFrontUrl\s*\|\|\s*null/)
    expect(form).toMatch(/idBackUrl:\s*input\.idBackUrl\s*\|\|\s*null/)
  })
})

// ── Version ───────────────────────────────────────────────────────────────────

describe('v1.81.0 — version bump', () => {
  const version = readSrc('src/lib/version.ts')

  it('APP_VERSION is 1.81.x or later', () => {
    expect(version).toMatch(/APP_VERSION\s*=\s*'1\.(81|[89]\d|\d{3,})\.[0-9]+'/)
  })
})
