/**
 * v1.47.0 — pure helper extracted from `src/app/matchday/[id]/actions.ts`.
 *
 * The v1.46.0 (PR ζ) prod build has been failing since the merge because
 * `parseMatchPublicId` was exported from a `'use server'` module as a
 * non-async function. Next 16's strict server-action contract rejects
 * non-async exports from `'use server'` files. Same shape of bug as
 * v1.33.0 → v1.33.1's `buildInviteCreateData` hotfix.
 *
 * Lives in `src/lib/` (not under `src/app/matchday/[id]/`) so it can be
 * imported from both server actions AND tests AND any future caller without
 * the route-segment co-location implying a server boundary.
 */

export interface ParsedMatchPublicId {
  weekNumber: number
  matchIndex: number
  matchdayPublicId: string
}

/**
 * Parse `md3-m2` → `{ weekNumber: 3, matchIndex: 1, matchdayPublicId: 'md3' }`.
 * Returns null on shape mismatch (e.g. `m1`, `md-m1`, `xxx`).
 */
export function parseMatchPublicId(matchPublicId: string): ParsedMatchPublicId | null {
  const match = matchPublicId.match(/^md(\d+)-m(\d+)$/)
  if (!match) return null
  const weekNumber = parseInt(match[1], 10)
  const matchNumber = parseInt(match[2], 10)
  if (!Number.isFinite(weekNumber) || weekNumber < 1) return null
  if (!Number.isFinite(matchNumber) || matchNumber < 1) return null
  return {
    weekNumber,
    matchIndex: matchNumber - 1,
    matchdayPublicId: `md${weekNumber}`,
  }
}
