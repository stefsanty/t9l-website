export const en = {
  // Navigation
  tabHome: 'Home',
  tabStats: 'Stats',
  tabTeams: 'Teams',
  
  // Dashboard & Vibes
  vibes: 'Vibes',
  response: 'response',
  responses: 'responses',
  vibesEnjoyment: 'Enjoyment',
  vibesTeamwork: 'Teamwork',
  vibesCompetitiveness: 'Competitiveness',
  vibesRefereeing: 'Refereeing',
  standings: 'Standings',
  statistics: 'Statistics',
  results: 'Results',
  squads: 'Squads',
  seasonFinished: 'Season Finished',
  seeYouAutumn: 'See you in the Autumn!',

  // NextMatchdayBanner
  nextMatchdayYour: 'YOUR NEXT MATCHDAY',
  nextMatchdayResults: 'MATCHDAY RESULTS',
  nextMatchdayDetails: 'MATCHDAY DETAILS',
  close: 'close',
  browse: 'browse ▾',
  kickoffTime: 'Kickoff Time',
  ft: 'FT',
  sittingOut: 'Sitting out',
  notScheduled: 'You are not scheduled to play on this matchday',
  tbd: 'TBD',

  // MatchdayAvailability
  noConfirmations: 'No confirmations yet',
  lineup: 'LINEUP',
  fwd: 'FWD',
  mid: 'MID',
  def: 'DEF',
  gk: 'GK',
  whoPlayed: 'Who Played',
  playedCount: 'played',
  playerAvailability: 'Player Availability',
  goingCount: 'going',
  undecidedCount: 'undecided',

  // RsvpButton
  rsvpGoing: 'Going',
  rsvpUndecided: 'Undecided',
  rsvpNotGoing: 'Not going',
  rsvpQuestion: 'Will you come play this matchday?',
  rsvpError: 'Could not update — try again',

  // MatchResults
  guestNonRostered: 'Guest (non-rostered)',
  asst: 'asst:',
  noGoalDetails: 'No goal details recorded',

  // SquadList
  squadMembers: 'SQUAD MEMBERS',
  availability: 'AVAILABILITY',
  statusGoing: 'GOING',
  statusUndecided: 'UNDECIDED',
  statusPlayed: 'PLAYED',
  statusNotGoing: 'NOT GOING',

  // TopPerformers
  playerHeader: 'PLAYER',
  matchesPlayed: 'Matches Played',
  rating: 'Rating',
  goals: 'Goals',
  assists: 'Assists',
  loadMore: 'Load more players',

  // LeagueTable
  pos: 'POS',
  club: 'CLUB',
  mp: 'MP',
  w: 'W',
  d: 'D',
  l: 'L',
  gf: 'GF',
  ga: 'GA',
  gd: 'GD',
  pts: 'PTS',

  // GuestLoginBanner
  rsvpMatchdays: 'RSVP for matchdays',
  loginLineConfirm: 'Login with LINE to confirm your attendance',
  login: 'Login',

  // LineLoginButton
  loggedInTitle: "You're logged in!",
  loggedInDesc: 'Link your LINE account to your player profile to RSVP to matchdays and show your photo in the squad list.',
  assignToPlayer: 'Assign to my player',
  continueAsGuest: 'Continue as guest',
  loginViaLine: 'Login via LINE',
  devShortcuts: 'Dev Shortcuts',
  impersonate: 'Impersonate:',
  loginAsGuestNoPlayer: 'Login as Guest (No Player)',
  signedInAsGuest: 'Signed in as guest',
  noPlayerAssigned: 'No player assigned yet',
  playingAs: 'Playing as',
  changeUnassignPlayer: 'Change/Unassign player',
  signOut: 'Sign out',

  // AssignPlayerClient
  whoAreYou: 'Who are you?',
  selectProfileDesc: 'Select your player profile. This links your LINE account to your squad entry.',
  searchPlaceholder: "Search your name (e.g. 'St')",
  noPlayersFound: 'No players found matching',
  clearSearch: 'Clear search',
  saving: 'Saving…',
  thisIsYou: 'This is you',
  confirmImThisPlayer: 'Confirm — I’m this player',
  selectPlayerAbove: 'Select a player above',
  removing: 'Removing…',
  unassignCurrentPlayer: 'Unassign from current player',
  linePhotoAvatarDesc: 'Your LINE profile photo will be used as your avatar',
  skipForNowGuest: 'Skip for now — keep browsing as guest',

  // Layout / Metadata
  metaTitle: "T9L '26 Spring",
  metaDesc: 'Tennozu 9-Aside League - Tokyo recreational football.',
} as const;

export type MessageKey = keyof typeof en;
