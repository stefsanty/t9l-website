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
  /** v1.86.0 — preferred positions (replaces parsing positions[0] from `position`). */
  preferredPositions?: string[];
  /** v1.86.0 — secondary positions. */
  secondaryPositions?: string[];
  picture: string | null;
  /**
   * v1.92.0 — NextAuth `User.image` of the player's linked auth account
   * (Google avatar / LINE picture / null). Distinct from `picture`,
   * which mirrors `Player.pictureUrl` (LINE-CDN write from the
   * /api/assign-player binding) and is used by the formation pitch +
   * SquadList. The list view in `MatchdayAvailability` uses `image`
   * specifically so the avatar follows the user's currently-active
   * auth provider rather than the historical LINE binding.
   * Null when the player has no linked User OR the User has no image.
   */
  image?: string | null;
  /**
   * v1.87.0 — per-league retirement marker. ISO string when the admin
   * has retired this player from this league; null/undefined when active.
   * Retired players still appear in the public squad list (sorted to
   * the bottom of their team, greyed out, with a "RETIRED" pill) and
   * keep their historical stats. Excluded by default from upcoming-
   * matchday formation/availability pickers (`MatchdayAvailability`).
   */
  retiredAt?: string | null;
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
  // v1.44.0 (PR δ) — optional event metadata exposed when the public read
  // path computes from MatchEvent rows. Pre-δ Goal records (Sheets path,
  // legacy Goal+Assist join) leave both null. Consumers that don't care
  // (the existing scorer-tick rendering) ignore these; PR ε's per-matchday
  // page renders the timeline using both.
  minute?: number | null;
  goalType?: 'OPEN_PLAY' | 'SET_PIECE' | 'PENALTY' | 'OWN_GOAL' | null;
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

/**
 * v1.93.0 — Per-(matchday, team) typed guest entries. Replaces the
 * v1.91.0 count-only `MatchdayGuestCounts` shape with per-row guests,
 * each carrying a type (EXTERNAL/LEAGUE), their own positions[]
 * (validated against the league's `ballType` vocab server-side), and
 * a `displayOrder` integer driving the "Ext Guest 1 / 2 / 3" label
 * numbering and stable per-section ordering. Empty teams/matchdays
 * are absent from the map.
 *
 * Order within a team is: all EXTERNAL rows ordered by displayOrder
 * asc, then all LEAGUE rows ordered by displayOrder asc. The
 * adapter (`dbToPublicLeagueData`) is responsible for emitting them
 * in that order; consumers iterate without re-sorting.
 */
export type GuestType = 'EXTERNAL' | 'LEAGUE';

export interface MatchdayGuestEntry {
  /** Stable cuid from `MatchdayGuest.id`. Used to build the
   *  `guest-<id>` pseudo-Player id in the pitch + list views so the
   *  same row keeps the same slot/pill across re-renders. */
  id: string;
  type: GuestType;
  positions: string[];
  /** 0..N-1 per (matchday, team, type) section. Drives "Ext Guest N+1" labels. */
  displayOrder: number;
}

export interface MatchdayGuests {
  [matchdayId: string]: {
    [teamId: string]: MatchdayGuestEntry[];
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
  /** v1.93.0 — per-row typed guest entries (per-matchday × per-team).
   *  Replaces the v1.91.0 count-only shape. Empty when no guests recorded. */
  guests: MatchdayGuests;
}
