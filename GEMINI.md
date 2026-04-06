# CLAUDE.md

## Project

T9L.me — mobile-first website for the Tennozu 9-Aside League, a recreational football league in Tokyo. Read-only V1: no auth, no data entry on the site. Data comes from a Google Sheet.

## Full Spec Sheet

Full Spec Sheet can be found in @docs/spec.md

## Stack

- Next.js 14+ (App Router, server components)
- TypeScript (strict mode)
- Tailwind CSS
- `googleapis` npm package for Google Sheets API
- Deployed to Vercel

## Data Source

All data is read from a single Google Sheet via the Sheets API using a service account.

- Sheet ID: `1BLTV9v518fEi3DXRA-qcYY3bLDm_qftNoY_5SNzjKSc`
- Auth: Service account credentials via env vars
- Caching: ISR with `revalidate = 300` (5 minutes)
- Read strategy: Single `batchGet` call fetching all 6 tabs per page render

### Environment Variables

```
GOOGLE_SERVICE_ACCOUNT_EMAIL  # e.g. t9l-reader@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY            # PEM format from service account JSON key
GOOGLE_SHEET_ID               # 1BLTV9v518fEi3DXRA-qcYY3bLDm_qftNoY_5SNzjKSc
```

### Sheet Tabs & Ranges

| Tab | Range | Purpose |
|-----|-------|---------|
| `TeamRaw` | `A:B` | Team names and logos (logos are null for now) |
| `RosterRaw` | `A:L` | Players: picture (null), name, team, position, MD1–MD8 availability (Y/blank) |
| `ScheduleRaw` | `A:F` | 24 matches: matchday, match number, kickoff, full time, home team, away team |
| `GoalsRaw` | `A:F` | Goals: matchday, timestamp, scoring team, conceding team, scorer, assister |
| `RatingsRaw` | `A:BH` | Peer ratings: matchday, timestamp, respondent team, 53 player columns (1–5), 4 meta columns |
| `Schedule Formula` | `A:E` | Rotation logic: which team plays first/last/middle/sits out per matchday |

### Data Parsing Rules

**Row 1 of every tab is the header row. Skip it.**

**Team name normalization** — RatingsRaw prepends color names. Strip them:
- "Blue Mariners FC" → "Mariners FC"
- "Yellow Fenix FC" → "Fenix FC"
- "Hygge SC" → "Hygge SC" (no prefix)
- "FC Torpedo" → "FC Torpedo" (no prefix)

**Player ID generation** — Slugify player name: lowercase, replace spaces with hyphens, strip accents. Example: "Ian Noseda" → `ian-noseda`, "Nikolai Akira Kawabata" → `nikolai-akira-kawabata`.

**Team ID generation** — Same slug approach: "Mariners FC" → `mariners-fc`.

**Matchday column (`#REF!` handling)** — GoalsRaw and RatingsRaw column 0 may contain `#REF!` (broken formula). Read the value as-is. If it's a valid matchday string like "MD1", use it. If it's `#REF!` or empty, fall back to inferring from the timestamp date matched against known matchday dates.

**Goal-to-match mapping** — Each goal has a matchday + scoring team + conceding team. Find the match in ScheduleRaw where those two teams play (as home/away or away/home) within that matchday's 3 matches.

**"Guest" scorer** — A non-rostered player. Display as "Guest" in the UI. Exclude from player stat aggregations (top scorers, etc.).

**Availability** — RosterRaw columns MD1–MD8. Cell value "Y" = confirmed available. Blank/null = not confirmed. Handle sparse data — most future MDs will be empty.

**Ratings** — RatingsRaw is a wide table. Row 0 has player names as column headers (columns 3–55). Each data row is one survey response where a player rates their own teammates 1–5. Columns 56–59 are meta ratings: refereeing, games close, teamwork, enjoyment. Average all responses per player per matchday for the player's matchday rating.

## File Structure

