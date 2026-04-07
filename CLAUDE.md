# CLAUDE.md

> **Maintenance rule:** Whenever an architectural decision is made — new component, changed data flow, new API route, modified sheet schema, UX philosophy change — update this file immediately as part of the same commit. This file is the single source of truth for how the project works.

## Project

T9L.me — mobile-first website for the Tennozu 9-Aside League, a recreational football league in Tokyo. Players can log in via LINE, assign themselves to their roster entry, RSVP availability for upcoming matchdays, and view live league data sourced from a Google Sheet.

## Stack

- Next.js (App Router, server + client components, ISR)
- TypeScript (strict mode)
- Tailwind CSS v4
- `googleapis` — Google Sheets API (read + write)
- `next-auth` v4 — LINE OAuth authentication
- `@upstash/redis` — JWT→player mapping storage
- `@vercel/blob` — player profile picture storage
- Deployed to Vercel

## Architecture Overview

```
Google Sheets (source of truth)
       ↕ read (batchGet) + write (availability cell updates)
  lib/sheets.ts
       ↓ parse
  lib/data.ts → lib/stats.ts
       ↓
  app/page.tsx (server component, ISR revalidate=300)
       ↓ props
  components/Dashboard.tsx (client, 3-tab UI)
       ├── NextMatchdayBanner      (Home tab — match info only)
       ├── MatchdayAvailability    (Home tab — RSVP + per-team attendance)
       ├── LeagueTable             (Stats tab)
       ├── TopPerformers           (Stats tab)
       ├── MatchResults            (Stats tab)
       └── SquadList               (Teams tab)

LINE OAuth → next-auth → Upstash Redis (lineId → player mapping)
Player pics → Vercel Blob Storage ← fetched at page.tsx render time
```

## Data Source

All data is read from a single Google Sheet via the Sheets API using a service account.

- Sheet ID: `1BLTV9v518fEi3DXRA-qcYY3bLDm_qftNoY_5SNzjKSc`
- Caching: ISR with `revalidate = 300` (5 minutes)
- Read strategy: Single `batchGet` call fetching all 7 tabs per page render
- Write: `writeRosterAvailability()` in `sheets.ts` writes RSVP status back to `RosterRaw` (requires service account Editor access)

### Environment Variables

```
# Google Sheets (service account — needs Editor access for RSVP write-back)
GOOGLE_SERVICE_ACCOUNT_EMAIL
GOOGLE_PRIVATE_KEY             # PEM format, newlines as \n

GOOGLE_SHEET_ID                # 1BLTV9v518fEi3DXRA-qcYY3bLDm_qftNoY_5SNzjKSc

# LINE OAuth (next-auth)
LINE_CLIENT_ID
LINE_CLIENT_SECRET
NEXTAUTH_SECRET
NEXTAUTH_URL                   # https://t9l.me in prod, http://localhost:3000 in dev

# Upstash Redis (lineId → player mapping)
KV_REST_API_URL
KV_REST_API_TOKEN

# Vercel Blob (player profile pictures)
BLOB_READ_WRITE_TOKEN
```

If `GOOGLE_SHEET_ID` or `GOOGLE_SERVICE_ACCOUNT_EMAIL` are absent, `fetchSheetData()` falls back to `lib/mock-data.ts` automatically. Auth features (RSVP, player assignment) degrade gracefully when KV/Blob vars are missing.

### Sheet Tabs & Ranges

| Tab | Range | Purpose |
|-----|-------|---------|
| `TeamRaw` | `A:B` | Team names and logos |
| `RosterRaw` | `A:L` | Players: picture, name, team, position, MD1–MD8 availability (`Y` / `EXPECTED` / `PLAYED` / blank) |
| `ScheduleRaw` | `A:F` | 24 matches: matchday, match number, kickoff, full time, home team, away team |
| `GoalsRaw` | `A:F` | Goals: matchday, timestamp, scoring team, conceding team, scorer, assister |
| `RatingsRaw` | `A:BH` | Peer ratings: matchday, timestamp, respondent team, 53 player columns (1–5), 4 meta columns |
| `Schedule Formula` | `A:E` | Rotation: which team plays first/last/middle/sits out per matchday |
| `MDScheduleRaw` | `A:B` | Matchday dates (label → YYYY-MM-DD or other parseable format) |

