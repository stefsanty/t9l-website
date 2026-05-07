/**
 * v1.66.0 — Player payment status system.
 *
 * Per outputs/v1.66.0-player-payment-status-spec.md. Tests pin:
 *
 *   1. APP_VERSION bumped to 1.66.0.
 *   2. Schema additions:
 *      - PaidStatus enum (PAID, UNPAID)
 *      - PlayerLeagueMembership: paidStatus (default UNPAID), paidAt,
 *        feeOverride
 *      - League: defaultFee (default 0)
 *      - LeaguePositionFee model with @@unique([leagueId, position])
 *   3. Migration is non-destructive (no DROP).
 *   4. resolvePlayerFee resolution order:
 *      a) feeOverride if non-null
 *      b) position match in league.positionFees
 *      c) league.defaultFee
 *   5. Server actions exist with right shape:
 *      - updateLeagueFeeSettings (assertAdmin, validation)
 *      - updateMembershipPaidStatus (assertAdmin, IDOR check, paidAt timestamping)
 *      - bulkUpdatePaidStatus (assertAdmin, 200-cap, IDOR check)
 *      - updateMembershipFeeOverride (assertAdmin, IDOR check)
 *   6. UnpaidFeeBanner renders only when data is non-null; reads
 *      formatJpyFee for the message.
 *   7. getUnpaidFeeBannerData returns null on every "hide banner" branch.
 *   8. Banner mounted on Dashboard, /id/[slug], /id/[slug]/md/[id],
 *      /schedule, /stats.
 *   9. Admin LeagueFeesEditor surfaces in SettingsTab.
 *  10. Admin Players kebab gains Mark paid/unpaid item.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolvePlayerFee, formatJpyFee } from '@/lib/playerFee'

const REPO_ROOT = join(__dirname, '..', '..')
const SCHEMA = readFileSync(join(REPO_ROOT, 'prisma/schema.prisma'), 'utf8')
const MIGRATION = readFileSync(
  join(REPO_ROOT, 'prisma/migrations/20260507300000_player_payment_status/migration.sql'),
  'utf8',
)
const VERSION_SRC = readFileSync(join(REPO_ROOT, 'src/lib/version.ts'), 'utf8')
const ADMIN_ACTIONS_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/admin/leagues/actions.ts'),
  'utf8',
)
const BANNER_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/UnpaidFeeBanner.tsx'),
  'utf8',
)
const BANNER_RESOLVER_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/unpaidFeeBanner.ts'),
  'utf8',
)
const FEES_EDITOR_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/admin/LeagueFeesEditor.tsx'),
  'utf8',
)
const SETTINGS_TAB_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/admin/SettingsTab.tsx'),
  'utf8',
)
const PLAYERS_TAB_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/admin/PlayersTab.tsx'),
  'utf8',
)

const MIGRATION_EXEC = MIGRATION.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

describe('v1.66.0 — APP_VERSION bumped', () => {
  it('APP_VERSION is 1.66.0 or higher', () => {
    expect(VERSION_SRC).toMatch(
      /APP_VERSION\s*=\s*['"]1\.(6[6-9]\.\d+|[7-9]\d?\.\d+)['"]/,
    )
  })
})

describe('v1.66.0 — schema additions', () => {
  it('PaidStatus enum has PAID and UNPAID', () => {
    expect(SCHEMA).toMatch(/enum PaidStatus\s*\{[\s\S]*?PAID[\s\S]*?UNPAID[\s\S]*?\}/)
  })

  it('PlayerLeagueMembership.paidStatus defaults to UNPAID', () => {
    const plmBlock = SCHEMA.match(/model PlayerLeagueMembership\s*\{[\s\S]*?\n\}/)![0]
    expect(plmBlock).toMatch(/^\s*paidStatus\s+PaidStatus\s+@default\(UNPAID\)/m)
  })

  it('PlayerLeagueMembership.paidAt is nullable DateTime', () => {
    const plmBlock = SCHEMA.match(/model PlayerLeagueMembership\s*\{[\s\S]*?\n\}/)![0]
    expect(plmBlock).toMatch(/^\s*paidAt\s+DateTime\?/m)
  })

  it('PlayerLeagueMembership.feeOverride is nullable Int', () => {
    const plmBlock = SCHEMA.match(/model PlayerLeagueMembership\s*\{[\s\S]*?\n\}/)![0]
    expect(plmBlock).toMatch(/^\s*feeOverride\s+Int\?/m)
  })

  it('League.defaultFee is Int with default 0', () => {
    const leagueBlock = SCHEMA.match(/model League\s*\{[\s\S]*?\n\}/)![0]
    expect(leagueBlock).toMatch(/^\s*defaultFee\s+Int\s+@default\(0\)/m)
  })

  it('LeaguePositionFee model exists with right shape', () => {
    const block = SCHEMA.match(/model LeaguePositionFee\s*\{[\s\S]*?\n\}/)
    expect(block).not.toBeNull()
    const exec = block![0]
    expect(exec).toMatch(/^\s*leagueId\s+String/m)
    expect(exec).toMatch(/^\s*position\s+String/m)
    expect(exec).toMatch(/^\s*fee\s+Int/m)
    expect(exec).toMatch(/@@unique\(\[leagueId,\s*position\]\)/)
  })

  it('LeaguePositionFee cascades on League delete', () => {
    const block = SCHEMA.match(/model LeaguePositionFee\s*\{[\s\S]*?\n\}/)![0]
    expect(block).toMatch(/league\s+League\s+@relation\([^)]*onDelete:\s*Cascade/)
  })
})

describe('v1.66.0 — migration is non-destructive', () => {
  it('creates the PaidStatus enum', () => {
    expect(MIGRATION_EXEC).toMatch(/CREATE TYPE\s+"PaidStatus"\s+AS ENUM\s*\('PAID',\s*'UNPAID'\)/)
  })

  it('adds three columns to PlayerLeagueAssignment SQL table', () => {
    expect(MIGRATION_EXEC).toMatch(/ADD COLUMN\s+"paidStatus"\s+"PaidStatus"\s+NOT NULL\s+DEFAULT\s+'UNPAID'/)
    expect(MIGRATION_EXEC).toMatch(/ADD COLUMN\s+"paidAt"\s+TIMESTAMP\(3\)/)
    expect(MIGRATION_EXEC).toMatch(/ADD COLUMN\s+"feeOverride"\s+INTEGER/)
  })

  it('adds defaultFee to League with default 0', () => {
    expect(MIGRATION_EXEC).toMatch(
      /ALTER TABLE\s+"League"\s+ADD COLUMN\s+"defaultFee"\s+INTEGER\s+NOT NULL\s+DEFAULT\s+0/,
    )
  })

  it('creates LeaguePositionFee table', () => {
    expect(MIGRATION_EXEC).toMatch(/CREATE TABLE\s+"LeaguePositionFee"/)
  })

  it('contains no destructive operations', () => {
    expect(MIGRATION_EXEC).not.toMatch(/\bDROP TABLE\b/i)
    expect(MIGRATION_EXEC).not.toMatch(/\bDROP COLUMN\b/i)
    expect(MIGRATION_EXEC).not.toMatch(/\bDROP TYPE\b/i)
    expect(MIGRATION_EXEC).not.toMatch(/\bTRUNCATE\b/i)
    expect(MIGRATION_EXEC).not.toMatch(/\bDELETE\s+FROM\b/i)
  })
})

describe('v1.66.0 — resolvePlayerFee resolution order', () => {
  const league = {
    defaultFee: 4000,
    positionFees: [
      { position: 'GK', fee: 5000 },
      { position: 'FP', fee: 3500 },
    ],
  }

  it('feeOverride wins over position match and defaultFee', () => {
    expect(
      resolvePlayerFee({ position: 'GK', feeOverride: 1000 }, league),
    ).toBe(1000)
    expect(
      resolvePlayerFee({ position: null, feeOverride: 0 }, league),
    ).toBe(0)
  })

  it('position match wins when feeOverride is null', () => {
    expect(
      resolvePlayerFee({ position: 'GK', feeOverride: null }, league),
    ).toBe(5000)
  })

  it('falls through to defaultFee when no override and no position match', () => {
    expect(
      resolvePlayerFee({ position: 'DF', feeOverride: null }, league),
    ).toBe(4000)
    // Position null → no match either; fallback.
    expect(
      resolvePlayerFee({ position: null, feeOverride: null }, league),
    ).toBe(4000)
  })

  it('case-sensitive position match (admin types literal)', () => {
    // 'gk' lowercase wouldn't match 'GK' in positionFees.
    expect(
      resolvePlayerFee(
        { position: 'GK', feeOverride: null },
        { defaultFee: 4000, positionFees: [{ position: 'gk', fee: 5000 }] },
      ),
    ).toBe(4000)
  })

  it('returns 0 for a no-fee league (defaultFee = 0, no overrides)', () => {
    expect(
      resolvePlayerFee(
        { position: 'GK', feeOverride: null },
        { defaultFee: 0, positionFees: [] },
      ),
    ).toBe(0)
  })
})

describe('v1.66.0 — formatJpyFee', () => {
  it('formats a number as ¥-prefixed JPY without decimals', () => {
    expect(formatJpyFee(5000)).toMatch(/¥5,000/)
    expect(formatJpyFee(0)).toMatch(/¥0/)
  })
})

describe('v1.66.0 — server actions exist with right shape', () => {
  it('updateLeagueFeeSettings is exported and gates on assertAdmin', () => {
    expect(ADMIN_ACTIONS_SRC).toMatch(/export async function updateLeagueFeeSettings/)
    const idx = ADMIN_ACTIONS_SRC.indexOf('export async function updateLeagueFeeSettings')
    const block = ADMIN_ACTIONS_SRC.slice(idx, idx + 3000)
    expect(block).toMatch(/assertAdmin\(\)/)
    // Replaces the positionFees set inside a transaction.
    expect(block).toMatch(/prisma\.\$transaction/)
    expect(block).toMatch(/leaguePositionFee\.deleteMany/)
    expect(block).toMatch(/leaguePositionFee\.createMany/)
    // Validates defaultFee non-negative integer.
    expect(block).toMatch(/Number\.isInteger.*defaultFee/)
    // Validates each position is non-empty trimmed.
    expect(block).toMatch(/position must be 32 characters or fewer/)
  })

  it('updateMembershipPaidStatus gates on assertAdmin + IDOR check + paidAt timestamping', () => {
    expect(ADMIN_ACTIONS_SRC).toMatch(/export async function updateMembershipPaidStatus/)
    const idx = ADMIN_ACTIONS_SRC.indexOf('export async function updateMembershipPaidStatus')
    const block = ADMIN_ACTIONS_SRC.slice(idx, idx + 3000)
    expect(block).toMatch(/assertAdmin\(\)/)
    // IDOR: verify membership belongs to this league.
    expect(block).toMatch(/Membership does not belong to this league/)
    // paidAt = now() on PAID, null on UNPAID.
    expect(block).toMatch(/paidAt:\s*input\.status === ['"]PAID['"]\s*\?\s*new Date\(\)\s*:\s*null/)
  })

  it('bulkUpdatePaidStatus has assertAdmin + 200-cap + per-row IDOR', () => {
    expect(ADMIN_ACTIONS_SRC).toMatch(/export async function bulkUpdatePaidStatus/)
    const idx = ADMIN_ACTIONS_SRC.indexOf('export async function bulkUpdatePaidStatus')
    const block = ADMIN_ACTIONS_SRC.slice(idx, idx + 3000)
    expect(block).toMatch(/assertAdmin\(\)/)
    expect(block).toMatch(/Cannot update more than 200/)
    // Per-row IDOR check.
    expect(block).toMatch(/One or more memberships do not belong to this league/)
    // updateMany dispatch.
    expect(block).toMatch(/playerLeagueMembership\.updateMany/)
  })

  it('updateMembershipFeeOverride gates on assertAdmin + IDOR + non-negative integer', () => {
    expect(ADMIN_ACTIONS_SRC).toMatch(/export async function updateMembershipFeeOverride/)
    const idx = ADMIN_ACTIONS_SRC.indexOf('export async function updateMembershipFeeOverride')
    const block = ADMIN_ACTIONS_SRC.slice(idx, idx + 3000)
    expect(block).toMatch(/assertAdmin\(\)/)
    expect(block).toMatch(/Membership does not belong to this league/)
    expect(block).toMatch(/feeOverride must be a non-negative integer/)
  })
})

describe('v1.66.0 — UnpaidFeeBanner', () => {
  it('renders nothing when data is null', () => {
    expect(BANNER_SRC).toMatch(/if\s*\(!data\)\s*return null/)
  })

  it('uses formatJpyFee for the message', () => {
    expect(BANNER_SRC).toMatch(/formatJpyFee/)
  })

  it('has data-testid="unpaid-fee-banner" + amount testid', () => {
    expect(BANNER_SRC).toMatch(/data-testid="unpaid-fee-banner"/)
    expect(BANNER_SRC).toMatch(/data-testid="unpaid-fee-amount"/)
  })

  it('is a client component', () => {
    expect(BANNER_SRC).toMatch(/^'use client'/m)
  })
})

describe('v1.66.0 — getUnpaidFeeBannerData hide branches', () => {
  it('returns null on no session', () => {
    expect(BANNER_RESOLVER_SRC).toMatch(/if\s*\(!session\)\s*return null/)
  })

  it('returns null when session has no userId (admin-credentials)', () => {
    expect(BANNER_RESOLVER_SRC).toMatch(/if\s*\(!userId\)\s*return null/)
  })

  it('returns null when User has no playerId', () => {
    expect(BANNER_RESOLVER_SRC).toMatch(/if\s*\(!user\?\.playerId\)\s*return null/)
  })

  it('returns null when no PLM in this league', () => {
    expect(BANNER_RESOLVER_SRC).toMatch(/if\s*\(!plm\)\s*return null/)
  })

  it('returns null when paidStatus === PAID', () => {
    expect(BANNER_RESOLVER_SRC).toMatch(
      /if\s*\(plm\.paidStatus === ['"]PAID['"]\)\s*return null/,
    )
  })

  it('returns null when resolved fee is 0 (no fee configured)', () => {
    expect(BANNER_RESOLVER_SRC).toMatch(/if\s*\(fee === 0\)\s*return null/)
  })

  it('uses resolvePlayerFee from lib/playerFee', () => {
    expect(BANNER_RESOLVER_SRC).toMatch(
      /import\s*\{\s*resolvePlayerFee\s*\}\s*from\s*['"]@\/lib\/playerFee['"]/,
    )
  })
})

describe('v1.66.0 — banner mounted on every league-scoped page', () => {
  const PAGES = [
    'src/app/page.tsx',
    'src/app/id/[slug]/page.tsx',
    'src/app/id/[slug]/md/[id]/page.tsx',
    'src/app/schedule/page.tsx',
    'src/app/stats/page.tsx',
  ]

  for (const p of PAGES) {
    it(`${p} fetches getUnpaidFeeBannerData`, () => {
      const src = readFileSync(join(REPO_ROOT, p), 'utf8')
      expect(src).toMatch(/getUnpaidFeeBannerData/)
    })
  }

  it('Dashboard renders <UnpaidFeeBanner>', () => {
    const dashSrc = readFileSync(
      join(REPO_ROOT, 'src/components/Dashboard.tsx'),
      'utf8',
    )
    expect(dashSrc).toMatch(/<UnpaidFeeBanner/)
  })

  it('StatsDashboard renders <UnpaidFeeBanner>', () => {
    const sdSrc = readFileSync(
      join(REPO_ROOT, 'src/components/StatsDashboard.tsx'),
      'utf8',
    )
    expect(sdSrc).toMatch(/<UnpaidFeeBanner/)
  })
})

describe('v1.66.0 — admin League Settings (LeagueFeesEditor)', () => {
  it('LeagueFeesEditor exports as default', () => {
    expect(FEES_EDITOR_SRC).toMatch(/export default function LeagueFeesEditor/)
  })

  it('imports and uses updateLeagueFeeSettings server action', () => {
    expect(FEES_EDITOR_SRC).toMatch(/updateLeagueFeeSettings/)
  })

  // v1.75.5 — fee fields absorbed into the unified LeagueDetailsEditor;
  // SettingsTab no longer mounts a standalone LeagueFeesEditor. The fee
  // initial props now thread through LeagueDetailsEditor in the same SettingsTab.
  it('SettingsTab passes fee initial props to LeagueDetailsEditor (post v1.75.5 consolidation)', () => {
    expect(SETTINGS_TAB_SRC).toMatch(/<LeagueDetailsEditor/)
    expect(SETTINGS_TAB_SRC).toMatch(/leagueId=\{league\.id\}/)
    expect(SETTINGS_TAB_SRC).toMatch(/initialDefaultFee=\{league\.defaultFee\}/)
    expect(SETTINGS_TAB_SRC).toMatch(/initialPositionFees=\{league\.positionFees\}/)
  })

  it('LeagueFeesEditor has data-testid="league-fees-editor" + key inputs/buttons', () => {
    expect(FEES_EDITOR_SRC).toMatch(/data-testid="league-fees-editor"/)
    expect(FEES_EDITOR_SRC).toMatch(/data-testid="default-fee-input"/)
    expect(FEES_EDITOR_SRC).toMatch(/data-testid="fee-add-row"/)
    expect(FEES_EDITOR_SRC).toMatch(/data-testid="fee-save"/)
  })
})

describe('v1.66.0 — admin Players paid toggle', () => {
  it('imports updateMembershipPaidStatus + formatJpyFee', () => {
    expect(PLAYERS_TAB_SRC).toMatch(/updateMembershipPaidStatus/)
    expect(PLAYERS_TAB_SRC).toMatch(/formatJpyFee/)
  })

  it('PlayerRow interface includes payment fields (optional)', () => {
    expect(PLAYERS_TAB_SRC).toMatch(/paidStatus\?:\s*['"]PAID['"]\s*\|\s*['"]UNPAID['"]/)
    expect(PLAYERS_TAB_SRC).toMatch(/effectiveFee\?:\s*number/)
    expect(PLAYERS_TAB_SRC).toMatch(/membershipId\?:\s*string/)
  })

  it('kebab menu has Mark paid / Mark unpaid item gated on membershipId + paidStatus', () => {
    expect(PLAYERS_TAB_SRC).toMatch(
      /if\s*\(player\.membershipId && player\.paidStatus\)\s*\{[\s\S]*?Mark paid/,
    )
    expect(PLAYERS_TAB_SRC).toMatch(/Mark unpaid/)
  })

  it('handleTogglePaid dispatches updateMembershipPaidStatus with correct status flip', () => {
    const idx = PLAYERS_TAB_SRC.indexOf('async function handleTogglePaid')
    expect(idx).toBeGreaterThan(0)
    const block = PLAYERS_TAB_SRC.slice(idx, idx + 1500)
    expect(block).toMatch(
      /paidStatus === ['"]PAID['"]\s*\?\s*['"]UNPAID['"]\s*:\s*['"]PAID['"]/,
    )
    expect(block).toMatch(/updateMembershipPaidStatus/)
  })
})
