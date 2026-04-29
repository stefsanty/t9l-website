/**
 * v1.21.1 — Default kickoff times for newly-added matches in the admin
 * schedule editor.
 *
 * T9L is a 4-team round-robin: each matchday has 3 matches with a
 * 33-minute match duration (per CLAUDE.md "Important Notes"). The audit
 * recommended pre-staggering the "Add Match" form's `playedAt` default
 * by match index instead of forcing admins to edit `T00:00` to the
 * actual kickoff time on every add. The standard cadence is 19:05 →
 * 19:40 → 20:15 (35-min step = 33-min match + 2-min break).
 *
 * Pure function so it can be unit-tested without a React render. If the
 * matchday has more than 3 matches (rare; non-standard format), all
 * subsequent matches default to the last stagger time and the operator
 * adjusts manually — better than crashing or wrapping.
 */

const STAGGER_TIMES_JST = ['19:05', '19:40', '20:15'] as const

/**
 * Get the default JST kickoff time (HH:MM) for the Nth match of a
 * matchday, where N is `matchIndex` (0-indexed).
 */
export function defaultMatchKickoffTime(matchIndex: number): string {
  if (matchIndex < 0) return STAGGER_TIMES_JST[0]
  if (matchIndex >= STAGGER_TIMES_JST.length) {
    return STAGGER_TIMES_JST[STAGGER_TIMES_JST.length - 1]
  }
  return STAGGER_TIMES_JST[matchIndex]
}

export const __test = { STAGGER_TIMES_JST }
