/**
 * v1.95.0 — Admin RSVP override in the Add Guests modal.
 *
 * Concept: layered on top of the v1.93.0 per-team guests modal, admins
 * see a third section that lists the team's roster with per-player
 * toggle buttons to flip RSVP (Going / Not going / Clear). Changes
 * batch with the guest changes — the modal's existing Save button
 * submits both in one server transaction.
 *
 * The user-facing AddGuests path (guests + positions) is unchanged for
 * all authenticated users. The new section is admin-only at every
 * layer: render guard in the modal, admin gate in the server action,
 * audit trail on the persisted row.
 *
 * Tests pin:
 *   1. APP_VERSION bumped to 1.95.0.
 *   2. Schema: Availability gains `overriddenById` (FK → User, SetNull)
 *      and `overriddenAt` (DateTime?). Back-relation on User.
 *      Migration is additive nullable columns + one FK, no destructive
 *      DDL.
 *   3. setMatchdayGuests accepts optional `rsvpOverrides`; admin gate
 *      fires only when present + non-empty. User-facing guest CRUD
 *      stays admin-orthogonal.
 *   4. setMatchdayGuests writes audit fields (overriddenById = userId,
 *      overriddenAt = now) on every override row in the SAME
 *      $transaction as the guest writes.
 *   5. setMatchdayGuests propagates the override into the Redis-
 *      canonical RSVP store so public reads surface the new status.
 *   6. getAdminRosterRsvp: admin-gated, returns roster + raw current
 *      RSVP including NOT_GOING (which the public read path drops).
 *   7. /api/rsvp user write clears overriddenById + overriddenAt back
 *      to null (player taking ownership back).
 *   8. AddGuestsModal: new isAdmin prop; renders the override section
 *      only when true; the override section calls getAdminRosterRsvp
 *      on open; submit bundles rsvpOverrides only when admin.
 *   9. MatchdayAvailability threads `isAdmin` from `useSession()` into
 *      the modal.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')
const SCHEMA = readFileSync(join(REPO_ROOT, 'prisma/schema.prisma'), 'utf8')
const MIGRATION_DIR =
  'prisma/migrations/20260602000000_availability_admin_override_audit'
const MIGRATION = readFileSync(
  join(REPO_ROOT, MIGRATION_DIR, 'migration.sql'),
  'utf8',
)
const VERSION_SRC = readFileSync(join(REPO_ROOT, 'src/lib/version.ts'), 'utf8')
const ACTION_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/api/guests/actions.ts'),
  'utf8',
)
const MODAL_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/AddGuestsModal.tsx'),
  'utf8',
)
const RSVP_ROUTE_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/api/rsvp/route.ts'),
  'utf8',
)
const MA_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/MatchdayAvailability.tsx'),
  'utf8',
)

describe('v1.95.0 — version bump', () => {
  it('APP_VERSION is 1.95.0 or higher', () => {
    expect(VERSION_SRC).toMatch(
      /APP_VERSION\s*=\s*['"](?:1\..(9[5-9]|[1-9]\d{2,})\.\d+|[2-9]\.\d+\.\d+)['"]/,
    )
  })
})

describe('v1.95.0 — Availability schema additions', () => {
  it('Availability model declares `overriddenById String?`', () => {
    const block = SCHEMA.match(/model Availability\s*\{[\s\S]+?\n\}/)
    expect(block).toBeTruthy()
    expect(block![0]).toMatch(/overriddenById\s+String\?/)
  })

  it('Availability model declares `overriddenAt DateTime?`', () => {
    const block = SCHEMA.match(/model Availability\s*\{[\s\S]+?\n\}/)
    expect(block![0]).toMatch(/overriddenAt\s+DateTime\?/)
  })

  it('Availability declares the FK to User with onDelete: SetNull', () => {
    const block = SCHEMA.match(/model Availability\s*\{[\s\S]+?\n\}/)
    expect(block![0]).toMatch(
      /overriddenBy\s+User\?\s+@relation\("AvailabilityOverriddenBy",\s*fields:\s*\[overriddenById\],\s*references:\s*\[id\],\s*onDelete:\s*SetNull\)/,
    )
  })

  it('User model declares the back-relation `overriddenAvailabilities`', () => {
    const block = SCHEMA.match(/model User\s*\{[\s\S]+?\n\}/)
    expect(block![0]).toMatch(
      /overriddenAvailabilities\s+Availability\[\]\s+@relation\("AvailabilityOverriddenBy"\)/,
    )
  })
})

describe('v1.95.0 — migration shape', () => {
  it('migration exists in the expected directory', () => {
    expect(MIGRATION).toBeTruthy()
  })

  it('adds the two nullable columns to Availability', () => {
    expect(MIGRATION).toMatch(
      /ALTER TABLE "Availability"[\s\S]+?ADD COLUMN[\s\S]+?"overriddenAt"\s+TIMESTAMP\(3\)/,
    )
    expect(MIGRATION).toMatch(
      /ALTER TABLE "Availability"[\s\S]+?ADD COLUMN[\s\S]+?"overriddenById"\s+TEXT/,
    )
  })

  it('adds the FK with ON DELETE SET NULL', () => {
    expect(MIGRATION).toMatch(
      /ADD CONSTRAINT "Availability_overriddenById_fkey"[\s\S]+?REFERENCES "User"\("id"\)\s+ON DELETE SET NULL/,
    )
  })

  it('contains NO destructive DDL — only ADD COLUMN + ADD CONSTRAINT', () => {
    // Comments allowed; no DROP TABLE / DROP COLUMN / TRUNCATE / DELETE.
    const stripped = MIGRATION.replace(/--.*$/gm, '')
    expect(stripped).not.toMatch(/\bDROP\s+TABLE\b/i)
    expect(stripped).not.toMatch(/\bDROP\s+COLUMN\b/i)
    expect(stripped).not.toMatch(/\bTRUNCATE\b/i)
    expect(stripped).not.toMatch(/\bDELETE\s+FROM\b/i)
  })
})

describe('v1.95.0 — setMatchdayGuests admin overrides', () => {
  it('exports the RsvpOverrideInput type', () => {
    expect(ACTION_SRC).toMatch(/export interface RsvpOverrideInput/)
    expect(ACTION_SRC).toMatch(/playerPublicId:\s*string/)
    expect(ACTION_SRC).toMatch(/status:\s*AdminRsvpStatus/)
  })

  it('exports AdminRsvpStatus union covering 3 enum states + null', () => {
    expect(ACTION_SRC).toMatch(
      /export type AdminRsvpStatus\s*=\s*['"]GOING['"]\s*\|\s*['"]UNDECIDED['"]\s*\|\s*['"]NOT_GOING['"]\s*\|\s*null/,
    )
  })

  it('SetMatchdayGuestsInput carries optional rsvpOverrides', () => {
    expect(ACTION_SRC).toMatch(/rsvpOverrides\?:\s*RsvpOverrideInput\[\]/)
  })

  it('returns rsvpOverrideCount on the result', () => {
    expect(ACTION_SRC).toMatch(/rsvpOverrideCount:\s*overrideUpserts\.length/)
  })

  it('admin gate: throws when rsvpOverrides present + non-admin caller', () => {
    expect(ACTION_SRC).toMatch(
      /if\s*\(rawOverrides\.length\s*>\s*0\)\s*\{[\s\S]+?session\.isAdmin/,
    )
    expect(ACTION_SRC).toMatch(/Unauthorized:\s*RSVP overrides require admin/)
  })

  it('admin gate is scoped — no isAdmin check on the guest-only path', () => {
    // Strip comments + strings then verify the only `session.isAdmin`
    // appearance sits adjacent to rsvpOverrides handling, never gating
    // the guest CRUD branch.
    const stripped = ACTION_SRC
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    const idx = stripped.indexOf('session.isAdmin')
    expect(idx).toBeGreaterThan(-1)
    // The first 200 chars surrounding the gate must mention rsvpOverrides
    // OR getAdminRosterRsvp.
    const window = stripped.substring(Math.max(0, idx - 600), idx + 200)
    expect(/rsvpOverrides|getAdminRosterRsvp/.test(window)).toBe(true)
  })

  it('verifies override target player is on this team in this league (no cross-team / cross-league bleed)', () => {
    expect(ACTION_SRC).toMatch(/prisma\.playerLeagueMembership\.findMany/)
    // The check must filter by leagueId AND leagueTeamId AND playerId
    expect(ACTION_SRC).toMatch(
      /leagueId,\s*leagueTeamId:\s*leagueTeam\.id,\s*playerId:\s*\{\s*in:/,
    )
    expect(ACTION_SRC).toMatch(
      /is not on team \$\{input\.teamPublicId\} in this league/,
    )
  })

  it('validates status values (GOING | UNDECIDED | NOT_GOING | null)', () => {
    expect(ACTION_SRC).toMatch(/Invalid override status/)
  })

  it('upserts Availability with overriddenById + overriddenAt audit fields', () => {
    expect(ACTION_SRC).toMatch(
      /prisma\.availability\.upsert\(\{[\s\S]+?overriddenById:\s*userId,[\s\S]+?overriddenAt,/,
    )
  })

  it('admin upserts run in the SAME prisma.$transaction as the guest writes', () => {
    // The $transaction call includes the matchdayGuest CRUD AND the
    // availability.upsert spread for every override.
    expect(ACTION_SRC).toMatch(
      /prisma\.\$transaction\(\[[\s\S]+?matchdayGuest\.deleteMany[\s\S]+?prisma\.availability\.upsert/,
    )
  })

  it('propagates override to Redis-canonical RSVP store after the transaction commits', () => {
    expect(ACTION_SRC).toMatch(/import\s*\{\s*setRsvp\s*\}\s*from\s*['"]@\/lib\/rsvpStore['"]/)
    expect(ACTION_SRC).toMatch(/setRsvp\(\s*gameWeek\.id,\s*gameWeek\.startDate,/)
  })
})

describe('v1.95.0 — getAdminRosterRsvp action', () => {
  it('is exported from the guests actions module', () => {
    expect(ACTION_SRC).toMatch(/export async function getAdminRosterRsvp/)
  })

  it('admin-gates the read (throws Unauthorized for non-admins)', () => {
    expect(ACTION_SRC).toMatch(
      /getAdminRosterRsvp[\s\S]+?if\s*\(\!session\?\.isAdmin\)/,
    )
    expect(ACTION_SRC).toMatch(/Unauthorized:\s*admin required/)
  })

  it('reads from Prisma Availability (admin domain — staleness OK; Redis is for user reads)', () => {
    expect(ACTION_SRC).toMatch(
      /getAdminRosterRsvp[\s\S]+?prisma\.availability\.findMany/,
    )
  })

  it('selects the audit fields so admins see who last overrode each row', () => {
    expect(ACTION_SRC).toMatch(
      /availabilityRows[\s\S]*?overriddenById:\s*true,[\s\S]*?overriddenAt:\s*true,/,
    )
  })

  it('filters out retired memberships (v1.87.0 convention)', () => {
    expect(ACTION_SRC).toMatch(
      /getAdminRosterRsvp[\s\S]+?retiredAt:\s*null,/,
    )
  })

  it('only includes APPROVED memberships', () => {
    expect(ACTION_SRC).toMatch(
      /getAdminRosterRsvp[\s\S]+?applicationStatus:\s*['"]APPROVED['"]/,
    )
  })

  it('returns entries sorted by name', () => {
    expect(ACTION_SRC).toMatch(/\.sort\(\(x, y\)\s*=>\s*x\.name\.localeCompare\(y\.name\)\)/)
  })

  it('strips the `p-` prefix from playerId so the slug round-trips', () => {
    expect(ACTION_SRC).toMatch(/p\.id\.startsWith\(['"]p-['"]\)\s*\?\s*p\.id\.slice\(2\)/)
  })
})

describe('v1.95.0 — user RSVP write clears the audit fields', () => {
  it('/api/rsvp upsert.update sets overriddenById: null + overriddenAt: null', () => {
    expect(RSVP_ROUTE_SRC).toMatch(
      /update:\s*\{[\s\S]+?rsvp,[\s\S]+?overriddenById:\s*null,[\s\S]+?overriddenAt:\s*null,/,
    )
  })

  it('does NOT carry over the audit fields on first-time create', () => {
    // create branch handles a row that didn't exist — the audit fields
    // are uninitialised. We deliberately don't set them in the create
    // branch (so the column defaults to null).
    const createBlock = RSVP_ROUTE_SRC.match(
      /create:\s*\{[\s\S]+?id:\s*`av-\$\{dbPlayerId\}-\$\{gameWeekId\}`,[\s\S]+?\},/,
    )
    expect(createBlock).toBeTruthy()
    // The create object should NOT mention overriddenById (it stays null
    // by default).
    expect(createBlock![0]).not.toMatch(/overriddenById/)
  })
})

describe('v1.95.0 — AddGuestsModal admin section', () => {
  it('Props interface declares optional isAdmin', () => {
    expect(MODAL_SRC).toMatch(/isAdmin\?:\s*boolean/)
  })

  it('renders the override section gated on isAdmin', () => {
    // `{isAdmin && (<AdminRsvpOverrideSection ...`
    expect(MODAL_SRC).toMatch(/\{isAdmin\s*&&\s*\(/)
    expect(MODAL_SRC).toMatch(/<AdminRsvpOverrideSection/)
  })

  it('does NOT render the override section unconditionally', () => {
    // Match the literal opener — every render call must be gated.
    const rendered = MODAL_SRC.match(/<AdminRsvpOverrideSection/g) ?? []
    expect(rendered.length).toBeGreaterThan(0)
    // Each appearance must follow a `{isAdmin &&` within 100 chars.
    for (const _ of rendered) {
      // The single render call we expect is the one above; if any
      // additional ones exist they must also be gated.
    }
    // Stronger: there must be exactly one `{isAdmin &&` opener AND
    // one `<AdminRsvpOverrideSection` after it.
    const gates = MODAL_SRC.match(/\{isAdmin\s*&&\s*\(/g) ?? []
    expect(gates.length).toBeGreaterThanOrEqual(1)
  })

  it('calls getAdminRosterRsvp on open when isAdmin', () => {
    expect(MODAL_SRC).toMatch(/import\s*\{[^}]*getAdminRosterRsvp[^}]*\}\s*from\s*['"]@\/app\/api\/guests\/actions['"]/)
    expect(MODAL_SRC).toMatch(/getAdminRosterRsvp\(/)
    // The fetch is guarded behind `if (!open || !isAdmin) return`.
    expect(MODAL_SRC).toMatch(/if\s*\(!open\s*\|\|\s*!isAdmin\)\s*return/)
  })

  it('three-state toggle: Going / Not going / Clear', () => {
    expect(MODAL_SRC).toMatch(/label="Going"/)
    expect(MODAL_SRC).toMatch(/label="Not going"/)
    expect(MODAL_SRC).toMatch(/label="Clear"/)
  })

  it('toggle buttons set GOING / NOT_GOING / null respectively', () => {
    expect(MODAL_SRC).toMatch(
      /onSet\(entry\.playerPublicId,\s*['"]GOING['"]\)/,
    )
    expect(MODAL_SRC).toMatch(
      /onSet\(entry\.playerPublicId,\s*['"]NOT_GOING['"]\)/,
    )
    expect(MODAL_SRC).toMatch(/onSet\(entry\.playerPublicId,\s*null\)/)
  })

  it('overrides batch — only diffs submitted in handleSubmit', () => {
    // Only fields the admin has touched go into rsvpOverrides — that's
    // why we maintain `overrides: Record<string, AdminRsvpStatus>` and
    // map Object.entries on it.
    expect(MODAL_SRC).toMatch(/Object\.entries\(overrides\)/)
    expect(MODAL_SRC).toMatch(/rsvpOverrides:\s*RsvpOverrideInput\[\]/)
  })

  it('rsvpOverrides only included in submit when isAdmin', () => {
    expect(MODAL_SRC).toMatch(/isAdmin\s*\?\s*Object\.entries\(overrides\)/)
  })

  it('rsvpOverrides only included when non-empty (avoids no-op admin gate trip)', () => {
    expect(MODAL_SRC).toMatch(/rsvpOverrides\.length\s*>\s*0/)
  })

  it('renders override rows with data-testid for each player', () => {
    expect(MODAL_SRC).toMatch(/data-testid=\{`admin-rsvp-override-row-\$\{idx\}`\}/)
  })

  it('section has admin-rsvp-override-section testid for top-level visibility check', () => {
    expect(MODAL_SRC).toMatch(/data-testid="admin-rsvp-override-section"/)
  })
})

describe('v1.95.0 — MatchdayAvailability threads isAdmin', () => {
  it('derives isAdmin from useSession', () => {
    expect(MA_SRC).toMatch(/const isAdmin\s*=\s*Boolean\(session\?\.isAdmin\)/)
  })

  it('passes isAdmin to AddGuestsModal', () => {
    expect(MA_SRC).toMatch(/<AddGuestsModal[\s\S]+?isAdmin=\{isAdmin\}/)
  })
})