### Data Parsing Rules

**Row 1 of every tab is the header row. Skip it.**

**Team name normalization** — RatingsRaw prepends color names. Strip them:
- "Blue Mariners FC" → "Mariners FC"
- "Yellow Fenix FC" → "Fenix FC"
- "Hygge SC" / "FC Torpedo" — no change

**Player ID** — `slugify(name)`: lowercase, strip accents (NFD), replace spaces with `-`, remove non-alphanumeric. Example: "Ian Noseda" → `ian-noseda`.

**Team ID** — same slug approach: "Mariners FC" → `mariners-fc`.

**`#REF!` handling** — GoalsRaw and RatingsRaw column 0 may contain `#REF!`. If value matches `/MD\d+/i`, use it. Otherwise fall back to inferring matchday from timestamp date against `MDScheduleRaw` dates.

**Availability statuses** — `RosterRaw` MD columns: `Y` / `GOING` = confirmed, `EXPECTED` / `UNDECIDED` = tentative, `PLAYED` = actually played, blank = not going. Both confirmed and tentative statuses count toward `availability`. Only `PLAYED` counts toward `played` (used for match stats). New RSVPs write `GOING` / `UNDECIDED` / `''`; legacy `Y` / `EXPECTED` values from the sheet are still parsed correctly.

**Goal-to-match mapping** — Match by `(scoringTeamId, concedingTeamId)` or `(concedingTeamId, scoringTeamId)` within the matchday's 3 matches.

**"Guest" scorer** — non-rostered player, keep as-is in data, exclude from player stat aggregations.

**Ratings** — RatingsRaw is wide. Columns 3 to `header.length - 4` are player columns (header = player name). Last 4 columns are meta ratings: refereeing, gamesClose, teamwork, enjoyment.

## File Structure

```
src/
├── app/
│   ├── layout.tsx                    # Fonts (Barlow Condensed + Inter), AuthProvider wrapper
│   ├── page.tsx                      # Server component: fetchSheetData → parse → Dashboard
│   ├── globals.css                   # Tailwind + custom design tokens
│   └── api/
│       ├── auth/[...nextauth]/       # next-auth handler
│       ├── assign-player/route.ts    # POST: map lineId → playerId in Redis, upload pic to Blob
│       └── rsvp/route.ts            # POST: write availability to RosterRaw, revalidatePath('/')
├── assign-player/
│   └── page.tsx                      # Server component: roster → AssignPlayerClient
├── components/
│   ├── Dashboard.tsx                 # Client: 3-tab layout (Home / Stats / Teams) + header/nav
│   ├── NextMatchdayBanner.tsx        # Matchday pill selector, match cards, sitting-out badge
│   ├── MatchdayAvailability.tsx      # RSVP control + per-team attendance (expanded by default)
│   ├── LeagueTable.tsx               # Standings table (responsive, highlights leader)
│   ├── TopPerformers.tsx             # Sortable player stats table with load-more
│   ├── MatchResults.tsx              # Past results, expandable goalscorers, most recent first
│   ├── SquadList.tsx                 # Per-team collapsible lists, availability badges
│   ├── PlayerAvatar.tsx              # Avatar with fallback chain: Blob URL → local pic → initials
│   ├── RsvpButton.tsx                # 3-state RSVP (Going / Undecided / Not going), optimistic UI
│   ├── LineLoginButton.tsx           # Login button + dropdown + first-login assignment modal
│   └── AssignPlayerClient.tsx        # Roster picker (team-grouped grid) for player self-assignment
├── lib/
│   ├── sheets.ts                     # batchGet (read) + writeRosterAvailability (write)
│   ├── data.ts                       # parseTeams/parsePlayers/parseSchedule/parseGoals/parseRatings
│   ├── stats.ts                      # computeLeagueTable/computePlayerStats/findNextMatchday
│   ├── auth.ts                       # next-auth authOptions (LINE provider, JWT, Redis lookup)
│   └── mock-data.ts                  # Fallback data when Sheets credentials absent
└── types/
    └── index.ts                      # All TypeScript interfaces
```

