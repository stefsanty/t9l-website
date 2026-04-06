# T9L.me — V1 Product Spec

## Overview

A mobile-first, read-only website for the **Tennozu 9-Aside League (T9L)**, a recreational football league in Tokyo. V1 displays league data sourced live from a Google Sheet. No backend, no auth, no data entry on the website — just a fast, polished viewer.

**URL**: t9l.me  
**Stack**: Next.js (App Router) + Tailwind CSS, deployed to Vercel  
**Data source**: Google Sheets API (read-only), with ISR (Incremental Static Regeneration) caching  
**Source spreadsheet**: `https://docs.google.com/spreadsheets/d/1BLTV9v518fEi3DXRA-qcYY3bLDm_qftNoY_5SNzjKSc` (owner: vitoriatamachi@gmail.com)

---

## Data Model

All data originates from a single Google Sheet with 6 tabs. The app reads from this sheet via the Google Sheets API at runtime (cached with ISR). Below is the canonical data model — the JSON structures represent how the app should parse and normalize the sheet data internally.

### `teams.json`

```json
[
  {
    "id": "mariners-fc",
    "name": "Mariners FC",
    "shortName": "MAR",
    "color": "#0055A4",
    "logo": null
  },
  {
    "id": "fenix-fc",
    "name": "Fenix FC",
    "shortName": "FEN",
    "color": "#FFD700",
    "logo": null
  },
  {
    "id": "hygge-sc",
    "name": "Hygge SC",
    "shortName": "HYG",
    "color": "#2E8B57",
    "logo": null
  },
  {
    "id": "fc-torpedo",
    "name": "FC Torpedo",
    "shortName": "TOR",
    "color": "#DC143C",
    "logo": null
  }
]
```

> Team colors are placeholder — pick sensible defaults. `logo` is null for now (future: URL to image).

### `players.json`

```json
[
  {
    "id": "ian-noseda",
    "name": "Ian Noseda",
    "teamId": "mariners-fc",
    "position": "MF/FWD",
    "picture": null
  }
  // ... 53 players total across 4 teams
]
```

Source: **RosterRaw** sheet. Columns: Picture (always null for now), Player Name, Team, Pref. Pos.

**Position values** (enum): `GK`, `DF`, `DF/MF`, `MF`, `MF/FWD`, `FWD`, `null` (FC Torpedo players have no position listed).

### `schedule.json`

Each matchday has exactly **3 matches**. The season has **8 matchdays** = 24 matches total.

```json
{
  "matchdays": [
    {
      "id": "md1",
      "label": "MD1",
      "date": "2026-04-03",
      "matches": [
        {
          "id": "md1-m1",
          "matchNumber": 1,
          "kickoff": "19:05",
          "fullTime": "19:38",
          "homeTeamId": "mariners-fc",
          "awayTeamId": "hygge-sc",
          "homeGoals": 2,
          "awayGoals": 2
        },
        {
          "id": "md1-m2",
          "matchNumber": 2,
          "kickoff": "19:40",
          "fullTime": "20:13",
          "homeTeamId": "mariners-fc",
          "awayTeamId": "fenix-fc",
          "homeGoals": 2,
          "awayGoals": 2
        },
        {
          "id": "md1-m3",
          "matchNumber": 3,
          "kickoff": "20:15",
          "fullTime": "20:48",
          "homeTeamId": "hygge-sc",
          "awayTeamId": "fenix-fc",
          "homeGoals": 4,
          "awayGoals": 3
        }
      ]
    }
  ]
}
```

Source: **ScheduleRaw** sheet. Columns: Matchday, Match, Kickoff Time, Full Time, Home Team, Away Team.

**Key facts**:
- Matchdays repeat a round-robin pattern every 4 MDs (MD1-4 = MD5-8 same matchups).
- Per the **Schedule Formula** sheet, each MD has 3 of 4 teams playing. One team sits out. The "active" team plays the first 2 games, then the other two play the 3rd.
- `homeGoals` / `awayGoals`: Computed by counting goals in GoalsRaw for each match. For future/unplayed matchdays, these are `null`.
- `date`: Not in the spreadsheet currently. **MD1 = 2026-04-03** (inferred from GoalsRaw timestamps). Future dates TBD — store as `null` for unscheduled MDs.

### `goals.json`

