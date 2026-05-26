import { unstable_cache } from 'next/cache'
import { prisma } from '../prisma'

/**
 * v1.58.0 (PR 5 of route-shortening chain) — `getAllLeagues` is the
 * single query behind the `/admin` dashboard tile grid. Pre-v1.58.0 it
 * used a flat `include: { matches: true, venue: true }` on every
 * gameWeek, fetching all ~15 fields of every Match row just to read
 * `match.status` (for the COMPLETED-everywhere check) and
 * `matches.length` (for the "X matches scheduled" copy).
 *
 * v1.58.0 trims to a minimal `select` projection — only the fields the
 * dashboard renders (League: id/name/subdomain/endDate; GameWeek:
 * weekNumber/startDate/venue.name; Match: status). Everything else
 * (homeScore/awayScore/playedAt/endedAt/scoreOverride/etc.) drops out.
 * Wire-payload + Prisma serialization both shrink proportionally.
 *
 * Cardinality: typical T9L instance has 1–2 leagues × 8 GWs × 3
 * matches = 24–48 Match rows pre-trim. The trim removes ~14
 * fields-per-row from the serialized payload. Magnitude small but
 * meaningful on cold-Neon-Vercel cold-lambda paths where every JSON
 * byte counts. The 30s `unstable_cache` TTL already absorbs warm-path
 * cost; this fix targets the cold cache miss.
 */
export const getAllLeagues = unstable_cache(
  async () =>
    prisma.league.findMany({
      select: {
        id: true,
        name: true,
        subdomain: true,
        endDate: true,
        gameWeeks: {
          select: {
            weekNumber: true,
            startDate: true,
            venue: { select: { name: true } },
            matches: { select: { status: true } },
          },
          orderBy: { weekNumber: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ['all-leagues'],
  { revalidate: 30, tags: ['leagues'] },
)

export const getLeagueSchedule = unstable_cache(
  async (leagueId: string) =>
    prisma.league.findUnique({
      where: { id: leagueId },
      include: {
        leagueTeams: { include: { team: true } },
        gameWeeks: {
          include: {
            venue: true,
            matches: {
              include: {
                homeTeam: { include: { team: true } },
                awayTeam: { include: { team: true } },
              },
              orderBy: { playedAt: 'asc' },
            },
          },
          orderBy: { weekNumber: 'asc' },
        },
      },
    }),
  ['league-schedule'],
  { revalidate: 30, tags: ['leagues'] },
)

export const getLeagueTeams = unstable_cache(
  async (leagueId: string) =>
    Promise.all([
      prisma.leagueTeam.findMany({
        where: { leagueId },
        include: {
          // v2.2.16 — `team` carries `allowOnboardingJoin`; the
          // TeamsTab toggle reads + writes that column via
          // `setTeamAllowOnboardingJoin`.
          team: true,
          playerAssignments: { include: { player: true } },
          homeMatches: true,
          awayMatches: true,
        },
      }),
      prisma.team.findMany({ orderBy: { name: 'asc' } }),
    ]),
  ['league-teams'],
  { revalidate: 30, tags: ['leagues'] },
)

export const getLeagueSettings = unstable_cache(
  async (leagueId: string) =>
    prisma.league.findUnique({
      where: { id: leagueId },
      // v1.66.0 — include positionFees so the SettingsTab > LeagueFeesEditor
      // can render the per-position rows without a separate fetch.
      include: {
        positionFees: { orderBy: { position: 'asc' } },
      },
    }),
  ['league-settings'],
  { revalidate: 30, tags: ['leagues'] },
)

export async function getLeague() {
  return prisma.league.findFirst({ orderBy: { createdAt: 'asc' } })
}

// `getLeagueBySubdomain` was removed in v1.25.0 — its only caller was the
// now-deleted `LeaguePublicView`. Subdomain rendering now goes through
// `Dashboard` fed by `getPublicLeagueData(leagueId)`, where the leagueId
// comes from `lib/getLeagueFromHost.ts#getLeagueIdFromRequest()`.

/**
 * v1.74.0 — the league picker in `/admin/teams-all`'s create dialog.
 * Returns a flat `{ id, name }` list, sorted by name.
 */
export async function getAllLeaguesForPicker(): Promise<{ id: string; name: string }[]> {
  return prisma.league.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
}
