/**
 * v1.82.0 — cross-team scorer/assister support for stats events.
 *
 * Casual leagues let players guest for other teams (especially when a
 * roster runs short on a matchday). Pre-v1.82.0 the goal-submission UIs
 * (`SubmitGoalForm` user-facing + `EventEditor` admin) only let users
 * pick scorers from the beneficiary team's roster. This helper supplies
 * the new "primary team first, everyone else after" grouping.
 *
 * Pure: no I/O, no React. Same helper drives both dropdowns.
 */

export interface OrderingPlayer {
  id: string
  name: string
  teamId: string
}

export interface PlayerGroup<P extends OrderingPlayer> {
  /** Stable key for React rendering. */
  key: string
  /** Human-readable group label — surfaces as `<optgroup label>`. */
  label: string
  players: P[]
}

/**
 * Split a flat list of league players into two `<optgroup>`s:
 *   1. `primaryTeamId`'s roster, sorted by name.
 *   2. "Other players" — everyone else in the league, sorted by name.
 *
 * Empty groups are dropped from the output so a primary team with zero
 * eligible players (or a league with only the primary team's members)
 * doesn't render an empty `<optgroup>`.
 *
 * `excludeIds` is consulted across BOTH groups — used by the assister
 * dropdown to filter out the already-selected scorer regardless of
 * whether they're on the beneficiary team or not.
 */
export function groupPlayersByPrimaryTeam<P extends OrderingPlayer>(
  players: P[],
  primaryTeamId: string,
  primaryLabel: string,
  otherLabel: string = 'Other players',
  excludeIds?: ReadonlySet<string>,
): Array<PlayerGroup<P>> {
  const primary: P[] = []
  const other: P[] = []
  for (const p of players) {
    if (excludeIds && excludeIds.has(p.id)) continue
    if (p.teamId === primaryTeamId) {
      primary.push(p)
    } else {
      other.push(p)
    }
  }
  primary.sort((a, b) => a.name.localeCompare(b.name))
  other.sort((a, b) => a.name.localeCompare(b.name))

  const out: Array<PlayerGroup<P>> = []
  if (primary.length > 0) {
    out.push({ key: `primary:${primaryTeamId}`, label: primaryLabel, players: primary })
  }
  if (other.length > 0) {
    out.push({ key: 'other', label: otherLabel, players: other })
  }
  return out
}
