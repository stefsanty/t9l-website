/**
 * v1.38.0 (PR κ) — pure helper unit tests for the new "Sign-in status"
 * column on the admin player list.
 */
import { describe, it, expect } from 'vitest'
import { pickSignInStatus, SIGN_IN_STATUS_LABEL } from '@/lib/playerSignInStatus'

describe('pickSignInStatus', () => {
  it('returns "signed_up" when the player has a bound User', () => {
    expect(pickSignInStatus({ userId: 'u-stefan', activeInviteCount: 0 })).toBe('signed_up')
    // userId presence wins even when there are pending invites — the
    // invite generated separately doesn't downgrade an active user.
    expect(pickSignInStatus({ userId: 'u-stefan', activeInviteCount: 3 })).toBe('signed_up')
  })

  it('returns "invited" when no User but ≥1 active invite', () => {
    expect(pickSignInStatus({ userId: null, activeInviteCount: 1 })).toBe('invited')
    expect(pickSignInStatus({ userId: null, activeInviteCount: 5 })).toBe('invited')
  })

  it('returns "pending" when no User and no active invite', () => {
    expect(pickSignInStatus({ userId: null, activeInviteCount: 0 })).toBe('pending')
  })

  it('treats userId="" the same as null (defensive)', () => {
    // Empty string is falsy so the helper falls into the invite/pending
    // branches. This is documented behavior — callers should pass `null`
    // for unset, but if they pass empty string they get the right result.
    expect(pickSignInStatus({ userId: '', activeInviteCount: 0 })).toBe('pending')
    expect(pickSignInStatus({ userId: '', activeInviteCount: 1 })).toBe('invited')
  })

  it('treats negative activeInviteCount as no invites (defensive)', () => {
    // Shouldn't happen but a corrupt cache entry shouldn't crash. The
    // helper uses `> 0` so -1 falls into pending.
    expect(pickSignInStatus({ userId: null, activeInviteCount: -1 })).toBe('pending')
  })
})

describe('SIGN_IN_STATUS_LABEL', () => {
  it('exposes a human-readable label for each status', () => {
    expect(SIGN_IN_STATUS_LABEL.signed_up).toBe('Signed up')
    expect(SIGN_IN_STATUS_LABEL.invited).toBe('Invited')
    expect(SIGN_IN_STATUS_LABEL.pending).toBe('Pending')
  })
})
