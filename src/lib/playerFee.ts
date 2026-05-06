/**
 * v1.66.0 — Player fee resolver.
 *
 * Per outputs/v1.66.0-player-payment-status-spec.md. Three sources of
 * truth, applied in order:
 *
 *   1. `membership.feeOverride` if non-null — admin-set per-membership
 *      override (waiver, partial scholarship, special case). Most
 *      precise; always wins.
 *   2. `LeaguePositionFee[].fee` matching `membership.position` —
 *      per-position fee for this league. The position field is
 *      case-sensitive exact-match against `membership.position`
 *      (which is `PlayerPosition?` enum: 'GK' | 'DF' | 'MF' | 'FW'
 *      | null). Admins typically set 'GK' = 5000 + leave others to
 *      defaultFee, or set richer schemes like 'GK' / 'FP' /
 *      arbitrary-string.
 *   3. `League.defaultFee` — fallback for memberships with no override
 *      and no matching position-fee row.
 *
 * Returns the resolved fee in JPY (Int). Always returns a number;
 * never null/undefined.
 *
 * Pure function — no I/O. Caller passes the membership shape with
 * pre-loaded `league.positionFees` so the resolver can match without
 * additional Prisma round-trips.
 */

export interface ResolveFeeMembership {
  position: 'GK' | 'DF' | 'MF' | 'FW' | null
  feeOverride: number | null
}

export interface ResolveFeeLeague {
  defaultFee: number
  positionFees: ReadonlyArray<{ position: string; fee: number }>
}

export function resolvePlayerFee(
  membership: ResolveFeeMembership,
  league: ResolveFeeLeague,
): number {
  // 1. Membership-level override wins.
  if (membership.feeOverride !== null) {
    return membership.feeOverride
  }

  // 2. League's per-position fee (if any matches the membership's position).
  if (membership.position !== null) {
    const match = league.positionFees.find((p) => p.position === membership.position)
    if (match) return match.fee
  }

  // 3. League default fee. Never null — defaults to 0 at the schema level.
  return league.defaultFee
}

/**
 * v1.66.0 — Format a JPY fee for display. Uses `Intl.NumberFormat` so
 * 5000 → "¥5,000". Renders "¥0" for zero (keeps the prefix consistent;
 * the unpaid-fee banner only renders when fee > 0 anyway).
 */
export function formatJpyFee(fee: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  }).format(fee)
}
