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

describe('v1.65.1 — APP_VERSION bumped', () => {
  it('APP_VERSION is 1.65.1', () => {
    expect(VERSION_SRC).toMatch(/APP_VERSION\s*=\s*['"]1\.65\.1['"]/)
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

  it('result includes mode: fresh | existing for the caller to differentiate', () => {
    expect(APPLY_ACTION_SRC).toMatch(/mode:\s*['"]fresh['"]\s*\|\s*['"]existing['"]/)
    expect(APPLY_ACTION_SRC).toMatch(/mode:\s*['"]fresh['"]\s*\}/)
    expect(APPLY_ACTION_SRC).toMatch(/mode:\s*['"]existing['"]\s*\}/)
  })
})

describe('v1.65.1 — getRecruitingViewerState UNION read', () => {
  it('checks PLM(PENDING) for this league as a primary signal', () => {
    expect(VIEWER_STATE_SRC).toMatch(/applicationStatus:\s*true/)
    expect(VIEWER_STATE_SRC).toMatch(
      /pendingPlm[\s\S]*applicationStatus === ['"]PENDING['"]/,
    )
  })

  it('legacy v1.64.0 Player.* PENDING fallback still fires', () => {
    expect(VIEWER_STATE_SRC).toMatch(/legacyPending/)
    expect(VIEWER_STATE_SRC).toMatch(
      /applicationStatus === ['"]PENDING['"][\s\S]*applicationLeagueId === leagueId/,
    )
  })

  it('returns pending_this when EITHER signal fires', () => {
    expect(VIEWER_STATE_SRC).toMatch(/if\s*\(pendingPlm\s*\|\|\s*legacyPending\)/)
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
    expect(BANNER_SRC).toMatch(
      /viewer\.kind === ['"]in_other_league['"][\s\S]*?['"]existing['"][\s\S]*?['"]fresh['"]/,
    )
    expect(BANNER_SRC).toMatch(/mode=\{viewer\.kind === ['"]in_other_league['"]/)
  })

  it('State E click toasts instead of redirecting', () => {
    expect(BANNER_SRC).toMatch(/case ['"]unauthenticated['"]:[\s\S]*?toast\.message\(/)
    expect(BANNER_SRC).toMatch(/Sign in to apply/)
    // signIn is now inside the toast action callback, not a direct call.
    expect(BANNER_SRC).toMatch(/onClick:\s*\(\)\s*=>\s*signIn\(/)
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

describe('v1.65.1 — adminApproveApplication v1.65.1 dual-path', () => {
  it('looks up PENDING PLM via playerLeagueMembership.findFirst', () => {
    const idx = ADMIN_ACTIONS_SRC.indexOf('export async function adminApproveApplication')
    const block = ADMIN_ACTIONS_SRC.slice(idx, idx + 4000)
    expect(block).toMatch(/playerLeagueMembership\.findFirst/)
    expect(block).toMatch(/applicationStatus:\s*['"]PENDING['"]/)
  })

  it('updates existing PENDING PLM in v1.65.1 path', () => {
    const idx = ADMIN_ACTIONS_SRC.indexOf('export async function adminApproveApplication')
    const block = ADMIN_ACTIONS_SRC.slice(idx, idx + 4000)
    expect(block).toMatch(/tx\.playerLeagueMembership\.update/)
    expect(block).toMatch(/applicationStatus:\s*['"]APPROVED['"]/)
  })

  it('creates new PLM in legacy v1.64.0 path (no PENDING PLM exists)', () => {
    const idx = ADMIN_ACTIONS_SRC.indexOf('export async function adminApproveApplication')
    const block = ADMIN_ACTIONS_SRC.slice(idx, idx + 4000)
    expect(block).toMatch(/tx\.playerLeagueMembership\.create/)
    expect(block).toMatch(/joinSource:\s*['"]SELF_SERVE['"]/)
    expect(block).toMatch(/onboardingStatus:\s*['"]COMPLETED['"]/)
  })

  it('only clears legacy Player.applicationStatus when legacy match for THIS league', () => {
    const idx = ADMIN_ACTIONS_SRC.indexOf('export async function adminApproveApplication')
    const block = ADMIN_ACTIONS_SRC.slice(idx, idx + 4000)
    expect(block).toMatch(/legacyMatchForThisLeague/)
    // The Player.* clear is gated behind `if (legacyMatchForThisLeague)`.
    expect(block).toMatch(/if\s*\(legacyMatchForThisLeague\)\s*\{[\s\S]*?tx\.player\.update/)
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

describe('v1.65.1 — getLeaguePlayers merges legacy + PLM pending applications', () => {
  it('queries playerLeagueMembership.findMany with applicationStatus PENDING', () => {
    expect(ADMIN_DATA_SRC).toMatch(
      /playerLeagueMembership\.findMany\([\s\S]*?applicationStatus:\s*['"]PENDING['"]/,
    )
  })

  it('dedupes by playerId — keeps one entry when both sources fire', () => {
    expect(ADMIN_DATA_SRC).toMatch(/seenPendingPlayerIds/)
    expect(ADMIN_DATA_SRC).toMatch(/mergedPendingApplications/)
  })

  it('returns 6-element tuple ending in mergedPendingApplications', () => {
    expect(ADMIN_DATA_SRC).toMatch(/mergedPendingApplications,?\s*\] as const/)
  })
})
