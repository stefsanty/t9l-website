/**
 * v1.75.0 — League details surface (data layer).
 *
 * Reads the ten new `League` columns introduced in v1.75.0 and returns
 * a typed shape consumed by the public `LeagueDetailsPanel` component.
 *
 * Auth/visibility:
 *   - Returns `null` when the league row is missing OR when
 *     `showLeagueDetails === false`. The panel never renders without a
 *     non-null value here. The caller (page.tsx) gates additionally on
 *     `preseasonMode === true` to keep the panel scoped to the preseason
 *     homepage.
 *   - Defensive `null` on Prisma rejection — a transient blip should
 *     hide the panel rather than crash the homepage.
 *
 * Why a separate helper:
 *   - Keeps `getPublicLeagueData`'s shape stable (LeagueData covers
 *     teams + players + matches; details belong to the homepage chrome).
 *   - Cached separately under the canonical `'leagues'` tag so admin
 *     writes (which always bust this tag via
 *     `revalidate({ domain: 'admin' })`) propagate on the next render.
 */
import { prisma } from '@/lib/prisma'
import { unstable_cache } from 'next/cache'

export type BallType = 'SOCCER' | 'FUTSAL'
export type GoalSize = 'FUTSAL' | 'YOUTH_SOCCER' | 'FULL_SIZE_SOCCER'
export type ThrowInType = 'THROW_IN' | 'KICK_IN'

export interface LeagueDetails {
  ballType: BallType
  goalSize: GoalSize
  throwInType: ThrowInType
  offsideRule: boolean
  backpassRule: boolean
  matchDurationMinutes: number | null
  playerFormat: number | null
  unlimitedSubstitutions: boolean
  organizerMessage: string | null
}

async function readLeagueDetails(
  leagueId: string,
): Promise<LeagueDetails | null> {
  try {
    const row = await prisma.league.findUnique({
      where: { id: leagueId },
      select: {
        ballType: true,
        goalSize: true,
        throwInType: true,
        offsideRule: true,
        backpassRule: true,
        matchDurationMinutes: true,
        playerFormat: true,
        unlimitedSubstitutions: true,
        organizerMessage: true,
        showLeagueDetails: true,
      },
    })
    if (!row) return null
    if (!row.showLeagueDetails) return null
    return {
      ballType: row.ballType,
      goalSize: row.goalSize,
      throwInType: row.throwInType,
      offsideRule: row.offsideRule,
      backpassRule: row.backpassRule,
      matchDurationMinutes: row.matchDurationMinutes,
      playerFormat: row.playerFormat,
      unlimitedSubstitutions: row.unlimitedSubstitutions,
      organizerMessage: row.organizerMessage,
    }
  } catch (err) {
    console.warn('[leagueDetails] read failed:', err)
    return null
  }
}

export const getLeagueDetails = unstable_cache(
  readLeagueDetails,
  ['league-details'],
  { revalidate: 30, tags: ['leagues'] },
)

export const __readLeagueDetails_for_testing = readLeagueDetails

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

export function formatPlayerFormat(n: number): string {
  return `${n}-a-side`
}
