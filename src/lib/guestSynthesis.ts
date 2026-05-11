import type { Player, MatchdayGuestEntry, GuestType } from '@/types'

/**
 * v1.93.0 — Synthesise per-guest pseudo-Player objects from the new
 * `MatchdayGuest` rows. Each guest gets its own pseudo-Player with:
 *   - id `guest-<MatchdayGuest.id>` (the new prefix; replaces the
 *     v1.91.0 `guest-pseudo-<team>-<n>` shape)
 *   - name `"League Guest N"` or `"Ext Guest N"` where N = displayOrder + 1
 *     scoped per-type within the team
 *   - `position` joined string (mirrors the public Player shape)
 *   - `preferredPositions` = the chosen positions, so passes 1–2b of the
 *     6-pass formation algorithm place guests like real players. Guests
 *     with empty positions[] still fall through to pass 2.5 (back-most
 *     non-GK fill), same as v1.91.0.
 *
 * The id prefix `guest-` is detected by `isGuestPseudoId` so renderers
 * can suppress the "fill in your profile" hint and skip avatar fetches.
 *
 * Pure module. No I/O, safe to import from server, client, or test code.
 */

export const GUEST_PSEUDO_ID_PREFIX = 'guest-'

export function isGuestPseudoId(id: string): boolean {
  return id.startsWith(GUEST_PSEUDO_ID_PREFIX)
}

function guestLabel(type: GuestType, displayOrder: number): string {
  const prefix = type === 'EXTERNAL' ? 'Ext Guest' : 'League Guest'
  return `${prefix} ${displayOrder + 1}`
}

/**
 * Build synthetic Player objects for a team's guest rows. Caller passes
 * the per-team slice of `MatchdayGuests[matchdayId][teamId]` (already
 * sorted by type asc, displayOrder asc — `dbToPublicLeagueData`
 * enforces). Each entry yields exactly one pseudo-Player.
 */
export function synthesizeGuestPlayers(
  teamId: string,
  guests: ReadonlyArray<MatchdayGuestEntry>,
): Player[] {
  if (guests.length === 0) return []
  return guests.map((g) => ({
    id: `${GUEST_PSEUDO_ID_PREFIX}${g.id}`,
    name: guestLabel(g.type, g.displayOrder),
    teamId,
    // `position` mirrors the joined-string shape used elsewhere on
    // public Player (`CB/CM`). Empty positions[] becomes `""` —
    // pitch view treats this as positionless and routes through pass 2.5.
    position: g.positions.join('/') || null,
    preferredPositions: g.positions,
    secondaryPositions: [],
    picture: null,
    image: null,
    retiredAt: null,
  }))
}