```json
[
  {
    "id": "g1",
    "matchId": "md1-m1",
    "scoringTeamId": "mariners-fc",
    "concedingTeamId": "hygge-sc",
    "scorer": "Ian Noseda",
    "assister": "Laurence"
  }
]
```

Source: **GoalsRaw** sheet. Columns: MD, Timestamp, Scoring Team, Conceding Team, Scorer, Assister.

**Matchday column**: Currently shows `#REF!` due to a broken formula. This will be corrected by human data entry in the sheet (e.g. "MD1", "MD2"). The app should read whatever string value is in this column. If the value is `#REF!` or empty, fall back to inferring the matchday from the timestamp date cross-referenced against schedule dates.

**Edge case**: `"Guest"` appears as a scorer. This is a non-rostered player. Keep as-is in the data, display as "Guest" in the UI.

### `ratings.json`

```json
[
  {
    "matchdayId": "md1",
    "respondentTeam": "mariners-fc",
    "timestamp": "2026-04-03T01:08:05.379Z",
    "playerRatings": {
      "yas-makita": 4,
      "isen": 4,
      "ken-hirami": 4,
      "kevin-chang": 3,
      "merck": 3,
      "stefan": 3,
      "ian-noseda": 5,
      "nathan-chang": 4,
      "laurence": 4,
      "vernieri-luca": 5
    },
    "refereeing": 4,
    "gamesClose": 5,
    "teamwork": 4,
    "enjoyment": 5
  }
]
```

Source: **RatingsRaw** sheet. This is a **pivot table** — player names run across columns 3–55 (indices), and each row is one survey response.

**Structure**:
- Column 0: Matchday (currently `#REF!` — will be corrected by human data entry, same approach as GoalsRaw)
- Column 1: Timestamp
- Column 2: Respondent's team (e.g. "Blue Mariners FC", "Yellow Fenix FC", "Hygge SC")
- Columns 3–55: Player rating columns. Each column header = player name. Value = 1–5 integer or null (null = didn't rate, typically because player is not on respondent's team).
- Columns 56–59: Meta ratings (refereeing, games close, teamwork, enjoyment). Scale 1–5.

**Rating system**: Players rate only their own teammates, 1–5 scale (1 = poor, 3 = average, 5 = star performer). The average across all responses for a player on a given matchday = that player's matchday rating.

**Team name mapping** (from RatingsRaw → canonical):
- "Blue Mariners FC" → "Mariners FC"
- "Yellow Fenix FC" → "Fenix FC"
- "Hygge SC" → "Hygge SC"
- "FC Torpedo" → "FC Torpedo"

### `availability.json`

```json
{
  "md1": {
    "mariners-fc": ["yas-makita", "isen", "ken-hirami", "kevin-chang", "merck", "stefan", "ian-noseda", "yusuke", "nathan-chang", "laurence", "vernieri-luca"],
    "fenix-fc": ["ivo-rodrigues", "ryota-itou", "kentaro-morooka", "miguel", "ryuusei", "badr", "shu-yoshimura", "shishido-ken", "kosma-knasiecki", "alexander-vassiliev", "johannes"],
    "hygge-sc": ["ryohei-enomoto", "ben-lee", "sebastien-gaboriau", "khrapov-tymur", "nikolai-akira-kawabata", "fatih-emre", "enes-komuro", "player-k", "player-s"]
  }
}
```

Source: **RosterRaw** sheet, columns MD1–MD8. Value `"Y"` = player is available for that matchday. `null`/blank = not available (or not yet confirmed).

---

## Computed Data (derive at build time or in a `lib/stats.ts`)

### League Table

Standard football league table. Computed from `goals.json` + `schedule.json`.

Per match result: **Win = 3pts, Draw = 1pt, Loss = 0pts**.

| Column | Source |
|--------|--------|
| Team | teams.json |
| MP (Matches Played) | Count of matches with non-null scores |
| W / D / L | Derived from match scores |
| GF (Goals For) | Sum of goals scored |
| GA (Goals Against) | Sum of goals conceded |
| GD (Goal Difference) | GF - GA |
| Pts (Points) | 3W + 1D |

**Sort order**: Pts desc → GD desc → GF desc.

### Top Scorers

Aggregate `goals.json` by `scorer`. Return sorted by count desc.

