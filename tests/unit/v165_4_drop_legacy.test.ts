/**
 * v1.65.4 — Membership-spec rework, stage 4: drop legacy Player.* fields.
 *
 * Final destructive PR in the 5-PR chain. Tests pin:
 *   1. APP_VERSION bumped to 1.65.4.
 *   2. Schema: Player.position, Player.applicationStatus, and
 *      Player.applicationLeagueId are GONE from the model declaration.
 *   3. PlayerApplicationStatus enum is KEPT (PLM still uses it).
 *   4. Migration is the only destructive step in the chain — DROP COLUMN
 *      on the three legacy fields.
 *   5. Position reads flipped: dbToPublicLeagueData reads PLM.position;
 *      admin Players page reads PLM.position; account/player reads PLM.
 *   6. Application reads flipped: getRecruitingViewerState is PLM-only;
 *      admin approve/reject have a single PLM-update path; getLeaguePlayers
 *      pending source is PLM-only.
 *   7. Read-source flag is preserved in lib/settings.ts for backwards
 *      compat but no consumer reads it post-v1.65.4.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')
const SCHEMA = readFileSync(join(REPO_ROOT, 'prisma/schema.prisma'), 'utf8')
const MIGRATION = readFileSync(
  join(REPO_ROOT, 'prisma/migrations/20260507200000_drop_legacy_player_fields/migration.sql'),
  'utf8',
)
const VERSION_SRC = readFileSync(join(REPO_ROOT, 'src/lib/version.ts'), 'utf8')
const PLAYER_BLOCK = SCHEMA.match(/model Player\s*\{[\s\S]*?\n\}/)![0]

const APPLY_ACTION_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/api/recruiting/actions.ts'),
  'utf8',
)
const ADMIN_ACTIONS_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/admin/leagues/actions.ts'),
  'utf8',
)
const VIEWER_STATE_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/recruitingViewerState.ts'),
  'utf8',
)
const ADMIN_DATA_SRC = ['leagues', 'players', 'stats', 'venues', 'users', 'teams', 'index']
  .map((n) => readFileSync(join(REPO_ROOT, 'src/lib/admin-data', n + '.ts'), 'utf8'))
  .join('\n')
const DB_TO_PUBLIC_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/dbToPublicLeagueData.ts'),
  'utf8',
)

// Comment-strip helper — drop /* */ blocks and // line comments so
// docstrings legitimately describing the historical fields don't trip
// the regression assertions.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