## Key Types

```typescript
interface Team {
  id: string;            // "mariners-fc"
  name: string;          // "Mariners FC"
  shortName: string;     // "MFC"
  color: string;         // hex
  logo: string | null;
}

interface Player {
  id: string;            // "ian-noseda"
  name: string;
  teamId: string;
  position: string | null; // "GK" | "DF" | "DF/MF" | "MF" | "MF/FWD" | "FWD" | null
  picture: string | null;
}

interface Match {
  id: string;            // "md1-m1"
  matchNumber: number;
  kickoff: string;       // "19:05"
  fullTime: string;
  homeTeamId: string;
  awayTeamId: string;
  homeGoals: number | null;  // null = unplayed
  awayGoals: number | null;
}

interface Matchday {
  id: string;            // "md1"
  label: string;         // "MD1"
  date: string | null;   // "YYYY-MM-DD" or null
  matches: Match[];      // always 3
  sittingOutTeamId: string;
}

interface Goal {
  id: string;
  matchId: string;
  matchdayId: string;
  scoringTeamId: string;
  concedingTeamId: string;
  scorer: string;        // player name or "Guest"
  assister: string | null;
}

interface PlayerRating {
  matchdayId: string;
  respondentTeamId: string;
  playerRatings: Record<string, number>; // playerId → 1-5
  refereeing: number;
  gamesClose: number;
  teamwork: number;
  enjoyment: number;
}

interface Availability {
  [matchdayId: string]: { [teamId: string]: string[] };
}

interface PlayedStatus {
  [matchdayId: string]: { [teamId: string]: string[] }; // players with "PLAYED" status
}

interface PlayerStats {
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
  avgRating: number;
  matchdaysRated: number;
  gaPerGame: number;
}

interface LeagueData {
  teams: Team[];
  players: Player[];
  matchdays: Matchday[];
  goals: Goal[];
  ratings: PlayerRating[];
  availability: Availability;
  played: PlayedStatus;
}
```

## Session Shape (next-auth extension)

```typescript
// session.user is extended via next-auth module augmentation
session.lineId: string
session.playerId: string | null   // null until player self-assigns
session.playerName: string | null
session.teamId: string | null
session.linePictureUrl: string
```

## Computed Stats (`lib/stats.ts`)

- `computeLeagueTable(teams, matchdays)` — W/D/L/GF/GA/GD/Pts per team. Sort: Pts → GD → GF.
- `computePlayerStats(teams, players, goals, ratings, played)` — per-player: matchesPlayed (from `played`, each matchday = 2 matches), goals, assists, avgRating, G+A per game.
- `computeTopScorers`, `computeTopAssisters`, `computeTopRated` — legacy helpers (not currently used in UI but available).
- `findNextMatchday(matchdays)` — first matchday with `homeGoals === null`; falls back to last played.

## Auth & Player Assignment Flow

1. User taps "Login" → LINE OAuth → `next-auth` JWT session created
2. `jwt` callback checks Upstash Redis hash `line-player-map` for `lineId` key
3. If no mapping found: `session.playerId` = null → LineLoginButton shows "Assign player" prompt
4. User visits `/assign-player` → selects themselves from team-grouped roster grid
5. `POST /api/assign-player` → stores `{playerId, playerName, teamId}` in Redis + downloads LINE profile pic to Vercel Blob
6. JWT is refreshed on next request → session now has full player context

## RSVP Flow

