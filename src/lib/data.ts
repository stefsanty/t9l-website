import type {
  Team,
  Player,
  Matchday,
  Goal,
  PlayerRating,
  Availability,
  PlayedStatus,
  LeagueData,
} from "@/types";
import type { RawSheetData } from "./sheets";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function normalizeTeamName(raw: string): string {
  const mapping: Record<string, string> = {
    "Blue Mariners FC": "Mariners FC",
    "Yellow Fenix FC": "Fenix FC",
  };
  return mapping[raw] || raw;
}

const TEAM_COLORS: Record<string, string> = {
  "mariners-fc": "#0055A4",
  "fenix-fc": "#FFD700",
  "hygge-sc": "#DC143C",
  "fc-torpedo": "#ccc",
};

const TEAM_SHORT_NAMES: Record<string, string> = {
  "mariners-fc": "MFC",
  "fenix-fc": "FFC",
  "hygge-sc": "HSC",
  "fc-torpedo": "TOR",
};

const TEAM_LOGOS: Record<string, string> = {
  "mariners-fc": "/team_logos/Mariners FC.png",
  "fenix-fc": "/team_logos/Fenix FC.png",
  "hygge-sc": "/team_logos/Hygge SC.png",
  "fc-torpedo": "/team_logos/FC Torpedo.png",
};

export function parseTeams(rows: string[][]): Team[] {
  // Skip header row
  return rows.slice(1).filter(row => row[0]).map((row) => {
    const name = row[0].trim();
    const id = slugify(name);
    return {
      id,
      name,
      shortName: TEAM_SHORT_NAMES[id] || id.substring(0, 3).toUpperCase(),
      color: TEAM_COLORS[id] || "#888888",
      logo: TEAM_LOGOS[id] || row[1]?.trim() || null,
    };
  });
}

export function parsePlayers(
  rows: string[][],
  teams: Team[]
): { players: Player[]; availability: Availability; played: PlayedStatus } {
  const players: Player[] = [];
  const availability: Availability = {};
  const played: PlayedStatus = {};
  const teamNameToId = new Map(teams.map((t) => [t.name, t.id]));

  // Header row: Picture, Player Name, Team, Pref. Pos., MD1, MD2, ..., MD8
  const header = rows[0] || [];
  // Find MD column indices (columns 4-11 for MD1-MD8)
  const mdColumns: { mdId: string; colIndex: number }[] = [];
  for (let i = 4; i < header.length; i++) {
    const mdMatch = header[i]?.match(/MD(\d+)/i);
    if (mdMatch) {
      mdColumns.push({ mdId: `md${mdMatch[1]}`, colIndex: i });
    }
  }

  for (const row of rows.slice(1)) {
    const name = row[1]?.trim();
    if (!name) continue;

    const teamName = row[2]?.trim() || "";
    const teamId = teamNameToId.get(teamName) || slugify(teamName);
    const position = row[3]?.trim() || null;
    const playerId = slugify(name);

    players.push({
      id: playerId,
      name,
      teamId,
      position,
      picture: row[0]?.trim() || null,
    });

    // Parse availability and played status
    for (const { mdId, colIndex } of mdColumns) {
      const status = row[colIndex]?.trim().toUpperCase();
      if (status === "Y" || status === "EXPECTED" || status === "PLAYED") {
        if (!availability[mdId]) availability[mdId] = {};
        if (!availability[mdId][teamId]) availability[mdId][teamId] = [];
        availability[mdId][teamId].push(playerId);
      }

      if (status === "PLAYED") {
        if (!played[mdId]) played[mdId] = {};
        if (!played[mdId][teamId]) played[mdId][teamId] = [];
        played[mdId][teamId].push(playerId);
      }
    }
  }

  return { players, availability, played };
}