describe('v1.65.4 — APP_VERSION bumped', () => {
  it('APP_VERSION is at least 1.65.4', () => {
    // Match any v1.65.[4-9] OR any higher minor.
    expect(VERSION_SRC).toMatch(/APP_VERSION\s*=\s*['"](?:1\.(?:65\.[4-9]|6[6-9]\.\d+|[7-9]\d?\.\d+)|2\.\d+\.\d+)['"]/)
  })
})

describe('v1.65.4 — Player.* legacy fields dropped from schema', () => {
  it('Player.position is GONE from the model', () => {
    const exec = stripComments(PLAYER_BLOCK)
    expect(exec).not.toMatch(/\bposition\s+PlayerPosition/)
  })

  it('Player.applicationStatus is GONE from the model', () => {
    const exec = stripComments(PLAYER_BLOCK)
    expect(exec).not.toMatch(/\bapplicationStatus\s+PlayerApplicationStatus/)
  })

  it('Player.applicationLeagueId is GONE from the model', () => {
    const exec = stripComments(PLAYER_BLOCK)
    expect(exec).not.toMatch(/\bapplicationLeagueId\s+String/)
  })

  it('PlayerApplicationStatus enum SURVIVES (PLM still uses it)', () => {
    expect(SCHEMA).toMatch(/enum PlayerApplicationStatus\s*\{/)
  })

  it('PlayerLeagueMembership.applicationStatus is the canonical home', () => {
    const plmBlock = SCHEMA.match(/model PlayerLeagueMembership\s*\{[\s\S]*?\n\}/)![0]
    expect(plmBlock).toMatch(
      /^\s*applicationStatus\s+PlayerApplicationStatus\s+@default\(APPROVED\)/m,
    )
  })

  it('PlayerLeagueMembership.position is the canonical home', () => {
    const plmBlock = SCHEMA.match(/model PlayerLeagueMembership\s*\{[\s\S]*?\n\}/)![0]
    expect(plmBlock).toMatch(/^\s*position\s+PlayerPosition\?/m)
  })
})

describe('v1.65.4 — migration SQL', () => {
  // Strip comments before the regex so rollback-recipe documentation
  // (which legitimately mentions DROP COLUMN) doesn't conflate with
  // the executable SQL.
  const exec = MIGRATION.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

  it('DROPs Player.position', () => {
    expect(exec).toMatch(/DROP COLUMN\s+"position"/)
  })

  it('DROPs Player.applicationStatus', () => {
    expect(exec).toMatch(/DROP COLUMN\s+"applicationStatus"/)
  })

  it('DROPs Player.applicationLeagueId', () => {
    expect(exec).toMatch(/DROP COLUMN\s+"applicationLeagueId"/)
  })

  it('does NOT drop PlayerApplicationStatus enum (PLM still uses it)', () => {
    expect(exec).not.toMatch(/DROP TYPE\s+"PlayerApplicationStatus"/)
  })

  it('targets only the Player table — no other model touched', () => {
    expect(exec).toMatch(/ALTER TABLE\s+"Player"/)
    expect(exec).not.toMatch(/ALTER TABLE\s+"(?!Player")/)
  })
})

describe('v1.65.4 — position read flip', () => {
  it('dbToPublicLeagueData reads pla.position (not pla.player.position)', () => {
    const exec = stripComments(DB_TO_PUBLIC_SRC)
    expect(exec).toMatch(/pla\.position/)
    // Regression target — the legacy read site is gone.
    expect(exec).not.toMatch(/pla\.player\.position/)
  })

  it('admin Players page reads PLM.position via assignment', () => {
    const playersPageSrc = readFileSync(
      join(REPO_ROOT, 'src/app/admin/leagues/[id]/players/page.tsx'),
      'utf8',
    )
    const exec = stripComments(playersPageSrc)
    expect(exec).toMatch(/position:\s*a\.position/)
    expect(exec).not.toMatch(/position:\s*a\.player\.position/)
  })
})

describe('v1.65.4 — application reads flipped to PLM-canonical', () => {
  it('getRecruitingViewerState no longer reads Player.applicationStatus / applicationLeagueId', () => {
    const exec = stripComments(VIEWER_STATE_SRC)
    expect(exec).not.toMatch(/applicationLeagueId/)
    expect(exec).not.toMatch(/legacyPending/)
  })

  it('adminApproveApplication has single PLM-update path (no legacy fallback)', () => {
    const idx = ADMIN_ACTIONS_SRC.indexOf('export async function adminApproveApplication')
    const block = ADMIN_ACTIONS_SRC.slice(idx, idx + 4000)
    const exec = stripComments(block)
    expect(exec).toMatch(/playerLeagueMembership\.update/)
    expect(exec).not.toMatch(/legacyMatchForThisLeague/)
  })

  it('adminRejectApplication no longer writes Player.applicationStatus / applicationLeagueId', () => {
    const idx = ADMIN_ACTIONS_SRC.indexOf('export async function adminRejectApplication')
    const block = ADMIN_ACTIONS_SRC.slice(idx, idx + 4000)
    const exec = stripComments(block)
    // Regression target: no `tx.player.update` / `prisma.player.update`
    // call inside the reject action (legacy Player.* clear is gone).
    expect(exec).not.toMatch(/tx\.player\.update/)
    expect(exec).not.toMatch(/applicationLeagueId/)
    // The remaining `applicationStatus: 'APPROVED'` reference is a Prisma
    // WHERE filter on PLM (`approvedElsewhere` lookup) — that's fine.
  })

  it('applyToLeague State C does not write Player.applicationStatus / applicationLeagueId', () => {
    const stateCIdx = APPLY_ACTION_SRC.indexOf('State C — fresh Player')
    const block = APPLY_ACTION_SRC.slice(stateCIdx, stateCIdx + 3000)
    const exec = stripComments(block)
    // The Player.create payload must not carry applicationStatus or
    // applicationLeagueId. The PLM.create still carries applicationStatus.
    const playerCreateMatch = exec.match(/tx\.player\.create\([\s\S]*?\}\)/)
    expect(playerCreateMatch).not.toBeNull()
    expect(playerCreateMatch![0]).not.toMatch(/applicationStatus/)
    expect(playerCreateMatch![0]).not.toMatch(/applicationLeagueId/)
  })

  it('getLeaguePlayers reads pending applications from PLM only (no Player legacy query)', () => {
    const exec = stripComments(ADMIN_DATA_SRC)
    expect(exec).toMatch(
      /playerLeagueMembership\.findMany\([\s\S]*?applicationStatus:\s*['"]PENDING['"]/,
    )
    expect(exec).not.toMatch(/applicationLeagueId:\s*leagueId/)
  })
})

describe('v1.65.4 — read-source flag preserved for backwards compat', () => {
  it('lib/settings.ts still exports getPlayerDataReadSource', () => {
    const settingsSrc = readFileSync(join(REPO_ROOT, 'src/lib/settings.ts'), 'utf8')
    expect(settingsSrc).toMatch(/export const getPlayerDataReadSource/)
  })

  it('viewer-state no longer imports the flag (no consumer post-v1.65.4)', () => {
    const exec = stripComments(VIEWER_STATE_SRC)
    expect(exec).not.toMatch(/getPlayerDataReadSource/)
  })
})
