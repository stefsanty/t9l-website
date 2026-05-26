import { unstable_cache } from 'next/cache'
import { prisma } from '../prisma'

/**
 * v1.43.0 — admin Stats page data fetch (excluding the events-first surface,
 * which `getLeagueEvents` covers).
 *
 * v1.89.0 — `prisma.goal.findMany` dropped: the legacy `Goal` table is being
 * decommissioned, and `StatsTab` already consumes `events` (MatchEvent rows)
 * for the leaderboard/scorer stats. The remaining tuple feeds the league
 * table + matchday filter; `getLeagueEvents` covers events + roster.
 */
export const getLeagueStats = unstable_cache(
  async (leagueId: string) =>
    Promise.all([
      prisma.match.findMany({
        where: { leagueId },
        include: { gameWeek: { select: { weekNumber: true } } },
      }),
      prisma.leagueTeam.findMany({
        where: { leagueId },
        include: { team: true },
      }),
      prisma.gameWeek.findMany({
        where: { leagueId },
        select: { weekNumber: true },
        orderBy: { weekNumber: 'desc' },
        take: 1,
      }),
    ]),
  ['league-stats'],
  { revalidate: 30, tags: ['leagues'] },
)

/**
 * v1.43.0 (PR γ) — admin Events tab data fetch.
 *
 * Returns the data the new events-first StatsTab needs:
 *   - events:      every MatchEvent for the league with scorer + assister names
 *   - matches:     every Match with home/away team labels + gameweek number
 *   - leagueTeams: each team in the league with its current roster
 *                  (for the admin editor's smart pickers — scorer filtered to
 *                  beneficiary team, assister too, etc.)
 *   - gameWeekMax: highest week number, for the matchday filter chips
 *
 * Cached under a separate tag from `getLeagueStats` so the cache-bust path
 * for event writes (`revalidate({ domain: 'admin' })` busts the `leagues` tag)
 * can pick this up.
 */
export const getLeagueEvents = unstable_cache(
  async (leagueId: string) => {
    const [events, matches, leagueTeams, gameWeeks] = await Promise.all([
      prisma.matchEvent.findMany({
        where: { match: { leagueId } },
        include: {
          scorer: { select: { id: true, name: true } },
          assister: { select: { id: true, name: true } },
          match: {
            include: {
              gameWeek: { select: { weekNumber: true } },
              homeTeam: { include: { team: true } },
              awayTeam: { include: { team: true } },
            },
          },
        },
        orderBy: [
          { match: { gameWeek: { weekNumber: 'desc' } } },
          { minute: 'asc' },
          { createdAt: 'asc' },
        ],
        take: 5000,
      }),
      prisma.match.findMany({
        where: { leagueId },
        include: {
          gameWeek: { select: { weekNumber: true } },
          homeTeam: { include: { team: true } },
          awayTeam: { include: { team: true } },
        },
        orderBy: [
          { gameWeek: { weekNumber: 'desc' } },
          { playedAt: 'asc' },
        ],
      }),
      prisma.leagueTeam.findMany({
        where: { leagueId },
        include: {
          team: true,
          playerAssignments: {
            include: { player: { select: { id: true, name: true } } },
          },
        },
      }),
      prisma.gameWeek.findMany({
        where: { leagueId },
        select: { weekNumber: true },
        orderBy: { weekNumber: 'desc' },
        take: 1,
      }),
    ])
    return [events, matches, leagueTeams, gameWeeks[0]?.weekNumber ?? 0] as const
  },
  ['league-events'],
  { revalidate: 30, tags: ['leagues'] },
)
