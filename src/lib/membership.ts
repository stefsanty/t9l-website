/**
 * v1.87.0 — unified per-league membership status.
 *
 * The data model carries two columns that together describe a player's
 * standing in a league:
 *
 *   - `PlayerLeagueMembership.applicationStatus`
 *       PENDING  — self-service application not yet reviewed by admin.
 *       APPROVED — real roster member (default; backfilled for every
 *                  pre-v1.64.0 PLM row).
 *       (No REJECTED — `adminRejectApplication` DELETEs the PLM, and
 *        when no other APPROVED PLM exists for the Player, it cascades
 *        to deleting the Player row too. Rejection is non-stored.)
 *
 *   - `PlayerLeagueMembership.retiredAt` (v1.87.0)
 *       null     — active member.
 *       Date     — admin retired this player from this league at the
 *                  recorded timestamp. Stays on the team, keeps stats,
 *                  excluded from roster-size + upcoming pickers.
 *
 * The unified user-facing status is the cross product:
 *   PENDING                            → 'PENDING'
 *   APPROVED + retiredAt = null        → 'ACTIVE'
 *   APPROVED + retiredAt ≠ null        → 'RETIRED'
 *
 * This helper is the single source of truth for status badges, sort
 * keys, and visibility gates. Components must NOT recompute the
 * status from individual fields.
 *
 * The retire flow is gated on ACTIVE → RETIRED only. PENDING players
 * cannot be retired directly (the kebab "Retire from league" item
 * surfaces only for `applicationStatus === 'APPROVED'` rows with a
 * current Assignment). Admins must first approve a pending applicant,
 * then optionally retire them.
 */

export type MembershipStatusValue = 'PENDING' | 'ACTIVE' | 'RETIRED'

export interface MembershipStatusInput {
  applicationStatus: 'PENDING' | 'APPROVED' | string
  /**
   * Accepts the wire-format Date OR ISO string OR null. Public payloads
   * round-trip through JSON (Date → string), and admin-side reads from
   * `unstable_cache` see the same shape, so the helper accepts both
   * without forcing each call site to coerce.
   */
  retiredAt: Date | string | null | undefined
}

export function getMembershipStatus(input: MembershipStatusInput): MembershipStatusValue {
  if (input.applicationStatus === 'PENDING') return 'PENDING'
  if (input.retiredAt) return 'RETIRED'
  return 'ACTIVE'
}

/**
 * Convenience predicates for the common visibility / filter call sites.
 * Use these instead of re-deriving the status when only one bit is
 * needed — they short-circuit and read more clearly than
 * `getMembershipStatus(...) === 'X'`.
 */
export function isRetired(input: MembershipStatusInput): boolean {
  return input.applicationStatus !== 'PENDING' && Boolean(input.retiredAt)
}

export function isActive(input: MembershipStatusInput): boolean {
  return input.applicationStatus === 'APPROVED' && !input.retiredAt
}
