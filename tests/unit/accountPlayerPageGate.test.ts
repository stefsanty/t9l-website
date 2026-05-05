/**
 * v1.59.1 — pin the page-level gate behavior on /account/player.
 *
 * Pre-v1.59.1 the page rejected any session without `userId` as an
 * "Admin sessions can't edit here" message. This bucketed legitimate
 * pre-v1.28.0 LINE users (and LINE-auth admins like Stefan S, whose
 * role is orthogonal to player binding) with admin-credentials sessions
 * and blocked them from editing their own player.
 *
 * v1.59.1 fix: the gate is "can we resolve a linked Player from
 * `session.userId` (canonical) or `session.lineId` (legacy fallback)."
 * Admin-credentials sessions (no userId AND no lineId) still hit the
 * friendly admin-shell pointer; everyone else either resolves a Player
 * or hits the friendly "no player linked yet" message.
 *
 * Structural assertions on the page source — these regression-target
 * the failure modes that produced the v1.59.0 bug:
 *   1. The page MUST NOT early-return on `if (!userId)` alone.
 *   2. The page MUST attempt a `lineId` fallback when the userId
 *      lookup is absent or returns null.
 *   3. The "Admin sessions can't edit" message MUST only fire when
 *      both userId AND lineId are absent.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const PAGE_PATH = join(ROOT, 'src/app/account/player/page.tsx')
const ACTIONS_PATH = join(ROOT, 'src/app/account/player/actions.ts')

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
}

describe('v1.59.1 — /account/player page gate', () => {
  it('does NOT gate solely on `!userId`', () => {
    const src = stripComments(readFileSync(PAGE_PATH, 'utf-8'))
    // Pre-v1.59.1 had `if (!userId) { return <Shell>...Admin...` — the
    // standalone single-condition check that wrongly bucketed LINE-only
    // sessions with admin-credentials. The new gate requires BOTH
    // userId AND lineId to be absent.
    expect(src).not.toMatch(/if\s*\(\s*!userId\s*\)\s*\{[^}]*?return\s+\(/)
  })

  it('reads `lineId` from the session for the fallback path', () => {
    const src = stripComments(readFileSync(PAGE_PATH, 'utf-8'))
    expect(src).toMatch(/session\.lineId/)
  })

  it('reaches Player.findUnique with `where: { lineId }` as a fallback path', () => {
    const src = stripComments(readFileSync(PAGE_PATH, 'utf-8'))
    expect(src).toMatch(/where:\s*\{\s*lineId\s*\}/)
  })

  it('still gates admin-credentials with combined `!userId && !lineId`', () => {
    const src = stripComments(readFileSync(PAGE_PATH, 'utf-8'))
    expect(src).toMatch(/!userId\s*&&\s*!lineId/)
  })

  it('preserves the `where: { userId }` lookup as the canonical first attempt', () => {
    const src = stripComments(readFileSync(PAGE_PATH, 'utf-8'))
    expect(src).toMatch(/where:\s*\{\s*userId\s*\}/)
  })

  it("removes the 'Admin sessions can't edit here' single-condition gate copy", () => {
    const src = readFileSync(PAGE_PATH, 'utf-8')
    // The new copy uses "Admin-only sessions can't edit here" (longer,
    // distinct, only fires for true admin-credentials with no auth-
    // provider link). The pre-v1.59.1 phrase fires per-render for any
    // session-without-userId — that's the regression target.
    expect(src).not.toMatch(/Admin sessions can't edit here/)
    // The new admin-only branch copy contains "Admin-only" prefix.
    expect(src).toMatch(/Admin-only sessions can't edit here/)
  })
})

describe('v1.59.1 — /account/player actions gate', () => {
  it('actions.ts requires `userId || lineId` (not just userId)', () => {
    const src = stripComments(readFileSync(ACTIONS_PATH, 'utf-8'))
    // The new gate uses `!userId && !lineId` to throw, allowing any
    // session that has at least ONE of the two identifiers.
    expect(src).toMatch(/!userId\s*&&\s*!lineId/)
  })

  it('actions.ts no longer requires session.playerId presence as a gate', () => {
    const src = stripComments(readFileSync(ACTIONS_PATH, 'utf-8'))
    // Pre-v1.59.1 had `if (!playerId) { throw new Error('Redeem...') }`.
    // The gate is now in `resolveOwnedPlayerId` via Player lookup, not
    // session.playerId presence. session.playerId can be stale post-
    // admin-remap; userId/lineId are canonical.
    expect(src).not.toMatch(/if\s*\(\s*!playerId\s*\)\s*\{\s*throw/)
  })

  it("actions.ts has lineId fallback path in resolveOwnedPlayerId", () => {
    const src = stripComments(readFileSync(ACTIONS_PATH, 'utf-8'))
    // The fallback chain: try userId first (post-α.5 canonical), then
    // lineId (legacy pre-v1.28.0 grandfathered sessions).
    expect(src).toMatch(/where:\s*\{\s*lineId:\s*session\.lineId\s*\}/)
    expect(src).toMatch(/where:\s*\{\s*userId:\s*session\.userId\s*\}/)
  })
})
