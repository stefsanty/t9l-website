/**
 * v1.64.0 — Application/recruiting workflow tests.
 *
 * Pins:
 *   1. Schema is purely additive (PlayerApplicationStatus enum +
 *      Player.applicationStatus DEFAULT 'APPROVED' + Player.applicationLeagueId).
 *   2. Migration matches the schema and is non-destructive.
 *   3. `applyToLeague` server action shape (auth gates, validation,
 *      State C creates Player+binds User, State D rejects with friendly
 *      message).
 *   4. `adminApproveApplication` + `adminRejectApplication` server actions
 *      shape (assertAdmin gate, status checks, atomic transaction).
 *   5. `getRecruitingViewerState` discriminated union shape + each
 *      state branch.
 *   6. `RecruitingBanner` renders the right surface per viewer kind
 *      (5 testids).
 *   7. Page-level wiring threads `recruitingState` + `league` through
 *      Dashboard (apex `/`, `/id/[slug]`, `/id/[slug]/md/[id]`).
 *   8. Admin Players tab — applicationStatus surfaced to PlayerRow,
 *      status badge in both layouts, kebab Approve/Reject items,
 *      ApproveApplicationDialog component.
 *   9. Pending applications surface in `getLeaguePlayers` (the new 6th
 *      tuple element) and merge into the page-level player list.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')

const SCHEMA_SRC = readFileSync(
  join(REPO_ROOT, 'prisma/schema.prisma'),
  'utf8',
)
const MIGRATION_SRC = readFileSync(
  join(
    REPO_ROOT,
    'prisma/migrations/20260507000000_player_application_status/migration.sql',
  ),
  'utf8',
)
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
const BANNER_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/RecruitingBanner.tsx'),
  'utf8',
)
const APPLY_MODAL_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/ApplyToLeagueModal.tsx'),
  'utf8',
)
const DASHBOARD_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/Dashboard.tsx'),
  'utf8',
)
const APEX_PAGE_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/page.tsx'),
  'utf8',
)
const ID_PAGE_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/id/[slug]/page.tsx'),
  'utf8',
)
const MD_PAGE_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/id/[slug]/md/[id]/page.tsx'),
  'utf8',
)
const PLAYERS_TAB_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/admin/PlayersTab.tsx'),
  'utf8',
)
const ADMIN_DATA_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/admin-data.ts'),
  'utf8',
)
const PLAYERS_PAGE_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/admin/leagues/[id]/players/page.tsx'),
  'utf8',
)

// ────────────────────────────────────────────────────────────────────────────
// 1) Schema + migration
// ────────────────────────────────────────────────────────────────────────────

describe('v1.64.0 — schema additions are purely additive', () => {
  it('declares the PlayerApplicationStatus enum with APPROVED + PENDING', () => {
    expect(SCHEMA_SRC).toMatch(
      /enum PlayerApplicationStatus \{[\s\S]*?APPROVED[\s\S]*?PENDING[\s\S]*?\}/,
    )
  })

  it('adds Player.applicationStatus with DEFAULT(APPROVED) — backward compat', () => {
    expect(SCHEMA_SRC).toMatch(
      /applicationStatus\s+PlayerApplicationStatus\s+@default\(APPROVED\)/,
    )
  })

  it('adds Player.applicationLeagueId nullable', () => {
    expect(SCHEMA_SRC).toMatch(/applicationLeagueId\s+String\?/)
  })

  it('migration creates the enum and adds two columns with the right defaults', () => {
    expect(MIGRATION_SRC).toMatch(/CREATE TYPE "PlayerApplicationStatus"/)
    expect(MIGRATION_SRC).toMatch(
      /ADD COLUMN "applicationStatus" "PlayerApplicationStatus" NOT NULL DEFAULT 'APPROVED'/,
    )
    expect(MIGRATION_SRC).toMatch(/ADD COLUMN "applicationLeagueId" TEXT/)
  })

  it('migration is purely additive (no DROP/ALTER COLUMN/TRUNCATE)', () => {
    // Strip docstring comments first (they describe the rollback recipe
    // which mentions DROP COLUMN — that's documentation, not executable).
    const stripped = MIGRATION_SRC.replace(/--.*$/gm, '')
    expect(stripped).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i)
    expect(stripped).not.toMatch(/\bALTER\s+COLUMN\b/i)
    expect(stripped).not.toMatch(/\bTRUNCATE\b/i)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 2) applyToLeague server action
// ────────────────────────────────────────────────────────────────────────────

describe("v1.64.0 — applyToLeague action", () => {
  it("is a 'use server' action exporting applyToLeague", () => {
    expect(APPLY_ACTION_SRC.trim()).toMatch(/^['"]use server['"]/)
    expect(APPLY_ACTION_SRC).toMatch(/export async function applyToLeague\b/)
  })

  it('rejects unauthenticated callers', () => {
    expect(APPLY_ACTION_SRC).toMatch(/Sign in required/)
  })

  it('rejects admin-credentials sessions (no userId)', () => {
    expect(APPLY_ACTION_SRC).toMatch(/Admin sessions cannot submit applications/)
  })

  it('validates name (required, ≤100 chars)', () => {
    expect(APPLY_ACTION_SRC).toMatch(/Your name is required/)
    expect(APPLY_ACTION_SRC).toMatch(/100 characters or fewer/)
  })

  it('verifies the league exists and accepts applications (recruiting === true)', () => {
    expect(APPLY_ACTION_SRC).toMatch(/league\.recruiting/)
    expect(APPLY_ACTION_SRC).toMatch(/not currently recruiting/)
  })

  it('State D — already-has-Player → friendly admin-contact message', () => {
    expect(APPLY_ACTION_SRC).toMatch(/already have a player profile/)
  })

  it('State C — creates Player with applicationStatus PENDING + applicationLeagueId set', () => {
    expect(APPLY_ACTION_SRC).toMatch(/applicationStatus:\s*['"]PENDING['"]/)
    expect(APPLY_ACTION_SRC).toMatch(/applicationLeagueId:/)
  })

  it("dual-writes the User binding (Player.userId AND User.playerId)", () => {
    // Both directions of the v1.27.0 1:1 invariant must be set in the
    // same transaction.
    expect(APPLY_ACTION_SRC).toMatch(/userId:\s*user\.id/)
    expect(APPLY_ACTION_SRC).toMatch(/tx\.user\.update[\s\S]*?playerId:\s*created\.id/)
  })

  it('busts admin + public caches via revalidate()', () => {
    expect(APPLY_ACTION_SRC).toMatch(/revalidate\(\{\s*domain:\s*['"]admin['"]/)
    expect(APPLY_ACTION_SRC).toMatch(/revalidate\(\{\s*domain:\s*['"]public['"]/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 3) Admin approve/reject actions
// ────────────────────────────────────────────────────────────────────────────

describe('v1.64.0 — admin approve/reject actions', () => {
  it('exports adminApproveApplication and adminRejectApplication', () => {
    expect(ADMIN_ACTIONS_SRC).toMatch(/export async function adminApproveApplication\b/)
    expect(ADMIN_ACTIONS_SRC).toMatch(/export async function adminRejectApplication\b/)
  })

  it('approve gates on assertAdmin and verifies PENDING status', () => {
    // Locate the approve function block and assert assertAdmin appears
    // in it and the status check fires before the mutation.
    const idx = ADMIN_ACTIONS_SRC.indexOf('export async function adminApproveApplication')
    expect(idx).toBeGreaterThan(0)
    const block = ADMIN_ACTIONS_SRC.slice(idx, idx + 2500)
    expect(block).toMatch(/assertAdmin\(\)/)
    expect(block).toMatch(/applicationStatus !== ['"]PENDING['"]/)
  })

  it('approve verifies cross-league isolation (leagueTeam.leagueId === leagueId)', () => {
    const idx = ADMIN_ACTIONS_SRC.indexOf('export async function adminApproveApplication')
    const block = ADMIN_ACTIONS_SRC.slice(idx, idx + 2500)
    expect(block).toMatch(/leagueTeam\.leagueId !== input\.leagueId/)
  })

  it('approve atomically flips status + creates PLA in $transaction', () => {
    const idx = ADMIN_ACTIONS_SRC.indexOf('export async function adminApproveApplication')
    const block = ADMIN_ACTIONS_SRC.slice(idx, idx + 2500)
    expect(block).toMatch(/prisma\.\$transaction\b/)
    expect(block).toMatch(/applicationStatus:\s*['"]APPROVED['"]/)
    expect(block).toMatch(/applicationLeagueId:\s*null/)
    expect(block).toMatch(/tx\.playerLeagueAssignment\.create/)
  })

  it('reject gates on assertAdmin and verifies PENDING status (cannot delete APPROVED player by mistake)', () => {
    const idx = ADMIN_ACTIONS_SRC.indexOf('export async function adminRejectApplication')
    const block = ADMIN_ACTIONS_SRC.slice(idx, idx + 1500)
    expect(block).toMatch(/assertAdmin\(\)/)
    expect(block).toMatch(/applicationStatus !== ['"]PENDING['"]/)
  })

  it('reject clears User.playerId before deleting Player (avoids dangling FK)', () => {
    const idx = ADMIN_ACTIONS_SRC.indexOf('export async function adminRejectApplication')
    const block = ADMIN_ACTIONS_SRC.slice(idx, idx + 1500)
    // The User update with `playerId: null` must come BEFORE the
    // player.delete call.
    const userUpdateIdx = block.search(/tx\.user\.update[\s\S]*?playerId:\s*null/)
    const playerDeleteIdx = block.indexOf('tx.player.delete')
    expect(userUpdateIdx).toBeGreaterThan(0)
    expect(playerDeleteIdx).toBeGreaterThan(userUpdateIdx)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 4) getRecruitingViewerState helper
// ────────────────────────────────────────────────────────────────────────────

describe('v1.64.0 — getRecruitingViewerState helper', () => {
  it('exports the discriminated union with five kinds', () => {
    expect(VIEWER_STATE_SRC).toMatch(/export type RecruitingViewerState/)
    expect(VIEWER_STATE_SRC).toMatch(/kind:\s*['"]unauthenticated['"]/)
    expect(VIEWER_STATE_SRC).toMatch(/kind:\s*['"]no_player['"]/)
    expect(VIEWER_STATE_SRC).toMatch(/kind:\s*['"]pending_this['"]/)
    expect(VIEWER_STATE_SRC).toMatch(/kind:\s*['"]approved_this['"]/)
    expect(VIEWER_STATE_SRC).toMatch(/kind:\s*['"]in_other_league['"]/)
  })

  it('checks Player.applicationLeagueId === leagueId for the pending_this branch', () => {
    expect(VIEWER_STATE_SRC).toMatch(
      /applicationStatus === ['"]PENDING['"][\s\S]*?applicationLeagueId === leagueId/,
    )
  })

  it('approved_this returns the team identity (id + name + logoUrl)', () => {
    expect(VIEWER_STATE_SRC).toMatch(/team:\s*\{[\s\S]*?id:[\s\S]*?name:[\s\S]*?logoUrl:/)
  })

  it("defaults to 'unauthenticated' on Prisma errors (defensive)", () => {
    expect(VIEWER_STATE_SRC).toMatch(/console\.warn[\s\S]*?defaulting unauth/)
    expect(VIEWER_STATE_SRC).toMatch(/return\s*\{\s*kind:\s*['"]unauthenticated['"]/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 5) RecruitingBanner renders the right surface per state
// ────────────────────────────────────────────────────────────────────────────

describe('v1.64.0 — RecruitingBanner state rendering', () => {
  it('imports ApplyToLeagueModal', () => {
    expect(BANNER_SRC).toMatch(/import\s+ApplyToLeagueModal\b/)
  })

  it('approved_this surface has its own testid', () => {
    expect(BANNER_SRC).toMatch(/data-testid="recruiting-banner-approved"/)
  })

  it('pending_this surface has its own testid', () => {
    expect(BANNER_SRC).toMatch(/data-testid="recruiting-banner-pending"/)
  })

  it('unauthenticated CTA testid + signIn dispatch', () => {
    // Banner builds the testid via a `ctaTestid` variable mapped from
    // viewer.kind, then renders `data-testid={ctaTestid}`. Pin both the
    // string literal and the dispatch.
    expect(BANNER_SRC).toMatch(/['"]recruiting-banner-cta-unauth['"]/)
    expect(BANNER_SRC).toMatch(/signIn\(undefined,\s*\{\s*callbackUrl:/)
  })

  it('no_player CTA testid + opens ApplyToLeagueModal', () => {
    expect(BANNER_SRC).toMatch(/['"]recruiting-banner-cta-noplayer['"]/)
    expect(BANNER_SRC).toMatch(/<ApplyToLeagueModal\b/)
  })

  it('in_other_league CTA testid + admin-contact toast (v1.64.0 punt)', () => {
    expect(BANNER_SRC).toMatch(/['"]recruiting-banner-cta-otherleague['"]/)
    expect(BANNER_SRC).toMatch(/Contact the league admin/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 6) ApplyToLeagueModal shape
// ────────────────────────────────────────────────────────────────────────────

describe('v1.64.0 — ApplyToLeagueModal', () => {
  it('is a client component with createPortal escape', () => {
    expect(APPLY_MODAL_SRC.trim()).toMatch(/^['"]use client['"]/)
    expect(APPLY_MODAL_SRC).toMatch(/createPortal\(/)
  })

  it('has dialog a11y (role + aria-modal)', () => {
    expect(APPLY_MODAL_SRC).toMatch(/role="dialog"/)
    expect(APPLY_MODAL_SRC).toMatch(/aria-modal="true"/)
  })

  it('exposes form testids (name + position + submit + error)', () => {
    expect(APPLY_MODAL_SRC).toMatch(/data-testid="apply-name"/)
    expect(APPLY_MODAL_SRC).toMatch(/data-testid="apply-position"/)
    expect(APPLY_MODAL_SRC).toMatch(/data-testid="apply-submit"/)
    expect(APPLY_MODAL_SRC).toMatch(/data-testid="apply-error"/)
  })

  it('calls applyToLeague with leagueId + name + position', () => {
    expect(APPLY_MODAL_SRC).toMatch(/applyToLeague\(\{[\s\S]*?leagueId[\s\S]*?name[\s\S]*?position/)
  })

  it("refreshes session + route on success so banner re-renders as 'pending_this'", () => {
    expect(APPLY_MODAL_SRC).toMatch(/await update\(\)/)
    expect(APPLY_MODAL_SRC).toMatch(/router\.refresh\(\)/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 7) Page-level wiring (apex + /id/<slug> + /id/<slug>/md/<id>)
// ────────────────────────────────────────────────────────────────────────────

describe('v1.64.0 — page-level wiring threads recruitingState + league', () => {
  it('Dashboard accepts recruitingState + league props', () => {
    expect(DASHBOARD_SRC).toMatch(/recruitingState\?:\s*RecruitingViewerState/)
    expect(DASHBOARD_SRC).toMatch(/league\?:\s*\{\s*id:\s*string;\s*name:\s*string\s*\}/)
  })

  it('apex `/` fetches getRecruitingViewerState + league row in Promise.all and threads them', () => {
    expect(APEX_PAGE_SRC).toMatch(/getRecruitingViewerState\(leagueId\)/)
    expect(APEX_PAGE_SRC).toMatch(
      /prisma\.league\.findUnique[\s\S]*?select:\s*\{\s*id:\s*true,\s*name:\s*true/,
    )
    expect(APEX_PAGE_SRC).toMatch(/recruitingState=\{recruitingState\}/)
    expect(APEX_PAGE_SRC).toMatch(/league=\{leagueRow/)
  })

  it('/id/[slug] threads recruitingState + leagueRow', () => {
    expect(ID_PAGE_SRC).toMatch(/getRecruitingViewerState\(leagueId\)/)
    expect(ID_PAGE_SRC).toMatch(/recruitingState=\{recruitingState\}/)
    expect(ID_PAGE_SRC).toMatch(/league=\{leagueRow/)
  })

  it('/id/[slug]/md/[id] threads recruitingState + leagueRow', () => {
    expect(MD_PAGE_SRC).toMatch(/getRecruitingViewerState\(leagueId\)/)
    expect(MD_PAGE_SRC).toMatch(/recruitingState=\{recruitingState\}/)
    expect(MD_PAGE_SRC).toMatch(/league=\{leagueRow/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 8) Admin Players tab — status badge + kebab Approve/Reject
// ────────────────────────────────────────────────────────────────────────────

describe('v1.64.0 — admin Players tab application surface', () => {
  it('PlayerRow interface declares applicationStatus', () => {
    expect(PLAYERS_TAB_SRC).toMatch(
      /applicationStatus:\s*['"]APPROVED['"] \| ['"]PENDING['"]/,
    )
  })

  it('imports adminApproveApplication and adminRejectApplication', () => {
    expect(PLAYERS_TAB_SRC).toMatch(/adminApproveApplication\b/)
    expect(PLAYERS_TAB_SRC).toMatch(/adminRejectApplication\b/)
  })

  it('renders the Application status badge in BOTH layouts (mobile + desktop)', () => {
    expect(PLAYERS_TAB_SRC).toMatch(/data-testid=\{`application-status-mobile-\$\{player\.id\}`/)
    expect(PLAYERS_TAB_SRC).toMatch(/data-testid=\{`application-status-\$\{player\.id\}`/)
  })

  it('kebab menu includes Approve + Reject items only when applicationStatus === PENDING', () => {
    expect(PLAYERS_TAB_SRC).toMatch(
      /player\.applicationStatus === ['"]PENDING['"][\s\S]{0,500}Approve application/,
    )
    expect(PLAYERS_TAB_SRC).toMatch(/Reject application/)
  })

  it('ApproveApplicationDialog component is defined inside the tab module', () => {
    expect(PLAYERS_TAB_SRC).toMatch(/function ApproveApplicationDialog\(/)
    expect(PLAYERS_TAB_SRC).toMatch(/data-testid="approve-application-dialog"/)
    expect(PLAYERS_TAB_SRC).toMatch(/data-testid="approve-team-select"/)
    expect(PLAYERS_TAB_SRC).toMatch(/data-testid="approve-submit"/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 9) admin-data + page-level pending-application merger
// ────────────────────────────────────────────────────────────────────────────

describe('v1.64.0 — getLeaguePlayers fetches pending applications', () => {
  it('extends Promise.all with a 6th query for pending applications', () => {
    expect(ADMIN_DATA_SRC).toMatch(
      /applicationLeagueId:\s*leagueId,[\s\S]*?applicationStatus:\s*['"]PENDING['"]/,
    )
  })

  it('returns 6-element tuple including pendingApplications', () => {
    expect(ADMIN_DATA_SRC).toMatch(/pendingApplications,?\s*\] as const/)
  })

  it('players page destructures the new tuple element', () => {
    expect(PLAYERS_PAGE_SRC).toMatch(
      /\[assignments,\s*leagueTeams,\s*gameWeeks,\s*lineLoginsByLineId,\s*activeInviteCountByPlayerId,\s*pendingApplications\]/,
    )
  })

  it('players page merges pending applications as synthetic rows with empty assignments', () => {
    expect(PLAYERS_PAGE_SRC).toMatch(/for\s*\(const p of pendingApplications\)/)
    expect(PLAYERS_PAGE_SRC).toMatch(/applicationStatus:\s*p\.applicationStatus/)
    expect(PLAYERS_PAGE_SRC).toMatch(/assignments:\s*\[\]/)
  })
})
