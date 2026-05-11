/**
 * v1.93.0 — Guest feature rework (per-row + typed + positions).
 *
 * Replaces the v1.91.0 count-only `MatchdayGuestEntry` with per-row
 * `MatchdayGuest` rows. Each guest carries a `type` (EXTERNAL / LEAGUE),
 * a `positions[]`, and a `displayOrder`. UI swings to a sectioned modal
 * table; pitch + list views treat each guest as a pseudo-Player with
 * positions so the 6-pass formation algorithm places them like real
 * players.
 *
 * Tests pin:
 *   1. APP_VERSION bumped to 1.93.0.
 *   2. Schema: `MatchdayGuest` model with the documented column shape,
 *      `GuestType` enum, indexes, and FK cascades.
 *   3. Migration shape: CREATE NEW + INSERT BACKFILL + DROP OLD atomic,
 *      Prisma-emitted table/column names, no @@map slip.
 *   4. v1.91.0 `MatchdayGuestEntry` model + `setMatchdayGuestEntry`
 *      action are GONE — regression-target against the prior shape
 *      sneaking back in.
 *   5. Server action `setMatchdayGuests`: auth gate, position validation
 *      per league's ballType, replacement-by-set inside a transaction,
 *      displayOrder server-assigned per type section.
 *   6. Pure helpers: `synthesizeGuestPlayers` produces "Ext Guest N" /
 *      "League Guest N" names with `preferredPositions` carried through
 *      from MatchdayGuest, and guest pseudo-IDs use the v1.93.0 prefix.
 *   7. `bucketConfirmedPlayers` sub-buckets guests by type
 *      (LEAGUE_GUEST + EXTERNAL_GUEST), removes the v1.91.0 single GUEST
 *      bucket, and orders LEAGUE_GUEST before EXTERNAL_GUEST.
 *   8. dbToPublicLeagueData reads MatchdayGuest rows, returns the new
 *      `guests` shape (replacing `guestCounts`).
 *   9. Modal source pins: per-row PositionMultiSelect, "+ Add row"
 *      buttons per section, per-row trash delete, "Guests for <Team>"
 *      title.
 *  10. MatchdayAvailability wiring: receives `guests` (not `guestCounts`),
 *      synthesised guest count drives "going" totals, modal mounted in
 *      both past and upcoming branches.
 *  11. assignPlayersToFormation: a LEAGUE guest with positions=[CB]
 *      lands at a CB slot through pass 1a; a guest with positions=[]
 *      still falls through to pass 2.5 (v1.89.1 hard rule preserved).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  GUEST_PSEUDO_ID_PREFIX,
  isGuestPseudoId,
  synthesizeGuestPlayers,
} from '@/lib/guestSynthesis'
import {
  bucketConfirmedPlayers,
  BUCKET_LABEL,
} from '@/components/MatchdayAvailability'
import {
  assignPlayersToFormation,
  getFormationsFor,
  type AssignmentInput,
} from '@/lib/formations'
import type { MatchdayGuestEntry } from '@/types'

const REPO_ROOT = join(__dirname, '..', '..')
const SCHEMA = readFileSync(join(REPO_ROOT, 'prisma/schema.prisma'), 'utf8')
const MIGRATION_DIR = 'prisma/migrations/20260522000000_add_matchday_guest_rows_replace_counts'
const MIGRATION = readFileSync(
  join(REPO_ROOT, MIGRATION_DIR, 'migration.sql'),
  'utf8',
)
const VERSION_SRC = readFileSync(join(REPO_ROOT, 'src/lib/version.ts'), 'utf8')
const TYPES_SRC = readFileSync(join(REPO_ROOT, 'src/types/index.ts'), 'utf8')
const DB_TO_PUBLIC_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/dbToPublicLeagueData.ts'),
  'utf8',
)
const ACTION_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/api/guests/actions.ts'),
  'utf8',
)
const MODAL_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/AddGuestsModal.tsx'),
  'utf8',
)
const MA_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/MatchdayAvailability.tsx'),
  'utf8',
)
const SYNTH_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/guestSynthesis.ts'),
  'utf8',
)

describe('v1.93.0 — version bump', () => {
  it('APP_VERSION is 1.93.0 or higher', () => {
    expect(VERSION_SRC).toMatch(
      /APP_VERSION\s*=\s*['"]1\.(9[3-9]|[1-9]\d{2,})\.\d+['"]/,
    )
  })
})

describe('v1.93.0 — schema deltas', () => {
  it('GuestType enum declared', () => {
    expect(SCHEMA).toMatch(/enum GuestType\s*\{[\s\S]+?EXTERNAL[\s\S]+?LEAGUE[\s\S]+?\}/)
  })

  it('MatchdayGuest model exists with required columns', () => {
    const block = SCHEMA.match(/model MatchdayGuest\s*\{[\s\S]+?\n\}/)
    expect(block).toBeTruthy()
    const body = block![0]
    expect(body).toMatch(/gameWeekId\s+String\b/)
    expect(body).toMatch(/leagueTeamId\s+String\b/)
    expect(body).toMatch(/type\s+GuestType\b/)
    expect(body).toMatch(/positions\s+String\[\]\s+@default\(\[\]\)/)
    expect(body).toMatch(/displayOrder\s+Int\s+@default\(0\)/)
    expect(body).toMatch(/createdById\s+String\?/)
    expect(body).toMatch(/createdAt\s+DateTime\s+@default\(now\(\)\)/)
    expect(body).toMatch(/updatedAt\s+DateTime\s+@updatedAt/)
  })

  it('cascade-on-parent + SetNull-on-User relations', () => {
    const body = SCHEMA.match(/model MatchdayGuest\s*\{[\s\S]+?\n\}/)![0]
    expect(body).toMatch(
      /gameWeek\s+GameWeek\s+@relation\(fields: \[gameWeekId\], references: \[id\], onDelete: Cascade\)/,
    )
    expect(body).toMatch(
      /leagueTeam\s+LeagueTeam\s+@relation\(fields: \[leagueTeamId\], references: \[id\], onDelete: Cascade\)/,
    )
    expect(body).toMatch(
      /createdBy\s+User\?\s+@relation\(fields: \[createdById\], references: \[id\], onDelete: SetNull\)/,
    )
  })

  it('compound index on (gameWeekId, leagueTeamId, type)', () => {
    const body = SCHEMA.match(/model MatchdayGuest\s*\{[\s\S]+?\n\}/)![0]
    expect(body).toMatch(/@@index\(\[gameWeekId, leagueTeamId, type\]\)/)
  })

  it('back-relations renamed: User.authoredGuests, GameWeek.guests, LeagueTeam.guests', () => {
    const user = SCHEMA.match(/model User\s*\{[\s\S]+?\n\}/)![0]
    expect(user).toMatch(/authoredGuests\s+MatchdayGuest\[\]/)
    const gw = SCHEMA.match(/model GameWeek\s*\{[\s\S]+?\n\}/)![0]
    expect(gw).toMatch(/guests\s+MatchdayGuest\[\]/)
    const lt = SCHEMA.match(/model LeagueTeam\s*\{[\s\S]+?\n\}/)![0]
    expect(lt).toMatch(/guests\s+MatchdayGuest\[\]/)
  })

  it('v1.91.0 MatchdayGuestEntry model is GONE (replacement, not addition)', () => {
    expect(SCHEMA).not.toMatch(/^model MatchdayGuestEntry\s*\{/m)
    // Comments may still reference the name (history); only code is gated.
  })
})

describe('v1.93.0 — migration shape', () => {
  it('migration directory + migration.sql exist', () => {
    expect(existsSync(join(REPO_ROOT, MIGRATION_DIR, 'migration.sql'))).toBe(true)
  })

  it('CREATE TYPE "GuestType" with EXTERNAL + LEAGUE values', () => {
    expect(MIGRATION).toMatch(
      /CREATE TYPE "GuestType" AS ENUM \('EXTERNAL', 'LEAGUE'\)/,
    )
  })

  it('CREATE TABLE "MatchdayGuest" with positions text[] + displayOrder', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE "MatchdayGuest"/)
    expect(MIGRATION).toMatch(/"type" "GuestType" NOT NULL/)
    expect(MIGRATION).toMatch(/"positions" TEXT\[\] DEFAULT ARRAY\[\]::TEXT\[\]/)
    expect(MIGRATION).toMatch(/"displayOrder" INTEGER NOT NULL DEFAULT 0/)
    expect(MIGRATION).toMatch(/"createdById" TEXT,?\s/)
  })

  it('compound index + single-leg indexes created', () => {
    expect(MIGRATION).toMatch(
      /CREATE INDEX "MatchdayGuest_gameWeekId_leagueTeamId_type_idx" ON "MatchdayGuest"\("gameWeekId", "leagueTeamId", "type"\)/,
    )
    expect(MIGRATION).toMatch(
      /CREATE INDEX "MatchdayGuest_gameWeekId_idx" ON "MatchdayGuest"\("gameWeekId"\)/,
    )
    expect(MIGRATION).toMatch(
      /CREATE INDEX "MatchdayGuest_leagueTeamId_idx" ON "MatchdayGuest"\("leagueTeamId"\)/,
    )
  })

  it('FKs reference real Prisma table names (no @@map slip)', () => {
    expect(MIGRATION).toMatch(
      /FOREIGN KEY \("gameWeekId"\) REFERENCES "GameWeek"\("id"\) ON DELETE CASCADE/,
    )
    expect(MIGRATION).toMatch(
      /FOREIGN KEY \("leagueTeamId"\) REFERENCES "LeagueTeam"\("id"\) ON DELETE CASCADE/,
    )
    expect(MIGRATION).toMatch(
      /FOREIGN KEY \("createdById"\) REFERENCES "User"\("id"\) ON DELETE SET NULL/,
    )
  })

  it('atomic: CREATE NEW → INSERT BACKFILL → DROP OLD ordering', () => {
    // Strip comments so we only inspect executable SQL.
    const stripped = MIGRATION
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
    const createIdx = stripped.indexOf('CREATE TABLE "MatchdayGuest"')
    const insertIdx = stripped.indexOf('INSERT INTO "MatchdayGuest"')
    const dropIdx = stripped.indexOf('DROP TABLE "MatchdayGuestEntry"')
    expect(createIdx).toBeGreaterThan(-1)
    expect(insertIdx).toBeGreaterThan(-1)
    expect(dropIdx).toBeGreaterThan(-1)
    expect(createIdx).toBeLessThan(insertIdx)
    expect(insertIdx).toBeLessThan(dropIdx)
  })

  it('backfill expands externalCount + leagueCount into per-type rows via generate_series', () => {
    expect(MIGRATION).toMatch(/'EXTERNAL'::"GuestType"/)
    expect(MIGRATION).toMatch(/'LEAGUE'::"GuestType"/)
    expect(MIGRATION).toMatch(/generate_series\(1,\s*e\."externalCount"\)/)
    expect(MIGRATION).toMatch(/generate_series\(1,\s*e\."leagueCount"\)/)
    expect(MIGRATION).toMatch(/FROM "MatchdayGuestEntry" e/)
  })

  it('backfill uses Prisma-generated column names exactly (no @@map slip)', () => {
    expect(MIGRATION).toMatch(/e\."gameWeekId"/)
    expect(MIGRATION).toMatch(/e\."leagueTeamId"/)
    expect(MIGRATION).toMatch(/e\."externalCount"/)
    expect(MIGRATION).toMatch(/e\."leagueCount"/)
    expect(MIGRATION).toMatch(/e\."createdById"/)
  })
})

describe('v1.93.0 — types: MatchdayGuests + MatchdayGuestEntry export', () => {
  it('MatchdayGuests interface (replaces v1.91.0 MatchdayGuestCounts)', () => {
    expect(TYPES_SRC).toMatch(/export interface MatchdayGuests/)
    expect(TYPES_SRC).not.toMatch(/export interface MatchdayGuestCounts/)
  })

  it('MatchdayGuestEntry interface exported (per-row guest payload shape)', () => {
    expect(TYPES_SRC).toMatch(/export interface MatchdayGuestEntry/)
    expect(TYPES_SRC).toMatch(/type:\s*GuestType/)
    expect(TYPES_SRC).toMatch(/positions:\s*string\[\]/)
    expect(TYPES_SRC).toMatch(/displayOrder:\s*number/)
  })

  it('LeagueData has `guests: MatchdayGuests` (replaces guestCounts)', () => {
    const block = TYPES_SRC.match(/export interface LeagueData\s*\{[\s\S]+?\n\}/)
    expect(block).toBeTruthy()
    expect(block![0]).toMatch(/guests:\s*MatchdayGuests/)
    expect(block![0]).not.toMatch(/guestCounts/)
  })
})

describe('v1.93.0 — guestSynthesis pure helpers', () => {
  it('GUEST_PSEUDO_ID_PREFIX is the new "guest-" prefix', () => {
    expect(GUEST_PSEUDO_ID_PREFIX).toBe('guest-')
  })

  it('isGuestPseudoId matches the new prefix; rejects real player ids', () => {
    expect(isGuestPseudoId('guest-abc123')).toBe(true)
    expect(isGuestPseudoId('guest-')).toBe(true)
    expect(isGuestPseudoId('p-stefan')).toBe(false)
    expect(isGuestPseudoId('mariners-fc')).toBe(false)
    expect(isGuestPseudoId('')).toBe(false)
  })

  it('synthesizeGuestPlayers([]) returns []', () => {
    expect(synthesizeGuestPlayers('mariners-fc', [])).toEqual([])
  })

  it('synthesizeGuestPlayers produces "Ext Guest N" / "League Guest N" labels', () => {
    const players = synthesizeGuestPlayers('mariners-fc', [
      { id: 'g1', type: 'LEAGUE', positions: ['CB'], displayOrder: 0 },
      { id: 'g2', type: 'LEAGUE', positions: [], displayOrder: 1 },
      { id: 'g3', type: 'EXTERNAL', positions: ['ST'], displayOrder: 0 },
    ])
    expect(players.length).toBe(3)
    expect(players[0]!.name).toBe('League Guest 1')
    expect(players[1]!.name).toBe('League Guest 2')
    expect(players[2]!.name).toBe('Ext Guest 1')
    for (const p of players) {
      expect(isGuestPseudoId(p.id)).toBe(true)
      expect(p.teamId).toBe('mariners-fc')
    }
  })

  it('synthesised guest carries preferredPositions from the source row', () => {
    const [p] = synthesizeGuestPlayers('t', [
      { id: 'gx', type: 'LEAGUE', positions: ['CB', 'DM'], displayOrder: 0 },
    ])
    expect(p!.preferredPositions).toEqual(['CB', 'DM'])
    // `position` mirrors the joined-string shape for compatibility with
    // the legacy public Player.position field.
    expect(p!.position).toBe('CB/DM')
  })

  it('synthesised guest with positions=[] has position null + empty preferredPositions', () => {
    const [p] = synthesizeGuestPlayers('t', [
      { id: 'gx', type: 'EXTERNAL', positions: [], displayOrder: 0 },
    ])
    expect(p!.position).toBeNull()
    expect(p!.preferredPositions).toEqual([])
  })

  it('id includes the source MatchdayGuest.id (stable across renders)', () => {
    const [p] = synthesizeGuestPlayers('t', [
      { id: 'mg-cuid-abc', type: 'LEAGUE', positions: [], displayOrder: 0 },
    ])
    expect(p!.id).toBe('guest-mg-cuid-abc')
  })
})

describe('v1.93.0 — bucketConfirmedPlayers sub-buckets guests by type', () => {
  const mkPlayer = (overrides: { id: string; name: string; positions: string[] }) => ({
    id: overrides.id,
    name: overrides.name,
    teamId: 't',
    position: overrides.positions.join('/') || null,
    preferredPositions: overrides.positions,
    picture: null,
    image: null,
    retiredAt: null,
  })

  it('removed v1.91.0 single GUEST bucket from BUCKET_LABEL', () => {
    // @ts-expect-error — old key no longer in the discriminated union
    expect(BUCKET_LABEL.GUEST).toBeUndefined()
    expect(BUCKET_LABEL.LEAGUE_GUEST).toBe('League Guests')
    expect(BUCKET_LABEL.EXTERNAL_GUEST).toBe('External Guests')
  })

  it('groups LEAGUE guests into LEAGUE_GUEST bucket', () => {
    const guests = synthesizeGuestPlayers('t', [
      { id: 'g1', type: 'LEAGUE', positions: ['CB'], displayOrder: 0 },
      { id: 'g2', type: 'LEAGUE', positions: [], displayOrder: 1 },
    ])
    const ids = guests.map((p) => p.id)
    const groups = bucketConfirmedPlayers(ids, guests)
    const lg = groups.find((g) => g.bucket === 'LEAGUE_GUEST')
    expect(lg).toBeTruthy()
    expect(lg!.players.length).toBe(2)
  })

  it('groups EXTERNAL guests into EXTERNAL_GUEST bucket', () => {
    const guests = synthesizeGuestPlayers('t', [
      { id: 'g3', type: 'EXTERNAL', positions: [], displayOrder: 0 },
    ])
    const groups = bucketConfirmedPlayers(guests.map((p) => p.id), guests)
    const eg = groups.find((g) => g.bucket === 'EXTERNAL_GUEST')
    expect(eg).toBeTruthy()
    expect(eg!.players.length).toBe(1)
  })

  it('LEAGUE_GUEST renders BEFORE EXTERNAL_GUEST', () => {
    const guests = synthesizeGuestPlayers('t', [
      { id: 'g1', type: 'EXTERNAL', positions: [], displayOrder: 0 },
      { id: 'g2', type: 'LEAGUE', positions: [], displayOrder: 0 },
    ])
    const groups = bucketConfirmedPlayers(
      guests.map((p) => p.id),
      guests,
    )
    const buckets = groups.map((g) => g.bucket)
    const lgIdx = buckets.indexOf('LEAGUE_GUEST')
    const egIdx = buckets.indexOf('EXTERNAL_GUEST')
    expect(lgIdx).toBeGreaterThan(-1)
    expect(egIdx).toBeGreaterThan(-1)
    expect(lgIdx).toBeLessThan(egIdx)
  })

  it('real players co-exist with guest sub-buckets in correct order', () => {
    const real = mkPlayer({ id: 'p-real', name: 'Real', positions: ['CB'] })
    const guests = synthesizeGuestPlayers('t', [
      { id: 'g1', type: 'LEAGUE', positions: [], displayOrder: 0 },
      { id: 'g2', type: 'EXTERNAL', positions: [], displayOrder: 0 },
    ])
    const all = [real, ...guests]
    const groups = bucketConfirmedPlayers(all.map((p) => p.id), all)
    const buckets = groups.map((g) => g.bucket)
    expect(buckets).toEqual(['DF', 'LEAGUE_GUEST', 'EXTERNAL_GUEST'])
  })
})

describe('v1.93.0 — formation assignment respects guest positions', () => {
  function realInput(id: string, position: string): AssignmentInput {
    return {
      id,
      positions: [position],
      preferredPositions: [position],
      secondaryPositions: [],
    }
  }
  function guestInput(id: string, preferred: string[]): AssignmentInput {
    return {
      id,
      positions: preferred,
      preferredPositions: preferred,
      secondaryPositions: [],
    }
  }

  it('guest with positions=[CB] takes a CB slot via pass 1a', () => {
    const formations = getFormationsFor('SOCCER', 9)
    const f = formations.find((x) => x.code === '4-3-1') ?? formations[0]
    const inputs = [
      realInput('gk', 'GK'),
      guestInput('guest-mg-aaa', ['CB']),
    ]
    const result = assignPlayersToFormation('SOCCER', f, inputs)
    const slotIdx = result.slotAssignments.findIndex((id) => id === 'guest-mg-aaa')
    expect(slotIdx).toBeGreaterThan(-1)
    expect(f.slots[slotIdx]!.code.toUpperCase()).toBe('CB')
  })

  it('guest with positions=[] falls through to pass 2.5 (back-most non-GK)', () => {
    const formations = getFormationsFor('SOCCER', 9)
    const f = formations[0]
    const inputs = [
      realInput('gk', 'GK'),
      guestInput('guest-mg-bbb', []),
    ]
    const result = assignPlayersToFormation('SOCCER', f, inputs)
    const slotIdx = result.slotAssignments.findIndex(
      (id) => id === 'guest-mg-bbb',
    )
    expect(slotIdx).toBeGreaterThan(-1)
    expect(f.slots[slotIdx]!.code.toUpperCase()).not.toBe('GK')
  })

  it('multiple positionless guests still never land at GK (v1.89.1 hard rule)', () => {
    const formations = getFormationsFor('FUTSAL', 5)
    const f = formations[0]
    const inputs = [
      guestInput('guest-mg-1', []),
      guestInput('guest-mg-2', []),
      guestInput('guest-mg-3', []),
      guestInput('guest-mg-4', []),
    ]
    const result = assignPlayersToFormation('FUTSAL', f, inputs)
    for (let i = 0; i < result.slotAssignments.length; i++) {
      if (f.slots[i]!.code.toUpperCase() === 'GK') {
        expect(result.slotAssignments[i]).toBeNull()
      }
    }
  })
})

describe('v1.93.0 — dbToPublicLeagueData reads MatchdayGuest', () => {
  it('EMPTY_RESULT shape carries `guests: {}`', () => {
    expect(DB_TO_PUBLIC_SRC).toMatch(/EMPTY_RESULT[\s\S]+?guests:\s*\{\}/)
  })

  it('queries MatchdayGuest (not MatchdayGuestEntry)', () => {
    expect(DB_TO_PUBLIC_SRC).toMatch(
      /prisma\.matchdayGuest\.findMany\(\s*\{[\s\S]+?gameWeekId:\s*\{\s*in:/,
    )
    expect(DB_TO_PUBLIC_SRC).not.toMatch(/prisma\.matchdayGuestEntry/)
  })

  it('orders results by (type asc, displayOrder asc)', () => {
    expect(DB_TO_PUBLIC_SRC).toMatch(
      /orderBy:\s*\[\s*\{\s*type:\s*['"]asc['"]\s*\}\s*,\s*\{\s*displayOrder:\s*['"]asc['"]\s*\}\s*\]/,
    )
  })

  it('returns `guests` in the data payload', () => {
    expect(DB_TO_PUBLIC_SRC).toMatch(/guests,\s*\n\s*\}/)
  })
})

describe('v1.93.0 — server action setMatchdayGuests', () => {
  it('module is server-only and the legacy export is gone', () => {
    expect(ACTION_SRC).toMatch(/^['"]use server['"]/m)
    expect(ACTION_SRC).not.toMatch(/export async function setMatchdayGuestEntry/)
    expect(ACTION_SRC).toMatch(/export async function setMatchdayGuests/)
  })

  it('rejects unauthenticated callers', () => {
    expect(ACTION_SRC).toMatch(/Sign in to add guests/)
  })

  it('accepts userId OR lineId on the session (admin-orthogonal pattern)', () => {
    expect(ACTION_SRC).toMatch(/session\.userId/)
    expect(ACTION_SRC).toMatch(/session\.lineId/)
  })

  it('does NOT gate on session.isAdmin (admin-orthogonal-UX rule)', () => {
    const stripped = ACTION_SRC
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    expect(stripped).not.toMatch(/session\.isAdmin/)
  })

  it('validates positions[] per league.ballType via normalizePositions', () => {
    expect(ACTION_SRC).toMatch(/normalizePositions\(/)
    expect(ACTION_SRC).toMatch(/league\.ballType/)
  })

  it('enforces MAX_GUESTS_PER_TEAM = 50', () => {
    expect(ACTION_SRC).toMatch(/MAX_GUESTS_PER_TEAM\s*=\s*50/)
  })

  it('replacement-by-set via prisma.$transaction([deleteMany, createMany])', () => {
    expect(ACTION_SRC).toMatch(/prisma\.\$transaction\(/)
    expect(ACTION_SRC).toMatch(/matchdayGuest\.deleteMany/)
    expect(ACTION_SRC).toMatch(/matchdayGuest\.createMany/)
  })

  it('parses matchdayPublicId via md<n> shape', () => {
    expect(ACTION_SRC).toMatch(/parseMatchdayPublicId/)
    expect(ACTION_SRC).toMatch(/match\(\/\^md/)
  })

  it('resolves leagueId via getLeagueIdBySlug', () => {
    expect(ACTION_SRC).toMatch(/getLeagueIdBySlug\(input\.leagueSlug\)/)
  })

  it('resolves leagueTeam scoped to (leagueId, teamId) — no cross-league bleed', () => {
    expect(ACTION_SRC).toMatch(
      /prisma\.leagueTeam\.findFirst\([\s\S]+?leagueId,\s*teamId:/,
    )
  })

  it('re-derives displayOrder per type section (no gaps from deleted rows)', () => {
    // Two independent counters, one per type — proves we don't blindly
    // persist whatever displayOrder the client sent.
    expect(ACTION_SRC).toMatch(/externalCounter/)
    expect(ACTION_SRC).toMatch(/leagueCounter/)
  })

  it('writes createdById on every created row (audit trail)', () => {
    expect(ACTION_SRC).toMatch(/createdById:\s*userId/)
  })

  it("revalidates the public domain on success", () => {
    expect(ACTION_SRC).toMatch(/revalidate\(\s*\{\s*domain:\s*['"]public['"]/)
  })
})

describe('v1.93.0 — modal source pins', () => {
  it('uses createPortal + role="dialog" + body-scroll-lock pattern', () => {
    expect(MODAL_SRC).toMatch(/createPortal/)
    expect(MODAL_SRC).toMatch(/role="dialog"/)
    expect(MODAL_SRC).toMatch(/aria-modal="true"/)
    expect(MODAL_SRC).toMatch(/document\.body\.style\.overflow\s*=\s*['"]hidden['"]/)
  })

  it('title reads "Guests for <Team>"', () => {
    expect(MODAL_SRC).toMatch(/`Guests for \$\{teamName\}`/)
  })

  it('per-row PositionMultiSelect (chip-based selector)', () => {
    expect(MODAL_SRC).toMatch(/import PositionMultiSelect from/)
    expect(MODAL_SRC).toMatch(/<PositionMultiSelect/)
  })

  it('sectioned table: data-testid="add-guests-section-league" + "-external"', () => {
    expect(MODAL_SRC).toMatch(/add-guests-section-\$\{type\.toLowerCase\(\)\}/)
    // Two GuestSection components rendered, one per type.
    const sections = MODAL_SRC.match(/<GuestSection/g) ?? []
    expect(sections.length).toBe(2)
  })

  it('"+ Add row" per section', () => {
    expect(MODAL_SRC).toMatch(/Add row/)
    expect(MODAL_SRC).toMatch(/onAdd/)
  })

  it('per-row delete button', () => {
    expect(MODAL_SRC).toMatch(/Remove \$\{labelPrefix\} \$\{idx \+ 1\}/)
    expect(MODAL_SRC).toMatch(/onRemove/)
  })

  it('row labels read "League Guest N" / "Ext Guest N"', () => {
    expect(MODAL_SRC).toMatch(/'Ext Guest'/)
    expect(MODAL_SRC).toMatch(/'League Guest'/)
  })

  it('imports + calls setMatchdayGuests (not setMatchdayGuestEntry)', () => {
    expect(MODAL_SRC).toMatch(
      /import\s*\{[^}]*setMatchdayGuests[^}]*\}\s*from\s*['"]@\/app\/api\/guests\/actions['"]/,
    )
    expect(MODAL_SRC).toMatch(/setMatchdayGuests\(\{/)
    expect(MODAL_SRC).not.toMatch(/setMatchdayGuestEntry\(/)
  })

  it('LEAGUE section renders ABOVE External section in JSX order', () => {
    const leagueIdx = MODAL_SRC.indexOf('"League Guests"')
    const externalIdx = MODAL_SRC.indexOf('"External Guests"')
    expect(leagueIdx).toBeGreaterThan(-1)
    expect(externalIdx).toBeGreaterThan(-1)
    expect(leagueIdx).toBeLessThan(externalIdx)
  })

  it('caps total rows at MAX_GUESTS_PER_TEAM = 50', () => {
    expect(MODAL_SRC).toMatch(/MAX_GUESTS_PER_TEAM\s*=\s*50/)
  })
})

describe('v1.93.0 — MatchdayAvailability wiring', () => {
  it('lazy-loads AddGuestsModal via next/dynamic', () => {
    expect(MA_SRC).toMatch(
      /AddGuestsModal\s*=\s*dynamic\(\s*\(\)\s*=>\s*import\(['"]\.\/AddGuestsModal['"]\)/,
    )
  })

  it('useSession-gated trigger visibility', () => {
    expect(MA_SRC).toMatch(/useSession/)
    expect(MA_SRC).toMatch(
      /canAddGuests\s*=\s*Boolean\(session\?\.user\)\s*&&\s*Boolean\(leagueSlug\)/,
    )
  })

  it('threads `guests` prop (replaces v1.91.0 `guestCounts`)', () => {
    expect(MA_SRC).toMatch(/guests\?:\s*MatchdayGuests/)
    expect(MA_SRC).not.toMatch(/guestCounts\?:\s*MatchdayGuestCounts/)
  })

  it('synthesizeGuestPlayers wired into per-team players array', () => {
    expect(MA_SRC).toMatch(/synthesizeGuestPlayers\(/)
  })

  it('going + played counts include guests (confirmedIds.length)', () => {
    expect(MA_SRC).toMatch(/total\s*=\s*confirmedIds\.length/)
    expect(MA_SRC).toMatch(/\{total\}\s+\{"going"\}/)
    expect(MA_SRC).toMatch(/\{total\}\s+\{"played"\}/)
  })

  it('renders the "+ Guests" trigger per team', () => {
    expect(MA_SRC).toMatch(/data-testid=\{`add-guests-trigger-\$\{team\.id\}`\}/)
  })

  it('modal is mounted via shared guestModalNode in both render paths', () => {
    expect(MA_SRC).toMatch(/guestModalNode/)
    const matches = MA_SRC.match(/\{guestModalNode\}/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })

  it('passes ballType + initialGuests to the modal', () => {
    expect(MA_SRC).toMatch(/ballType=\{[\s\S]+?\}/)
    expect(MA_SRC).toMatch(/initialGuests=\{guestModalRows\}/)
  })
})

describe('v1.93.0 — going count: per-team total = real + guests', () => {
  // Behavioural pin (not just source-string) — exercises the JS path
  // that aggregates guest counts into the going total.
  it('synthesizeGuestPlayers length == MatchdayGuestEntry[].length (basic invariant)', () => {
    const entries: MatchdayGuestEntry[] = [
      { id: 'g1', type: 'EXTERNAL', positions: [], displayOrder: 0 },
      { id: 'g2', type: 'LEAGUE', positions: ['CB'], displayOrder: 0 },
      { id: 'g3', type: 'LEAGUE', positions: [], displayOrder: 1 },
    ]
    const synth = synthesizeGuestPlayers('mariners-fc', entries)
    expect(synth.length).toBe(entries.length)
  })
})

describe('v1.93.0 — v1.91.0 setMatchdayGuestEntry / MatchdayGuestEntry are gone', () => {
  it('action file no longer exports setMatchdayGuestEntry', () => {
    expect(ACTION_SRC).not.toMatch(/export async function setMatchdayGuestEntry/)
  })

  it('synthesis module no longer documents the v1.91.0 guest-pseudo- prefix as live', () => {
    // Comments may still mention the historic prefix; the CONSTANT must
    // be the new "guest-" prefix.
    expect(SYNTH_SRC).toMatch(/GUEST_PSEUDO_ID_PREFIX\s*=\s*['"]guest-['"]/)
  })

  it('no source file in src/ uses the v1.91.0 "guest-pseudo-" prefix as code', () => {
    // Scan all relevant sources for the literal — comments only.
    const SRC_FILES = [SYNTH_SRC, MA_SRC, MODAL_SRC, ACTION_SRC, DB_TO_PUBLIC_SRC]
    for (const src of SRC_FILES) {
      const stripped = src
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
      expect(stripped).not.toMatch(/['"`]guest-pseudo-/)
    }
  })
})