```
{ playerId, playerName, teamId, goals }
```

### Top Assisters

Aggregate `goals.json` by `assister` (exclude null). Return sorted by count desc.

```
{ playerId, playerName, teamId, assists }
```

### Top Performers (by rating)

Aggregate `ratings.json` → average rating per player across all matchdays.

```
{ playerId, playerName, teamId, avgRating, matchdaysRated }
```

Only include players with ≥1 rating. Sort by avgRating desc.

### Next Matchday

Find the first matchday in schedule data where `homeGoals === null` (unplayed). Return the full matchday object including all 3 matches + which team is sitting out. If all matchdays are played, return the most recent one as "latest results".

For the next matchday, also show **player availability per team**: which players have confirmed they are coming. This data comes from the RosterRaw sheet (MD1–MD8 columns, "Y" = confirmed).

---

## Pages & UI

### Page 1: Home (`/`)

Mobile-first single page. No hamburger menus, no sidebars. Vertical scroll.

#### Section 1: Hero / Next Matchday Banner
- If a future matchday exists: **"NEXT MATCHDAY — MD[X]"** with date (if known).
  - Show all 3 matches with team names and kickoff times (e.g. "MAR vs HYG — 19:05 / MAR vs FEN — 19:40 / HYG vs FEN — 20:15").
  - Show which team is **sitting out** this matchday (e.g. "FC Torpedo resting").
  - Show **player availability per team**: confirmed player count and names (e.g. "Mariners FC: 11 confirmed" expandable to show the list). Data from RosterRaw MD columns.
- If all matchdays played: **"LATEST RESULTS — MD[X]"** with scores for all 3 matches.

#### Section 2: League Table
- Compact table. Team name (or crest placeholder), MP, W, D, L, GF, GA, GD, Pts.
- Highlight leader row.

#### Section 3: Top Performers Card Row
- Horizontal scroll or 3-card grid.
- Card 1: **Top Scorer** — name, team badge, goals count.
- Card 2: **Top Assister** — name, team badge, assists count.
- Card 3: **Top Rated** — name, team badge, avg rating.

#### Section 4: Match Results
- Accordion or stacked cards, one per matchday (most recent first).
- Each matchday shows 3 match scores: `Home X - Y Away`.
- Expandable to show goalscorers per match.

#### Section 5: Squad Lists
- Tabs or collapsible sections per team.
- Show player name, position.
- If availability data exists for next matchday, show ✅/❓ badge.

### Page 2: Player Profile (`/player/[id]`)

**Defer to V2.** For V1, player names in lists are plain text (not linked).

---

## Design Direction

**Aesthetic**: Dark-mode sports dashboard. Think ESPN app meets a Tokyo street poster — high contrast, bold type, compact information density. Not a corporate dashboard.

**Typography**: Use a bold condensed display font for headers/scores (e.g. Oswald, Barlow Condensed, or similar from Google Fonts). Clean sans-serif for body text.