```
src/
├── app/
│   ├── layout.tsx
│   ├── page.tsx              # Home — server component, calls getLeagueData()
│   └── globals.css
├── components/
│   ├── NextMatchdayBanner.tsx # Hero: all 3 matches, sitting-out team, availability
│   ├── LeagueTable.tsx        # Standings table
│   ├── TopPerformers.tsx      # Top scorer / assister / rated cards
│   ├── MatchResults.tsx       # Played matchday results, expandable goalscorers
│   └── SquadList.tsx          # Per-team player lists with availability badges
├── lib/
│   ├── sheets.ts              # Google Sheets API client + raw data fetching
│   ├── data.ts                # Parse raw sheet arrays → typed data model
│   └── stats.ts               # Computed: league table, top scorers, top rated, next matchday
└── types/
    └── index.ts               # All TypeScript interfaces
```

## Key Types

```typescript
interface Team {
  id: string;            // "mariners-fc"
  name: string;          // "Mariners FC"
  shortName: string;     // "MAR"
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
  matchNumber: number;   // 1, 2, or 3
  kickoff: string;       // "19:05"
  fullTime: string;      // "19:38"
  homeTeamId: string;
  awayTeamId: string;
  homeGoals: number | null;  // null = unplayed
  awayGoals: number | null;
}

interface Matchday {
  id: string;            // "md1"
  label: string;         // "MD1"
  date: string | null;   // "2026-04-03" or null if TBD
  matches: Match[];      // always 3
  sittingOutTeamId: string; // team not playing this matchday
}

interface Goal {
  id: string;
  matchId: string;
  matchdayId: string;
  scoringTeamId: string;
  concedingTeamId: string;
  scorer: string;        // player name, or "Guest"
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
  [matchdayId: string]: {
    [teamId: string]: string[]; // array of playerIds
  };
}
```

## Computed Stats (lib/stats.ts)

**League table**: For each team, count matches played (where both homeGoals and awayGoals are non-null), W/D/L, GF, GA, GD, Pts (3/1/0). Sort: Pts desc → GD desc → GF desc.

**Top scorers**: Group goals by scorer name, match to player, sort by count desc. Exclude "Guest".

**Top assisters**: Group goals by assister (exclude null), match to player, sort by count desc. Exclude "Guest".

**Top rated**: Average all ratings per player across all matchdays. Only players with ≥1 rating. Sort by avg desc.

**Next matchday**: First matchday where any match has `homeGoals === null`. If none, return the last matchday as "latest results".

## UI Sections (top to bottom on home page)

1. **Next Matchday Banner** — "NEXT MATCHDAY — MD[X]", date or "TBD", all 3 match pairings with kickoff times, which team sits out, per-team confirmed player count (expandable to show names).
2. **League Table** — compact, highlight table leader, team color accents.
3. **Top Performers** — 3 cards: top scorer, top assister, top rated. Horizontal scroll or grid.
4. **Match Results** — stacked by matchday (most recent first), 3 scores each, expandable for goalscorers.
5. **Squad Lists** — per-team collapsible sections, player name + position, availability badge (✅/❓) for next matchday.

## Design Rules

- Dark mode: background ~#0a0a0a, white text, team colors as accents
- Mobile-first: design for 375px, must work up to 430px. Desktop acceptable but not priority.
- Bold condensed display font for headers/scores (Google Fonts — pick something with character, not Inter/Roboto)
- Clean sans-serif body font
- No modals, no tooltips, no cookie banners, no login prompts
- No skeleton screens. Brief loading state acceptable but rare due to ISR.
- Score lines should feel like a sports ticker — compact, high contrast
- Single column layout on mobile. Cards with subtle borders.

## Commands

```bash
npm run dev          # Local dev server
npm run build        # Production build (will fail without env vars)
npm run lint         # ESLint
```

## Important Constraints

- This is V1. No auth, no database, no data entry, no player profile pages.
- Player names in lists are plain text (not linked). Player pages are V2.
- All data is public. No sensitive information in the sheet.
- The Google Sheet may have incomplete data (future matchdays with no goals, no ratings, no availability). Handle all nulls gracefully.
- 4 teams, 53 players, 8 matchdays, 24 matches, 33-minute match duration.
- FC Torpedo players have no positions listed — display "—".
- Matchday dates will be added manually over time. Display "TBD" when null.