export function parseSchedule(
  rows: string[][],
  formulaRows: string[][],
  mdScheduleRows: string[][],
  teams: Team[]
): Matchday[] {
  const teamNameToId = new Map(teams.map((t) => [t.name, t.id]));
  const matchdays = new Map<string, Matchday>();

  // Parse MDScheduleRaw for dates
  const dates = new Map<string, string>();
  for (const row of mdScheduleRows.slice(1)) {
    const mdLabel = row[0]?.trim();
    const date = row[1]?.trim();
    if (mdLabel && date) {
      const mdId = mdLabel.toLowerCase().replace(/\s/g, "");
      dates.set(mdId, date);
    }
  }

  // Parse schedule formula to find sitting-out team per matchday
  const sittingOut = new Map<string, string>();
  for (const row of formulaRows.slice(1)) {
    const mdLabel = row[0]?.trim();
    // Column layout: Matchday, First, Middle, Last, Sits Out
    const sitsOutTeam = row[4]?.trim();
    if (mdLabel && sitsOutTeam) {
      const mdId = mdLabel.toLowerCase().replace(/\s/g, "");
      sittingOut.set(mdId, teamNameToId.get(sitsOutTeam) || slugify(sitsOutTeam));
    }
  }

  for (const row of rows.slice(1)) {
    const mdLabel = row[0]?.trim();
    if (!mdLabel) continue;

    const mdId = mdLabel.toLowerCase().replace(/\s/g, "");
    if (!matchdays.has(mdId)) {
      matchdays.set(mdId, {
        id: mdId,
        label: mdLabel.toUpperCase(),
        date: dates.get(mdId) || null,
        matches: [],
        sittingOutTeamId: sittingOut.get(mdId) || "",
      });
    }

    const md = matchdays.get(mdId)!;
    const matchNum = parseInt(row[1]?.trim() || "0", 10);
    const homeTeam = row[4]?.trim() || "";
    const awayTeam = row[5]?.trim() || "";

    md.matches.push({
      id: `${mdId}-m${matchNum}`,
      matchNumber: matchNum,
      kickoff: row[2]?.trim() || "",
      fullTime: row[3]?.trim() || "",
      homeTeamId: teamNameToId.get(homeTeam) || slugify(homeTeam),
      awayTeamId: teamNameToId.get(awayTeam) || slugify(awayTeam),
      homeGoals: null,
      awayGoals: null,
    });
  }

  return Array.from(matchdays.values()).sort((a, b) => {
    const aNum = parseInt(a.id.replace("md", ""), 10);
    const bNum = parseInt(b.id.replace("md", ""), 10);
    return aNum - bNum;
  });
}

function resolveMatchdayId(
  mdRaw: string,
  timestampRaw: string,
  matchdays: Matchday[]
): string {
  if (mdRaw && !mdRaw.includes("#REF!") && mdRaw.match(/MD\d+/i)) {
    return mdRaw.toLowerCase().replace(/\s/g, "");
  }

  // Fallback: Infer from timestamp date
  if (timestampRaw) {
    const date = timestampRaw.split("T")[0];
    const match = matchdays.find((md) => md.date === date);
    if (match) return match.id;
  }

  // Last resort fallback
  return "md1";
}

export function parseGoals(
  rows: string[][],
  matchdays: Matchday[],
  teams: Team[]
): Goal[] {
  const teamNameToId = new Map(teams.map((t) => [t.name, t.id]));
  const goals: Goal[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const mdRaw = row[0]?.trim() || "";
    const timestampRaw = row[1]?.trim() || "";
    const scoringTeamName = row[2]?.trim() || "";
    const concedingTeamName = row[3]?.trim() || "";
    const scorer = row[4]?.trim() || "";
    const assister = row[5]?.trim() || null;

    if (!scorer) continue;

    const scoringTeamId = teamNameToId.get(scoringTeamName) || slugify(scoringTeamName);
    const concedingTeamId = teamNameToId.get(concedingTeamName) || slugify(concedingTeamName);

    const matchdayId = resolveMatchdayId(mdRaw, timestampRaw, matchdays);

    // Find the match within this matchday
    const md = matchdays.find((m) => m.id === matchdayId);
    let matchId = "";
    if (md) {
      const match = md.matches.find(
        (m) =>
          (m.homeTeamId === scoringTeamId && m.awayTeamId === concedingTeamId) ||
          (m.homeTeamId === concedingTeamId && m.awayTeamId === scoringTeamId)
      );
      if (match) matchId = match.id;
    }

    goals.push({
      id: `g${i}`,
      matchId,
      matchdayId,
      scoringTeamId,
      concedingTeamId,
      scorer,
      assister,
    });
  }

  return goals;
}

