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

  it('Player.applicationStatus / applicationLeagueId DROPPED in v1.65.4 (regression target)', () => {
    // v1.64.0 added these columns; v1.65.4 dropped them after the read-flip
    // soak (membership-spec rework PR 5). Pin the post-v1.65.4 state — a
    // regression that re-adds them would need a fresh additive migration.
    const playerBlock = SCHEMA_SRC.match(/model Player\s*\{[\s\S]*?\n\}/)![0]
    const exec = playerBlock.replace(/\/\/.*$/gm, '')
    expect(exec).not.toMatch(/applicationStatus\s+PlayerApplicationStatus/)
    expect(exec).not.toMatch(/applicationLeagueId\s+String\?/)
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

  it('admin-shaming gate is GONE (v1.80.10 — admin-orthogonal-UX rule)', () => {
    // v1.64.0 returned `Admin sessions cannot submit applications` for any
    // session without a userId. v1.80.10 closes the rule violation: the
    // gate is now expressed in terms of identifier resolution
    // (`userId` OR `lineId`, mirroring v1.59.1's
    // `requireSelfPlayerSession`) and the user-facing copy is neutral.
    // Regression target — re-introducing the admin-shaming string would
    // re-introduce the rule violation flagged by docs/admin-orthogonal-ux.md.
    expect(APPLY_ACTION_SRC).not.toMatch(/Admin sessions cannot submit applications/)
    // The neutral fallback message from the new gate.
    expect(APPLY_ACTION_SRC).toMatch(/Sign in with a player account to apply/)
  })

  it('validates name (required, ≤100 chars)', () => {
    expect(APPLY_ACTION_SRC).toMatch(/Your name is required/)
    expect(APPLY_ACTION_SRC).toMatch(/100 characters or fewer/)
  })

  it('verifies the league exists and accepts applications (visibility !== PRIVATE)', () => {
    // v1.84.0 — gate flipped from `!league.recruiting` to
    // `league.visibility === 'PRIVATE'`. PRIVATE leagues require an
    // invite path; PUBLIC_OPEN + PUBLIC_CLOSED both accept applications.
    expect(APPLY_ACTION_SRC).toMatch(/league\.visibility\s*===\s*['"]PRIVATE['"]/)
    expect(APPLY_ACTION_SRC).toMatch(/league is private/)
  })

  it('State D (v1.65.1) — already-has-Player → creates new PLM(PENDING) for the new league', () => {
    // v1.64.0 returned an "already have a player profile, contact admin"
    // error here. v1.65.1 closes the State D bug by creating a fresh
    // PlayerLeagueMembership row with applicationStatus=PENDING tied to
    // the existing Player + the new league's id. The Player record
    // STAYS one global record (Player.applicationStatus is NOT touched
    // — that's a global field; flipping it would corrupt the existing-
    // league admin's view).
    expect(APPLY_ACTION_SRC).toMatch(/State D/i)
    expect(APPLY_ACTION_SRC).toMatch(/playerLeagueMembership\.create/)
    // Per-league truth on the new PLM, not on the global Player row.
    expect(APPLY_ACTION_SRC).toMatch(
      /State D[\s\S]*playerLeagueMembership\.create[\s\S]*applicationStatus:\s*['"]PENDING['"]/,
    )
  })

  it('State C — creates Player + PLM(PENDING) (v1.65.4 — Player.* legacy fields gone)', () => {
    // v1.65.4 — Player.applicationStatus + applicationLeagueId dropped.
    // The PENDING signal lives only on PLM. Pin: the PLM.create payload
    // carries applicationStatus PENDING; Player.create payload doesn't.
    const stateCIdx = APPLY_ACTION_SRC.indexOf('State C — fresh Player')
    expect(stateCIdx).toBeGreaterThan(0)
    const block = APPLY_ACTION_SRC.slice(stateCIdx, stateCIdx + 3000)
    expect(block).toMatch(/playerLeagueMembership\.create[\s\S]*applicationStatus:\s*['"]PENDING['"]/)
    // Regression target: legacy Player.applicationLeagueId is NOT in the
    // executable code post-v1.65.4.
    const exec = APPLY_ACTION_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(exec).not.toMatch(/applicationLeagueId/)
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

  it('approve gates on assertAdmin and verifies PENDING status (v1.65.1 — PLM OR legacy Player check)', () => {
    // v1.65.1 — the approve action accepts BOTH a v1.64.0 legacy
    // pending Player (Player.applicationStatus=PENDING + applicationLeagueId
    // = this league) AND a v1.65.1 PENDING PLM in this league. Either
    // satisfies; the action throws "Player is not a pending application"
    // when neither matches.
    const idx = ADMIN_ACTIONS_SRC.indexOf('export async function adminApproveApplication')
    expect(idx).toBeGreaterThan(0)
    const block = ADMIN_ACTIONS_SRC.slice(idx, idx + 3500)
    expect(block).toMatch(/assertAdmin\(\)/)
    // The acceptance gate now checks for either a PENDING PLM OR a
    // legacy Player.* PENDING match for this league.
    expect(block).toMatch(/Player is not a pending application/)
    expect(block).toMatch(/playerLeagueMembership\.findFirst/)
    expect(block).toMatch(/applicationStatus:\s*['"]PENDING['"]/)
  })

  it('approve verifies cross-league isolation (leagueTeam.leagueId === leagueId)', () => {
    const idx = ADMIN_ACTIONS_SRC.indexOf('export async function adminApproveApplication')
    const block = ADMIN_ACTIONS_SRC.slice(idx, idx + 2500)
    expect(block).toMatch(/leagueTeam\.leagueId !== input\.leagueId/)
  })

  it('approve flips PENDING PLM to APPROVED (v1.65.4 — single PLM-update path)', () => {
    // v1.65.1 had two branches (PLM-update + legacy PLM-create). v1.65.4
    // collapsed to a single PLM-update path since the legacy v1.64.0
    // pending source is gone.
    const idx = ADMIN_ACTIONS_SRC.indexOf('export async function adminApproveApplication')
    const block = ADMIN_ACTIONS_SRC.slice(idx, idx + 3500)
    expect(block).toMatch(/playerLeagueMembership\.update/)
    expect(block).toMatch(/applicationStatus:\s*['"]APPROVED['"]/)
    // Regression: legacy `legacyMatchForThisLeague` variable + legacy
    // Player.applicationLeagueId clear are gone.
    expect(block).not.toMatch(/legacyMatchForThisLeague/)
    expect(block).not.toMatch(/applicationLeagueId:\s*null/)
  })

  it('reject gates on assertAdmin and verifies pending status for THIS league (v1.65.1)', () => {
    // v1.65.1 — accepts both v1.64.0 legacy pending Players and v1.65.1
    // PLM(PENDING) rows. The error message specifies "for this league"
    // since multi-league applicants exist now.
    const idx = ADMIN_ACTIONS_SRC.indexOf('export async function adminRejectApplication')
    const block = ADMIN_ACTIONS_SRC.slice(idx, idx + 3500)
    expect(block).toMatch(/assertAdmin\(\)/)
    expect(block).toMatch(/Player is not a pending application for this league/)
  })

  it('reject deletes only PLM (not Player) for State D applicants (v1.65.1)', () => {
    // v1.65.1 — when a PENDING PLM is being rejected and the Player has
    // ANY APPROVED PLM elsewhere, only delete the PLM. The Player + their
    // other-league memberships survive.
    const idx = ADMIN_ACTIONS_SRC.indexOf('export async function adminRejectApplication')
    const block = ADMIN_ACTIONS_SRC.slice(idx, idx + 3500)
    expect(block).toMatch(/approvedElsewhere/)
    expect(block).toMatch(/playerLeagueMembership\.delete/)
    // The State D branch does NOT call player.delete.
    expect(block).toMatch(/State D[\s\S]*Player survives/)
  })

  it('reject deletes the Player (legacy v1.64.0 path) when no other-league PLM exists', () => {
    // v1.64.0 path preserved: fresh applicant with no other-league
    // membership → delete the Player. v1.27.0 dual-write invariant still
    // requires User.playerId to be cleared first.
    const idx = ADMIN_ACTIONS_SRC.indexOf('export async function adminRejectApplication')
    const block = ADMIN_ACTIONS_SRC.slice(idx, idx + 3500)
    expect(block).toMatch(/tx\.player\.delete/)
    // User.playerId clear must come BEFORE player.delete in source order.
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

  it('checks PLM(PENDING) for this league (v1.65.4 — Player.applicationLeagueId is gone)', () => {
    // v1.64.0 read `Player.applicationLeagueId === leagueId`. v1.65.4
    // dropped the column; the resolver now reads PLM-canonical only.
    expect(VIEWER_STATE_SRC).toMatch(
      /applicationStatus === ['"]PENDING['"]/,
    )
    // Regression target: legacy field reference is gone from executable code.
    const exec = VIEWER_STATE_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(exec).not.toMatch(/applicationLeagueId/)
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
    // v1.80.8 — declared via `next/dynamic` so the modal chunk only
    // fetches when a State D applicant clicks the CTA. The static
    // `import ApplyToLeagueModal from './ApplyToLeagueModal'` form was
    // replaced; perfPhase4.test.ts pins the dynamic-import shape.
    expect(BANNER_SRC).toMatch(
      /(?:import\s+ApplyToLeagueModal\b|const\s+ApplyToLeagueModal\s*=\s*dynamic\()/,
    )
  })

  it('approved_this surface has its own testid', () => {
    expect(BANNER_SRC).toMatch(/data-testid="recruiting-banner-approved"/)
  })

  it('pending_this surface has its own testid', () => {
    expect(BANNER_SRC).toMatch(/data-testid="recruiting-banner-pending"/)
  })

  it('unauthenticated CTA testid + State E sign-in lightbox', () => {
    // v1.64.0 hard-redirected to /auth/signin. v1.65.1 used a toast with
    // a sign-in action button. v1.76.0 replaced the toast with a full
    // SignInLightbox modal (matching the GuestLoginBanner pattern). The
    // unauth click stays on page and opens the lightbox; signIn fires
    // only when the user explicitly picks a provider inside the modal.
    expect(BANNER_SRC).toMatch(/['"]recruiting-banner-cta-unauth['"]/)
    expect(BANNER_SRC).toMatch(/SignInLightbox/)
    // Lightbox open state is set on the unauth click (the new "stay on
    // page, surface providers in-modal" affordance).
    expect(BANNER_SRC).toMatch(/setSignInOpen\(true\)/)
  })

  it('no_player CTA testid is present (v1.67.2 — navigates to /recruit/<slug>)', () => {
    expect(BANNER_SRC).toMatch(/['"]recruiting-banner-cta-noplayer['"]/)
    // v1.67.2 — State C navigates to a dedicated registration route.
    // The Player + PLM are created atomically on form submit via
    // `applyToLeague`, not pre-created via a synthetic invite (the
    // v1.67.0 path that left orphan rows + surfaced "This invite has
    // been used"). Regression target: re-introducing
    // `recruitToLeagueWithOnboarding` would re-introduce the bug.
    // Strip comments first so the historical-context note in the file
    // doesn't false-positive.
    const code = BANNER_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/recruitToLeagueWithOnboarding/)
    expect(BANNER_SRC).toMatch(/router\.push\(`\/recruit\/\$\{leagueSlug\}`\)/)
  })

  it('in_other_league CTA testid + opens ApplyToLeagueModal in existing mode (v1.65.1 State D fix)', () => {
    expect(BANNER_SRC).toMatch(/['"]recruiting-banner-cta-otherleague['"]/)
    // v1.67.0 — State D still uses the inline modal (simplified intake —
    // existing Player just needs a position for the new league); only
    // State C migrated off. Mode is now hardcoded "existing" rather than
    // dispatched via ternary.
    expect(BANNER_SRC).toMatch(/mode="existing"/)
    // Regression target: the v1.64.0 "Contact the league admin" toast is
    // gone (replaced by the modal-open path).
    expect(BANNER_SRC).not.toMatch(/Contact the league admin/)
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
    // v1.82.0 — Position dropdown replaced with the chip
    // PositionMultiSelect component using `testIdPrefix="apply-position"`.
    expect(APPLY_MODAL_SRC).toMatch(/testIdPrefix="apply-position"/)
    expect(APPLY_MODAL_SRC).toMatch(/data-testid="apply-submit"/)
    expect(APPLY_MODAL_SRC).toMatch(/data-testid="apply-error"/)
  })

  it('v1.82.0 — calls applyToLeague with leagueId + name + positions[]', () => {
    expect(APPLY_MODAL_SRC).toMatch(/applyToLeague\(\{[\s\S]*?leagueId[\s\S]*?name[\s\S]*?positions/)
  })

  // v1.81.0 — `applyToLeague` now redirects server-side to
  // `<originPath>?submitted=applyToLeague`; the success popup mounts on
  // the destination page (Dashboard's <SuccessConfirmationGate>) and the
  // post-action `router.refresh()` + session `update()` calls are no
  // longer needed (the redirect re-renders the page server-side, picking
  // up fresh recruiting-state for State B). Regression target: those
  // calls must NOT come back, otherwise we'd trigger a refresh AFTER
  // the redirect has navigated which causes a flash.
  it('does not refresh session or route post-success (redirect handles it)', () => {
    expect(APPLY_MODAL_SRC).not.toMatch(/await update\(\)/)
    expect(APPLY_MODAL_SRC).not.toMatch(/router\.refresh\(\)/)
  })

  it('passes originPath captured at mount time', () => {
    expect(APPLY_MODAL_SRC).toMatch(/originPath/)
    expect(APPLY_MODAL_SRC).toMatch(/window\.location\.pathname/)
  })

  it('re-throws Next.js redirect digest so framework can navigate', () => {
    // The try/catch must surface validation errors inline but re-throw
    // the redirect (`digest` field on the thrown error) — without the
    // re-throw, the framework can't apply the navigation and the user
    // is stuck on the modal.
    expect(APPLY_MODAL_SRC).toMatch(/'digest'\s+in\s+err/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 7) Page-level wiring (apex + /id/<slug> + /id/<slug>/md/<id>)
// ────────────────────────────────────────────────────────────────────────────

describe('v1.64.0 — page-level wiring threads recruitingState + league', () => {
  it('Dashboard accepts recruitingState + league props', () => {
    expect(DASHBOARD_SRC).toMatch(/recruitingState\?:\s*RecruitingViewerState/)
    // v1.73.0 extended the shape to include optional abbreviation; relaxed to prefix-match
    expect(DASHBOARD_SRC).toMatch(/league\?:\s*\{\s*id:\s*string;\s*name:\s*string/)
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

describe('v1.64.0 — getLeaguePlayers fetches pending applications (v1.65.4 — PLM-only)', () => {
  it('queries PlayerLeagueMembership.findMany for PENDING applications (v1.65.4)', () => {
    // v1.64.0 queried Player.applicationLeagueId + applicationStatus.
    // v1.65.4 dropped those columns; the query now hits PLM directly.
    expect(ADMIN_DATA_SRC).toMatch(
      /playerLeagueMembership\.findMany\([\s\S]*?applicationStatus:\s*['"]PENDING['"]/,
    )
  })

  it('returns 7-element tuple including merged pending applications (v1.70.0 added idDataByPlayerId)', () => {
    // v1.65.1 — `mergedPendingApplications` unions v1.64.0
    // `pendingApplications` (Player rows) with v1.65.1
    // `pendingMemberships` (PLM rows).
    // v1.70.0 — `idDataByPlayerId` appended as the 7th element so the
    // page-level builder can surface ID upload state from User.
    expect(ADMIN_DATA_SRC).toMatch(/mergedPendingApplications,/)
    expect(ADMIN_DATA_SRC).toMatch(/idDataByPlayerId,?\s*\] as const/)
  })

  it('players page destructures the new tuple element', () => {
    // v1.70.0 — destructure picks up the 7th element idDataByPlayerId.
    expect(PLAYERS_PAGE_SRC).toMatch(
      /\[\s*assignments,\s*leagueTeams,\s*gameWeeks,\s*lineLoginsByLineId,\s*activeInviteCountByPlayerId,\s*pendingApplications,\s*idDataByPlayerId,?\s*\]/,
    )
  })

  it('players page merges pending applications as synthetic rows with empty assignments', () => {
    expect(PLAYERS_PAGE_SRC).toMatch(/for\s*\(const p of pendingApplications\)/)
    // v1.65.4 — Player.applicationStatus is dropped; the page hardcodes
    // 'PENDING' since pendingApplications now comes exclusively from
    // PLM(PENDING) rows.
    expect(PLAYERS_PAGE_SRC).toMatch(/applicationStatus:\s*['"]PENDING['"]/)
    expect(PLAYERS_PAGE_SRC).toMatch(/assignments:\s*\[\]/)
  })
})
