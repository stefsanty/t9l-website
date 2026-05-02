/**
 * v1.34.0 (PR ζ) — pure invite-validation helper covering all 7 outcomes:
 *   ok / not-found / expired / revoked / used-up / wrong-league
 *
 * Pure function suite. No mocks needed — the validator takes a row + Date
 * and returns a discriminated union. Tests pin behavior at every branch
 * + every boundary (exact-equal expiresAt, exact-equal usedCount==maxUses).
 */
import { describe, it, expect } from 'vitest'
import {
  validateInvite,
  isInviteRedeemable,
  type ValidatableInvite,
} from '@/lib/joinValidation'

const NOW = new Date('2026-05-03T12:00:00Z')

function make(overrides: Partial<ValidatableInvite> = {}): ValidatableInvite {
  return {
    leagueId: 'l-default',
    expiresAt: new Date('2026-05-10T12:00:00Z'),
    revokedAt: null,
    usedCount: 0,
    maxUses: 1,
    ...overrides,
  }
}

describe('v1.34.0 (PR ζ) — validateInvite — happy path', () => {
  it('returns ok for a fresh, in-the-window, non-revoked, under-uses invite', () => {
    expect(validateInvite(make(), { now: NOW })).toEqual({ kind: 'ok' })
  })

  it('expiresAt: null (admin opt-out) is always valid', () => {
    expect(validateInvite(make({ expiresAt: null }), { now: NOW })).toEqual({ kind: 'ok' })
  })

  it('maxUses: null (unlimited) is always under-uses regardless of usedCount', () => {
    expect(
      validateInvite(make({ maxUses: null, usedCount: 9999 }), { now: NOW }),
    ).toEqual({ kind: 'ok' })
  })
})

describe('v1.34.0 (PR ζ) — validateInvite — error branches', () => {
  it('null/undefined invite → not-found', () => {
    expect(validateInvite(null, { now: NOW })).toEqual({ kind: 'not-found' })
    expect(validateInvite(undefined, { now: NOW })).toEqual({ kind: 'not-found' })
  })

  it('expiresAt in the past → expired with the date', () => {
    const expiredAt = new Date('2026-04-01T12:00:00Z')
    expect(validateInvite(make({ expiresAt: expiredAt }), { now: NOW })).toEqual({
      kind: 'expired',
      expiredAt,
    })
  })

  it('expiresAt EXACTLY equal to now → expired (boundary: <= rather than <)', () => {
    expect(
      validateInvite(make({ expiresAt: NOW }), { now: NOW }),
    ).toMatchObject({ kind: 'expired' })
  })

  it('revokedAt set → revoked with the date (regardless of expiry / uses)', () => {
    const revokedAt = new Date('2026-05-01T08:00:00Z')
    expect(
      validateInvite(make({ revokedAt, expiresAt: null, usedCount: 0 }), { now: NOW }),
    ).toEqual({ kind: 'revoked', revokedAt })
  })

  it('revoked takes precedence over expired (admin intent overrides expiry)', () => {
    const revokedAt = new Date('2026-05-01T08:00:00Z')
    expect(
      validateInvite(
        make({ revokedAt, expiresAt: new Date('2026-04-01T12:00:00Z') }),
        { now: NOW },
      ).kind,
    ).toBe('revoked')
  })

  it('usedCount === maxUses → used-up (exclusive boundary; the Nth use is the last)', () => {
    expect(
      validateInvite(make({ usedCount: 1, maxUses: 1 }), { now: NOW }),
    ).toEqual({ kind: 'used-up', usedCount: 1, maxUses: 1 })
  })

  it('usedCount > maxUses → used-up (defensive — admin tinkered)', () => {
    expect(
      validateInvite(make({ usedCount: 5, maxUses: 1 }), { now: NOW }).kind,
    ).toBe('used-up')
  })

  it('expectedLeagueId mismatch → wrong-league with both ids', () => {
    expect(
      validateInvite(make({ leagueId: 'l-other' }), {
        now: NOW,
        expectedLeagueId: 'l-default',
      }),
    ).toEqual({
      kind: 'wrong-league',
      expectedLeagueId: 'l-default',
      inviteLeagueId: 'l-other',
    })
  })

  it('wrong-league check skipped when expectedLeagueId is omitted', () => {
    expect(
      validateInvite(make({ leagueId: 'l-other' }), { now: NOW }),
    ).toEqual({ kind: 'ok' })
  })
})

describe('v1.34.0 (PR ζ) — branch precedence', () => {
  // Order documented in the helper: not-found > wrong-league > revoked > expired > used-up > ok.
  it('wrong-league wins over revoked + expired + used-up', () => {
    const result = validateInvite(
      make({
        leagueId: 'l-other',
        revokedAt: new Date('2026-04-01T00:00:00Z'),
        expiresAt: new Date('2026-04-01T00:00:00Z'),
        usedCount: 1,
        maxUses: 1,
      }),
      { now: NOW, expectedLeagueId: 'l-default' },
    )
    expect(result.kind).toBe('wrong-league')
  })

  it('revoked wins over expired + used-up', () => {
    expect(
      validateInvite(
        make({
          revokedAt: new Date('2026-04-01T00:00:00Z'),
          expiresAt: new Date('2026-04-01T00:00:00Z'),
          usedCount: 1,
          maxUses: 1,
        }),
        { now: NOW },
      ).kind,
    ).toBe('revoked')
  })

  it('expired wins over used-up', () => {
    expect(
      validateInvite(
        make({
          expiresAt: new Date('2026-04-01T00:00:00Z'),
          usedCount: 1,
          maxUses: 1,
        }),
        { now: NOW },
      ).kind,
    ).toBe('expired')
  })
})

describe('v1.34.0 (PR ζ) — isInviteRedeemable boolean shorthand', () => {
  it('true when validator returns ok', () => {
    expect(isInviteRedeemable(make(), { now: NOW })).toBe(true)
  })

  it('false on every error branch', () => {
    expect(isInviteRedeemable(null, { now: NOW })).toBe(false)
    expect(isInviteRedeemable(make({ revokedAt: NOW }), { now: NOW })).toBe(false)
    expect(
      isInviteRedeemable(make({ expiresAt: new Date('2026-04-01T12:00:00Z') }), { now: NOW }),
    ).toBe(false)
    expect(
      isInviteRedeemable(make({ usedCount: 1, maxUses: 1 }), { now: NOW }),
    ).toBe(false)
  })
})
