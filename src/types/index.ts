export interface Team {
  id: string;
  name: string;
  shortName: string;
  color: string;
  logo: string | null;
}

export interface Player {
  id: string;
  name: string;
  teamId: string;
  position: string | null;
  picture: string | null;
}

export interface Match {
  id: string;
  matchNumber: number;
  kickoff: string;
  fullTime: string;
  homeTeamId: string;
  awayTeamId: string;
  homeGoals: number | null;
  awayGoals: number | null;
}

export interface Matchday {
  id: string;
  label: string;
  date: string | null;
  venueName?: string;
  venueUrl?: string;
  venueCourtSize?: string;
  matches: Match[];
  sittingOutTeamId: string;
}

export interface Goal {
  id: string;
  matchId: string;
  matchdayId: string;
  scoringTeamId: string;
  concedingTeamId: string;
  scorer: string;
  assister: string | null;
}

export interface Availability {
  [matchdayId: string]: {
    [teamId: string]: string[];
  };
}

export interface AvailabilityStatuses {
  [matchdayId: string]: {
    [teamId: string]: {
      [playerId: string]: 'Y' | 'EXPECTED' | 'PLAYED' | 'GOING' | 'UNDECIDED';
    };
  };
}

export interface PlayedStatus {
  [matchdayId: string]: {
    [teamId: string]: string[];
  };
}

export interface LeagueTableRow {
  team: Team;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

export interface TopScorer {
  playerId: string;
  playerName: string;
  teamId: string;
  goals: number;
}

export interface TopAssister {
  playerId: string;
  playerName: string;
  teamId: string;
  assists: number;
}

export interface PlayerStats {
  playerId: string;
  playerName: string;
  teamId: string;
  teamName: string;
  teamShortName: string;
  teamLogo: string | null;
  teamColor: string;
  matchesPlayed: number;
  goals: number;
  assists: number;
  gaPerGame: number;
}

export interface LeagueData {
  teams: Team[];
  players: Player[];
  matchdays: Matchday[];
  goals: Goal[];
  availability: Availability;
  availabilityStatuses: AvailabilityStatuses;
  played: PlayedStatus;
}
