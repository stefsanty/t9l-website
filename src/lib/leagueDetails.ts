/**
 * v1.75.0 — League details surface (data layer).
 *
 * v1.80.7 (perf phase 4b) — server-only DB read (`readLeagueDetails`,
 * `getLeagueDetails`) moved to `leagueDetailsServer.ts`. This file now
 * contains ONLY pure types + label maps + format helpers so the
 * client-side `LeagueDetailsPanel` (lazy-loaded via `next/dynamic`) can
 * import them without dragging `@prisma/client` and `next/cache` into the
 * public bundle. Server callers that need the cached DB read now
 * `import { getLeagueDetails } from '@/lib/leagueDetailsServer'`.
 *
 * Auth/visibility (server side, see leagueDetailsServer.ts):
 *   - `getLeagueDetails` returns `null` when the league row is missing OR
 *     when `showLeagueDetails === false`. The panel never renders without
 *     a non-null value here. The caller (page.tsx) gates additionally on
 *     `preseasonMode === true` to keep the panel scoped to the preseason
 *     homepage.
 *
 * Why a separate helper:
 *   - Keeps `getPublicLeagueData`'s shape stable (LeagueData covers
 *     teams + players + matches; details belong to the homepage chrome).
 *   - Cached separately under the canonical `'leagues'` tag so admin
 *     writes (which always bust this tag via
 *     `revalidate({ domain: 'admin' })`) propagate on the next render.
 */

export type BallType = 'SOCCER' | 'FUTSAL'
export type GoalSize = 'FUTSAL' | 'YOUTH_SOCCER' | 'FULL_SIZE_SOCCER'
export type ThrowInType = 'THROW_IN' | 'KICK_IN'
export type GoalKickType = 'THROW' | 'KICK'

export interface LeagueDetails {
  ballType: BallType
  goalSize: GoalSize
  throwInType: ThrowInType
  goalKickType: GoalKickType
  offsideRule: boolean
  backpassRule: boolean
  matchDurationMinutes: number | null
  playerFormat: number | null
  unlimitedSubstitutions: boolean
  organizerMessage: string | null
}

/**
 * Human-readable labels for the enum fields. Used by both the public
 * panel and any future admin display surface.
 */
export const BALL_TYPE_LABELS: Record<BallType, string> = {
  SOCCER: 'Soccer',
  FUTSAL: 'Futsal',
}

export const GOAL_SIZE_LABELS: Record<GoalSize, string> = {
  FUTSAL: 'Futsal',
  YOUTH_SOCCER: 'Youth',
  FULL_SIZE_SOCCER: 'Full size',
}

export const THROW_IN_TYPE_LABELS: Record<ThrowInType, string> = {
  THROW_IN: 'Throw-in',
  KICK_IN: 'Kick-in',
}

export const GOAL_KICK_TYPE_LABELS: Record<GoalKickType, string> = {
  THROW: 'Throw',
  KICK: 'Kick',
}

export function formatPlayerFormat(n: number): string {
  return `${n}-a-side`
}
