# CLAUDE.md

> **Maintenance rule:** Whenever an architectural decision is made — new component, changed data flow, new API route, new Prisma model or column, modified Sheet schema, UX philosophy change — update this file **in the same PR** as the change. PRs that touch architecture without updating CLAUDE.md should be sent back. This file is the single source of truth for how the project works.
>
> **Test rule:** Every PR that adds or changes behavior ships with at least one test that proves the new behavior. Unit tests for pure functions (Vitest), e2e tests for user-visible flows (Playwright). The CI workflow at `.github/workflows/test.yml` runs Vitest + tsc on every PR; merge is blocked on red. See [Testing](#testing) below for what to add per change-type.
>
> **Autonomy rule:** The Claude Code harness reads `.claude/settings.json` (committed) and `.claude/settings.local.json` (gitignored, per-developer override). The committed file pre-approves routine read/edit/grep/install/test/git/gh/vercel/neonctl tools and explicitly **denies** destructive Bash patterns (`git push --force*`, `git reset --hard*`, `rm -rf*`, `prisma migrate reset*`, `neonctl branches delete*`, raw SQL `DROP/TRUNCATE/DELETE FROM`). If a routine command is hitting an approval prompt, propose adding it to `permissions.allow` in `.claude/settings.json` rather than `settings.local.json` so the whole team benefits.

## Project

T9L.me — mobile-first website for the Tennozu 9-Aside League, a recreational football league in Tokyo. Players can log in via LINE, assign themselves to their roster entry, RSVP availability for upcoming matchdays, and view live league data sourced from a Google Sheet.

## Stack

- Next.js (App Router, server + client components, ISR)
- TypeScript (strict mode)
- Tailwind CSS v4
- `googleapis` — Google Sheets API (read + write) — public-site source of truth on apex (cutover to DB in progress; see [Sheets→DB Migration](#sheetsdb-migration))
- `@prisma/client` + `@neondatabase/serverless` — Postgres ORM (Neon-hosted) — admin-side source of truth and target of public-site cutover
- `next-auth` v4 — LINE OAuth (public players) + Credentials provider (admin)
- `@upstash/redis` — JWT→player mapping storage, i18n translation cache
- `@anthropic-ai/sdk` — runtime translation (Claude 3.5 Haiku)
- `@vercel/blob` — player profile picture storage
- Vitest (unit) + Playwright (e2e) — see [Testing](#testing)
- Deployed to Vercel; Neon-Vercel marketplace integration auto-provisions a Neon branch DB per Vercel preview branch

## Architecture Overview

```
Google Sheets (source of truth)
       ↕ read (batchGet) + write (availability cell updates)
  lib/sheets.ts
       ↓ parse
  lib/data.ts → lib/stats.ts
       ↓
  app/page.tsx (server component, dynamic — reads host header)
       ├─ subdomain found in DB → components/LeaguePublicView.tsx (DB-driven, 3-tab)
       └─ no subdomain match  → components/Dashboard.tsx (Google Sheets, ISR 300s)
            ├── NextMatchdayBanner      (Home tab — match info only)
            ├── MatchdayAvailability    (Home tab — RSVP + per-team attendance)
            ├── LeagueTable             (Stats tab)
            ├── TopPerformers           (Stats tab)
            ├── MatchResults            (Stats tab)
            └── SquadList               (Teams tab)

LINE OAuth → next-auth → Upstash Redis (lineId → player mapping)
i18n → cookie t9l-lang → translateDict (Claude + Redis cache) → I18nProvider
Player pics → Vercel Blob Storage ← fetched at page.tsx render time
```

### Subdomain Routing

`page.tsx` reads the `host` request header and extracts the first segment as a potential league subdomain (e.g. `test.dev.t9l.me` → `test`). If a `League` row with that subdomain exists in the database, it renders `LeaguePublicView` with Prisma data instead of the Google Sheets Dashboard.

- `lib/admin-data.ts#getLeagueBySubdomain(subdomain)` — cached Prisma query (revalidate=60, tag=leagues)
- Known non-league hostnames skipped: `www`, `dev`, `localhost`, `t9l`, `127`, empty
- `LeaguePublicView` renders schedule, standings, and team rosters entirely from the database; no Google Sheets dependency

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

## Prisma schema (admin-side / DB cutover target)

`prisma/schema.prisma` defines the DB-backed admin and (post-cutover) public-site source of truth. Key models:

- **`User`** — admin/viewer accounts (`role: ADMIN|VIEWER`). LINE-linked via `lineId @unique`.
- **`League`** — single league instance (e.g. "T9L 2026 Spring"). Has `subdomain @unique` for subdomain-based public routing. **Restored fields** `isDefault Boolean`, `primaryColor String?`, `accentColor String?` were re-added to the schema in PR 1 to match prod's actual columns; they're orphan from a rolled-back per-league-branding feature, populated only on `T9L 2026 Spring` (`isDefault: true`) and `Test League 2025` (`isDefault: false`). No code reads them today.
- **`Team`** + **`LeagueTeam`** — teams are global brand identities (`Team`); a team's participation in a league is `LeagueTeam`. PR 1 added `Team.shortName String?` and `Team.color String?`. `Team.name` is **not `@unique`** because the test-league seed introduced duplicates (`Storm United`, `Phoenix FC`); upserts key on `id` (slug) instead.
- **`Player`** + **`PlayerLeagueAssignment`** — players are global; league participation is recorded with `fromGameWeek` / `toGameWeek`. PR 1 added `Player.position String?` (FC Torpedo players are intentionally null).
- **`Venue`** — PR 1 added `url String?`, `courtSize String?`, and `name @unique`.
- **`GameWeek`** — `(leagueId, weekNumber) @@unique`. Has optional `venueId`.
- **`Match`** — PR 1 added `@@unique([gameWeekId, homeTeamId, awayTeamId])` so the upcoming backfill can `prisma.match.upsert` by natural key. Constraint is safe under T9L's 4-team round-robin (each pair plays once per MD); revisit if format ever allows the same pair to play twice in one MD.
- **`Goal`** + **`Assist`** — `Goal` cascades on `Match` delete; **does not cascade on `Player` delete** (deleting a Player with goals will FK-fail — admin "remove from league" only deletes `PlayerLeagueAssignment`, not `Player`).
- **`Availability`** *(new in PR 1)* — RSVP per `(playerId, gameWeekId) @@unique`. Two enums: `RsvpStatus { GOING, UNDECIDED, NOT_GOING }` and `ParticipatedStatus { JOINED, NO_SHOWED }`. Cascades on Player and GameWeek delete. Public-site RSVP route will dual-write to this table starting PR 3.
- **`Setting`** *(new in PR 1)* — `(category, key, leagueId) @@unique` composite. `leagueId IS NULL` rows are global; per-league rows override. Used by upcoming PR 3 to store `(public, dataSource) ∈ {sheets, db}` and `(public, writeMode) ∈ {sheets-only, dual, db-only}` toggles. Cascades on League delete.

The `directUrl` connection in `datasource db { ... }` reads from `DATABASE_URL_UNPOOLED` (matches the Neon-Vercel integration's canonical var name). The legacy `DIRECT_URL` var is also still set on production and Preview (dev) for backwards compatibility but no longer referenced by the schema.

## Testing

Two tools, both wired into `package.json` and CI.

| Stack | Purpose | Where |
|---|---|---|
| **Vitest** | Pure-function and module-level tests; run in CI on every PR | `tests/unit/**/*.test.ts(x)`; config in `vitest.config.ts` |
| **Playwright** | End-to-end tests against a base URL (defaults to `https://t9l.me`); run locally pre-merge for PR 3+ user-flow changes | `tests/e2e/**/*.spec.ts`; config in `playwright.config.ts`; override base URL with `BASE_URL=https://<preview>.vercel.app npm run test:e2e` |

Scripts:

```bash
npm test            # vitest watch
npm run test:run    # vitest one-shot (same as CI)
npm run test:e2e    # playwright against $BASE_URL (default https://t9l.me)
npm run test:ci     # vitest only (e2e is opt-in in CI for now)
```

CI workflow `.github/workflows/test.yml` runs `npm ci`, `prisma generate` (placeholder URLs — no DB connection needed for codegen), `tsc --noEmit`, then `vitest run`. PRs are merge-blocked on red.

What to add per change-type:

- **Pure-function or library change** (e.g. `lib/data.ts`, `lib/stats.ts`, parsers, mappers) → Vitest unit test with explicit input/output. Example: `tests/unit/slugify.test.ts`.
- **API route or server action change** → Vitest test that calls the handler directly (mock `next-auth` session if auth-gated); assert response status + body shape.
- **Public UI flow change** (anything visible at apex `/`, `/schedule`, `/stats`, `/admin`) → Playwright e2e covering the user-visible behavior. Run against the PR's preview URL (`BASE_URL=<preview>`) before requesting merge.
- **Backfill / migration script change** → Vitest unit tests for row mappers (Sheets row → Prisma create input). Integration test that runs the full backfill against the per-PR Neon branch DB and asserts row counts + spot-check fields.
- **Schema change** → No new test required for the migration itself (Prisma's `migrate deploy` covers correctness), but any code that reads new fields needs a unit or e2e test.

## Backups & rollback runbook

Every PR that ships ≥ PR 2 has four parallel rollback paths. Sequencing of *which* path to invoke depends on what broke.

### Layer 1 — Git tag reset (fastest if the bad change is the latest commit on `main`)
- Each PR's merge commit is tagged `v-pre-pr-<N+1>-<slug>` (e.g. `v-pre-pr-2-backfill` is the last-known-good before PR 2 merges).
- To revert main locally: `git fetch origin --tags && git reset --hard v-pre-pr-2-backfill`. **Do not push --force to main** — instead create a revert PR: `git revert <merge-sha>` and merge that.
- Tags are immutable; check listing with `git tag -l "v-pre-pr-*" -n1`.

### Layer 2 — Vercel deploy promotion (fastest if you need prod restored without waiting for CI)
- Vercel retains every prior production deploy. Each PR's "last good prod deploy URL" is recorded in this section as it lands.
- To promote a previous prod deploy back to current: `vercel promote <deploy-url>` (e.g. `vercel promote https://t9l-website-784a0vmrz-t9l-app.vercel.app`).
- This rolls back code + the running build only. Schema/data are unaffected — pair with Layer 3 if the issue was DB-side.

### Layer 3 — Neon branch restore (when the DB itself is wrong)
- Before each PR ≥ 2 merges, a snapshot Neon branch is cut from `production`: `neonctl branches create --name pre-pr-<N>-<slug> --parent production --project-id young-lake-57212861`. This captures the DB state pre-PR.
- To restore prod to the snapshot state: `neonctl branches restore production --source pre-pr-<N>-<slug> --project-id young-lake-57212861`. This is destructive on the current `production` branch — confirm with the operator before invoking.
- The connection URI for a snapshot branch (read-only inspection) is fetchable via `neonctl connection-string <branch-id> --project-id young-lake-57212861`.
- Project ID: `young-lake-57212861`. Default branch on Neon is named `production` (not `main`). Org: `org-floral-feather-76166317`.

### Layer 4 — Sheets snapshot (when public-site Sheets data needs reverting)
- Before PR 2 (the first PR after which dual-write or backfill could touch any data adjacent to Sheets), make a date-stamped duplicate of the source spreadsheet via Drive: File → Make a copy → name `T9L Roster Snapshot YYYY-MM-DD pre-pr-N`. Record the snapshot file ID below.
- Restore by copying values back from the snapshot to the live sheet (same tabs, same ranges).
- Source Sheet ID: `1BLTV9v518fEi3DXRA-qcYY3bLDm_qftNoY_5SNzjKSc`. Snapshots: *(none yet — PR 1 didn't touch Sheets; first snapshot will be cut before PR 2 merges).*

### Per-PR snapshot ledger

| PR | Merge commit | Git tag | Last-good prod deploy URL | Neon snapshot branch | Sheets snapshot |
|---|---|---|---|---|---|
| 1 | `87cc64f` | `v-pre-pr-2-backfill` | `https://t9l-website-784a0vmrz-t9l-app.vercel.app` | `pre-pr-2-backfill` (`br-frosty-night-aoczjbgo`, endpoint `ep-fancy-feather-aog9jjya`) | N/A — PR 1 didn't touch Sheets |

Keep this table append-only; future PRs add a row.

## Sheets→DB migration

Multi-PR cutover replacing Google Sheets with Neon Postgres as the source of truth for the public site. Plan: `/tmp/sheets-to-db-migration-plan.md` (v2, post-review).

Status:

- **PR 1 — Schema additions** ✅ shipped (`87cc64f`, 2026-04-27). Strictly additive: `Player.position`, `Team.shortName/color`, `Venue.url/courtSize`, `Venue.name @unique`, `Match @@unique`, `Availability` model + enums, `Setting` model. Public site behavior unchanged.
- **PR 1.5 — Testing + autonomy + runbook** *(this PR)* — Vitest, Playwright config, GitHub Actions CI, settings.json autonomy rules, this CLAUDE.md update.
- **PR 2 — Backfill script + DB→public adapter** — Pending. Adds `scripts/sheetsToDbBackfill.ts`, `lib/dbToPublicLeagueData.ts`, `lib/publicData.ts`, `lib/settings.ts`. Default `dataSource='sheets'` → no behavior change.
- **PR 3 — Toggle UI + RSVP dual-write** — Pending. Re-enables Settings tab, adds Data source / Write mode radios.
- **PR 4 — Operational toggle flip** — Pending. No code; flip `dataSource` to `db` via admin Settings on prod.
- **PR 5 — Retire Sheets path** — Pending; only after weeks of confidence post-PR-4.
