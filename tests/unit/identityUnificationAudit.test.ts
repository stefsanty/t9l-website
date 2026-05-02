/**
 * v1.39.0 (PR λ) — structural assertions for the identity unification
 * audit. Pin the load-bearing call shapes so a future regression that
 * peels redeemInvite away from `linkUserToPlayer` (or splits it back
 * into separate Player.update / User.update calls) gets caught at CI.
 *
 * Companion to `outputs/identity-unification-audit.md`.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const REDEEM_ACTIONS = readFileSync(
  join(ROOT, 'src', 'app', 'join', '[code]', 'actions.ts'),
  'utf-8',
)
const IDENTITY_LINK = readFileSync(
  join(ROOT, 'src', 'lib', 'identityLink.ts'),
  'utf-8',
)
const ASSIGN_PLAYER = readFileSync(
  join(ROOT, 'src', 'app', 'api', 'assign-player', 'route.ts'),
  'utf-8',
)
const AUDIT_DOC = readFileSync(
  join(ROOT, 'outputs', 'identity-unification-audit.md'),
  'utf-8',
)

function strip(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

describe('PR λ — identityLink exports', () => {
  it('exports `linkUserToPlayer` (the new generic helper)', () => {
    expect(IDENTITY_LINK).toMatch(/export\s+async\s+function\s+linkUserToPlayer\b/)
  })

  it('still exports `linkPlayerToUser` (legacy lineId-keyed helper, used by /api/assign-player + admin)', () => {
    expect(IDENTITY_LINK).toMatch(/export\s+async\s+function\s+linkPlayerToUser\b/)
  })

  it('still exports `unlinkPlayerFromUser` (admin-clear path)', () => {
    expect(IDENTITY_LINK).toMatch(/export\s+async\s+function\s+unlinkPlayerFromUser\b/)
  })
})

describe('PR λ — redeemInvite routes BOTH branches through linkUserToPlayer', () => {
  const cleaned = strip(REDEEM_ACTIONS)

  it('imports `linkUserToPlayer` (the new helper)', () => {
    expect(cleaned).toMatch(/import\s*\{\s*linkUserToPlayer\s*\}\s*from\s*['"]@\/lib\/identityLink['"]/)
  })

  it('does NOT import `linkPlayerToUser` (the old lineId-keyed helper) — redeemInvite no longer needs it', () => {
    expect(cleaned).not.toMatch(/import.*\blinkPlayerToUser\b.*from\s*['"]@\/lib\/identityLink['"]/)
  })

  it('the dual-write transaction calls linkUserToPlayer with userId+playerId+optional-lineId', () => {
    // Pre-λ the LINE branch did `tx.player.update({lineId, userId})`
    // followed by `linkPlayerToUser({playerId, lineId})`. Post-λ the
    // single `linkUserToPlayer({userId, playerId, lineId})` call replaces
    // both.
    expect(cleaned).toMatch(/linkUserToPlayer\(tx,\s*\{[\s\S]*?userId,[\s\S]*?playerId:\s*targetPlayerId/)
  })

  it('does NOT contain a standalone tx.player.update({...userId}) outside the helper', () => {
    // The helper handles the Player.update internally now. A regression
    // that re-introduces `tx.player.update({where: {id: targetPlayerId}, data: {userId}})`
    // would split the dual-write logic across two paths again.
    expect(cleaned).not.toMatch(/tx\.player\.update\(\s*\{[\s\S]*?where:\s*\{\s*id:\s*targetPlayerId\s*\}[\s\S]*?data:\s*\{[\s\S]*?userId\b/)
  })

  it('does NOT contain a standalone tx.user.update({...playerId}) outside the helper', () => {
    // Same shape — the helper handles the User.update.
    expect(cleaned).not.toMatch(/tx\.user\.update\(\s*\{[\s\S]*?where:\s*\{\s*id:\s*userId\s*\}[\s\S]*?data:\s*\{[\s\S]*?playerId/)
  })
})

describe('PR λ — /api/assign-player still uses linkPlayerToUser (legacy lineId-keyed helper)', () => {
  // The legacy picker carries lineId from the LINE session, not userId
  // (admin sessions don't reach this route). It correctly continues to
  // use `linkPlayerToUser`. The helper isn't going anywhere until stage
  // Δ drops Player.lineId entirely.
  const cleaned = strip(ASSIGN_PLAYER)

  it('still imports linkPlayerToUser', () => {
    expect(cleaned).toMatch(/linkPlayerToUser/)
  })

  it('still imports unlinkPlayerFromUser for the DELETE handler', () => {
    expect(cleaned).toMatch(/unlinkPlayerFromUser/)
  })
})

describe('PR λ — audit doc exists and lists the affected sites', () => {
  it('outputs/identity-unification-audit.md is checked in', () => {
    expect(AUDIT_DOC.length).toBeGreaterThan(500)
  })

  it('audit doc names every Player.lineId write site', () => {
    expect(AUDIT_DOC).toMatch(/api\/assign-player.*POST/)
    expect(AUDIT_DOC).toMatch(/api\/assign-player.*DELETE/)
    expect(AUDIT_DOC).toMatch(/adminLinkLineToPlayer/)
    expect(AUDIT_DOC).toMatch(/adminClearLineLink/)
    expect(AUDIT_DOC).toMatch(/redeemInvite/)
  })

  it('audit doc documents the deferred work (no @relation FK, no account-linking UI, no stage Δ yet)', () => {
    expect(AUDIT_DOC).toMatch(/@relation/i)
    expect(AUDIT_DOC).toMatch(/account-linking/i)
    expect(AUDIT_DOC).toMatch(/[Ss]tage 4|[Ss]tage Δ/)
  })
})
