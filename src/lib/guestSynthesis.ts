import type { Player } from '@/types'

/**
 * v1.91.0 — Add Guests feature.
 *
 * Synthesizes positionless "Guest" pseudo-Player objects per (matchday,
 * team) for downstream rendering. Guests bump the team's "going" count
 * and slot into the formation pitch via the v1.89.1 pass 2.5 (back-most
 * non-GK slots first, with GK strictly excluded). The id prefix below
 * is detected by `isGuestPseudoId` so renderers can apply guest-specific
 * styling and skip the "no position on file" hint for these synthetic
 * entries.
 *
 * Pure module. No I/O, no exports of mutable state — safe to import
 * from server, client, or test code.
 */

export const GUEST_PSEUDO_ID_PREFIX = 'guest-pseudo-'

export function isGuestPseudoId(id: string): boolean {
  return id.startsWith(GUEST_PSEUDO_ID_PREFIX)
}

/**
 * Build N synthetic Player objects for a team. Names are 1-indexed so
 * "Guest #1" is the first one on the list (matches the "+ Add Guests"
 * UX surface).
 *
 * @param teamId  Public team slug (e.g. "mariners-fc"). Stored on the
 *                synthesised Player so the existing pipeline that keys
 *                by `Player.teamId` (e.g. `playerToLt` lookups) stays
 *                consistent.
 * @param count   Total number of guest pseudo-players to synthesise.
 *                Caller passes `externalCount + leagueCount` (the brief
 *                doesn't distinguish them in the pitch/list rendering;
 *                they're aggregated for the count surface).
 */
export function synthesizeGuestPlayers(teamId: string, count: number): Player[] {
  if (count <= 0) return []
  const players: Player[] = []
  for (let i = 0; i < count; i++) {
    players.push({
      id: `${GUEST_PSEUDO_ID_PREFIX}${teamId}-${i + 1}`,
      name: `Guest #${i + 1}`,
      teamId,
      position: null,
      preferredPositions: undefined,
      secondaryPositions: undefined,
      picture: null,
      retiredAt: null,
    })
  }
  return players
}
