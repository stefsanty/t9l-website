# CLAUDE.md

> **Maintenance rule:** Whenever an architectural decision is made — new component, changed data flow, new API route, modified sheet schema, UX philosophy change — update this file immediately as part of the same commit. This file is the single source of truth for how the project works.

## Project

T9L.me — mobile-first, multi-tenant website for recreational football leagues. Originally built for the Tennozu 9-Aside League in Tokyo (still served at the apex `t9l.me`), now hosts arbitrary leagues, each on its own subdomain (e.g. `<league>.t9l.me`). Every instance shares one component template — only data and branding vary. Players can log in via LINE, assign themselves to their roster entry, RSVP availability for upcoming matchdays, and view live league data from Postgres.

## Stack

- Next.js (App Router, server + client components, ISR)
- TypeScript (strict mode)
- Tailwind CSS v4
- `googleapis` — Google Sheets API (read + write)
- `next-auth` v4 — LINE OAuth authentication
- `@upstash/redis` — JWT→player mapping storage, i18n translation cache
- `@anthropic-ai/sdk` — Runtime translation (Claude 3.5 Haiku)
- `@vercel/blob` — player profile picture storage
- Deployed to Vercel

## Architecture Overview

```
Postgres (Neon) — source of truth for all leagues
       ↕ Prisma (read + write)
  lib/admin-data.ts#getPublicLeagueData(id) — cached, tag=leagues
       ↓
  lib/dbToDashboard.ts — adapts Prisma shape → Dashboard props
       ↓
  app/page.tsx (server component, dynamic — reads host header)
       ├─ subdomain matches a League.subdomain → Dashboard
       ├─ apex / unknown host → getLeagueFromHost() falls back to isDefault → Dashboard
       └─ no League found at all → "No league configured" placeholder

Dashboard (single template — used by every tenant; was originally the Sheets-
   backed t9l.me dashboard, now driven by adapted DB data)
   ├── Header                    (fixed top bar)
   ├── NextMatchdayBanner        (matchday navigation, live scores, goals)
   ├── GuestLoginBanner          (LINE login CTA when not signed in)
   ├── MatchdayAvailability      (per-team pitch view + RSVP roster)
   └── RsvpBar                   (sticky bottom RSVP toggle for the signed-in player)

LINE OAuth → next-auth → Upstash Redis (lineId → player mapping)
i18n → cookie t9l-lang → translateDict (Claude + Redis cache) → I18nProvider
Player pics → Vercel Blob Storage ← fetched at page.tsx render time
```

### Multi-Tenancy

Every league is a row in the `League` table. The same `Dashboard` component renders all of them — only data and branding (name, location, primary/accent color) vary. Architectural rules:

1. **Single template, no per-league forks.** Adding a feature to `Dashboard` (or any of its children) updates every league instance simultaneously. Do not branch on league id/subdomain inside the template.
2. **One Prisma include + one adapter.** All public renders go through `getPublicLeagueData(id)` in `lib/admin-data.ts` and `dbToDashboard()` in `lib/dbToDashboard.ts`, so the props shape passed to `Dashboard` is invariant across tenants.
3. **LeagueTeam.id is the unifying team identifier.** Teams, players, matches, and goals all reference `LeagueTeam.id` so cross-references in the adapted Dashboard data line up regardless of underlying `Team` reuse across leagues.
4. **Branding via two CSS variables.** `--primary` (active tab / accents) and `--accent` (league name color) are injected on the page root from `league.primaryColor` / `league.accentColor`. No light/dark variants, no theming engine — two CSS variables, that's the whole API.
5. **Schema gaps degrade silently.** Per-player per-matchday RSVP, team rotation (`sittingOutTeamId`), and player position aren't in the DB yet — the adapter fills them with empty defaults so RSVP/availability widgets render but stay inert until those tables exist.

### Routing

`page.tsx` reads the `host` request header and extracts the first segment as a potential league subdomain (e.g. `test.dev.t9l.me` → `test`).

- **Subdomain match:** `getLeagueFromHost()` returns the matched League → `getPublicLeagueData(id)` → `dbToDashboard()` → render `Dashboard`
- **Apex / no subdomain:** `getLeagueFromHost()` falls back to `League.isDefault === true` → same render path
- **No matching League:** show a "No league configured" placeholder

Helpers:
- `lib/getLeagueFromHost.ts` — single resolver for host → League (subdomain match, falling back to isDefault)
- `lib/admin-data.ts#getPublicLeagueData(leagueId)` — cached Prisma query with the canonical public include
- `lib/dbToDashboard.ts#dbToDashboard(league)` — adapter to `Dashboard`'s props
- The `isDefault` flag is mutually exclusive — `updateLeagueInfo` toggles all other leagues off in a transaction when one is set to default

