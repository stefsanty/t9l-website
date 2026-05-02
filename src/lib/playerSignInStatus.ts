/**
 * v1.38.0 (PR κ) — pure helper for the admin player list "Sign-in status"
 * column.
 *
 * Three states:
 *   - `signed_up`  — player has authenticated and bound their User to
 *                    this Player row. `Player.userId IS NOT NULL`. From
 *                    PR ζ onward the User came in via /join/[code]
 *                    redemption; pre-ζ users came in via /assign-player.
 *                    Either way, the binding is done.
 *   - `invited`    — admin has generated a PERSONAL invite for this
 *                    Player and the invite is still valid (not revoked /
 *                    used / expired). The user hasn't redeemed yet.
 *                    `Player.userId IS NULL` AND ≥1 active invite.
 *   - `pending`    — neither linked nor invited. The roster slot exists
 *                    (admin pre-stage or legacy backfilled Sheets row)
 *                    but no human is connected to it.
 *
 * Pure for unit testability. The two inputs are easy to derive from
 * the cached admin-data fetch in `getLeaguePlayers`:
 *   - `userId`             → Player.userId (PR β / v1.29.0 dual-write)
 *   - `activeInviteCount`  → from `activeInviteCountByPlayerId`
 *                            (computed in admin-data.ts)
 *
 * The legacy `Player.lineId` column is NOT consulted here — the v1.5.0
 * inversion made Redis canonical, and post-β every Player.lineId row
 * has a paired Player.userId. Pre-β rows that were linked via the
 * legacy /assign-player picker may carry lineId but no userId; PR ζ's
 * dual-write covers that, and the post-merge backfill (`scripts/
 * backfillUserPlayerLink.ts`) reported 32/32 link-exists on prod —
 * meaning every linked Player has both lineId AND userId set. So
 * keying on userId alone is correct.
 */
export type PlayerSignInStatus = 'signed_up' | 'invited' | 'pending'

export interface PlayerSignInStatusInput {
  userId: string | null
  activeInviteCount: number
}

export function pickSignInStatus(input: PlayerSignInStatusInput): PlayerSignInStatus {
  if (input.userId) return 'signed_up'
  if (input.activeInviteCount > 0) return 'invited'
  return 'pending'
}

export const SIGN_IN_STATUS_LABEL: Record<PlayerSignInStatus, string> = {
  signed_up: 'Signed up',
  invited: 'Invited',
  pending: 'Pending',
}
