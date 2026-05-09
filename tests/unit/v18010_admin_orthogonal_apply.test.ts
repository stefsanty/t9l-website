/**
 * v1.80.10 — Admin-orthogonal-UX fix: applyToLeague + registerToLeague +
 * /recruit/[slug] page + upload-token route.
 *
 * Reported bug: a user got "Admin sessions cannot submit applications"
 * when applying to a new league. The standing rule
 * (docs/admin-orthogonal-ux.md) says admin role MUST NEVER gate
 * user-facing UX. The gate was at:
 *
 *   - src/app/api/recruiting/actions.ts: applyToLeague + registerToLeague
 *     `if (!userId) return 'Admin sessions cannot submit applications'`
 *   - src/app/recruit/[slug]/page.tsx
 *     `if (!userId) return <AdminSessionSurface />`
 *   - src/app/api/blob/upload-token/route.ts
 *     `if (!userId) throw 'Sign in required'` (inside onBeforeGenerateToken)
 *
 * Each rejected:
 *   - admin-credentials shared-password sessions (legitimate — no User row)
 *   - grandfathered LINE sessions whose JWT cookie predates v1.28.0 stage
 *     α.5 (lineId set, userId NOT set on token refresh because the JWT
 *     callback only writes userId on initial sign-in via the `account`
 *     object — see src/lib/auth.ts:765-789)
 *   - LINE-auth admins whose admin role is orthogonal to player binding
 *
 * Fix: resolve the User row by `userId` OR `lineId` (User.lineId @unique
 * per prisma/schema.prisma:18). Mirrors the v1.59.1 fallback in
 * src/app/account/player/actions.ts:requireSelfPlayerSession. Sessions
 * with neither identifier (admin-credentials only) get a neutral
 * "Sign in with a player account" message.
 *
 * Tests are source-string assertions (the project's convention for
 * server-action shape pinning). Each assertion is a regression target —
 * reverting the fix re-introduces the matched string and trips the test.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')
const RECRUITING_ACTIONS_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/api/recruiting/actions.ts'),
  'utf8',
)
const RECRUIT_PAGE_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/recruit/[slug]/page.tsx'),
  'utf8',
)
const UPLOAD_TOKEN_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/api/blob/upload-token/route.ts'),
  'utf8',
)
const VERSION_SRC = readFileSync(join(REPO_ROOT, 'src/lib/version.ts'), 'utf8')

describe('v1.80.10 — APP_VERSION bumped', () => {
  it('APP_VERSION is at least 1.80.10', () => {
    expect(VERSION_SRC).toMatch(
      /APP_VERSION\s*=\s*['"]1\.(80\.(?:1[0-9]|[2-9]\d?)|8[1-9]\.\d+|9\d?\.\d+)['"]/,
    )
  })
})

describe('v1.80.10 — applyToLeague admin-orthogonal-UX fix', () => {
  // Strip block + line comments before regression-target checks so
  // historical context in the docstring (which legitimately mentions the
  // old behavior) doesn't false-positive.
  const exec = RECRUITING_ACTIONS_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  it('admin-shaming "Admin sessions cannot submit applications" string is GONE from executable code', () => {
    expect(exec).not.toMatch(/Admin sessions cannot submit applications/)
  })

  it('neutral fallback message is in place', () => {
    expect(RECRUITING_ACTIONS_SRC).toMatch(/Sign in with a player account to apply/)
  })

  it('applyToLeague gate accepts userId OR lineId (mirrors v1.59.1 pattern)', () => {
    const applyIdx = RECRUITING_ACTIONS_SRC.indexOf(
      'export async function applyToLeague',
    )
    expect(applyIdx).toBeGreaterThan(0)
    // v1.84.0 — bumped from 3000 to 3500 to match `registerToLeague`'s
    // window; the v1.84.0 visibility gate addition (5 lines vs 1 line
    // for the old `recruiting` gate) pushed `prisma.user.findUnique`
    // beyond the original 3000-char slice.
    const block = RECRUITING_ACTIONS_SRC.slice(applyIdx, applyIdx + 3500)
    // Both identifiers pulled from session.
    expect(block).toMatch(/userId\s*=\s*\(session as[\s\S]*\.userId/)
    expect(block).toMatch(/lineId\s*=\s*session\.lineId\s*\|\|\s*null/)
    // Combined gate: only fail when BOTH are null.
    expect(block).toMatch(/!userId\s*&&\s*!lineId/)
  })

  it('applyToLeague resolves User row by userId then lineId fallback', () => {
    const applyIdx = RECRUITING_ACTIONS_SRC.indexOf(
      'export async function applyToLeague',
    )
    // v1.84.0 — see slice-window note above.
    const block = RECRUITING_ACTIONS_SRC.slice(applyIdx, applyIdx + 3500)
    // userId-first lookup.
    expect(block).toMatch(/prisma\.user\.findUnique\(\s*\{\s*where:\s*\{\s*id:\s*userId\s*\}/)
    // lineId fallback lookup.
    expect(block).toMatch(/prisma\.user\.findUnique\(\s*\{\s*where:\s*\{\s*lineId\s*\}/)
  })

  it('registerToLeague gate accepts userId OR lineId', () => {
    const regIdx = RECRUITING_ACTIONS_SRC.indexOf(
      'export async function registerToLeague',
    )
    expect(regIdx).toBeGreaterThan(0)
    const block = RECRUITING_ACTIONS_SRC.slice(regIdx, regIdx + 3500)
    expect(block).toMatch(/userId\s*=\s*\(session as[\s\S]*\.userId/)
    expect(block).toMatch(/lineId\s*=\s*session\.lineId\s*\|\|\s*null/)
    expect(block).toMatch(/!userId\s*&&\s*!lineId/)
  })

  it('registerToLeague resolves User row by userId then lineId fallback', () => {
    const regIdx = RECRUITING_ACTIONS_SRC.indexOf(
      'export async function registerToLeague',
    )
    const block = RECRUITING_ACTIONS_SRC.slice(regIdx, regIdx + 3500)
    expect(block).toMatch(/prisma\.user\.findUnique\(\s*\{\s*where:\s*\{\s*id:\s*userId\s*\}/)
    expect(block).toMatch(/prisma\.user\.findUnique\(\s*\{\s*where:\s*\{\s*lineId\s*\}/)
  })

  it('registerToLeague upload prefix is keyed on RESOLVED user.id (not raw session.userId)', () => {
    // The upload-token route gates pathnames on the resolved canonical
    // User.id; the action MUST validate against the same id so legacy
    // LINE sessions whose session.userId is null still match the prefix
    // their upload-token issued.
    const regIdx = RECRUITING_ACTIONS_SRC.indexOf(
      'export async function registerToLeague',
    )
    const block = RECRUITING_ACTIONS_SRC.slice(regIdx, regIdx + 4000)
    expect(block).toMatch(/expectedPrefix\s*=\s*`\/register-pending\/\$\{user\.id\}\//)
    // Regression target: `${userId}` raw substitution would be the bug.
    expect(block).not.toMatch(/expectedPrefix\s*=\s*`\/register-pending\/\$\{userId\}\//)
  })
})

describe('v1.80.10 — /recruit/[slug] page admin-orthogonal-UX fix', () => {
  // Strip block + line comments before regression-target checks; the
  // historical docstring on NoPlayerAccountSurface legitimately
  // references the v1.67.2 `AdminSessionSurface` it replaces.
  const recruitExec = RECRUIT_PAGE_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(
    /\/\/.*$/gm,
    '',
  )

  it('AdminSessionSurface (admin-shaming copy) is GONE from executable code', () => {
    expect(recruitExec).not.toMatch(/AdminSessionSurface/)
    expect(recruitExec).not.toMatch(/Admin sessions can.t apply/)
    // The neutral replacement surface.
    expect(recruitExec).toMatch(/NoPlayerAccountSurface/)
    expect(recruitExec).toMatch(/data-testid="recruit-no-player-account"/)
  })

  it('page resolves User by userId OR lineId fallback', () => {
    expect(RECRUIT_PAGE_SRC).toMatch(/lineId\s*=\s*session\.lineId\s*\|\|\s*null/)
    expect(RECRUIT_PAGE_SRC).toMatch(/!userId\s*&&\s*!lineId/)
    expect(RECRUIT_PAGE_SRC).toMatch(/prisma\.user\.findUnique\(\s*\{\s*where:\s*\{\s*id:\s*userId\s*\}/)
    expect(RECRUIT_PAGE_SRC).toMatch(/prisma\.user\.findUnique\(\s*\{\s*where:\s*\{\s*lineId\s*\}/)
  })

  it('RegistrationForm receives the RESOLVED user.id (not raw session userId)', () => {
    // After the lineId fallback resolves a User row, the form must use
    // user.id (canonical) for the upload pathname prefix. Passing raw
    // session.userId could be null for legacy LINE sessions.
    expect(RECRUIT_PAGE_SRC).toMatch(/userId=\{user\.id\}/)
  })
})

describe('v1.80.10 — upload-token route admin-orthogonal-UX fix', () => {
  it('route resolves canonical userId via lineId fallback', () => {
    // resolvedUserId is computed from session.userId first, then a Prisma
    // lookup keyed on lineId. This lets legacy LINE sessions upload to
    // their own register-pending/<resolvedUserId>/ prefix.
    expect(UPLOAD_TOKEN_SRC).toMatch(/resolvedUserId/)
    expect(UPLOAD_TOKEN_SRC).toMatch(/prisma\.user\.findUnique\(\s*\{[\s\S]*where:\s*\{\s*lineId\s*\}/)
  })

  it('inner pathname gate keys on resolvedUserId, not raw session userId', () => {
    // Regression target: keying on raw `session.userId` was the v1.71.1
    // bug; legacy LINE sessions land here with userId === null.
    expect(UPLOAD_TOKEN_SRC).toMatch(
      /pathname\.startsWith\(`register-pending\/\$\{resolvedUserId\}\//,
    )
  })

  it('admin-credentials sessions still get the team-logo path (orthogonal)', () => {
    // The fix doesn't alter admin-only behavior. Team-logo uploads still
    // require isAdmin and reject sessions without it.
    expect(UPLOAD_TOKEN_SRC).toMatch(/Admin role required for team-logo uploads/)
  })
})
