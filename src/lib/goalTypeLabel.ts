import type { Goal } from '@/types'

/**
 * Pure helper extracted from the legacy `/matchday/[id]/page.tsx` so it
 * survives the v1.51.0 conversion of that route to a redirect-only stub.
 *
 * Returns the short label for a goalType enum value (or null when no
 * decoration applies). Used by `MatchdayCard` for per-goal decoration
 * and by tests that pin the label-mapping contract.
 *
 * Pre-v1.51.0 this lived as a non-default export on the matchday route
 * file (PR ε / v1.45.0). v1.51.0 (PR 2 of the path-routing chain) makes
 * the route a thin redirect stub; the helper moves here so the export
 * surface doesn't disappear.
 */
export function goalTypeLabel(t: Goal['goalType']): string | null {
  switch (t) {
    case 'OPEN_PLAY':
      return null
    case 'SET_PIECE':
      return 'set piece'
    case 'PENALTY':
      return 'pen'
    case 'OWN_GOAL':
      return 'OG'
    default:
      return null
  }
}
