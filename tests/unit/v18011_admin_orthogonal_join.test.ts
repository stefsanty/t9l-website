/**
 * v1.80.11 — Admin-orthogonal-UX follow-up: src/app/join/[code]/actions.ts.
 *
 * PR #229 (v1.80.10) fixed the gate in src/app/api/recruiting/actions.ts
 * for `applyToLeague` and `registerToLeague`, plus the /recruit/[slug]
 * page and the /api/blob/upload-token route. That PR's audit explicitly
 * flagged five same-pattern sites in src/app/join/[code]/actions.ts as
 * follow-up work:
 *
 *   - redeemInvite              (was rejecting at L74-78 with
 *                                "Admin sessions cannot redeem player invites")
 *   - submitOnboarding          (was rejecting at L259-260 with
 *                                "Admin sessions cannot submit onboarding")
 *   - submitIdUpload            (was rejecting at L348-349 with
 *                                "Admin sessions cannot submit onboarding")
 *   - completeOnboardingWithId  (was rejecting at L485-486 with
 *                                "Admin sessions cannot submit onboarding")
 *   - skipIdUpload              (was rejecting at L657-658 with
 *                                "Admin sessions cannot submit onboarding")
 *
 * Each rejected:
 *   - admin-credentials shared-password sessions (legitimate — no User row)
 *   - grandfathered LINE sessions whose JWT cookie predates v1.28.0 stage
 *     α.5 (lineId set, userId NOT set on token refresh)
 *   - LINE-auth admins whose admin role is orthogonal to player binding
 *
 * Fix mirrors v1.80.10: each gate now accepts userId OR lineId, the
 * User row is resolved by either identifier (User.lineId @unique), and
 * the canonical user.id flows downstream. Admin-shaming copy is replaced
 * with a neutral "Sign in with a player account to ..." message.
 *
 * Tests are source-string assertions (the project's convention for
 * server-action shape pinning). Each is a regression target — reverting
 * the fix re-introduces the matched string and trips the test.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')
const JOIN_ACTIONS_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/join/[code]/actions.ts'),
  'utf8',
)
const VERSION_SRC = readFileSync(join(REPO_ROOT, 'src/lib/version.ts'), 'utf8')

// Strip block + line comments before regression-target checks so the
// docstrings (which legitimately mention the old admin-shaming copy as
// historical context) don't false-positive.
const exec = JOIN_ACTIONS_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

function blockOf(fnName: string, slice = 4000): string {
  const idx = JOIN_ACTIONS_SRC.indexOf(`export async function ${fnName}`)
  if (idx < 0) throw new Error(`fn ${fnName} not found`)
  return JOIN_ACTIONS_SRC.slice(idx, idx + slice)
}

describe('v1.80.11 — APP_VERSION bumped', () => {
  it('APP_VERSION is at least 1.80.11', () => {
    expect(VERSION_SRC).toMatch(
      /APP_VERSION\s*=\s*['"](?:1\..(80\.(?:1[1-9]|[2-9]\d?)|8[1-9]\.\d+|9\d?\.\d+)|[2-9]\.\d+\.\d+)['"]/,
    )
  })
})

describe('v1.80.11 — admin-shaming copy gone from executable code', () => {
  it('"Admin sessions cannot redeem player invites" string is GONE', () => {
    expect(exec).not.toMatch(/Admin sessions cannot redeem player invites/)
  })

  it('"Admin sessions cannot submit onboarding" string is GONE', () => {
    expect(exec).not.toMatch(/Admin sessions cannot submit onboarding/)
  })

  it('neutral fallback messages are in place', () => {
    expect(JOIN_ACTIONS_SRC).toMatch(
      /Sign in with a player account to redeem this invite/,
    )
    expect(JOIN_ACTIONS_SRC).toMatch(
      /Sign in with a player account to complete onboarding/,
    )
  })
})

describe('v1.80.11 — redeemInvite gate accepts userId OR lineId', () => {
  const block = blockOf('redeemInvite', 5000)

  it('pulls both identifiers from session', () => {
    expect(block).toMatch(/sessionUserId\s*=\s*\(session as[\s\S]*\.userId/)
    expect(block).toMatch(/sessionLineId\s*=\s*session\.lineId\s*\|\|\s*null/)
  })

  it('combined gate: only fails when BOTH are null', () => {
    expect(block).toMatch(/!sessionUserId\s*&&\s*!sessionLineId/)
  })

  it('resolves User row by userId then lineId fallback', () => {
    expect(block).toMatch(
      /prisma\.user\.findUnique\(\s*\{\s*where:\s*\{\s*id:\s*sessionUserId\s*\}/,
    )
    expect(block).toMatch(
      /prisma\.user\.findUnique\(\s*\{\s*where:\s*\{\s*lineId:\s*sessionLineId\s*\}/,
    )
  })

  it('downstream uses canonical user.id (not raw session userId)', () => {
    // The function declares `const userId = user.id` after resolution
    // and uses `userId` for the linkUserToPlayer call + target.userId
    // comparison. Regression target: directly using `sessionUserId`
    // downstream would skip the lineId fallback path.
    expect(block).toMatch(/const\s+userId\s*=\s*user\.id/)
  })
})

describe('v1.80.11 — submitOnboarding gate accepts userId OR lineId', () => {
  const block = blockOf('submitOnboarding', 4000)

  it('pulls both identifiers from session', () => {
    expect(block).toMatch(/sessionUserId\s*=\s*\(session as[\s\S]*\.userId/)
    expect(block).toMatch(/sessionLineId\s*=\s*session\.lineId\s*\|\|\s*null/)
  })

  it('combined gate: only fails when BOTH are null', () => {
    expect(block).toMatch(/!sessionUserId\s*&&\s*!sessionLineId/)
  })

  it('resolves User row by userId then lineId fallback', () => {
    expect(block).toMatch(
      /prisma\.user\.findUnique\(\s*\{\s*where:\s*\{\s*id:\s*sessionUserId\s*\}/,
    )
    expect(block).toMatch(
      /prisma\.user\.findUnique\(\s*\{\s*where:\s*\{\s*lineId:\s*sessionLineId\s*\}/,
    )
  })

  it('downstream uses canonical user.id', () => {
    expect(block).toMatch(/const\s+userId\s*=\s*user\.id/)
  })
})

describe('v1.80.11 — submitIdUpload gate accepts userId OR lineId', () => {
  const block = blockOf('submitIdUpload', 4500)

  it('pulls both identifiers from session', () => {
    expect(block).toMatch(/sessionUserId\s*=\s*\(session as[\s\S]*\.userId/)
    expect(block).toMatch(/sessionLineId\s*=\s*session\.lineId\s*\|\|\s*null/)
  })

  it('combined gate: only fails when BOTH are null', () => {
    expect(block).toMatch(/!sessionUserId\s*&&\s*!sessionLineId/)
  })

  it('resolves User row by userId then lineId fallback', () => {
    expect(block).toMatch(
      /prisma\.user\.findUnique\(\s*\{\s*where:\s*\{\s*id:\s*sessionUserId\s*\}/,
    )
    expect(block).toMatch(
      /prisma\.user\.findUnique\(\s*\{\s*where:\s*\{\s*lineId:\s*sessionLineId\s*\}/,
    )
  })

  it('downstream uses canonical user.id', () => {
    expect(block).toMatch(/const\s+userId\s*=\s*user\.id/)
  })
})

describe('v1.80.11 — completeOnboardingWithId gate accepts userId OR lineId', () => {
  const block = blockOf('completeOnboardingWithId', 7000)

  it('pulls both identifiers from session', () => {
    expect(block).toMatch(/sessionUserId\s*=\s*\(session as[\s\S]*\.userId/)
    expect(block).toMatch(/sessionLineId\s*=\s*session\.lineId\s*\|\|\s*null/)
  })

  it('combined gate: only fails when BOTH are null', () => {
    expect(block).toMatch(/!sessionUserId\s*&&\s*!sessionLineId/)
  })

  it('resolves User row by userId then lineId fallback (selecting email for v1.78.0 fold-in)', () => {
    expect(block).toMatch(
      /prisma\.user\.findUnique\(\s*\{\s*where:\s*\{\s*id:\s*sessionUserId\s*\}[\s\S]*?email:\s*true/,
    )
    expect(block).toMatch(
      /prisma\.user\.findUnique\(\s*\{\s*where:\s*\{\s*lineId:\s*sessionLineId\s*\}[\s\S]*?email:\s*true/,
    )
  })

  it('downstream uses canonical user.id and folds the v1.78.0 email lookup into the resolution', () => {
    expect(block).toMatch(/const\s+userId\s*=\s*user\.id/)
    // shouldWriteEmail should derive from `user.email` (resolved at top)
    // rather than re-querying via `userRow`.
    expect(block).toMatch(/shouldWriteEmail\s*=\s*!user\.email/)
    // Regression target: the old userRow second-query is gone.
    expect(block).not.toMatch(/const\s+userRow\s*=\s*await\s+prisma\.user\.findUnique/)
  })
})

describe('v1.80.11 — skipIdUpload gate accepts userId OR lineId', () => {
  const block = blockOf('skipIdUpload', 3500)

  it('pulls both identifiers from session', () => {
    expect(block).toMatch(/sessionUserId\s*=\s*\(session as[\s\S]*\.userId/)
    expect(block).toMatch(/sessionLineId\s*=\s*session\.lineId\s*\|\|\s*null/)
  })

  it('combined gate: only fails when BOTH are null', () => {
    expect(block).toMatch(/!sessionUserId\s*&&\s*!sessionLineId/)
  })

  it('resolves User row by userId then lineId fallback', () => {
    expect(block).toMatch(
      /prisma\.user\.findUnique\(\s*\{\s*where:\s*\{\s*id:\s*sessionUserId\s*\}/,
    )
    expect(block).toMatch(
      /prisma\.user\.findUnique\(\s*\{\s*where:\s*\{\s*lineId:\s*sessionLineId\s*\}/,
    )
  })

  it('downstream uses canonical user.id', () => {
    expect(block).toMatch(/const\s+userId\s*=\s*user\.id/)
  })
})
