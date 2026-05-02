/**
 * v1.34.0 (PR ζ of the onboarding chain) — pure invite-validation helper.
 *
 * Used by:
 *   - the `/join/[code]` server component to decide which UI branch to
 *     render (preview / form / error pages),
 *   - the `redeemInvite` server action to re-validate the invite at
 *     write time (the page-render check is best-effort; race-safe
 *     redemption needs the same check inside the transaction).
 *
 * Pure shape over the raw `LeagueInvite` row + a `now` Date. No DB
 * access. Tests mock the row directly. The validator is total: every
 * row → exactly one of seven outcomes.
 *
 *   { kind: 'ok' }                     — valid, redeemable now
 *   { kind: 'unknown' }                — input was null/undefined
 *   { kind: 'expired',  expiredAt }    — past expiresAt
 *   { kind: 'revoked',  revokedAt }    — admin revoked
 *   { kind: 'used-up',  maxUses }      — usedCount >= maxUses
 *   { kind: 'wrong-league', leagueId } — invite is for a different
 *                                         league than the host resolved
 *                                         (cross-league guard; ζ uses
 *                                         this for subdomain mismatch)
 *   { kind: 'not-found' }              — caller passed null (unknown
 *                                         code), distinct from 'unknown'
 *                                         (caller didn't pass any input)
 *
 * Distinguishing 'not-found' from 'unknown' lets callers render
 * different copy: "we don't recognise this code" vs "the URL is missing
 * a code".
 */

export type InviteValidationResult =
  | { kind: 'ok' }
  | { kind: 'not-found' }
  | { kind: 'expired'; expiredAt: Date }
  | { kind: 'revoked'; revokedAt: Date }
  | { kind: 'used-up'; usedCount: number; maxUses: number }
  | { kind: 'wrong-league'; expectedLeagueId: string; inviteLeagueId: string }

export interface ValidatableInvite {
  leagueId: string
  expiresAt: Date | null
  revokedAt: Date | null
  usedCount: number
  maxUses: number | null
}

export function validateInvite(
  invite: ValidatableInvite | null | undefined,
  args: { now: Date; expectedLeagueId?: string },
): InviteValidationResult {
  if (!invite) return { kind: 'not-found' }

  if (args.expectedLeagueId && invite.leagueId !== args.expectedLeagueId) {
    return {
      kind: 'wrong-league',
      expectedLeagueId: args.expectedLeagueId,
      inviteLeagueId: invite.leagueId,
    }
  }

  if (invite.revokedAt) {
    return { kind: 'revoked', revokedAt: invite.revokedAt }
  }

  if (invite.expiresAt && invite.expiresAt.getTime() <= args.now.getTime()) {
    return { kind: 'expired', expiredAt: invite.expiresAt }
  }

  if (invite.maxUses !== null && invite.usedCount >= invite.maxUses) {
    return {
      kind: 'used-up',
      usedCount: invite.usedCount,
      maxUses: invite.maxUses,
    }
  }

  return { kind: 'ok' }
}

/**
 * Convenience for callers that just need to know "should we proceed."
 * Use this for the boolean gate in the redemption transaction; full
 * `validateInvite` for UI rendering where the failure detail matters.
 */
export function isInviteRedeemable(
  invite: ValidatableInvite | null | undefined,
  args: { now: Date; expectedLeagueId?: string },
): boolean {
  return validateInvite(invite, args).kind === 'ok'
}
