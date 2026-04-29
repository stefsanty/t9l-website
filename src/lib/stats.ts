import type {
  Team,
  Player,
  Matchday,
  Goal,
  LeagueTableRow,
  TopScorer,
  TopAssister,
  PlayerStats,
  PlayedStatus,
} from "@/types";

export function computeLeagueTable(
  teams: Team[],
  matchdays: Matchday[]
): LeagueTableRow[] {
  const stats = new Map<
    string,
    { w: number; d: number; l: number; gf: number; ga: number; mp: number }
  >();

  for (const team of teams) {
    stats.set(team.id, { w: 0, d: 0, l: 0, gf: 0, ga: 0, mp: 0 });
  }

  for (const md of matchdays) {
    for (const match of md.matches) {
      if (match.homeGoals === null || match.awayGoals === null) continue;

      const home = stats.get(match.homeTeamId);
      const away = stats.get(match.awayTeamId);
      if (!home || !away) continue;

      home.mp++;
      away.mp++;
      home.gf += match.homeGoals;
      home.ga += match.awayGoals;
      away.gf += match.awayGoals;
      away.ga += match.homeGoals;

      if (match.homeGoals > match.awayGoals) {
        home.w++;
        away.l++;
      } else if (match.homeGoals < match.awayGoals) {
        away.w++;
        home.l++;
      } else {
        home.d++;
        away.d++;
      }
    }
  }

  return teams
    .map((team) => {
      const s = stats.get(team.id)!;
      return {
        team,
        played: s.mp,
        won: s.w,
        drawn: s.d,
        lost: s.l,
        goalsFor: s.gf,
        goalsAgainst: s.ga,
        goalDifference: s.gf - s.ga,
        points: s.w * 3 + s.d,
      };
    })
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.goalDifference !== a.goalDifference)
        return b.goalDifference - a.goalDifference;
      return b.goalsFor - a.goalsFor;
    });
}

export function computeTopScorers(
  goals: Goal[],
  players: Player[]
): TopScorer[] {
  const counts = new Map<string, number>();

  for (const goal of goals) {
    if (goal.scorer === "Guest") continue;
    counts.set(goal.scorer, (counts.get(goal.scorer) || 0) + 1);
  }

  const playerByName = new Map(players.map((p) => [p.name, p]));

  return Array.from(counts.entries())
    .map(([name, goalCount]) => {
      const player = playerByName.get(name);
      return {
        playerId: player?.id || name.toLowerCase().replace(/\s+/g, "-"),
        playerName: name,
        teamId: player?.teamId || "",
        goals: goalCount,
      };
    })
    .sort((a, b) => b.goals - a.goals);
}

export function computeTopAssisters(
  goals: Goal[],
  players: Player[]
): TopAssister[] {
  const counts = new Map<string, number>();

  for (const goal of goals) {
    if (!goal.assister || goal.assister === "Guest") continue;
    counts.set(goal.assister, (counts.get(goal.assister) || 0) + 1);
  }

  const playerByName = new Map(players.map((p) => [p.name, p]));

  return Array.from(counts.entries())
    .map(([name, assistCount]) => {
      const player = playerByName.get(name);
      return {
        playerId: player?.id || name.toLowerCase().replace(/\s+/g, "-"),
        playerName: name,
        teamId: player?.teamId || "",
        assists: assistCount,
      };
    })
    .sort((a, b) => b.assists - a.assists);
}

export function computePlayerStats(
  teams: Team[],
  players: Player[],
  goals: Goal[],
  played: PlayedStatus
): PlayerStats[] {
  const statsMap = new Map<string, PlayerStats>();
  const playerByName = new Map<string, string>();
  const teamById = new Map(teams.map((t) => [t.id, t]));

  // Initialize for all players
  for (const player of players) {
    playerByName.set(player.name, player.id);
    const team = teamById.get(player.teamId);
    statsMap.set(player.id, {
      playerId: player.id,
      playerName: player.name,
      teamId: player.teamId,
      teamName: team?.name || "",
      teamShortName: team?.shortName || "",
      teamLogo: team?.logo || null,
      teamColor: team?.color || "#ffffff",
      matchesPlayed: 0,
      goals: 0,
      assists: 0,
      gaPerGame: 0,
    });
  }

  // Calculate matches played (each gameweek played = 2 matches)
  for (const teams of Object.values(played)) {
    for (const playerIds of Object.values(teams)) {
      for (const playerId of playerIds) {
        if (statsMap.has(playerId)) {
          statsMap.get(playerId)!.matchesPlayed += 2;
        }
      }
    }
  }

  // Count goals and assists
  for (const goal of goals) {
    if (goal.scorer !== "Guest") {
      const playerId = playerByName.get(goal.scorer);
      if (playerId && statsMap.has(playerId)) {
        statsMap.get(playerId)!.goals++;
      }
    }
    if (goal.assister && goal.assister !== "Guest") {
      const playerId = playerByName.get(goal.assister);
      if (playerId && statsMap.has(playerId)) {
        statsMap.get(playerId)!.assists++;
      }
    }
  }

  // Calculate G/A per game
  for (const stats of statsMap.values()) {
    if (stats.matchesPlayed > 0) {
      stats.gaPerGame = Math.round(((stats.goals + stats.assists) / stats.matchesPlayed) * 100) / 100;
    }
  }

  return Array.from(statsMap.values()).sort((a, b) => {
    if (b.goals !== a.goals) return b.goals - a.goals;
    return b.assists - a.assists;
  });
}

export function findNextMatchday(matchdays: Matchday[]): {
  matchday: Matchday;
  isNext: boolean;
} | null {
  if (matchdays.length === 0) return null;

  const next = matchdays.find((md) =>
    md.matches.some((m) => m.homeGoals === null)
  );

  if (next) return { matchday: next, isNext: true };

  // All played — return the last one
  return { matchday: matchdays[matchdays.length - 1], isNext: false };
}
