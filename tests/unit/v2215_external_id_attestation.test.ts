/**
 * v2.2.15 — external-ID attestation + admin-triggered re-upload tests.
 *
 * Five areas pinned:
 *   (A) Pure helper `selectIdSectionMode()` — exhaustive priority
 *       branches (none / reupload-requested / external / reuse-existing
 *       / upload). The helper is the single source of truth for which
 *       UI branch `RegistrationFields` renders; pinning the pure
 *       function keeps the render-time logic and the server-side gate
 *       in lockstep.
 *   (B) Schema — six new columns on User, defaults, nullability.
 *   (C) Migration — additive ADD COLUMN only; no DROP / ALTER COLUMN
 *       on existing data.
 *   (D) Admin actions — four exports, all `assertAdmin`-gated, all
 *       write the matching three columns (or clear them), all
 *       revalidate `domain: 'admin'`.
 *   (E) Server-action + proxy + UI prop wiring — source-pin checks on
 *       the v2.2.15 branches landing in the right files.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { selectIdSectionMode } from '@/lib/registration-helpers'

const root = resolve(__dirname, '../..')
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8')

// ── (A) Pure helper ─────────────────────────────────────────────────

describe('v2.2.15 (A) — selectIdSectionMode priority branches', () => {
  const base = {
    idRequired: true,
    hasExistingIds: false,
    idCollectedExternally: false,
    idReuploadRequested: false,
  }

  it('returns "none" when idRequired is false (league opted out)', () => {
    expect(selectIdSectionMode({ ...base, idRequired: false })).toBe('none')
    // Other flags should not matter when idRequired is false.
    expect(
      selectIdSectionMode({
        ...base,
        idRequired: false,
        hasExistingIds: true,
        idCollectedExternally: true,
        idReuploadRequested: true,
      }),
    ).toBe('none')
  })

  it('returns "reupload-requested" when admin requested fresh upload (top priority)', () => {
    expect(
      selectIdSectionMode({ ...base, idReuploadRequested: true }),
    ).toBe('reupload-requested')
    // Wins over existing IDs.
    expect(
      selectIdSectionMode({
        ...base,
        idReuploadRequested: true,
        hasExistingIds: true,
      }),
    ).toBe('reupload-requested')
    // Wins over external attestation.
    expect(
      selectIdSectionMode({
        ...base,
        idReuploadRequested: true,
        idCollectedExternally: true,
      }),
    ).toBe('reupload-requested')
  })

  it('returns "external" when admin marked ID collected externally', () => {
    expect(
      selectIdSectionMode({ ...base, idCollectedExternally: true }),
    ).toBe('external')
    // Wins over existing IDs.
    expect(
      selectIdSectionMode({
        ...base,
        idCollectedExternally: true,
        hasExistingIds: true,
      }),
    ).toBe('external')
  })

  it('returns "reuse-existing" when user has IDs on file and no admin override', () => {
    expect(selectIdSectionMode({ ...base, hasExistingIds: true })).toBe(
      'reuse-existing',
    )
  })

  it('returns "upload" as the default', () => {
    expect(selectIdSectionMode(base)).toBe('upload')
  })

  it('priority is reupload > external > reuse-existing > upload', () => {
    // Smoke test of the ordering: turn on each flag one-at-a-time
    // and verify the highest-priority mode wins.
    expect(
      selectIdSectionMode({
        idRequired: true,
        idReuploadRequested: true,
        idCollectedExternally: true,
        hasExistingIds: true,
      }),
    ).toBe('reupload-requested')
    expect(
      selectIdSectionMode({
        idRequired: true,
        idReuploadRequested: false,
        idCollectedExternally: true,
        hasExistingIds: true,
      }),
    ).toBe('external')
    expect(
      selectIdSectionMode({
        idRequired: true,
        idReuploadRequested: false,
        idCollectedExternally: false,
        hasExistingIds: true,
      }),
    ).toBe('reuse-existing')
    expect(
      selectIdSectionMode({
        idRequired: true,
        idReuploadRequested: false,
        idCollectedExternally: false,
        hasExistingIds: false,
      }),
    ).toBe('upload')
  })
})

// ── (B) Schema ──────────────────────────────────────────────────────

describe('v2.2.15 (B) — schema additions on User', () => {
  const schema = read('prisma/schema.prisma')

  it('declares idCollectedExternally Boolean with default false', () => {
    expect(schema).toMatch(/idCollectedExternally\s+Boolean\s+@default\(false\)/)
  })

  it('declares idCollectedExternallyAt DateTime?', () => {
    expect(schema).toMatch(/idCollectedExternallyAt\s+DateTime\?/)
  })

  it('declares idCollectedExternallyNotes String?', () => {
    expect(schema).toMatch(/idCollectedExternallyNotes\s+String\?/)
  })

  it('declares idReuploadRequested Boolean with default false', () => {
    expect(schema).toMatch(/idReuploadRequested\s+Boolean\s+@default\(false\)/)
  })

  it('declares idReuploadRequestedAt DateTime?', () => {
    expect(schema).toMatch(/idReuploadRequestedAt\s+DateTime\?/)
  })

  it('declares idReuploadRequestedNotes String?', () => {
    expect(schema).toMatch(/idReuploadRequestedNotes\s+String\?/)
  })
})

// ── (C) Migration ───────────────────────────────────────────────────

describe('v2.2.15 (C) — migration is additive ADD COLUMN only', () => {
  const sql = read(
    'prisma/migrations/20260605000000_add_user_id_attestation_fields/migration.sql',
  )

  it('adds all six columns to "User"', () => {
    expect(sql).toMatch(/ADD COLUMN "idCollectedExternally"\s+BOOLEAN\s+NOT NULL DEFAULT false/)
    expect(sql).toMatch(/ADD COLUMN "idCollectedExternallyAt"\s+TIMESTAMP/)
    expect(sql).toMatch(/ADD COLUMN "idCollectedExternallyNotes"\s+TEXT/)
    expect(sql).toMatch(/ADD COLUMN "idReuploadRequested"\s+BOOLEAN\s+NOT NULL DEFAULT false/)
    expect(sql).toMatch(/ADD COLUMN "idReuploadRequestedAt"\s+TIMESTAMP/)
    expect(sql).toMatch(/ADD COLUMN "idReuploadRequestedNotes"\s+TEXT/)
  })

  it('contains no destructive statements (excluding the rollback-recipe comments)', () => {
    // Strip `--` line comments so the rollback recipe (which documents
    // the DROP COLUMNs an operator would run on revert) doesn't trip
    // the destructive-statement check.
    const noComments = sql
      .split('\n')
      .map((line) => line.replace(/--.*/, ''))
      .join('\n')
    expect(noComments).not.toMatch(/\bDROP\s+(COLUMN|TABLE)\b/i)
    expect(noComments).not.toMatch(/\bALTER\s+COLUMN\b/i)
    expect(noComments).not.toMatch(/\bTRUNCATE\b/i)
    expect(noComments).not.toMatch(/\bDELETE\s+FROM\b/i)
  })
})