**Color**: Dark background (#0a0a0a or similar), white text, team colors as accents (badges, borders, score highlights). Avoid grey-on-grey.

**Layout**: Single column on mobile. Cards with subtle borders or background differentiation. Score lines should feel like a ticker.

**No**: Skeleton screens, modals, tooltips, cookie banners, login prompts. A brief loading state is acceptable on first uncached load but should be rare due to ISR.

---

## Technical Architecture

```
t9l-website/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx           # Home (server component, fetches data)
│   │   └── globals.css
│   ├── components/
│   │   ├── NextMatchdayBanner.tsx
│   │   ├── LeagueTable.tsx
│   │   ├── TopPerformers.tsx
│   │   ├── MatchResults.tsx
│   │   └── SquadList.tsx
│   ├── lib/
│   │   ├── sheets.ts          # Google Sheets API client, sheet-to-model parsing
│   │   ├── data.ts            # Type definitions, normalization helpers
│   │   └── stats.ts           # Computed stats (table, scorers, etc.)
│   └── types/
│       └── index.ts           # TypeScript interfaces
├── tailwind.config.ts
├── next.config.ts
├── package.json
└── README.md
```

### Key decisions

1. **Google Sheets API as data source**: The app reads directly from the Google Sheet at `1BLTV9v518fEi3DXRA-qcYY3bLDm_qftNoY_5SNzjKSc` using a Google Service Account. The sheet must be shared with the service account email (read-only).

2. **ISR caching**: Use Next.js `revalidate` (e.g. 300 seconds / 5 minutes) so the site isn't hitting the Sheets API on every page load, but picks up spreadsheet changes within minutes.

3. **Google Sheets API setup**:
   - Create a Google Cloud project, enable Sheets API.
   - Create a Service Account, download JSON key.
   - Share the spreadsheet with the service account email as Viewer.
   - Store the service account credentials as environment variables in Vercel (`GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID`).
   - Use `googleapis` npm package (`google.sheets('v4')`) to read ranges.

4. **Sheet reading strategy**: Fetch all 6 tabs in a single `batchGet` call with ranges like `RosterRaw!A:L`, `GoalsRaw!A:F`, etc. Parse in `lib/sheets.ts` into the canonical data model.

5. **No database for V1**: The Google Sheet is the source of truth. Data entry happens in the sheet by humans.

6. **No auth for V1**: All data is public. Player profiles are deferred.

7. **Responsive but mobile-first**: Design for 375px width first. Desktop is a nice-to-have stretch.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service account email (e.g. `t9l-reader@project.iam.gserviceaccount.com`) |
| `GOOGLE_PRIVATE_KEY` | Service account private key (PEM format, from JSON key file) |
| `GOOGLE_SHEET_ID` | `1BLTV9v518fEi3DXRA-qcYY3bLDm_qftNoY_5SNzjKSc` |

---

## Data Issues to Handle

| Issue | Resolution |
|-------|------------|
| `#REF!` in GoalsRaw column 0 (Matchday) | Will be corrected by human data entry in the sheet. App should read the value as-is. If `#REF!` or empty, fall back to timestamp-based inference. |
| `#REF!` in RatingsRaw column 0 | Same approach — read value, fall back to timestamp if broken. |
| Team names in RatingsRaw have color prefixes | Strip: "Blue Mariners FC" → "Mariners FC", "Yellow Fenix FC" → "Fenix FC". |
| FC Torpedo players have no positions | Store as `null`. Display as "—" in UI. |
| "Guest" as scorer | Display as "Guest (non-rostered)". Do not link to a player profile. Do not count in player stats. |
| No matchday dates in ScheduleRaw | MD1 = 2026-04-03 from timestamps. Future MDs: store as `null`, display as "TBD". Dates will be added to the sheet manually over time. |
| Goal-to-match mapping | A goal belongs to the match where (ScoringTeam, ConcedingTeam) appear as (Home, Away) or (Away, Home) within that matchday's 3 matches. The Matchday column tells you which matchday. |
| Availability only populated for MD1 | Future MDs will have Y/null filled in as players confirm. App should handle sparse data gracefully. |
| Google Sheets API rate limits | Use ISR caching (revalidate every 5 min). A single `batchGet` call per page render to minimize API usage. |

---

## V2+ Roadmap (out of scope for V1, but informs architecture)

- **Auth / Player accounts**: Clerk or Supabase Auth. Players log in, see their own stats, update profile picture.
- **Data entry via web**: Replace spreadsheet. Admin panel to record goals, ratings in-app. Or Airtable as intermediate step.
- **Live availability RSVP**: Players mark themselves available for upcoming matchdays directly on site.
- **Player profile pages**: `/player/[id]` with per-matchday stats, rating history chart, goals/assists breakdown.
- **Push notifications**: Upcoming match reminders.
- **Bilingual (EN/JP)**: i18n support.

---

## Acceptance Criteria for V1

1. Site loads at t9l.me on mobile in <2s (ISR cached).
2. Home page shows: next matchday (all 3 games + sitting-out team + player availability), league table, top scorer/assister/rated, match results with scorers, squad lists.
3. All data matches the Google Sheet exactly (15 goals for MD1, 53 players, 4 teams, 24 scheduled matches).
4. Data refreshes within 5 minutes of a Google Sheet edit (ISR revalidation).
5. No JavaScript errors in console.
6. Looks good on iPhone SE (375px) through iPhone 15 Pro Max (430px). Desktop is acceptable but not priority.
7. Gracefully handles missing data: null dates show "TBD", missing matchday columns show "—", empty availability shows "No confirmations yet".
