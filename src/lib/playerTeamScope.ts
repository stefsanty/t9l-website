/**
 * Resolve the user's team id within the league currently being rendered.
 *
 * Why this exists: `session.teamId` is resolved by the JWT callback against
 * `getDefaultLeagueId()` only (see `src/lib/auth.ts` ~line 885 + comment
 * block at line 846–857), so on `/id/<slug>` pages for non-default leagues
 * it points at the player's *default-league* team — or at `''`/null if the
 * player has no default-league membership. Readers that key per-matchday
 * RSVP data by `[matchdayId][teamId][playerId]` (the public availability
 * shape built in `rsvpMerge.ts`, where `teamId` is the player's team *in
 * the rendered league*) miss when `session.teamId` disagrees with the
 * league-scoped team. The RsvpBar then renders "Are you coming?" even
 * though the player appears in the going-list under the right team.
 *
 * Fix: derive the team from the rendered `players` array (which is
 * league-scoped public data), falling back to `session.teamId` when the
 * player is not in this league's roster.
 *
 * Pure — exported for unit testing.
 */
export function resolveLeagueScopedTeamId(args: {
  players: { id: string; teamId: string }[]
  userPlayerId: string | null
  sessionTeamId: string | null
}): string | null {
  const { players, userPlayerId, sessionTeamId } = args
  if (!userPlayerId) return sessionTeamId ?? null
  const inLeague = players.find((p) => p.id === userPlayerId)
  if (inLeague?.teamId) return inLeague.teamId
  return sessionTeamId ?? null
}