// ── (D) Admin actions ───────────────────────────────────────────────

describe('v2.2.15 (D) — admin actions assertAdmin + revalidate', () => {
  const src = read('src/app/admin/users/actions.ts')

  it("starts with 'use server'", () => {
    expect(src).toMatch(/^'use server'/)
  })

  it('exports the four required actions', () => {
    expect(src).toMatch(/export async function markUserIdExternal\b/)
    expect(src).toMatch(/export async function revokeUserIdExternal\b/)
    expect(src).toMatch(/export async function requestUserIdReupload\b/)
    expect(src).toMatch(/export async function cancelUserIdReuploadRequest\b/)
  })

  it('gates every action on assertAdmin()', () => {
    // The helper is inlined; both the function declaration and four
    // call sites must be present.
    expect(src).toMatch(/async function assertAdmin\(\)/)
    const calls = (src.match(/await assertAdmin\(\)/g) ?? []).length
    expect(calls).toBeGreaterThanOrEqual(4)
  })

  it('markUserIdExternal writes the three external columns', () => {
    expect(src).toMatch(/idCollectedExternally:\s*true/)
    expect(src).toMatch(/idCollectedExternallyAt:\s*new Date\(\)/)
    expect(src).toMatch(/idCollectedExternallyNotes:\s*normalised/)
  })

  it('revokeUserIdExternal clears the three external columns', () => {
    // `idCollectedExternally: false` and the matching `null` writes for
    // the timestamp + notes appear ONLY under revoke — across the four
    // actions, each pair of `<col>: false / <col>: null` is unique to
    // its owning action. Substring checks are sufficient.
    expect(src).toMatch(/idCollectedExternally:\s*false/)
    expect(src).toMatch(/idCollectedExternallyAt:\s*null/)
    expect(src).toMatch(/idCollectedExternallyNotes:\s*null/)
  })

  it('requestUserIdReupload writes the three reupload columns', () => {
    expect(src).toMatch(/idReuploadRequested:\s*true/)
    expect(src).toMatch(/idReuploadRequestedAt:\s*new Date\(\)/)
    expect(src).toMatch(/idReuploadRequestedNotes:\s*normalised/)
  })

  it('cancelUserIdReuploadRequest clears the three reupload columns', () => {
    // Same logic as the revoke check — substring uniqueness across the
    // four actions makes a global match safe.
    expect(src).toMatch(/idReuploadRequested:\s*false/)
    expect(src).toMatch(/idReuploadRequestedAt:\s*null/)
    expect(src).toMatch(/idReuploadRequestedNotes:\s*null/)
  })

  it('every action revalidates the admin domain', () => {
    const calls = (src.match(/revalidate\(\{\s*domain:\s*'admin'/g) ?? []).length
    expect(calls).toBeGreaterThanOrEqual(4)
  })
})

// ── (E) Server action + proxy + onboarding wiring ───────────────────

describe('v2.2.15 (E) — completeOnboardingWithId honours the new flags', () => {
  const src = read('src/app/join/[code]/actions.ts')

  it('selects the new attestation + reupload-request columns', () => {
    expect(src).toMatch(/idCollectedExternally:\s*true/)
    expect(src).toMatch(/idReuploadRequested:\s*true/)
  })

  it('rejects when admin requested re-upload and no new upload is supplied', () => {
    expect(src).toMatch(
      /Please upload a fresh ID — your organizer has requested it\./,
    )
  })

  it('clears the three reupload-request columns on satisfied upload', () => {
    expect(src).toMatch(/idReuploadRequested:\s*false/)
    expect(src).toMatch(/idReuploadRequestedAt:\s*null/)
    expect(src).toMatch(/idReuploadRequestedNotes:\s*null/)
  })

  it('auto-sets PLM.idShared = true for externally-attested users', () => {
    // The PLM write conditionally sets idShared when EITHER
    // reuseExistingId OR idCollectedExternally is true.
    expect(src).toMatch(
      /reuseExistingId\s*\|\|\s*user\.idCollectedExternally/,
    )
  })

  it('skips the User-ID-columns write when externally attested', () => {
    // The shouldWriteIdColumns derivation must AND-out the external case.
    expect(src).toMatch(
      /shouldWriteIdColumns[\s\S]*?!user\.idCollectedExternally/,
    )
  })
})

describe('v2.2.15 (E) — admin proxy returns 404 external_id for external-only users', () => {
  const src = read('src/app/api/admin/id-image/[userId]/[side]/route.ts')

  it('selects idCollectedExternally + idCollectedExternallyNotes', () => {
    expect(src).toMatch(/idCollectedExternally:\s*true/)
    expect(src).toMatch(/idCollectedExternallyNotes:\s*true/)
  })

  it('returns the external_id 404 shape when no Blob URL on file', () => {
    expect(src).toMatch(/error:\s*'external_id'/)
    expect(src).toMatch(/notes:\s*user\.idCollectedExternallyNotes/)
  })
})

describe('v2.2.15 (E) — onboarding form prop threading', () => {
  const fields = read('src/components/registration/RegistrationFields.tsx')
  const form = read('src/app/join/[code]/onboarding/OnboardingForm.tsx')
  const page = read('src/app/join/[code]/onboarding/page.tsx')

  it('RegistrationFields imports the pure helper', () => {
    expect(fields).toMatch(
      /import\s*\{\s*selectIdSectionMode\s*\}\s*from\s*'@\/lib\/registration-helpers'/,
    )
  })

  it('RegistrationFields accepts the three new optional props', () => {
    expect(fields).toMatch(/idCollectedExternally\?:\s*boolean/)
    expect(fields).toMatch(/idReuploadRequested\?:\s*boolean/)
    expect(fields).toMatch(/idReuploadRequestedNotes\?:\s*string\s*\|\s*null/)
  })

  it('OnboardingForm threads the three props through to RegistrationFields', () => {
    expect(form).toMatch(/idCollectedExternally=\{idCollectedExternally\}/)
    expect(form).toMatch(/idReuploadRequested=\{idReuploadRequested\}/)
    expect(form).toMatch(/idReuploadRequestedNotes=\{idReuploadRequestedNotes\}/)
  })

  it('onboarding page selects the new fields on userRow + passes them to OnboardingForm', () => {
    expect(page).toMatch(/idCollectedExternally:\s*true/)
    expect(page).toMatch(/idReuploadRequested:\s*true/)
    expect(page).toMatch(/idReuploadRequestedNotes:\s*true/)
    expect(page).toMatch(/idCollectedExternally=\{userRow\?\.idCollectedExternally/)
    expect(page).toMatch(/idReuploadRequested=\{userRow\?\.idReuploadRequested/)
  })
})

describe('v2.2.15 (E) — admin UsersList surfaces the new flags', () => {
  const src = read('src/components/admin/UsersList.tsx')

  it('UserRow type carries all six new fields', () => {
    expect(src).toMatch(/idCollectedExternally:\s*boolean/)
    expect(src).toMatch(/idCollectedExternallyAt:\s*string\s*\|\s*null/)
    expect(src).toMatch(/idCollectedExternallyNotes:\s*string\s*\|\s*null/)
    expect(src).toMatch(/idReuploadRequested:\s*boolean/)
    expect(src).toMatch(/idReuploadRequestedAt:\s*string\s*\|\s*null/)
    expect(src).toMatch(/idReuploadRequestedNotes:\s*string\s*\|\s*null/)
  })

  it('imports the four admin actions', () => {
    expect(src).toMatch(/markUserIdExternal/)
    expect(src).toMatch(/revokeUserIdExternal/)
    expect(src).toMatch(/requestUserIdReupload/)
    expect(src).toMatch(/cancelUserIdReuploadRequest/)
  })

  it('renders the two new modal components', () => {
    expect(src).toMatch(/MarkExternalIdModal/)
    expect(src).toMatch(/RequestReuploadModal/)
  })

  it('renders inline badges for external + reupload-requested states', () => {
    expect(src).toMatch(/admin-users-badge-external/)
    expect(src).toMatch(/admin-users-badge-reupload/)
  })
})
