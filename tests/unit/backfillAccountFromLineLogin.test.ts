import { describe, it, expect } from 'vitest'
import {
  decideBackfillAction,
  type BackfillInputs,
} from '../../scripts/backfillAccountFromLineLogin'

/**
 * v1.28.0 — pre-α.5 Account backfill decision helper.
 *
 * Pin every branch of `decideBackfillAction`. The script's load-bearing
 * job is "prevent the adapter from creating duplicate User rows on first
 * post-α.5 LINE login"; if any of these branches is wrong, the duplicate
 * scenario sneaks through and stage β breaks.
 *
 * Pure function tests — no Prisma, no Redis. The integration shape (full
 * planActions / applyActions cycle) lives in a one-shot prod dry-run, not
 * here.
 */

function inputs(partial: Partial<BackfillInputs> = {}): BackfillInputs {
  return {
    lineId: 'U_test_line_id',
    existingUser: null,
    existingAccount: null,
    playerWithLineId: null,
    lineLogin: null,
    ...partial,
  }
}

describe('decideBackfillAction', () => {
  describe('account-exists branch', () => {
    it('returns account-exists when an Account row already matches', () => {
      const result = decideBackfillAction(
        inputs({
          existingAccount: { id: 'acc1', userId: 'user1' },
          existingUser: { id: 'user1', lineId: 'U_test_line_id' },
        }),
      )
      expect(result.kind).toBe('account-exists')
      if (result.kind === 'account-exists') {
        expect(result.userId).toBe('user1')
      }
    })

    it('returns account-exists even when the matching User has no lineId column set', () => {
      // Edge case: a User with playerId but no lineId column, where an
      // Account exists pointing at them. Possible if admin manually
      // inserted both. Skip is correct — the Account already exists.
      const result = decideBackfillAction(
        inputs({
          existingAccount: { id: 'acc1', userId: 'user1' },
          existingUser: null,
        }),
      )
      expect(result.kind).toBe('account-exists')
    })
  })

  describe('create-account branch', () => {
    it('creates Account when User exists with this lineId but no Account', () => {
      const result = decideBackfillAction(
        inputs({
          existingUser: { id: 'user1', lineId: 'U_test_line_id' },
          existingAccount: null,
        }),
      )
      expect(result.kind).toBe('create-account')
      if (result.kind === 'create-account') {
        expect(result.userId).toBe('user1')
      }
    })

    it('prefers User over Player when both reference the same lineId', () => {
      // If a User row already exists with this lineId, we should NOT create
      // a new User — we should bind the Account to the existing User.
      const result = decideBackfillAction(
        inputs({
          existingUser: { id: 'user1', lineId: 'U_test_line_id' },
          playerWithLineId: { id: 'player1', name: 'Stefan S' },
        }),
      )
      expect(result.kind).toBe('create-account')
      if (result.kind === 'create-account') {
        expect(result.userId).toBe('user1')
      }
    })
  })

  describe('create-user-and-account branch', () => {
    it('creates both User + Account when only Player.lineId is populated', () => {
      const result = decideBackfillAction(
        inputs({
          playerWithLineId: { id: 'player1', name: 'Stefan S' },
          lineLogin: { name: 'Stefan Santoso', pictureUrl: 'https://line.cdn/abc' },
        }),
      )
      expect(result.kind).toBe('create-user-and-account')
      if (result.kind === 'create-user-and-account') {
        expect(result.userPayload.lineId).toBe('U_test_line_id')
        // Prefers LineLogin's name over Player's (it's the LINE-displayed
        // name; Player.name is the league-display name).
        expect(result.userPayload.name).toBe('Stefan Santoso')
        expect(result.userPayload.pictureUrl).toBe('https://line.cdn/abc')
      }
    })

    it('falls back to Player.name when LineLogin is missing', () => {
      const result = decideBackfillAction(
        inputs({
          playerWithLineId: { id: 'player1', name: 'Stefan S' },
          lineLogin: null,
        }),
      )
      expect(result.kind).toBe('create-user-and-account')
      if (result.kind === 'create-user-and-account') {
        expect(result.userPayload.name).toBe('Stefan S')
        expect(result.userPayload.pictureUrl).toBeNull()
      }
    })

    it('falls back to null pictureUrl when LineLogin lacks one', () => {
      const result = decideBackfillAction(
        inputs({
          playerWithLineId: { id: 'player1', name: 'Stefan S' },
          lineLogin: { name: 'Stefan Santoso', pictureUrl: null },
        }),
      )
      expect(result.kind).toBe('create-user-and-account')
      if (result.kind === 'create-user-and-account') {
        expect(result.userPayload.pictureUrl).toBeNull()
      }
    })
  })

  describe('skip-orphan-line-login branch', () => {
    it('skips when only a LineLogin exists (no User, no Player, no Account)', () => {
      const result = decideBackfillAction(
        inputs({
          lineLogin: { name: 'Random Lurker', pictureUrl: null },
        }),
      )
      expect(result.kind).toBe('skip-orphan-line-login')
    })

    it('returns skip with a human-readable reason', () => {
      const result = decideBackfillAction(inputs())
      expect(result.kind).toBe('skip-orphan-line-login')
      if (result.kind === 'skip-orphan-line-login') {
        expect(result.reason).toMatch(/orphan|adapter.*sign.in/i)
      }
    })

    it('skips when none of the three sources have anything for this lineId', () => {
      // This is a degenerate case (the planner shouldn't even produce this
      // lineId) but the helper must handle it without throwing.
      const result = decideBackfillAction(inputs())
      expect(result.kind).toBe('skip-orphan-line-login')
    })
  })

  describe('idempotency (re-run scenarios)', () => {
    it('post-first-run: a previously create-account row now resolves to account-exists', () => {
      // Simulate the state after first --apply run completes for a row
      // that started as create-account.
      const before = decideBackfillAction(
        inputs({
          existingUser: { id: 'user1', lineId: 'U_test_line_id' },
          existingAccount: null,
        }),
      )
      expect(before.kind).toBe('create-account')

      // Second run sees the now-populated Account.
      const after = decideBackfillAction(
        inputs({
          existingUser: { id: 'user1', lineId: 'U_test_line_id' },
          existingAccount: { id: 'acc1', userId: 'user1' },
        }),
      )
      expect(after.kind).toBe('account-exists')
    })

    it('post-first-run: a previously create-user-and-account row now resolves to account-exists', () => {
      const before = decideBackfillAction(
        inputs({
          playerWithLineId: { id: 'player1', name: 'Stefan S' },
          lineLogin: { name: 'Stefan Santoso', pictureUrl: 'https://line.cdn/abc' },
        }),
      )
      expect(before.kind).toBe('create-user-and-account')

      const after = decideBackfillAction(
        inputs({
          existingUser: { id: 'user1', lineId: 'U_test_line_id' },
          existingAccount: { id: 'acc1', userId: 'user1' },
          playerWithLineId: { id: 'player1', name: 'Stefan S' },
          lineLogin: { name: 'Stefan Santoso', pictureUrl: 'https://line.cdn/abc' },
        }),
      )
      expect(after.kind).toBe('account-exists')
    })
  })
})
