/**
 * v1.96.0 — Admin-toggleable payment-reminder banner suppression.
 *
 * Tests pin:
 *   1. APP_VERSION bumped to 1.96.0+ and CLAUDE.md header up to date.
 *   2. Schema additive: League.paymentBannerEnabled Boolean @default(true).
 *   3. Migration file exists, additive ADD COLUMN only, no DROP.
 *   4. Resolver `getUnpaidFeeBannerData` selects + short-circuits on the
 *      flag (returns null when paymentBannerEnabled === false; returns
 *      data when true and other gates pass; banner stays hidden for paid
 *      players regardless of the toggle).
 *   5. Server action `updateLeagueDetails` accepts + validates the new
 *      boolean field; rejects non-boolean.
 *   6. Admin LeagueDetailsEditor renders the new toggle (testid + button
 *      + label) and threads `paymentBannerEnabled` into
 *      `updateLeagueDetails`.
 *   7. SettingsTab passes `initialPaymentBannerEnabled` from the league
 *      row.
 *   8. Banner visibility no longer derives from `preseasonMode` — the
 *      resolver MUST NOT read `preseasonMode` (regression target —
 *      future drift would re-introduce the user-reported confusion).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')

const SCHEMA = readFileSync(join(REPO_ROOT, 'prisma/schema.prisma'), 'utf8')
const MIGRATION = readFileSync(
  join(
    REPO_ROOT,
    'prisma/migrations/20260603000000_league_payment_banner_enabled/migration.sql',
  ),
  'utf8',
)
const VERSION_SRC = readFileSync(join(REPO_ROOT, 'src/lib/version.ts'), 'utf8')
const CLAUDE_MD = readFileSync(join(REPO_ROOT, 'CLAUDE.md'), 'utf8')
const RESOLVER_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/unpaidFeeBanner.ts'),
  'utf8',
)
const ADMIN_ACTIONS_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/admin/leagues/actions.ts'),
  'utf8',
)
const EDITOR_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/admin/LeagueDetailsEditor.tsx'),
  'utf8',
)
const SETTINGS_TAB_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/admin/SettingsTab.tsx'),
  'utf8',
)

const MIGRATION_EXEC = MIGRATION.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

// ── 1. version + CLAUDE.md ──────────────────────────────────────────────────

describe('v1.96.0 — APP_VERSION bumped', () => {
  it('APP_VERSION is 1.96.0 or higher', () => {
    expect(VERSION_SRC).toMatch(
      /APP_VERSION\s*=\s*['"](?:1\.(?:9[6-9]\.\d+|\d{3,}\.\d+)|2\.\d+\.\d+)['"]|APP_VERSION\s*=\s*['"][2-9]\.\d+\.\d+['"]/,
    )
  })
  it('CLAUDE.md header pins v1.96.0 or higher current release', () => {
    expect(CLAUDE_MD).toMatch(
      /\*\*Current release:\*\*\s*(?:v1\.(?:9[6-9]\.\d+|\d{3,}\.\d+)|v2\.\d+\.\d+)|\*\*Current release:\*\*\s*v[2-9]\.\d+\.\d+/,
    )
  })
})

// ── 2. schema ───────────────────────────────────────────────────────────────

describe('v1.96.0 — schema: League.paymentBannerEnabled', () => {
  it('column declared on League with Boolean type and default true', () => {
    const leagueBlock = SCHEMA.match(/model League\s*\{[\s\S]*?\n\}/)![0]
    expect(leagueBlock).toMatch(
      /^\s*paymentBannerEnabled\s+Boolean\s+@default\(true\)/m,
    )
  })
})

// ── 3. migration ────────────────────────────────────────────────────────────

describe('v1.96.0 — migration: additive ADD COLUMN', () => {
  it('adds paymentBannerEnabled column with default true', () => {
    expect(MIGRATION_EXEC).toMatch(
      /ALTER TABLE\s+"League"\s+ADD COLUMN\s+"paymentBannerEnabled"\s+BOOLEAN\s+NOT NULL\s+DEFAULT\s+true/i,
    )
  })

  it('contains no destructive statements', () => {
    expect(MIGRATION_EXEC).not.toMatch(/\bDROP\b/i)
    expect(MIGRATION_EXEC).not.toMatch(/\bTRUNCATE\b/i)
    expect(MIGRATION_EXEC).not.toMatch(/\bDELETE\s+FROM\b/i)
  })
})

// ── 4. resolver source-grep pins ────────────────────────────────────────────

describe('v1.96.0 — getUnpaidFeeBannerData resolver structure', () => {
  it('selects paymentBannerEnabled from the league row', () => {
    const leagueFindUnique = RESOLVER_SRC.match(
      /prisma\.league\.findUnique\(\{[\s\S]*?\}\)/,
    )!
    expect(leagueFindUnique[0]).toMatch(/paymentBannerEnabled:\s*true/)
  })

  it('short-circuits to null when paymentBannerEnabled is false', () => {
    expect(RESOLVER_SRC).toMatch(
      /if\s*\(!league\.paymentBannerEnabled\)\s*return null/,
    )
  })

  it('regression target: resolver does NOT read preseasonMode', () => {
    expect(RESOLVER_SRC).not.toMatch(/preseasonMode/)
  })
})

// ── 5. server action validation ─────────────────────────────────────────────

describe('v1.96.0 — updateLeagueDetails accepts paymentBannerEnabled', () => {
  it('declares paymentBannerEnabled?: boolean in the input shape', () => {
    expect(ADMIN_ACTIONS_SRC).toMatch(/paymentBannerEnabled\?:\s*boolean/)
  })

  it('validates type and writes through to data', () => {
    expect(ADMIN_ACTIONS_SRC).toMatch(
      /typeof\s+input\.paymentBannerEnabled\s*!==\s*['"]boolean['"]/,
    )
    expect(ADMIN_ACTIONS_SRC).toMatch(
      /data\.paymentBannerEnabled\s*=\s*input\.paymentBannerEnabled/,
    )
  })
})

// ── 6. admin editor UI ──────────────────────────────────────────────────────

describe('v1.96.0 — LeagueDetailsEditor renders the toggle', () => {
  it('declares initialPaymentBannerEnabled prop', () => {
    expect(EDITOR_SRC).toMatch(/initialPaymentBannerEnabled:\s*boolean/)
  })

  it('binds local state from the initial prop', () => {
    expect(EDITOR_SRC).toMatch(
      /const\s+\[paymentBannerEnabled,\s*setPaymentBannerEnabled\]\s*=\s*useState<boolean>\(\s*initialPaymentBannerEnabled\s*,?\s*\)/,
    )
  })

  it('renders the toggle with stable testids', () => {
    expect(EDITOR_SRC).toMatch(
      /data-testid="league-details-payment-banner-toggle"/,
    )
    expect(EDITOR_SRC).toMatch(
      /data-testid="league-details-payment-banner-button"/,
    )
  })

  it('uses the spec-pinned label copy for the toggle', () => {
    expect(EDITOR_SRC).toMatch(
      /Show payment reminder banner to unpaid players/,
    )
  })

  it('threads paymentBannerEnabled into updateLeagueDetails on save', () => {
    const saveCall = EDITOR_SRC.match(
      /updateLeagueDetails\(\{[\s\S]*?\}\)/,
    )!
    expect(saveCall[0]).toMatch(/paymentBannerEnabled/)
  })
})

// ── 7. SettingsTab thread-through ───────────────────────────────────────────

describe('v1.96.0 — SettingsTab threads the league row field', () => {
  it('declares paymentBannerEnabled on the League prop type', () => {
    expect(SETTINGS_TAB_SRC).toMatch(/paymentBannerEnabled:\s*boolean/)
  })

  it('passes initialPaymentBannerEnabled to LeagueDetailsEditor', () => {
    expect(SETTINGS_TAB_SRC).toMatch(
      /initialPaymentBannerEnabled=\{league\.paymentBannerEnabled\}/,
    )
  })
})

// ── 8. runtime resolver behaviour ───────────────────────────────────────────

const {
  getServerSessionMock,
  userFindUniqueMock,
  plmFindFirstMock,
  leagueFindUniqueMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  plmFindFirstMock: vi.fn(),
  leagueFindUniqueMock: vi.fn(),
}))

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: userFindUniqueMock },
    playerLeagueMembership: { findFirst: plmFindFirstMock },
    league: { findUnique: leagueFindUniqueMock },
  },
}))

describe('v1.96.0 — getUnpaidFeeBannerData runtime behaviour', () => {
  beforeEach(() => {
    getServerSessionMock.mockReset()
    userFindUniqueMock.mockReset()
    plmFindFirstMock.mockReset()
    leagueFindUniqueMock.mockReset()
  })

  async function call() {
    const { getUnpaidFeeBannerData } = await import('@/lib/unpaidFeeBanner')
    return getUnpaidFeeBannerData('league-1')
  }

  it('returns banner data for unpaid player when toggle ON', async () => {
    getServerSessionMock.mockResolvedValue({ userId: 'u1' })
    userFindUniqueMock.mockResolvedValue({ playerId: 'p1' })
    plmFindFirstMock.mockResolvedValue({
      id: 'plm1',
      position: null,
      feeOverride: null,
      paidStatus: 'UNPAID',
    })
    leagueFindUniqueMock.mockResolvedValue({
      name: 'Test League',
      defaultFee: 5000,
      paymentBannerEnabled: true,
      positionFees: [],
    })

    const result = await call()
    expect(result).toEqual({
      membershipId: 'plm1',
      fee: 5000,
      leagueName: 'Test League',
    })
  })

  it('returns null when toggle OFF (admin suppression overrides everything else)', async () => {
    getServerSessionMock.mockResolvedValue({ userId: 'u1' })
    userFindUniqueMock.mockResolvedValue({ playerId: 'p1' })
    plmFindFirstMock.mockResolvedValue({
      id: 'plm1',
      position: null,
      feeOverride: null,
      paidStatus: 'UNPAID',
    })
    leagueFindUniqueMock.mockResolvedValue({
      name: 'Test League',
      defaultFee: 5000,
      paymentBannerEnabled: false,
      positionFees: [],
    })

    expect(await call()).toBeNull()
  })

  it('returns null for paid players regardless of toggle ON', async () => {
    getServerSessionMock.mockResolvedValue({ userId: 'u1' })
    userFindUniqueMock.mockResolvedValue({ playerId: 'p1' })
    plmFindFirstMock.mockResolvedValue({
      id: 'plm1',
      position: null,
      feeOverride: null,
      paidStatus: 'PAID',
    })
    // league.findUnique should not even be reached, but mock it anyway
    leagueFindUniqueMock.mockResolvedValue({
      name: 'Test League',
      defaultFee: 5000,
      paymentBannerEnabled: true,
      positionFees: [],
    })

    expect(await call()).toBeNull()
    // Confirm the short-circuit happens before the league fetch — paid
    // players never trigger the league lookup.
    expect(leagueFindUniqueMock).not.toHaveBeenCalled()
  })

  it('returns null for paid players regardless of toggle OFF', async () => {
    getServerSessionMock.mockResolvedValue({ userId: 'u1' })
    userFindUniqueMock.mockResolvedValue({ playerId: 'p1' })
    plmFindFirstMock.mockResolvedValue({
      id: 'plm1',
      position: null,
      feeOverride: null,
      paidStatus: 'PAID',
    })
    leagueFindUniqueMock.mockResolvedValue({
      name: 'Test League',
      defaultFee: 5000,
      paymentBannerEnabled: false,
      positionFees: [],
    })

    expect(await call()).toBeNull()
  })

  it('toggle field is requested in the league select', async () => {
    getServerSessionMock.mockResolvedValue({ userId: 'u1' })
    userFindUniqueMock.mockResolvedValue({ playerId: 'p1' })
    plmFindFirstMock.mockResolvedValue({
      id: 'plm1',
      position: null,
      feeOverride: null,
      paidStatus: 'UNPAID',
    })
    leagueFindUniqueMock.mockResolvedValue({
      name: 'Test League',
      defaultFee: 5000,
      paymentBannerEnabled: true,
      positionFees: [],
    })

    await call()
    const selectArg = leagueFindUniqueMock.mock.calls[0][0]
    expect(selectArg.select).toMatchObject({ paymentBannerEnabled: true })
  })
})