export function computeMatchScores(
  matchdays: Matchday[],
  goals: Goal[]
): Matchday[] {
  return matchdays.map((md) => {
    const mdGoals = goals.filter((g) => g.matchdayId === md.id);
    const isMdStarted = mdGoals.length > 0;

    return {
      ...md,
      matches: md.matches.map((match) => {
        const matchGoals = mdGoals.filter((g) => g.matchId === match.id);
        
        // A match is played if:
        // 1. It has at least one goal recorded
        // 2. OR the matchday has goals AND this specific match is logically "finished"
        // Since we don't have a "finished" flag, we assume if ANY goals exist for the MD,
        // any match with 0 goals recorded is 0-0 IF it's not the "next" or future matches.
        // For V1, we'll stick to: if MD has goals, this match is played (even if 0-0).
        if (!isMdStarted) {
          return match;
        }

        const homeGoals = matchGoals.filter(
          (g) => g.scoringTeamId === match.homeTeamId
        ).length;
        const awayGoals = matchGoals.filter(
          (g) => g.scoringTeamId === match.awayTeamId
        ).length;

        return { ...match, homeGoals, awayGoals };
      }),
    };
  });
}

export function parseRatings(
  rows: string[][],
  matchdays: Matchday[],
  teams: Team[]
): PlayerRating[] {
  if (rows.length < 2) return [];

  const header = rows[0];
  const teamNameToId = new Map(teams.map((t) => [t.name, t.id]));
  const ratings: PlayerRating[] = [];

  // Player name columns: 3 to header.length - 4 (last 4 are meta ratings)
  const metaStartIndex = header.length - 4;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const mdRaw = row[0]?.trim() || "";
    const timestampRaw = row[1]?.trim() || "";
    const respondentTeamRaw = normalizeTeamName(row[2]?.trim() || "");
    const respondentTeamId =
      teamNameToId.get(respondentTeamRaw) || slugify(respondentTeamRaw);

    const matchdayId = resolveMatchdayId(mdRaw, timestampRaw, matchdays);

    const playerRatings: Record<string, number> = {};
    for (let col = 3; col < metaStartIndex; col++) {
      const playerName = header[col]?.trim();
      if (!playerName) continue;
      const val = parseInt(row[col], 10);
      if (!isNaN(val) && val >= 1 && val <= 5) {
        playerRatings[slugify(playerName)] = val;
      }
    }

    ratings.push({
      matchdayId,
      respondentTeamId,
      playerRatings,
      refereeing: parseInt(row[metaStartIndex], 10) || 0,
      gamesClose: parseInt(row[metaStartIndex + 1], 10) || 0,
      teamwork: parseInt(row[metaStartIndex + 2], 10) || 0,
      enjoyment: parseInt(row[metaStartIndex + 3], 10) || 0,
    });
  }

  return ratings;
}

export function parseAllData(raw: RawSheetData): LeagueData {
  const teams = parseTeams(raw.teams);
  const { players, availability, played } = parsePlayers(raw.roster, teams);
  let matchdays = parseSchedule(raw.schedule, raw.scheduleFormula, raw.mdSchedule, teams);
  const goals = parseGoals(raw.goals, matchdays, teams);
  matchdays = computeMatchScores(matchdays, goals);
  const ratings = parseRatings(raw.ratings, matchdays, teams);

  return { teams, players, matchdays, goals, ratings, availability, played };
}