1. `RsvpButton` renders only if `session.teamId !== matchday.sittingOutTeamId`
2. User selects one of three states → `POST /api/rsvp` with `{matchdayId, status: 'GOING' | 'UNDECIDED' | ''}`
3. `writeRosterAvailability(playerId, matchdayId, status)` writes the string value to `RosterRaw` via Sheets API
4. `revalidatePath('/')` invalidates the ISR cache — next visitor triggers a fresh sheet read
5. RsvpButton uses optimistic UI; reverts on error

**RSVP status values written to sheet:**
- `GOING` — player confirmed (maps to `Y` in legacy data)
- `UNDECIDED` — player tentative (maps to `EXPECTED` in legacy data)
- `''` (blank) — not going / no response

## UI — 3-Tab Layout

**Header** (fixed): "T9L '26 SPRING" branding + LINE login button  
**Bottom nav**: Home / Stats / Teams tabs

| Tab | Contents |
|-----|----------|
| **Home** | Personal status card (your next playing matchday + your RSVP status) → NextMatchdayBanner (pill selector, match cards, sitting-out badge) → MatchdayAvailability (3-state RSVP + per-team attendance, expanded by default with pitch formation view) |
| **Stats** | Standings table → Sortable player stats table (goals, assists, rating, G+A/game, load-more) → Past match results with expandable goalscorers |
| **Teams** | Per-team collapsible squad lists with position badges, availability status (CONFIRMED/PENDING), player avatars |

## Home Dashboard UX Philosophy

The Home tab is the primary screen for players. Its job is to answer three questions as fast as possible:

1. **Is my team playing soon, and when?** — A personal status card at the top of the Home tab shows the next matchday where the logged-in user's team plays (skipping any matchday where their team sits out). It displays the matchday label, date, and the user's current RSVP status as a color badge.

2. **Am I going?** — The RSVP control lives in `MatchdayAvailability`, visually separate from the match schedule. It offers three states with clear language:
   - **Going** → writes `GOING` to the sheet
   - **Undecided** → writes `UNDECIDED` to the sheet
   - **Not going** → writes blank to the sheet

3. **Who else is coming?** — Per-team attendance cards are **expanded by default** so the player count and pitch formation are immediately visible without any interaction. Users can still collapse individual team sections.

**Separation of concerns in the Home tab:**
- `NextMatchdayBanner` — pure match schedule: pill selector, match cards (scores/kickoffs), sitting-out team. No RSVP, no availability.
- `MatchdayAvailability` — pure attendance: RSVP control + per-team attendance with formation view. Reacts to the same selected matchday as the banner.

This separation keeps each component focused and makes it easy to iterate on RSVP UX without touching match display logic.

## Design Tokens

- Background: `#0D060E` (midnight)
- Primary accent: `#E90052` (vibrant-pink)
- Secondary accent: `#963CFF` (electric-violet)
- Success: `#00FF85` (electric-green)
- Display font: Barlow Condensed (bold/black for headers, scores)
- Body font: Inter
- Max-width: `max-w-lg` (centered, mobile-first at 375–430px)
- Cards: `pl-card` class with left accent border, subtle background, `rounded-2xl`

## Commands

```bash
npm run dev          # Local dev (uses mock data if env vars absent)
npm run build        # Production build
npm run lint         # ESLint
```

## Important Notes

- **4 teams, ~53 players, 8 matchdays, 24 matches**, 33-minute match duration
- FC Torpedo players have no positions in the sheet — store as `null`, display "—"
- Matchday dates come from `MDScheduleRaw`, not `ScheduleRaw`. Display "TBD" when null.
- `computeMatchScores`: if a matchday has any goals at all, all 3 matches are treated as played (even if 0-0). This is a simplification — no explicit "match finished" flag exists.
- Player pictures: fetched from Redis/Blob at page.tsx render time and passed down as `playerPictures: Record<string, string>` to avoid per-component async calls
- The `/minato` route redirects to the team's AppSheet data-entry form