## Internationalization (i18n)

The app supports English (`en`) and Japanese (`ja`) based on the `t9l-lang` cookie.

- **Source of Truth:** All UI strings are defined in English in `src/i18n/en.ts`.
- **Translation:** Japanese translations are generated at runtime via Claude API (`claude-3-5-haiku-20241022`) and cached in Upstash Redis (`t9l:i18n:ja:<key>`).
- **Provider:** `I18nProvider` wraps the app in `layout.tsx`, providing `locale` and `dict` to client components via `useT()`.
- **Dates:** Formatted via `Intl.DateTimeFormat` in `src/i18n/format.ts` based on the current locale.
- **Toggle:** `LanguageToggle` component in the header sets the `t9l-lang` cookie via a server action and refreshes the page.
- **Cache Invalidation:** To bust the translation cache, manually delete Redis keys matching `t9l:i18n:ja:*`.

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

# Upstash Redis (lineId → player mapping, i18n cache)
KV_REST_API_URL
KV_REST_API_TOKEN

# Anthropic (runtime translation)
ANTHROPIC_API_KEY

# Vercel Blob (player profile pictures)
BLOB_READ_WRITE_TOKEN
```

If `GOOGLE_SHEET_ID` or `GOOGLE_SERVICE_ACCOUNT_EMAIL` are absent, `fetchSheetData()` falls back to `lib/mock-data.ts` automatically. Auth features (RSVP, player assignment) degrade gracefully when KV/Blob vars are missing. i18n falls back to English if `ANTHROPIC_API_KEY` is missing or translation fails.

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
│   ├── layout.tsx                    # i18n-aware RootLayout, AuthProvider + I18nProvider
│   ├── page.tsx                      # Server component: cached fetchSheetData → parse → Dashboard
│   ├── globals.css                   # Tailwind + custom design tokens
│   ├── actions/
│   │   └── setLocale.ts              # Server action: set t9l-lang cookie
│   └── api/
│       ├── auth/[...nextauth]/       # next-auth handler
│       ├── assign-player/route.ts    # POST: map lineId → playerId in Redis, upload pic to Blob
│       └── rsvp/route.ts            # POST: write availability to RosterRaw, revalidatePath('/')
├── i18n/
│   ├── en.ts                         # Master English dictionary
│   ├── translate.ts                  # Server: Claude + Redis translation logic
│   ├── I18nProvider.tsx              # Client: context + useT() hook
│   ├── getLocale.ts                  # Server: read t9l-lang cookie
│   └── format.ts                     # Intl.DateTimeFormat helpers
├── assign-player/
│   └── page.tsx                      # Server component: roster → AssignPlayerClient
├── components/
│   ├── Dashboard.tsx                 # Client: 3-tab layout + LanguageToggle
│   ├── NextMatchdayBanner.tsx        # i18n-aware match cards
│   ├── MatchdayAvailability.tsx      # i18n-aware attendance pitch view
│   ├── LeagueTable.tsx               # i18n-aware standings
│   ├── TopPerformers.tsx             # i18n-aware player stats
│   ├── MatchResults.tsx              # i18n-aware past results
│   ├── SquadList.tsx                 # i18n-aware squad lists
│   ├── LanguageToggle.tsx            # Client: EN/JP switch
│   ├── PlayerAvatar.tsx              # Avatar with fallback chain
│   ├── RsvpButton.tsx                # i18n-aware 3-state RSVP
│   ├── LineLoginButton.tsx           # i18n-aware login dropdown
│   └── AssignPlayerClient.tsx        # i18n-aware player assignment grid
├── lib/
│   ├── sheets.ts                     # batchGet (read) + writeRosterAvailability (write)
│   ├── data.ts                       # parseTeams/parsePlayers/parseSchedule/parseGoals/parseRatings
│   ├── stats.ts                      # computeLeagueTable/computePlayerStats/findNextMatchday
│   ├── auth.ts                       # next-auth authOptions (LINE provider, JWT, Redis lookup)
│   └── mock-data.ts                  # Fallback data when Sheets credentials absent
└── types/
    └── index.ts                      # All TypeScript interfaces
```

## Key i18n Workflow

1. `RootLayout` calls `getLocale()` (reads cookie) and `translateDict(en, locale)` (Claude + Redis).
2. `I18nProvider` receives `locale` and `dict`, making them available via `useT()`.
3. Client components use `const { t, locale } = useT()` to render localized strings: `t('standings')`.
4. Dates use `formatMatchDate(date, locale)` for local-appropriate formatting.
5. `LanguageToggle` triggers `setLocaleAction` → `revalidatePath('/')` → server re-renders with new locale.

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
