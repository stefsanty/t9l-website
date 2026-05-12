/**
 * v1.84.0 — homepage redesign phase 1a (schema foundation).
 *
 * This PR ships the foundation for the upcoming `/leagues` directory +
 * persona-aware apex without yet touching the routing surface itself:
 *
 *   1. `LeagueVisibility` enum + `League.visibility` column (default
 *      PUBLIC_CLOSED), with a one-shot backfill that maps existing
 *      `recruiting = true` rows to PUBLIC_OPEN.
 *   2. `User.defaultLeagueId` nullable FK (additive only — phase 1b/1c
 *      wires writes from the upcoming directory + LeagueSwitcher).
 *   3. Admin SettingsTab visibility radio + the `setLeagueVisibility`
 *      server action.
 *   4. RecruitingBanner gate flipped from the legacy `recruiting`
 *      boolean to `visibility === 'PUBLIC_OPEN'` via `getLeagueFlags`.
 *   5. `applyToLeague` server action accepts PUBLIC_OPEN + PUBLIC_CLOSED
 *      and rejects PRIVATE with an "invitation-only" message (the
 *      legacy `!league.recruiting` rejection is gone from this path).
 *
 * Tests are a mix of source-string structural pins (project convention)
 * and runtime assertions through hoisted mocks (mirrors the v1.82.0
 * `v182_multi_position_validation` shape). Each runtime assertion is a
 * regression target: stash-pop verified the suite fails when the gate
 * change is reverted on the executable code.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')
const SCHEMA_SRC = readFileSync(join(REPO_ROOT, 'prisma/schema.prisma'), 'utf8')
const MIGRATION_SRC = readFileSync(
  join(
    REPO_ROOT,
    'prisma/migrations/20260517000000_league_visibility_user_default_league/migration.sql',
  ),
  'utf8',
)
const FLAGS_SRC = readFileSync(join(REPO_ROOT, 'src/lib/leagueFlags.ts'), 'utf8')
const APEX_SRC = readFileSync(join(REPO_ROOT, 'src/app/page.tsx'), 'utf8')
// v2.1.0 — /id/<slug> render tree is split across page.tsx +
// LeagueBannersBlock + LeagueMatchdayContent + LeagueMatchdayClient.
// Concat so cross-cutting regressions still find their target.
const ID_SLUG_SRC =
  readFileSync(join(REPO_ROOT, 'src/app/id/[slug]/page.tsx'), 'utf8') +
  '\n' +
  readFileSync(join(REPO_ROOT, 'src/components/LeagueBannersBlock.tsx'), 'utf8') +
  '\n' +
  readFileSync(join(REPO_ROOT, 'src/components/LeagueMatchdayContent.tsx'), 'utf8') +
  '\n' +
  readFileSync(join(REPO_ROOT, 'src/components/LeagueMatchdayClient.tsx'), 'utf8')
const ID_SLUG_MD_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/id/[slug]/md/[id]/page.tsx'),
  'utf8',
)
const RECRUITING_ACTIONS_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/api/recruiting/actions.ts'),
  'utf8',
)
const ADMIN_ACTIONS_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/admin/leagues/actions.ts'),
  'utf8',
)
const SETTINGS_TAB_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/admin/SettingsTab.tsx'),
  'utf8',
)
const VERSION_SRC = readFileSync(join(REPO_ROOT, 'src/lib/version.ts'), 'utf8')

// ────────────────────────────────────────────────────────────────────────────
// 1) Version bump
// ────────────────────────────────────────────────────────────────────────────

describe('v1.84.0 — APP_VERSION bumped', () => {
  it('APP_VERSION is at least 1.84.0', () => {
    expect(VERSION_SRC).toMatch(
      /APP_VERSION\s*=\s*['"](?:1\.(?:84\.\d+|8[5-9]\.\d+|9\d?\.\d+)|2\.\d+\.\d+)['"]/,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 2) Schema additions
// ────────────────────────────────────────────────────────────────────────────

describe('v1.84.0 — Prisma schema additions', () => {
  it('declares the LeagueVisibility enum with the three required values', () => {
    expect(SCHEMA_SRC).toMatch(/enum\s+LeagueVisibility\s*\{/)
    expect(SCHEMA_SRC).toMatch(
      /enum\s+LeagueVisibility[\s\S]*?PRIVATE[\s\S]*?PUBLIC_CLOSED[\s\S]*?PUBLIC_OPEN[\s\S]*?\}/,
    )
  })

  it('adds League.visibility default PUBLIC_CLOSED', () => {
    expect(SCHEMA_SRC).toMatch(
      /visibility\s+LeagueVisibility\s+@default\(PUBLIC_CLOSED\)/,
    )
  })

  it('adds User.defaultLeagueId nullable FK with onDelete: SetNull', () => {
    expect(SCHEMA_SRC).toMatch(/defaultLeagueId\s+String\?/)
    expect(SCHEMA_SRC).toMatch(
      /defaultLeague\s+League\?\s+@relation\("UserDefaultLeague",\s*fields:\s*\[defaultLeagueId\],\s*references:\s*\[id\],\s*onDelete:\s*SetNull\)/,
    )
    expect(SCHEMA_SRC).toMatch(/@@index\(\[defaultLeagueId\]\)/)
  })

  it('declares the back-relation on League for the named UserDefaultLeague relation', () => {
    expect(SCHEMA_SRC).toMatch(
      /usersWithDefault\s+User\[\]\s+@relation\("UserDefaultLeague"\)/,
    )
  })

  it('keeps League.isDefault for the transition + carries a removal TODO', () => {
    expect(SCHEMA_SRC).toMatch(/isDefault\s+Boolean\s+@default\(false\)/)
    expect(SCHEMA_SRC).toMatch(/TODO\(homepage-phase-1c\):\s*remove\s+`isDefault`/)
  })

  it('keeps the legacy League.recruiting boolean during the transition', () => {
    // Decision 3: legacy column stays. Re-adding the column drop here
    // would break the migration's coexistence assumption.
    expect(SCHEMA_SRC).toMatch(/recruiting\s+Boolean\s+@default\(false\)/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 3) Migration shape
// ────────────────────────────────────────────────────────────────────────────

describe('v1.84.0 — migration creates enum, column, FK, backfill', () => {
  it('creates the LeagueVisibility enum with the canonical literals', () => {
    expect(MIGRATION_SRC).toMatch(
      /CREATE\s+TYPE\s+"LeagueVisibility"\s+AS\s+ENUM\s*\(\s*'PRIVATE'\s*,\s*'PUBLIC_CLOSED'\s*,\s*'PUBLIC_OPEN'\s*\)/,
    )
  })

  it('adds League.visibility NOT NULL DEFAULT PUBLIC_CLOSED', () => {
    expect(MIGRATION_SRC).toMatch(
      /ALTER\s+TABLE\s+"League"[\s\S]*?ADD\s+COLUMN\s+"visibility"\s+"LeagueVisibility"\s+NOT\s+NULL\s+DEFAULT\s+'PUBLIC_CLOSED'/i,
    )
  })

  it('backfills recruiting=true rows to PUBLIC_OPEN (regression target — preserves existing UX)', () => {
    expect(MIGRATION_SRC).toMatch(
      /UPDATE\s+"League"[\s\S]*?SET\s+"visibility"\s*=\s*'PUBLIC_OPEN'[\s\S]*?WHERE\s+"recruiting"\s*=\s*true/i,
    )
  })

  it('does NOT backfill recruiting=false rows (they stay at the PUBLIC_CLOSED default)', () => {
    // No second UPDATE statement targeting recruiting=false — that would
    // be a no-op write but a noisy footgun in code review. The default
    // on ADD COLUMN handles those rows implicitly.
    expect(MIGRATION_SRC).not.toMatch(/SET\s+"visibility"\s*=\s*'PUBLIC_CLOSED'\s+WHERE/i)
  })

  it('adds User.defaultLeagueId nullable column + FK + index', () => {
    expect(MIGRATION_SRC).toMatch(
      /ALTER\s+TABLE\s+"User"[\s\S]*?ADD\s+COLUMN\s+"defaultLeagueId"\s+TEXT/i,
    )
    expect(MIGRATION_SRC).toMatch(
      /ALTER\s+TABLE\s+"User"[\s\S]*?ADD\s+CONSTRAINT\s+"User_defaultLeagueId_fkey"[\s\S]*?REFERENCES\s+"League"\("id"\)[\s\S]*?ON\s+DELETE\s+SET\s+NULL/i,
    )
    expect(MIGRATION_SRC).toMatch(
      /CREATE\s+INDEX\s+"User_defaultLeagueId_idx"\s+ON\s+"User"\("defaultLeagueId"\)/i,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 4) leagueFlags helper exposes visibility
// ────────────────────────────────────────────────────────────────────────────

describe('v1.84.0 — getLeagueFlags includes visibility', () => {
  it('selects visibility from Prisma alongside the legacy flags', () => {
    // v1.98.0 — identity columns (id/name/abbreviation/ballType) were
    // folded onto the same cached read. The select block now carries
    // those plus the original three flags. Pin each column
    // independently so the assertion survives ordering churn.
    expect(FLAGS_SRC).toMatch(/preseasonMode:\s*true/)
    expect(FLAGS_SRC).toMatch(/recruiting:\s*true/)
    expect(FLAGS_SRC).toMatch(/visibility:\s*true/)
  })

  it('LeagueFlags interface includes visibility (PRIVATE | PUBLIC_CLOSED | PUBLIC_OPEN)', () => {
    expect(FLAGS_SRC).toMatch(/visibility:\s*LeagueVisibilityFlag/)
    expect(FLAGS_SRC).toMatch(
      /export\s+type\s+LeagueVisibilityFlag\s*=\s*['"]PRIVATE['"]\s*\|\s*['"]PUBLIC_CLOSED['"]\s*\|\s*['"]PUBLIC_OPEN['"]/,
    )
  })

  it('default flags fall back to visibility=PUBLIC_CLOSED on missing row / Prisma error', () => {
    expect(FLAGS_SRC).toMatch(
      /DEFAULT_FLAGS:\s*LeagueFlags\s*=\s*\{[\s\S]*?visibility:\s*['"]PUBLIC_CLOSED['"][\s\S]*?\}/,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 5) Page wiring — banner gate flipped from `recruiting` to visibility
// ────────────────────────────────────────────────────────────────────────────

describe('v1.84.0 — page consumers gate the banner on visibility === PUBLIC_OPEN', () => {
  it('apex `/` derives recruiting prop from visibility', () => {
    // Regression target: stash-pop reverts to `flags.recruiting` and
    // PUBLIC_CLOSED leagues with legacy recruiting=true would still
    // show the banner via the wrong signal.
    expect(APEX_SRC).toMatch(
      /recruiting=\{flags\.visibility\s*===\s*['"]PUBLIC_OPEN['"]\}/,
    )
    expect(APEX_SRC).not.toMatch(/recruiting=\{flags\.recruiting\}/)
  })

  it('/id/[slug] derives recruiting gate from visibility', () => {
    // v2.1.0 — on /id/<slug> the gate moved inside <LeagueBannersBlock>
    // as `const recruiting = flags.visibility === 'PUBLIC_OPEN'`
    // (a local, not a JSX prop). The semantic regression target — the
    // gate derives from visibility, NOT from the legacy `flags.recruiting`
    // bool — is unchanged.
    expect(ID_SLUG_SRC).toMatch(
      /flags\.visibility\s*===\s*['"]PUBLIC_OPEN['"]/,
    )
    expect(ID_SLUG_SRC).not.toMatch(/recruiting=\{flags\.recruiting\}/)
  })

  it('/id/[slug]/md/[id] derives recruiting prop from visibility', () => {
    expect(ID_SLUG_MD_SRC).toMatch(
      /recruiting=\{flags\.visibility\s*===\s*['"]PUBLIC_OPEN['"]\}/,
    )
    expect(ID_SLUG_MD_SRC).not.toMatch(/recruiting=\{flags\.recruiting\}/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 6) Admin SettingsTab — visibility radio
// ────────────────────────────────────────────────────────────────────────────

describe('v1.84.0 — Admin SettingsTab visibility radio', () => {
  it('imports setLeagueVisibility from the admin actions module', () => {
    expect(SETTINGS_TAB_SRC).toMatch(/setLeagueVisibility/)
  })

  it('renders one button per visibility tier with stable testids', () => {
    // Section testid is rendered as a literal `data-testid="..."`. The
    // per-option testids live in the VISIBILITY_OPTIONS array (single-
    // quoted strings) and are threaded into the JSX via `opt.testId`,
    // so we grep for the literal id anywhere in source.
    expect(SETTINGS_TAB_SRC).toMatch(/data-testid="settings-tab-visibility-section"/)
    expect(SETTINGS_TAB_SRC).toMatch(/settings-tab-visibility-private/)
    expect(SETTINGS_TAB_SRC).toMatch(/settings-tab-visibility-public_closed/)
    expect(SETTINGS_TAB_SRC).toMatch(/settings-tab-visibility-public_open/)
  })

  it('rolls back optimistic state when the server rejects', () => {
    // Pin the rollback shape: `setVisibilityState(prev)` inside the
    // catch branch. Without this, a server reject would leave the UI
    // showing the wrong value.
    expect(SETTINGS_TAB_SRC).toMatch(/setVisibilityState\(prev\)/)
  })

  it('threads the savingToggle state for the visibility radio', () => {
    expect(SETTINGS_TAB_SRC).toMatch(/savingToggle\s*===\s*['"]visibility['"]/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 7) Admin action — setLeagueVisibility
// ────────────────────────────────────────────────────────────────────────────

describe('v1.84.0 — setLeagueVisibility admin action', () => {
  it('exists as an exported async server action', () => {
    expect(ADMIN_ACTIONS_SRC).toMatch(
      /export\s+async\s+function\s+setLeagueVisibility\s*\(/,
    )
  })

  it('asserts admin first, validates the literal set, then writes + revalidates', () => {
    const idx = ADMIN_ACTIONS_SRC.indexOf('export async function setLeagueVisibility')
    expect(idx).toBeGreaterThan(0)
    const block = ADMIN_ACTIONS_SRC.slice(idx, idx + 1500)
    expect(block).toMatch(/await\s+assertAdmin\(\)/)
    expect(block).toMatch(/ALLOWED_VISIBILITY/)
    expect(block).toMatch(/data:\s*\{\s*visibility:\s*value\s*\}/)
    expect(block).toMatch(/revalidate\(\s*\{\s*domain:\s*['"]admin['"]/)
    expect(block).toMatch(/revalidate\(\s*\{\s*domain:\s*['"]public['"]\s*\}/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 8) applyToLeague — runtime gate on visibility (PRIVATE rejected,
//                    PUBLIC_OPEN + PUBLIC_CLOSED accepted)
// ────────────────────────────────────────────────────────────────────────────

const {
  sessionMock,
  leagueFindUniqueMock,
  userFindUniqueMock,
  plmFindFirstMock,
  plmCreateMock,
  txMock,
  redirectMock,
  revalidateMock,
} = vi.hoisted(() => {
  const sessionMock = vi.fn()
  const leagueFindUniqueMock = vi.fn()
  const userFindUniqueMock = vi.fn()
  const plmFindFirstMock = vi.fn()
  const plmCreateMock = vi.fn().mockResolvedValue({ id: 'plm-new' })
  const txMock = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      player: { create: vi.fn().mockResolvedValue({ id: 'p-new' }) },
      user: { update: vi.fn() },
      playerLeagueMembership: { create: plmCreateMock },
    }
    return cb(tx)
  })
  return {
    sessionMock,
    leagueFindUniqueMock,
    userFindUniqueMock,
    plmFindFirstMock,
    plmCreateMock,
    txMock,
    redirectMock: vi.fn().mockImplementation(() => {
      const err = new Error('NEXT_REDIRECT') as Error & { digest?: string }
      err.digest = 'NEXT_REDIRECT'
      throw err
    }),
    revalidateMock: vi.fn(),
  }
})

vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: leagueFindUniqueMock },
    user: { findUnique: userFindUniqueMock },
    playerLeagueMembership: {
      findFirst: plmFindFirstMock,
      create: plmCreateMock,
    },
    $transaction: txMock,
  },
}))
vi.mock('@/lib/revalidate', () => ({ revalidate: revalidateMock }))
vi.mock('next/navigation', () => ({ redirect: redirectMock }))
vi.mock('@vercel/functions', () => ({ waitUntil: (p: Promise<unknown>) => p }))
vi.mock('@/lib/email', () => ({ sendMail: vi.fn() }))
vi.mock('@/lib/emailTemplates', () => ({
  applicationReceivedEmail: vi.fn(() => ({ subject: '', html: '' })),
}))

const { applyToLeague } = await import('@/app/api/recruiting/actions')

beforeEach(() => {
  vi.clearAllMocks()
  sessionMock.mockResolvedValue({ userId: 'u-1', lineId: null })
  userFindUniqueMock.mockResolvedValue({
    id: 'u-1',
    playerId: 'p-existing',
    lineId: null,
  })
  plmFindFirstMock.mockResolvedValue(null)
})

describe('v1.84.0 — applyToLeague gates on visibility', () => {
  it('PUBLIC_OPEN league accepts the apply (creates a PLM and redirects)', async () => {
    leagueFindUniqueMock.mockResolvedValue({
      id: 'league-open',
      recruiting: true,
      visibility: 'PUBLIC_OPEN',
      name: 'Open League',
      subdomain: 'open',
      ballType: 'SOCCER',
    })
    await expect(
      applyToLeague({
        leagueId: 'league-open',
        name: '',
        positions: [],
      }),
    ).rejects.toThrow('NEXT_REDIRECT')
    expect(plmCreateMock).toHaveBeenCalled()
  })

  it('PUBLIC_CLOSED league ALSO accepts the apply (regression target — banner hidden, applications still flow)', async () => {
    leagueFindUniqueMock.mockResolvedValue({
      id: 'league-closed',
      // Legacy `recruiting=false` would have rejected pre-v1.84.0; the
      // visibility gate replaces it.
      recruiting: false,
      visibility: 'PUBLIC_CLOSED',
      name: 'Closed-Listed League',
      subdomain: 'closed',
      ballType: 'SOCCER',
    })
    await expect(
      applyToLeague({
        leagueId: 'league-closed',
        name: '',
        positions: [],
      }),
    ).rejects.toThrow('NEXT_REDIRECT')
    expect(plmCreateMock).toHaveBeenCalled()
  })

  it('PRIVATE league REJECTS the apply with an "invitation-only" message', async () => {
    leagueFindUniqueMock.mockResolvedValue({
      id: 'league-private',
      recruiting: false,
      visibility: 'PRIVATE',
      name: 'Private League',
      subdomain: 'private',
      ballType: 'SOCCER',
    })
    const result = await applyToLeague({
      leagueId: 'league-private',
      name: '',
      positions: [],
    })
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/invitation-only|invite link/i),
    })
    expect(plmCreateMock).not.toHaveBeenCalled()
  })

  it('PRIVATE rejection wins even when legacy recruiting=true (defensive ordering)', async () => {
    // Defensive: an admin who flips visibility=PRIVATE while the legacy
    // recruiting boolean is still on (transition-window edge case)
    // should see the new gate win, not the legacy one.
    leagueFindUniqueMock.mockResolvedValue({
      id: 'league-private-stale',
      recruiting: true,
      visibility: 'PRIVATE',
      name: 'Private Stale Recruiting',
      subdomain: 'priv',
      ballType: 'SOCCER',
    })
    const result = await applyToLeague({
      leagueId: 'league-private-stale',
      name: '',
      positions: [],
    })
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/invitation-only|invite link/i),
    })
    expect(plmCreateMock).not.toHaveBeenCalled()
  })
})
