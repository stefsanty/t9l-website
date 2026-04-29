import type { Team } from '@/types'

/**
 * v1.11.0 / PR C — pure helper that resolves the logged-in linked
 * user's `Team` from the session shape next-auth produces and the
 * `teams` list `Dashboard` already has in scope.
 *
 * Returns `null` for any of:
 *   - no session (unauthenticated)
 *   - session.playerId is empty / null (auth'd via LINE but not yet linked)
 *   - session.teamId is empty / null (same)
 *   - teamId doesn't match any team in `teams` (data drift; e.g. league
 *     cutover where the user's `teamId` references a team not in the
 *     current league's roster)
 *
 * The component's "render nothing" branches are derived from this — a
 * regression that turned an unauthenticated session into an accidental
 * "Your team is null" badge would manifest as this helper returning a
 * non-null Team for a null teamId, which the tests pin against.
 */
export interface SessionLike {
  playerId?: string | null
  teamId?: string | null
}

export function pickUserTeam(
  session: SessionLike | null | undefined,
  teams: Team[],
): Team | null {
  const playerId = session?.playerId ?? null
  const teamId = session?.teamId ?? null
  if (!playerId || !teamId) return null
  return teams.find((t) => t.id === teamId) ?? null
}
