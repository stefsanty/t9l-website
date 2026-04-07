# Gemini.md

> Project context for AI assistants working on this codebase.
> See CLAUDE.md for the authoritative version — this file mirrors it.

## Project

T9L.me — mobile-first website for the Tennozu 9-Aside League, a recreational football league in Tokyo. Players log in via LINE, assign themselves to their roster entry, RSVP availability, and view live league data from a Google Sheet.

## Stack

- **Next.js** (App Router, server + client components, ISR `revalidate=300`)
- **TypeScript** strict mode
- **Tailwind CSS v4**
- **`googleapis`** — Google Sheets API (read + write)
- **`next-auth` v4** — LINE OAuth
- **`@upstash/redis`** — lineId → player mapping
- **`@vercel/blob`** — player profile pictures
- Deployed to **Vercel**

## Architecture

```
Google Sheets  ←→  lib/sheets.ts  →  lib/data.ts  →  lib/stats.ts
                                                          ↓
                                              app/page.tsx (ISR server component)
                                                          ↓
                                              components/Dashboard.tsx (client)
                                          ┌───────────────┼────────────────────┐
                                     Home tab         Stats tab           Teams tab
                               NextMatchdayBanner  LeagueTable           SquadList
                                                   TopPerformers
                                                   MatchResults

LINE OAuth → next-auth → Upstash Redis (lineId → {playerId, playerName, teamId})
Player pics → Vercel Blob ← fetched in page.tsx, passed as playerPictures prop
```

## Environment Variables

```
# Google Sheets (Editor access required for RSVP write-back)
GOOGLE_SERVICE_ACCOUNT_EMAIL
GOOGLE_PRIVATE_KEY             # PEM format, \n-escaped
GOOGLE_SHEET_ID                # 1BLTV9v518fEi3DXRA-qcYY3bLDm_qftNoY_5SNzjKSc

# LINE OAuth
LINE_CLIENT_ID
LINE_CLIENT_SECRET
NEXTAUTH_SECRET
NEXTAUTH_URL

# Upstash Redis
KV_REST_API_URL
KV_REST_API_TOKEN

# Vercel Blob
BLOB_READ_WRITE_TOKEN
```

Missing `GOOGLE_SHEET_ID` or `GOOGLE_SERVICE_ACCOUNT_EMAIL` → falls back to `lib/mock-data.ts`.

## Google Sheet Tabs

| Tab | Range | Purpose |
|-----|-------|---------|
| `TeamRaw` | `A:B` | Team names + logos |
| `RosterRaw` | `A:L` | Players: picture, name, team, position, MD1–MD8 (`Y`/`EXPECTED`/`PLAYED`/blank) |
| `ScheduleRaw` | `A:F` | 24 matches: matchday, match#, kickoff, full time, home, away |
| `GoalsRaw` | `A:F` | Goals: matchday, timestamp, scoring team, conceding team, scorer, assister |
| `RatingsRaw` | `A:BH` | Peer ratings: matchday, timestamp, respondent team, 53 player columns, 4 meta columns |
| `Schedule Formula` | `A:E` | Sitting-out team per matchday |
| `MDScheduleRaw` | `A:B` | Matchday dates (label → date) |

Row 1 of every tab = header, skip it.

## Key Parsing Rules

- **Slugify**: `name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'')` → player/team IDs
- **Team name normalization**: "Blue Mariners FC" → "Mariners FC", "Yellow Fenix FC" → "Fenix FC"
- **Availability**: `Y` + `EXPECTED` → `availability`; only `PLAYED` → `played`
- **`#REF!`**: GoalsRaw/RatingsRaw col 0 may be broken — fall back to timestamp-based matchday inference
- **Guest scorer**: non-rostered, keep as "Guest", exclude from player stats
- **Match scores**: derived by counting goals per match. If a matchday has any goals, all 3 matches are treated as played (even 0-0)

## File Structure

