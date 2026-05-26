import { prisma } from '../prisma'

/**
 * v1.74.0 — feeds the redesigned `/admin/teams-all` route. Returns every
 * Team with the leagues it's enrolled in (via LeagueTeam) and a per-team
 * player-assignment count so the admin UI can show usage + soft-block
 * delete when the team has players. Sorted by primary league name (asc),
 * then team name (asc) so multi-league lists are deterministic.
 */
export interface TeamsAllRow {
  id: string
  name: string
  color: string | null
  logoUrl: string | null
  leagues: { id: string; name: string; leagueTeamId: string }[]
  playerCount: number
  matchCount: number
}

export async function getAllTeamsForAdmin(): Promise<TeamsAllRow[]> {
  const teams = await prisma.team.findMany({
    include: {
      leagueTeams: {
        include: {
          league: { select: { id: true, name: true } },
          _count: {
            select: {
              // v1.87.0 — retired memberships keep their leagueTeam link
              // (so historical match-event scorer→team resolution still
              // works) but don't count toward the team's `playerCount`
              // shown on /admin/teams-all.
              playerAssignments: { where: { retiredAt: null } },
              homeMatches: true,
              awayMatches: true,
            },
          },
        },
      },
    },
  })

  const rows: TeamsAllRow[] = teams.map((t) => {
    const leagues = t.leagueTeams.map((lt) => ({
      id: lt.league.id,
      name: lt.league.name,
      leagueTeamId: lt.id,
    }))
    const playerCount = t.leagueTeams.reduce(
      (sum, lt) => sum + lt._count.playerAssignments,
      0,
    )
    const matchCount = t.leagueTeams.reduce(
      (sum, lt) => sum + lt._count.homeMatches + lt._count.awayMatches,
      0,
    )
    return {
      id: t.id,
      name: t.name,
      color: t.color,
      logoUrl: t.logoUrl,
      leagues,
      playerCount,
      matchCount,
    }
  })

  rows.sort((a, b) => {
    const aLeague = a.leagues[0]?.name ?? '￿'
    const bLeague = b.leagues[0]?.name ?? '￿'
    if (aLeague !== bLeague) return aLeague.localeCompare(bLeague)
    return a.name.localeCompare(b.name)
  })

  return rows
}
