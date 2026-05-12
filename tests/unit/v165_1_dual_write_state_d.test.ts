/**
 * v1.65.1 — Dual-write + State D bug fix.
 *
 * Tests pin:
 *   1. APP_VERSION bumped to 1.65.1.
 *   2. `applyToLeague` State D path creates a NEW PlayerLeagueMembership
 *      row with applicationStatus=PENDING tied to the existing Player
 *      and the new league. The Player record stays one global record;
 *      Player.applicationStatus is NOT touched.
 *   3. `applyToLeague` State C path creates BOTH the Player +
 *      PLM(PENDING) in a single $transaction (dual-write).
 *   4. `applyToLeague` State D idempotency: clicking again when a PLM
 *      already exists returns ok without creating a duplicate.
 *   5. `getRecruitingViewerState` UNION read: pending_this fires for
 *      EITHER a v1.65.1 PLM(PENDING) in this league OR the legacy
 *      v1.64.0 Player.applicationStatus + applicationLeagueId match.
 *   6. `RecruitingBanner` State D click opens ApplyToLeagueModal in
 *      'existing' mode (not the v1.64.0 contact-admin toast).
 *   7. `RecruitingBanner` State E click toasts (does NOT redirect).
 *   8. `ApplyToLeagueModal` accepts `mode: 'fresh' | 'existing'`; the
 *      'existing' mode hides the name input.
 *   9. `adminApproveApplication` accepts BOTH legacy v1.64.0 PENDING
 *      Players AND v1.65.1 PLM(PENDING) rows; updates the existing
 *      PLM in the v1.65.1 path, creates one in the legacy path.
 *  10. `adminRejectApplication` for State D applicants deletes ONLY
 *      the PLM (not the Player); for v1.64.0 path still deletes the
 *      Player after clearing User.playerId.
 *  11. `getLeaguePlayers` merges v1.64.0 Player rows + v1.65.1 PLM
 *      rows into one pending-applications surface.
 *
 * The State D bug is the load-bearing target: a Stefan-APPROVED-in-T9L
 * Player can submit a PENDING application to Shinjuku without the
 * v1.64.0 "contact admin" wall and without corrupting his APPROVED
 * state in T9L.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')
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
const ADMIN_DATA_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/admin-data.ts'),
  'utf8',
)
const VERSION_SRC = readFileSync(join(REPO_ROOT, 'src/lib/version.ts'), 'utf8')

describe('v1.65.1 — APP_VERSION bumped (chain proceeds)', () => {
  it('APP_VERSION is at least 1.65.1 (chain ships v1.65.x sequentially)', () => {
    // Pin the bump that landed in v1.65.1; subsequent chain PRs (v1.65.2+)
    // can bump higher. Match v1.65.1, v1.65.2, ... v1.65.9 (single-digit
    // patch is plenty for the chain).
    // Chain ships sequentially. v1.65.1 introduced these contracts; later
    // versions may continue to honor them. Match any v1.65.[1-9] OR any
    // higher minor (1.66+) so the test stays green as the codebase grows.
    expect(VERSION_SRC).toMatch(/APP_VERSION\s*=\s*['"](?:1\.(?:65\.[1-9]|6[6-9]\.\d+|[7-9]\d?\.\d+)|2\.\d+\.\d+)['"]/)
  })
})

describe('v1.65.1 — State D bug fix in applyToLeague', () => {
  it('legacy v1.64.0 contact-admin error is gone', () => {
    // The v1.64.0 path returned `error: 'You already have a player profile. Contact the league admin...'`
    // for State D. v1.65.1 closes this — the user can now apply.
    expect(APPLY_ACTION_SRC).not.toMatch(/Contact the league admin to add you to this league/)
  })

  it('State D creates a new PLM(PENDING) for the existing Player', () => {
    // Locate the executable State D branch (not the docstring).
    const stateDIdx = APPLY_ACTION_SRC.indexOf('State D — multi-league application path')
    expect(stateDIdx).toBeGreaterThan(0)
    const stateCIdx = APPLY_ACTION_SRC.indexOf('State C — fresh Player')
    expect(stateCIdx).toBeGreaterThan(stateDIdx)
    const block = APPLY_ACTION_SRC.slice(stateDIdx, stateCIdx)
    expect(block).toMatch(/playerLeagueMembership\.create/)
    expect(block).toMatch(/applicationStatus:\s*['"]PENDING['"]/)
    expect(block).toMatch(/leagueId:\s*league\.id/)
    expect(block).toMatch(/leagueTeamId:\s*null/)
  })

  it('State D does NOT touch Player.applicationStatus (regression target)', () => {
    // Critical: State D applicants stay APPROVED globally on Player.
    // The action MUST NOT set Player.applicationStatus to PENDING in the
    // State D branch — that would corrupt the existing-league admin's view.
    const stateDIdx = APPLY_ACTION_SRC.indexOf('State D — multi-league application path')
    const stateCIdx = APPLY_ACTION_SRC.indexOf('State C — fresh Player')
    expect(stateDIdx).toBeGreaterThan(0)
    expect(stateCIdx).toBeGreaterThan(stateDIdx)
    const stateDBlock = APPLY_ACTION_SRC.slice(stateDIdx, stateCIdx)
    expect(stateDBlock).not.toMatch(/tx\.player\.update/)
    expect(stateDBlock).not.toMatch(/tx\.player\.create/)
    expect(stateDBlock).not.toMatch(/prisma\.player\.update/)
  })

  it('State D is idempotent — existing PLM(PENDING) returns ok without duplicate create', () => {
    const stateDIdx = APPLY_ACTION_SRC.indexOf('State D — multi-league application path')
    const stateCIdx = APPLY_ACTION_SRC.indexOf('State C — fresh Player')
    const block = APPLY_ACTION_SRC.slice(stateDIdx, stateCIdx)
    expect(block).toMatch(/Idempotency/i)
    expect(block).toMatch(/playerLeagueMembership\.findFirst/)
    expect(block).toMatch(/existingPlm/)
  })

  it('State C dual-writes Player + PLM in a single transaction', () => {
    const stateCIdx = APPLY_ACTION_SRC.indexOf('State C — fresh Player')
    expect(stateCIdx).toBeGreaterThan(0)
    const block = APPLY_ACTION_SRC.slice(stateCIdx, stateCIdx + 3000)
    expect(block).toMatch(/prisma\.\$transaction/)
    expect(block).toMatch(/tx\.player\.create/)
    expect(block).toMatch(/tx\.user\.update/)
    expect(block).toMatch(/tx\.playerLeagueMembership\.create/)
    // Both PLM and Player carry PENDING applicationStatus in State C.
    expect(block).toMatch(/applicationStatus:\s*['"]PENDING['"]/)
  })

  it('result type includes mode: fresh | existing for the caller to differentiate', () => {
    // v1.81.0 — applyToLeague now redirect()s server-side on every
    // success branch (existingPlm idempotent / new PLM / fresh Player),
    // so the inline literal `return { ..., mode: 'existing' }` is gone
    // — the existing-mode redirect lands the user back on the league
    // page where the popup signals success. The type still declares the
    // discriminator (kept for the unreachable State C `return { ...
    // mode: 'fresh' }` that satisfies tsc, plus future-proofing if a
    // caller needs to branch on mode).
    expect(APPLY_ACTION_SRC).toMatch(/mode:\s*['"]fresh['"]\s*\|\s*['"]existing['"]/)
    expect(APPLY_ACTION_SRC).toMatch(/mode:\s*['"]fresh['"]\s*\}/)
  })
})

describe('v1.65.4 — getRecruitingViewerState (PLM-canonical, post-cleanup)', () => {
  // v1.65.1 shipped a UNION read (PLM + legacy Player.* fallback). v1.65.4
  // dropped the legacy Player.applicationStatus/applicationLeagueId fields
  // entirely; the resolver is now PLM-only. The UNION block above is gone.
  it('checks PLM(PENDING) for this league as the primary (and only) signal', () => {
    expect(VIEWER_STATE_SRC).toMatch(/applicationStatus:\s*true/)
    expect(VIEWER_STATE_SRC).toMatch(
      /pendingPlm[\s\S]*applicationStatus === ['"]PENDING['"]/,
    )
  })

  it('legacy v1.64.0 Player.* PENDING fallback is GONE post-v1.65.4 (regression target)', () => {
    // The `legacyPending` variable + `applicationLeagueId === leagueId`
    // check are gone from the executable code. Regression target — strip
    // comments first since the docstring legitimately mentions the
    // historical fields.
    const exec = VIEWER_STATE_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(exec).not.toMatch(/legacyPending/)
    expect(exec).not.toMatch(/applicationLeagueId/)
  })

  it('returns pending_this on the PLM signal alone', () => {
    expect(VIEWER_STATE_SRC).toMatch(/if\s*\(pendingPlm\)/)
  })

  it('State A (approved_this) checks for APPROVED PLM with team', () => {
    expect(VIEWER_STATE_SRC).toMatch(/approvedPlm/)
    expect(VIEWER_STATE_SRC).toMatch(
      /applicationStatus === ['"]APPROVED['"][\s\S]*toGameWeek === null[\s\S]*leagueTeam !== null/,
    )
  })

  it('Prisma where-clause unions new direct leagueId + legacy leagueTeam.leagueId', () => {
    // The PLM query reaches both v1.65.0-backfilled rows (have direct
    // leagueId) and any future-only-leagueTeam rows. Prisma `OR`.
    expect(VIEWER_STATE_SRC).toMatch(/OR:\s*\[[\s\S]*\{\s*leagueId\s*\}/)
    expect(VIEWER_STATE_SRC).toMatch(/leagueTeam:\s*\{\s*leagueId\s*\}/)
  })
})

describe('v1.65.1 — RecruitingBanner State D + E', () => {
  it('State D click opens ApplyToLeagueModal (not the v1.64.0 toast)', () => {
    // The handleClick for in_other_league must call setApplyOpen(true).
    expect(BANNER_SRC).toMatch(/case ['"]in_other_league['"]:[\s\S]*?setApplyOpen\(true\)/)
    // Regression: the v1.64.0 contact-admin toast is gone.
    expect(BANNER_SRC).not.toMatch(/Contact the league admin/)
  })

  it('State D mounts ApplyToLeagueModal with mode="existing"', () => {
    // v1.67.0 — State C migrated off the modal to the full /join/[code]
    // onboarding flow. Modal now mounts ONLY for in_other_league (State D),
    // so mode is hardcoded "existing" rather than dispatched.
    expect(BANNER_SRC).toMatch(/viewer\.kind === ['"]in_other_league['"][\s\S]*?<ApplyToLeagueModal/)
    expect(BANNER_SRC).toMatch(/mode="existing"/)
  })

  it('State E click opens the SignInLightbox instead of redirecting', () => {
    // v1.65.1 used a toast nudge with a sign-in action callback.
    // v1.76.0 replaced the toast with a SignInLightbox (matches
    // GuestLoginBanner). The unauth click stays on page and surfaces
    // the provider list inline; signIn fires from inside the modal.
    expect(BANNER_SRC).toMatch(/case ['"]unauthenticated['"]:[\s\S]*?setSignInOpen\(true\)/)
    expect(BANNER_SRC).toMatch(/SignInLightbox/)
  })
})

describe('v1.65.1 — ApplyToLeagueModal mode prop', () => {
  it('accepts mode: fresh | existing prop with fresh as default', () => {
    expect(APPLY_MODAL_SRC).toMatch(/mode\?:\s*['"]fresh['"]\s*\|\s*['"]existing['"]/)
    expect(APPLY_MODAL_SRC).toMatch(/mode\s*=\s*['"]fresh['"]/)
  })

  it('hides the name input in existing mode', () => {
    // In existing mode, the name <label> + <input> block is not rendered.
    expect(APPLY_MODAL_SRC).toMatch(/mode === ['"]fresh['"][\s\S]*<input/)
  })

  it('passes empty name in existing mode (existing Player carries through)', () => {
    expect(APPLY_MODAL_SRC).toMatch(/mode === ['"]existing['"]\s*\?\s*['"]['"]/)
  })

  it('disables submit only on missing name when in fresh mode', () => {
    expect(APPLY_MODAL_SRC).toMatch(/mode === ['"]fresh['"] && !name\.trim\(\)/)
  })
})

describe('v1.65.4 — adminApproveApplication PLM-canonical path', () => {
  it('looks up PENDING PLM via playerLeagueMembership.findFirst', () => {
    const idx = ADMIN_ACTIONS_SRC.indexOf('export async function adminApproveApplication')
    const block = ADMIN_ACTIONS_SRC.slice(idx, idx + 4000)
    expect(block).toMatch(/playerLeagueMembership\.findFirst/)
    expect(block).toMatch(/applicationStatus:\s*['"]PENDING['"]/)
  })

  it('updates the existing PENDING PLM (only path; v1.65.1 dual-path collapsed in v1.65.4)', () => {
    const idx = ADMIN_ACTIONS_SRC.indexOf('export async function adminApproveApplication')
    const block = ADMIN_ACTIONS_SRC.slice(idx, idx + 4000)
    expect(block).toMatch(/playerLeagueMembership\.update/)
    expect(block).toMatch(/applicationStatus:\s*['"]APPROVED['"]/)
  })

  it('legacy v1.64.0 PLM-create branch is GONE (regression target — single PLM-update path)', () => {
    // v1.65.4 removed the legacy fallback that created a fresh PLM when
    // no PENDING PLM existed. After v1.65.4 only the PLM-update path exists.
    const idx = ADMIN_ACTIONS_SRC.indexOf('export async function adminApproveApplication')
    const block = ADMIN_ACTIONS_SRC.slice(idx, idx + 4000)
    // No legacy `legacyMatchForThisLeague` variable.
    expect(block).not.toMatch(/legacyMatchForThisLeague/)
    // No `tx.playerLeagueMembership.create` call inside this action — only
    // updates. (PLM creates happen elsewhere — applyToLeague, adminCreatePlayer.)
    expect(block).not.toMatch(/tx\.playerLeagueMembership\.create/)
  })
})

describe('v1.65.1 — adminRejectApplication preserves State D Player', () => {
  it('checks for APPROVED PLM elsewhere before deleting Player', () => {
    const idx = ADMIN_ACTIONS_SRC.indexOf('export async function adminRejectApplication')
    const block = ADMIN_ACTIONS_SRC.slice(idx, idx + 4000)
    expect(block).toMatch(/approvedElsewhere/)
    expect(block).toMatch(/applicationStatus:\s*['"]APPROVED['"]/)
  })

  it('deletes only the PLM (not Player) when approvedElsewhere is truthy', () => {
    const idx = ADMIN_ACTIONS_SRC.indexOf('export async function adminRejectApplication')
    const block = ADMIN_ACTIONS_SRC.slice(idx, idx + 4000)
    // The State D branch fires when approvedElsewhere is truthy.
    expect(block).toMatch(/playerLeagueMembership\.delete/)
    expect(block).toMatch(/Player survives/i)
  })

  it('deletes the Player + clears User.playerId in legacy v1.64.0 path', () => {
    const idx = ADMIN_ACTIONS_SRC.indexOf('export async function adminRejectApplication')
    const block = ADMIN_ACTIONS_SRC.slice(idx, idx + 4000)
    expect(block).toMatch(/tx\.user\.update[\s\S]*playerId:\s*null/)
    expect(block).toMatch(/tx\.player\.delete/)
  })

  it('error message specifies "for this league" (multi-league applicants exist)', () => {
    const idx = ADMIN_ACTIONS_SRC.indexOf('export async function adminRejectApplication')
    const block = ADMIN_ACTIONS_SRC.slice(idx, idx + 4000)
    expect(block).toMatch(/Player is not a pending application for this league/)
  })
})

describe('v1.65.4 — getLeaguePlayers PLM-only pending applications', () => {
  // v1.65.1 merged legacy v1.64.0 Player rows + PLM rows; v1.65.4
  // dropped the legacy source entirely. The merge step is now a
  // simple map over the PLM rows with PLM.position attached.
  it('queries playerLeagueMembership.findMany with applicationStatus PENDING', () => {
    expect(ADMIN_DATA_SRC).toMatch(
      /playerLeagueMembership\.findMany\([\s\S]*?applicationStatus:\s*['"]PENDING['"]/,
    )
  })

  it('legacy Player.findMany pending-applications query is GONE (regression target)', () => {
    // Strip comments so docstrings referencing the historical query
    // don't trip the regex.
    const exec = ADMIN_DATA_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(exec).not.toMatch(/applicationLeagueId:\s*leagueId/)
    expect(exec).not.toMatch(/seenPendingPlayerIds/)
  })

  it('returns 7-element tuple including mergedPendingApplications (v1.70.0 added idDataByPlayerId)', () => {
    // v1.70.0 (PR move_id_to_user) appends idDataByPlayerId as the 7th
    // element. The mergedPendingApplications block is preserved as the
    // 6th element; both must be present in the return.
    expect(ADMIN_DATA_SRC).toMatch(/mergedPendingApplications,/)
    expect(ADMIN_DATA_SRC).toMatch(/idDataByPlayerId,?\s*\] as const/)
  })

  it('attaches PLM.position to each pending applicant row', () => {
    expect(ADMIN_DATA_SRC).toMatch(/position:\s*plm\.position/)
  })
})