```
src/
├── app/
│   ├── layout.tsx                    # Fonts + AuthProvider
│   ├── page.tsx                      # Server component (ISR) — fetch → parse → Dashboard
│   ├── globals.css                   # Design tokens + Tailwind
│   ├── assign-player/page.tsx        # Roster picker (server → AssignPlayerClient)
│   └── api/
│       ├── auth/[...nextauth]/       # next-auth handler
│       ├── assign-player/route.ts    # Map lineId → playerId in Redis + upload pic to Blob
│       └── rsvp/route.ts            # Write availability to RosterRaw + revalidatePath('/')
├── components/
│   ├── Dashboard.tsx                 # 3-tab client shell + header + bottom nav
│   ├── NextMatchdayBanner.tsx        # Matchday selector, matches, RSVP, formations
│   ├── LeagueTable.tsx               # Standings
│   ├── TopPerformers.tsx             # Sortable player stats table
│   ├── MatchResults.tsx              # Past results + goalscorers
│   ├── SquadList.tsx                 # Team rosters + availability
│   ├── PlayerAvatar.tsx              # Avatar with fallback: Blob → local → initials
│   ├── RsvpButton.tsx                # Optimistic RSVP toggle
│   ├── LineLoginButton.tsx           # Login + assignment modal
│   └── AssignPlayerClient.tsx        # Player self-assignment UI
├── lib/
│   ├── sheets.ts                     # batchGet + writeRosterAvailability
│   ├── data.ts                       # Parse raw arrays → typed model
│   ├── stats.ts                      # computeLeagueTable, computePlayerStats, findNextMatchday
│   ├── auth.ts                       # next-auth authOptions (LINE + Redis lookup)
│   └── mock-data.ts                  # Dev fallback
└── types/index.ts                    # All TypeScript interfaces
```

## Core Types (abbreviated)

```typescript
Team        { id, name, shortName, color, logo }
Player      { id, name, teamId, position, picture }
Match       { id, matchNumber, kickoff, fullTime, homeTeamId, awayTeamId, homeGoals, awayGoals }
Matchday    { id, label, date, matches[3], sittingOutTeamId }
Goal        { id, matchId, matchdayId, scoringTeamId, concedingTeamId, scorer, assister }
PlayerRating { matchdayId, respondentTeamId, playerRatings: Record<playerId, 1-5>,
               refereeing, gamesClose, teamwork, enjoyment }
Availability { [matchdayId]: { [teamId]: playerId[] } }
PlayedStatus { [matchdayId]: { [teamId]: playerId[] } }
PlayerStats  { playerId, playerName, teamId, teamName, teamColor, teamLogo,
               matchesPlayed, goals, assists, avgRating, matchdaysRated, gaPerGame }
LeagueData   { teams, players, matchdays, goals, ratings, availability, played }
```

## Session Shape

```typescript
session.lineId: string
session.playerId: string | null   // null until self-assigned
session.playerName: string | null
session.teamId: string | null
session.linePictureUrl: string
```

## Auth Flow

1. LINE OAuth → `next-auth` JWT
2. `jwt` callback → Redis lookup `hget("line-player-map", lineId)`
3. If mapping exists → populate `playerId`, `playerName`, `teamId` on token
4. If not → show "Assign player" prompt in LineLoginButton
5. `/assign-player` → `POST /api/assign-player` → Redis + Blob → session refreshes

## RSVP Flow

`RsvpButton` (auth required, team must be playing) → `POST /api/rsvp {matchdayId, going}` → `writeRosterAvailability()` updates RosterRaw cell → `revalidatePath('/')` → optimistic UI

## Design System

- Background: `#0D060E` (midnight)
- Primary: `#E90052` (vibrant-pink)
- Secondary: `#963CFF` (electric-violet)
- Success: `#00FF85` (electric-green)
- Display font: Barlow Condensed | Body: Inter
- Layout: `max-w-lg`, centered, mobile-first (375–430px)
- Cards: left accent border (`pl-card`), `rounded-2xl`, subtle bg

## Commands

```bash
npm run dev    # Local dev (auto-uses mock data if no Sheets env vars)
npm run build  # Production build
npm run lint   # ESLint
```

## Key Facts

- 4 teams, ~53 players, 8 matchdays, 24 matches
- FC Torpedo: no positions in sheet → store `null`, display "—"
- Matchday dates from `MDScheduleRaw`, not `ScheduleRaw` → show "TBD" when null
- `/minato` redirects to team's AppSheet data-entry form
