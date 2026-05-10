/**
 * v1.91.0 — Add Guests feature.
 *
 * Each team gets an "+ Add Guests" trigger on the player-availability
 * widget. Click → modal with two integer inputs (external guests +
 * league guests). Submit → upsert one MatchdayGuestEntry row per team
 * per matchday. Effects:
 *   - Team's "going" / "played" count increases by `external + league`.
 *   - Pitch view: guests synthesised as positionless pseudo-players
 *     placed by the v1.89.1 pass 2.5 into back-most non-GK slots.
 *   - List view: dedicated "Guests" subsection beneath GK/DF/MF/FW.
 *
 * Permissions: any authenticated user. No admin or team-membership gate.
 *
 * Tests pin:
 *   1. APP_VERSION 1.91.x or higher.
 *   2. Schema: MatchdayGuestEntry model with the documented column shape
 *      and unique constraint.
 *   3. Migration file exists with the expected DDL and uses
 *      "LeagueTeam"/"GameWeek"/"User" as table names (no @@map slips).
 *   4. Pure helpers (synthesizeGuestPlayers, isGuestPseudoId,
 *      bucketConfirmedPlayers with GUEST bucket).
 *   5. assignPlayersToFormation pass 2.5 places guest pseudo-players
 *      into back-most non-GK slots, exactly as it does for any
 *      empty-positions player (v1.89.1 carries this — guests just
 *      enter through the same door).
 *   6. dbToPublicLeagueData includes guestCounts in the empty-result
 *      shape and reads MatchdayGuestEntry rows.
 *   7. Server action source pins: auth gate, count validation,
 *      league-slug + matchday-public-id + team-public-id resolution,
 *      upsert by (gameWeekId, leagueTeamId), revalidate({domain:'public'}).
 *   8. Modal source pins: lazy-loaded import, two number inputs,
 *      calls setMatchdayGuestEntry on submit.
 *   9. MatchdayAvailability source pins: button visible only when
 *      (session.user && leagueSlug), going count includes guest total,
 *      synthesizeGuestPlayers wired in, AddGuestsModal lazy-loaded.
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

const REPO_ROOT = join(__dirname, '..', '..')
const SCHEMA = readFileSync(join(REPO_ROOT, 'prisma/schema.prisma'), 'utf8')
const MIGRATION_DIR = 'prisma/migrations/20260521000000_add_matchday_guest_entries'
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
const FP_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/FormationPitch.tsx'),
  'utf8',
)

describe('v1.91.0 — version bump', () => {
  it('APP_VERSION is 1.91.0 or higher', () => {
    expect(VERSION_SRC).toMatch(
      /APP_VERSION\s*=\s*['"]1\.(9[1-9]|[2-9]\d)\.\d+['"]/,
    )
  })
})

describe('v1.91.0 — schema deltas', () => {
  it('MatchdayGuestEntry model exists', () => {
    expect(SCHEMA).toMatch(/model MatchdayGuestEntry\s*\{/)
  })

  it('has gameWeekId + leagueTeamId + externalCount + leagueCount + createdById columns', () => {
    const block = SCHEMA.match(/model MatchdayGuestEntry\s*\{[\s\S]+?\n\}/)
    expect(block).toBeTruthy()
    const body = block![0]
    expect(body).toMatch(/gameWeekId\s+String\b/)
    expect(body).toMatch(/leagueTeamId\s+String\b/)
    expect(body).toMatch(/externalCount\s+Int\s+@default\(0\)/)
    expect(body).toMatch(/leagueCount\s+Int\s+@default\(0\)/)
    expect(body).toMatch(/createdById\s+String\?/)
    expect(body).toMatch(/createdAt\s+DateTime\s+@default\(now\(\)\)/)
    expect(body).toMatch(/updatedAt\s+DateTime\s+@updatedAt/)
  })

  it('relations cascade on parent delete and SET NULL on User delete', () => {
    const block = SCHEMA.match(/model MatchdayGuestEntry\s*\{[\s\S]+?\n\}/)
    const body = block![0]
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

  it('unique constraint on (gameWeekId, leagueTeamId)', () => {
    const block = SCHEMA.match(/model MatchdayGuestEntry\s*\{[\s\S]+?\n\}/)
    expect(block![0]).toMatch(/@@unique\(\[gameWeekId, leagueTeamId\]\)/)
  })

  it('GameWeek + LeagueTeam + User declare back-relations to MatchdayGuestEntry', () => {
    const gwBlock = SCHEMA.match(/model GameWeek\s*\{[\s\S]+?\n\}/)
    expect(gwBlock![0]).toMatch(/guestEntries\s+MatchdayGuestEntry\[\]/)

    const ltBlock = SCHEMA.match(/model LeagueTeam\s*\{[\s\S]+?\n\}/)
    expect(ltBlock![0]).toMatch(/guestEntries\s+MatchdayGuestEntry\[\]/)

    const userBlock = SCHEMA.match(/model User\s*\{[\s\S]+?\n\}/)
    expect(userBlock![0]).toMatch(/authoredGuestEntries\s+MatchdayGuestEntry\[\]/)
  })
})

describe('v1.91.0 — migration shape', () => {
  it('migration directory + migration.sql exist', () => {
    expect(existsSync(join(REPO_ROOT, MIGRATION_DIR, 'migration.sql'))).toBe(true)
  })

  it('CREATE TABLE "MatchdayGuestEntry" with the required columns', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE "MatchdayGuestEntry"/)
    expect(MIGRATION).toMatch(/"externalCount" INTEGER NOT NULL DEFAULT 0/)
    expect(MIGRATION).toMatch(/"leagueCount" INTEGER NOT NULL DEFAULT 0/)
    expect(MIGRATION).toMatch(/"createdById" TEXT,?\s/)
  })

  it('unique index on (gameWeekId, leagueTeamId)', () => {
    expect(MIGRATION).toMatch(
      /CREATE UNIQUE INDEX "MatchdayGuestEntry_gameWeekId_leagueTeamId_key" ON "MatchdayGuestEntry"\("gameWeekId", "leagueTeamId"\)/,
    )
  })

  it('FKs reference the real Prisma table names (no @@map slip)', () => {
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

  it('contains NO destructive statements (per migration-sql-lessons.md)', () => {
    const stripped = MIGRATION.split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
    expect(stripped).not.toMatch(/\bDELETE FROM\b/i)
    expect(stripped).not.toMatch(/\bDROP TABLE\b/i)
    expect(stripped).not.toMatch(/\bTRUNCATE\b/i)
  })
})

describe('v1.91.0 — types: MatchdayGuestCounts on LeagueData', () => {
  it('MatchdayGuestCounts interface exported', () => {
    expect(TYPES_SRC).toMatch(/export interface MatchdayGuestCounts/)
  })

  it('LeagueData has required guestCounts field', () => {
    const block = TYPES_SRC.match(/export interface LeagueData\s*\{[\s\S]+?\n\}/)
    expect(block).toBeTruthy()
    expect(block![0]).toMatch(/guestCounts:\s*MatchdayGuestCounts/)
  })
})

describe('v1.91.0 — guestSynthesis pure helpers', () => {
  it('GUEST_PSEUDO_ID_PREFIX is the documented prefix', () => {
    expect(GUEST_PSEUDO_ID_PREFIX).toBe('guest-pseudo-')
  })

  it('isGuestPseudoId detects the prefix and rejects non-prefixed ids', () => {
    expect(isGuestPseudoId('guest-pseudo-mariners-fc-1')).toBe(true)
    expect(isGuestPseudoId('guest-pseudo-')).toBe(true)
    expect(isGuestPseudoId('p-stefan')).toBe(false)
    expect(isGuestPseudoId('mariners-fc')).toBe(false)
    expect(isGuestPseudoId('')).toBe(false)
  })

  it('synthesizeGuestPlayers(team, 0) returns []', () => {
    expect(synthesizeGuestPlayers('mariners-fc', 0)).toEqual([])
  })

  it('synthesizeGuestPlayers(team, n) returns n Guest #1..#n positionless players', () => {
    const guests = synthesizeGuestPlayers('mariners-fc', 3)
    expect(guests.length).toBe(3)
    expect(guests[0].name).toBe('Guest #1')
    expect(guests[1].name).toBe('Guest #2')
    expect(guests[2].name).toBe('Guest #3')
    for (const g of guests) {
      expect(g.position).toBeNull()
      expect(g.preferredPositions).toBeUndefined()
      expect(g.secondaryPositions).toBeUndefined()
      expect(g.teamId).toBe('mariners-fc')
      expect(isGuestPseudoId(g.id)).toBe(true)
    }
  })

  it('synthesised ids are unique within a team and stable across calls', () => {
    const a = synthesizeGuestPlayers('mariners-fc', 3)
    const b = synthesizeGuestPlayers('mariners-fc', 3)
    expect(a.map((g) => g.id)).toEqual(b.map((g) => g.id))
    expect(new Set(a.map((g) => g.id)).size).toBe(3)
  })
})

describe('v1.91.0 — bucketConfirmedPlayers exposes a Guests bucket', () => {
  const realPlayer = (id: string, position: string | null) => ({
    id,
    name: id,
    teamId: 't',
    position,
    picture: null,
    retiredAt: null,
  })

  it('GUEST bucket label is "Guests"', () => {
    expect(BUCKET_LABEL.GUEST).toBe('Guests')
  })

  it('groups guest pseudo-IDs into the GUEST bucket', () => {
    const guests = synthesizeGuestPlayers('mariners-fc', 2)
    const realCb = realPlayer('p-cb', 'CB')
    const realFw = realPlayer('p-fw', 'ST')
    const players = [...guests, realCb, realFw]
    const ids = players.map((p) => p.id)
    const groups = bucketConfirmedPlayers(ids, players)
    const guestGroup = groups.find((g) => g.bucket === 'GUEST')
    expect(guestGroup).toBeTruthy()
    expect(guestGroup!.players.length).toBe(2)
  })

  it('GUEST bucket renders AFTER GK/DF/MF/FW (last in returned order)', () => {
    const guest = synthesizeGuestPlayers('mariners-fc', 1)[0]
    const cb = realPlayer('p-cb', 'CB')
    const cm = realPlayer('p-cm', 'CM')
    const groups = bucketConfirmedPlayers(
      [guest.id, cb.id, cm.id],
      [guest, cb, cm],
    )
    const buckets = groups.map((g) => g.bucket)
    // GK absent (no GK player); DF, MF, GUEST in that order.
    expect(buckets[buckets.length - 1]).toBe('GUEST')
  })

  it('omits GUEST bucket entirely when no guest IDs are present', () => {
    const cb = realPlayer('p-cb', 'CB')
    const groups = bucketConfirmedPlayers([cb.id], [cb])
    expect(groups.find((g) => g.bucket === 'GUEST')).toBeUndefined()
  })
})

describe('v1.91.0 — pass 2.5 places guests in back-most non-GK slots', () => {
  // Same algorithm v1.89.1 added for empty-positions players. Regression-
  // target: guests funnel into the same code path; verify they actually
  // land in back-most slots and never at GK.

  function inputsFor(realPositions: ReadonlyArray<string>, guestCount: number): AssignmentInput[] {
    const inputs: AssignmentInput[] = realPositions.map((pos, i) => ({
      id: `p-real-${i}`,
      positions: [pos],
      preferredPositions: [pos],
      secondaryPositions: [],
    }))
    for (let i = 0; i < guestCount; i++) {
      inputs.push({
        id: `${GUEST_PSEUDO_ID_PREFIX}lt-test-${i + 1}`,
        positions: [],
        preferredPositions: [],
        secondaryPositions: [],
      })
    }
    return inputs
  }

  it('a single guest with one CB roster fills the next back-most slot, not GK', () => {
    const formations = getFormationsFor('SOCCER', 9)
    const f433 = formations.find((f) => f.code === '4-3-1') ?? formations[0]
    expect(f433).toBeTruthy()
    const inputs = inputsFor(['GK', 'CB'], 1)
    const result = assignPlayersToFormation('SOCCER', f433, inputs)
    // GK slot has the GK player; the guest lands somewhere non-GK.
    const gkIdx = f433.slots.findIndex((s) => s.code.toUpperCase() === 'GK')
    expect(result.slotAssignments[gkIdx]).toBe('p-real-0')
    const guestId = `${GUEST_PSEUDO_ID_PREFIX}lt-test-1`
    const guestSlot = result.slotAssignments.findIndex((id) => id === guestId)
    expect(guestSlot).toBeGreaterThan(-1)
    expect(f433.slots[guestSlot].code.toUpperCase()).not.toBe('GK')
  })

  it('multiple guests with sparse roster never land at GK', () => {
    const formations = getFormationsFor('SOCCER', 9)
    const fAny = formations[0]
    // Empty roster + 5 guests — all 5 should slot into non-GK slots,
    // GK stays empty (per v1.89.1 hard rule).
    const inputs = inputsFor([], 5)
    const result = assignPlayersToFormation('SOCCER', fAny, inputs)
    const gkIdx = fAny.slots.findIndex((s) => s.code.toUpperCase() === 'GK')
    expect(result.slotAssignments[gkIdx]).toBe(null)
    const guestIds = inputs.map((i) => i.id)
    const placedGuests = guestIds.filter(
      (id) => result.slotAssignments.includes(id),
    )
    expect(placedGuests.length).toBeGreaterThan(0)
    // None at GK.
    for (let i = 0; i < result.slotAssignments.length; i++) {
      if (f0Code(fAny, i) === 'GK' && result.slotAssignments[i]) {
        throw new Error('Guest landed at GK — pass 2.5 hard rule broken')
      }
    }
  })

  it('overflow guests (more guests than non-GK empty slots) land in unassignedPlayers', () => {
    const formations = getFormationsFor('FUTSAL', 5)
    const f0 = formations[0]
    // Futsal 5-aside has 4 outfield + 1 GK. Empty roster + 8 guests:
    // 4 fill outfield, 4 overflow.
    const inputs = inputsFor([], 8)
    const result = assignPlayersToFormation('FUTSAL', f0, inputs)
    expect(result.unassignedPlayers.length).toBeGreaterThanOrEqual(4)
  })
})

function f0Code(f: { slots: ReadonlyArray<{ code: string }> }, i: number): string {
  return f.slots[i]!.code.toUpperCase()
}

describe('v1.91.0 — dbToPublicLeagueData includes guestCounts', () => {
  it('EMPTY_RESULT shape includes guestCounts: {}', () => {
    expect(DB_TO_PUBLIC_SRC).toMatch(/EMPTY_RESULT[\s\S]+?guestCounts:\s*\{\}/)
  })

  it('reads MatchdayGuestEntry rows', () => {
    expect(DB_TO_PUBLIC_SRC).toMatch(
      /prisma\.matchdayGuestEntry\.findMany\(\s*\{[\s\S]+?gameWeekId:\s*\{\s*in:/,
    )
  })

  it('skips rows where both counts are zero (empty-team noise filter)', () => {
    expect(DB_TO_PUBLIC_SRC).toMatch(
      /externalCount\s*===\s*0\s*&&\s*row\.leagueCount\s*===\s*0/,
    )
  })

  it('returns guestCounts in the data payload', () => {
    expect(DB_TO_PUBLIC_SRC).toMatch(/guestCounts,\s*\n\s*\}/)
  })
})

describe('v1.91.0 — server action setMatchdayGuestEntry', () => {
  it('module is server-only', () => {
    expect(ACTION_SRC).toMatch(/^['"]use server['"]/m)
  })

  it('rejects unauthenticated callers', () => {
    expect(ACTION_SRC).toMatch(/Sign in to add guests/)
  })

  it('accepts userId OR lineId on the session (admin-orthogonal pattern)', () => {
    expect(ACTION_SRC).toMatch(/session\.userId/)
    expect(ACTION_SRC).toMatch(/session\.lineId/)
  })

  it('does NOT gate on session.isAdmin (admin-orthogonal-UX rule)', () => {
    // Per the v1.67.0 standing rule, no non-admin code path should
    // gate on `session.isAdmin`. Admin sign-in via OAuth flows through
    // userId/lineId; admin-credentials sessions get rejected by the
    // resolve-or-reject branch above.
    const stripped = ACTION_SRC
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    expect(stripped).not.toMatch(/session\.isAdmin/)
  })

  it('validates non-negative integer counts under MAX_COUNT_PER_FIELD', () => {
    expect(ACTION_SRC).toMatch(/must be ≥ 0/)
    expect(ACTION_SRC).toMatch(/must be an integer/)
    expect(ACTION_SRC).toMatch(/MAX_COUNT_PER_FIELD\s*=\s*50/)
  })

  it('parses matchdayPublicId via the md<n> shape', () => {
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

  it('upserts by (gameWeekId, leagueTeamId)', () => {
    expect(ACTION_SRC).toMatch(/prisma\.matchdayGuestEntry\.upsert/)
    expect(ACTION_SRC).toMatch(/gameWeekId_leagueTeamId/)
  })

  it('writes createdById on both create and update branches', () => {
    expect(ACTION_SRC).toMatch(
      /create:\s*\{[\s\S]+?createdById:\s*userId/,
    )
    expect(ACTION_SRC).toMatch(
      /update:\s*\{[\s\S]+?createdById:\s*userId/,
    )
  })

  it("revalidates the public domain on success", () => {
    expect(ACTION_SRC).toMatch(/revalidate\(\s*\{\s*domain:\s*['"]public['"]/)
  })
})

describe('v1.91.0 — AddGuestsModal client component', () => {
  it("declares 'use client'", () => {
    expect(MODAL_SRC).toMatch(/^['"]use client['"]/m)
  })

  it('imports the server action and calls it on submit', () => {
    expect(MODAL_SRC).toMatch(
      /import\s*\{\s*setMatchdayGuestEntry\s*\}\s*from\s*['"]@\/app\/api\/guests\/actions['"]/,
    )
    expect(MODAL_SRC).toMatch(/setMatchdayGuestEntry\(\{/)
  })

  it('renders two number inputs for external + league guests', () => {
    expect(MODAL_SRC).toMatch(/data-testid="add-guests-external"/)
    expect(MODAL_SRC).toMatch(/data-testid="add-guests-league"/)
    expect(MODAL_SRC).toMatch(/type="number"[\s\S]+?type="number"/)
  })

  it('uses createPortal + role="dialog" + body-scroll-lock pattern', () => {
    expect(MODAL_SRC).toMatch(/createPortal/)
    expect(MODAL_SRC).toMatch(/role="dialog"/)
    expect(MODAL_SRC).toMatch(/aria-modal="true"/)
    expect(MODAL_SRC).toMatch(/document\.body\.style\.overflow\s*=\s*['"]hidden['"]/)
  })

  it('clamps user input to MAX_PER_FIELD = 50', () => {
    expect(MODAL_SRC).toMatch(/MAX_PER_FIELD\s*=\s*50/)
  })
})

describe('v1.91.0 — MatchdayAvailability wiring', () => {
  it('lazy-loads AddGuestsModal via next/dynamic', () => {
    expect(MA_SRC).toMatch(
      /AddGuestsModal\s*=\s*dynamic\(\s*\(\)\s*=>\s*import\(['"]\.\/AddGuestsModal['"]\)/,
    )
  })

  it('useSession-gated button visibility (button only renders when session.user && leagueSlug)', () => {
    expect(MA_SRC).toMatch(/useSession/)
    expect(MA_SRC).toMatch(
      /canAddGuests\s*=\s*Boolean\(session\?\.user\)\s*&&\s*Boolean\(leagueSlug\)/,
    )
  })

  it('renders the "+ Guests" trigger per team', () => {
    expect(MA_SRC).toMatch(/data-testid=\{`add-guests-trigger-\$\{team\.id\}`\}/)
  })

  it('synthesizeGuestPlayers wired into the per-team players array', () => {
    expect(MA_SRC).toMatch(/synthesizeGuestPlayers\(/)
  })

  it('going count uses confirmedIds.length (real + guests), not goingIds.length alone', () => {
    expect(MA_SRC).toMatch(/total\s*=\s*confirmedIds\.length/)
    expect(MA_SRC).toMatch(/\{total\}\s+\{"going"\}/)
  })

  it('past-matchday played count also includes guest IDs', () => {
    expect(MA_SRC).toMatch(/\{total\}\s+\{"played"\}/)
  })

  it('mounts the guest modal via the shared guestModalNode in both branches', () => {
    expect(MA_SRC).toMatch(/guestModalNode/)
    // The node is referenced at least twice (once per branch render).
    const matches = MA_SRC.match(/\{guestModalNode\}/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })
})

describe('v1.91.0 — FormationPitch suppresses guest no-position hint', () => {
  it('imports isGuestPseudoId and excludes guests from the playersWithoutPositions filter', () => {
    expect(FP_SRC).toMatch(
      /import\s*\{\s*isGuestPseudoId\s*\}\s*from\s*['"]@\/lib\/guestSynthesis['"]/,
    )
    expect(FP_SRC).toMatch(/&&\s*!isGuestPseudoId\(p\.id\)/)
  })
})
