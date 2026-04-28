# CLAUDE.md

> **Current release:** v1.4.0 — Optimistic UI rewrite of the public assign-player flow. PRs 10/11/12 structurally cut latency from ~6s to ~3s but never made the click feel instant — the user still saw a "Saving…" → "Done — redirecting…" sequence followed by an RSC navigation. v1.4.0 makes the click perceived-instant via `useOptimistic`: the form is replaced by an inline success view ("✓ You're linked to {Player Name}" + team-color badge + "Go to home →" button) the moment the user clicks Confirm, before the API resolves. The auto-navigate to `/` is removed — the user pays the navigation cost on their own schedule. The Go-home button awaits the in-flight API write + next-auth `update()` if pressed before they settle (it briefly shows "Finalizing…"), so the destination never renders with a stale JWT — and on API failure the optimistic state reverts via `useOptimistic` end-of-transition semantics, the user stays on `/assign-player` with an error toast for retry. Helpers `lib/postAssignNavigate.ts` and `lib/kickOffSessionRefresh.ts` (both shipped in PRs 10/11) are removed because the new flow no longer auto-navigates. New unit tests in `tests/unit/optimisticLink.test.ts` pin the rollback gate (`attemptLink`/`attemptUnlink` discriminated-union return shape across 200/4xx/5xx/network-failure paths). Playwright spec tightened: success-view-visible-within-50ms-of-click target (DoD <50ms; assertion budget 150ms for CI jitter); plus a new case that stalls the API by 2s, clicks Confirm + Go-home immediately, and asserts the navigation defers until the pipeline settles. Minor bump (1.3.2 → 1.4.0) — UX behavior change. v1.3.2 (PR 12.5) — Docs-only follow-up to v1.3.1: backfilled the PR 12 ledger row (merge `9d51ed9`, prod `https://t9l-website-co1k0pqzm-t9l-app.vercel.app`) and captured the post-cutover cold/warm timing baseline against apex (unauth) — `/api/auth/session` 1.37s cold / 0.52s warm; `/` 1.82s cold / 0.99s warm; `/api/assign-player POST` (401) 1.89s cold / 0.51s warm. Each cold lambda is ~1–2s of fixed cost; the user's perceived "5–7s" assign-player hang was the sum of multiple cold round-trips serially. PRs 10/11/12 collectively remove two of them (the redundant `router.refresh()` and the awaited `update()`) plus 200–500ms of inline Blob upload, leaving the synchronous critical path at: API write (Prisma transaction + cache pre-warm + revalidate) + RSC navigation to `/`. Cold-most-of-the-time perception drops from ~5–7s to ~2–3s — but still not instant, which is what motivates v1.4.0. v1.3.1 (PR 12) — Third in the cold-lambda perceived-latency push on assign-player. Moves the LINE-profile-picture mirror (LINE-CDN fetch + Vercel Blob `put` + Redis SET + `Player.pictureUrl` update) off the API response critical path. Pre-fix the entire chain ran serially before the route returned, costing 200–500ms warm and meaningfully more cold on every assign that had a LINE picture. Now the synchronous part of the route is just the Prisma transaction (set `Player.lineId`) + cache pre-warm + revalidate; the picture work runs out of band via `waitUntil(uploadAndPersistLinePic(...))` from `@vercel/functions`. Background work calls `revalidateTag('public-data', { expire: 0 })` on success so the picture appears on the next page render instead of waiting up to 30s for `unstable_cache` to expire. Destination renders with `PlayerAvatar`'s built-in fallback chain (LINE CDN URL → `/player_pics/{name}.png` → `default.png`) until the upload completes — typically <1s in the background. Vitest in `tests/unit/assignPlayerBackgroundPic.test.ts` pins five contracts: `waitUntil` called exactly once when picture data is present, response returns 200 even when the put-Promise never resolves (the regression target — if the route awaits `put`, this test times out), Prisma transaction's `data` does NOT include `pictureUrl`, no `waitUntil` when `linePictureUrl` is empty, no `waitUntil` when `BLOB_READ_WRITE_TOKEN` is unset. Patch bump (1.3.0 → 1.3.1) — perf optimization, no semantic change to the link contract itself. Combined with PRs 10 (drop redundant `router.refresh()` + `startTransition`) and 11 (drop awaited `update()`), the assign-player critical path has lost two cold-startable round-trips and 200–500ms of inline blob work; what remains is the Prisma transaction + the cache pre-warm + revalidate calls. v1.3.0 (PR 11) prod: `https://t9l-website-36ub5hp2d-t9l-app.vercel.app`. Constant lives in `src/lib/version.ts`; bump there and update this line on each release.

> **Version-bump rule:** Every PR bumps `APP_VERSION` in `src/lib/version.ts` as part of the change.
> - Patch bump (1.1.0 → 1.1.1) — fixes, chores, refactors, docs.
> - Minor bump (1.1.0 → 1.2.0) — new user-visible features.
> - Major bump (1.1.0 → 2.0.0) — breaking changes / migrations of public contracts.
> The bump lives in the same commit as the change. The matching test in `tests/unit/version.test.ts` updates in the same commit. After merge, the autonomy post-merge sequence pushes an annotated release tag `v<APP_VERSION>` at the merge SHA — separate from the rollback tag (`v-pre-pr-N-...`).

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

**Auth/perf — JWT mapping cache.** `lib/auth.ts#getPlayerMapping` is fronted by `src/lib/playerMappingCache.ts` (Upstash, 60s TTL, `t9l:auth:map:` namespace, null sentinel). **Writes pre-warm, they do NOT invalidate** — every site that mutates `Player.lineId` (`api/assign-player` POST/DELETE, `admin/actions.ts#updatePlayer/createPlayer`, `admin/leagues/actions.ts#adminLinkLineToPlayer`) calls `setCached(lineId, freshMapping)` after the Prisma write, using the exported `getPlayerMappingFromDb` helper for shape parity with the JWT path. This is load-bearing: pre-PR-9 (v1.2.5) writes invalidated, which left the next `await update()` on the client paying the cold-Neon Prisma cost. If you're tempted to replace a `setCached` here with `invalidate`, read PR 9 first and the regression test in `tests/unit/assignPlayerCachePrewarm.test.ts`. The OLD lineId on `updatePlayer` is the deliberate exception (still `invalidate` — see comment there).

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
│   ├── playerMappingCache.ts         # Upstash cache-aside in front of getPlayerMapping (PR 8)
│   ├── optimisticLink.ts             # Pure I/O helpers for /assign-player (PR 13) — attemptLink/attemptUnlink rollback gate
│   ├── assignButtonLabel.ts          # Pure label/disabled state machine for confirm + unassign buttons
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
- **`LineLogin`** *(new in PR 6)* — Tracks every distinct LINE user that has authenticated against the public site, regardless of whether they've been linked to a Player record. Upserted from `lib/auth.ts#trackLineLogin` on every JWT callback that has a `lineId`. `lineId @unique` plus `@@index([lastSeenAt])` for sorted-by-recency orphan queries. Drives the admin "Assign Player" Flow B dropdown — orphan = `LineLogin` row whose `lineId` is not currently set on any `Player.lineId`. Powers `lib/admin-data.ts#getOrphanLineLogins()`.

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

| PR | Merge commit | Git tag (rollback target *for next PR*) | Prod deploy URL | Neon snapshot branch | Sheets snapshot |
|---|---|---|---|---|---|
| 1 (schema additions) | `87cc64f` | — (initial; tag was assigned to PR 1.5 below) | `https://t9l-website-784a0vmrz-t9l-app.vercel.app` | `pre-pr-2-backfill` (`br-frosty-night-aoczjbgo`, endpoint `ep-fancy-feather-aog9jjya`) | N/A |
| 1.5 (testing infra + runbook) | `7f32896` | `v-pre-pr-2-backfill` (rollback target for PR 2) | `https://t9l-website-8g700kpdn-t9l-app.vercel.app` | (reuses PR 1's snapshot — PR 1.5 didn't touch schema/data) | N/A — PR 1.5 didn't touch Sheets |
| 2 (backfill + adapter + dispatcher) | `6648654` | `v-pre-pr-3-toggle` (rollback target for PR 3) | `https://t9l-website-umcem26vd-t9l-app.vercel.app` | `pre-pr-3-toggle` (`br-dry-silence-aojekuoy`) — taken AFTER live backfill against prod Neon (4 teams, 53 players, 8 GWs, 24 matches, 67 availability rows new, 23 goals preserved per `--no-overwrite-goals`). Public site behavior unchanged because `dataSource` defaults to `'sheets'`. | N/A — PR 2 doesn't touch Sheets (RSVP dual-write lands in PR 3) |
| 3 (toggle UI + RSVP dual-write) | `e80cf44` | `v-pre-pr-4-toggle-flip` (rollback target for PR 4 — the operational flip) | `https://t9l-website-lm0wa9vhm-t9l-app.vercel.app` | `pre-pr-3-toggle` (`br-dry-silence-aojekuoy`) is the rollback target. Per-PR Neon branch verified: seed migration applied, both Setting rows present (`dataSource=sheets`, `writeMode=dual`). | Drive file `1c5BoySUsC829gku_bm9JFZ7wIGgKxROJj29Q8XG_eRI` ("T9L Roster Snapshot 2026-04-28 pre-pr-3"), full URL `https://docs.google.com/spreadsheets/d/1c5BoySUsC829gku_bm9JFZ7wIGgKxROJj29Q8XG_eRI/edit`. Restore by copy-pasting cell ranges back into the live sheet `1BLTV9v518fEi3DXRA-qcYY3bLDm_qftNoY_5SNzjKSc`. |
| 4 (operational flip — no code) | (no merge — operator action) | (no tag; cutover is reversible via setDataSource('sheets')) | unchanged from PR 3 (`https://t9l-website-lm0wa9vhm-t9l-app.vercel.app`) | `pre-pr-4-toggle-flip` (`br-morning-mode-aon72ghp`) — taken AFTER PR 3 merge but BEFORE the toggle flip, so it captures the post-PR-3 schema with `dataSource=sheets` still in place. Rollback to pre-flip state via `setDataSource('sheets')` from admin UI; restore Neon branch only if catastrophic. | (same Sheets snapshot from PR 3) |
| 5 (saving-stuck fix + version in LINE-user dropdown) | `d02a2ef` | `v-pre-pr-6-admin-assign` (rollback target for PR 6 — admin Flow B) | `https://t9l-website-7d6bxllcq-t9l-app.vercel.app` | N/A — PR 5 is UI-only, no schema change | N/A — PR 5 doesn't touch Sheets |
| 6 (admin assign-player Flow B + B1 Redis→Prisma migration + LineLogin model) | `12f5cbf` | `v-pre-pr-7-admin-assign` (rollback target for next PR) | `https://t9l-website-osi69ivex-t9l-app.vercel.app` | **Snapshot not taken** — Neon branch limit (10/10) at create time; additive-only schema change (single new `LineLogin` table, no alters to existing tables). Rollback = `DROP TABLE "LineLogin"` + code revert. Live Redis→Prisma backfill against prod ran clean post-merge: 34 scanned / 31 linked / 1 already-linked (stefan-s) / 1 conflict (`U86cccdcbbcc00e4a44d6bfbe7f280ed8` — second LINE ID on aleksandr-ivankov, kept the first) / 1 missing player (Redis `nikolai-akira-kawabata` not in DB roster) / 34 LineLogin rows. Retire `pre-pr-2-backfill` (`br-frosty-night-aoczjbgo`) next session when terminal access available. | N/A — PR 6 doesn't touch Sheets |
| 6.5 (chore — backfill PR 6 ledger row) | `9feba1c` | (no rollback tag — docs-only) | unchanged from PR 6 | N/A | N/A |
| 7 (saving-stuck UX fix v2 — `redirecting` state + state-machine helper) | `f50328b` | `v-pre-pr-8-jwt-cache` (rollback target for PR 8) | `https://t9l-website-1e4jty2dv-t9l-app.vercel.app` | N/A — PR 7 is UI-only, no schema change | N/A — PR 7 doesn't touch Sheets |
| 8 (Prisma-on-every-JWT perf fix — Upstash mapping cache) | `96d4605` | `v-pre-pr-9-jwt-cache` (rollback target for PR 9) | `https://t9l-website-gwukc7ljc-t9l-app.vercel.app` | N/A — PR 8 is code-only, no schema change | N/A — PR 8 doesn't touch Sheets |
| 9 (post-write pre-warm — closes the v1.2.3 invalidate-then-cold hole) | `f9f2db3` | `v-pre-pr-10-drop-refresh` (rollback target for PR 10 — created at PR 10's merge) | `https://t9l-website-q01pe7pnv-t9l-app.vercel.app` | N/A — PR 9 is code-only, no schema change | N/A — PR 9 doesn't touch Sheets |
| 10 (drop redundant `router.refresh()` + wrap navigation in `startTransition`) | `9f063af` | `v-pre-pr-11-drop-awaited-update` (rollback target for PR 11 — created at PR 11's merge) | `https://t9l-website-rm9wtk2pd-t9l-app.vercel.app` | N/A — PR 10 is code-only, no schema change | N/A — PR 10 doesn't touch Sheets |
| 11 (drop awaited `update()` — fire-and-forget session refresh off the critical path) | `6d37ca1` | `v-pre-pr-12-blob-bg` (rollback target for PR 12 — created at PR 12's merge) | `https://t9l-website-36ub5hp2d-t9l-app.vercel.app` | N/A — PR 11 is code-only, no schema change | N/A — PR 11 doesn't touch Sheets |
| 12 (move Vercel Blob upload off API critical path — `waitUntil`) | `9d51ed9` | (rollback target for PR 13 — created at PR 13's merge) | `https://t9l-website-co1k0pqzm-t9l-app.vercel.app` | N/A — PR 12 is code-only, no schema change | N/A — PR 12 doesn't touch Sheets |
| 12.5 (chore — backfill PR 12 ledger row + capture cold/warm timings) | `1e56aaf` | (no rollback tag — docs-only) | unchanged from PR 12 | N/A | N/A |
| 13 (optimistic UI rewrite of assign-player flow — useOptimistic + inline success view + no auto-nav + Go-home awaits pipeline) | TBD (filled post-merge) | (rollback target for PR 14 — created at PR 14's merge) | TBD | N/A — PR 13 is code-only, no schema change | N/A — PR 13 doesn't touch Sheets |

Keep this table append-only; future PRs add a row. **Rollback target convention:** the tag in row N points to the commit *before PR (N+1) was merged* — i.e. it's where you'd reset main to undo PR (N+1).

**Neon branch hygiene rule.** Snapshots older than 5 PRs ago can be retired by the active session as needed to free Neon branch slots; the active per-PR snapshot is sufficient for forward rollback (Layer 1 git tag + Layer 2 Vercel deploy promotion still cover the older windows). Each retirement gets a one-line note in the ledger row of the snapshot being retired AND in the row of the PR that retired it.

### Operational events

One-shot ops on shared systems (Redis cleanup, Sheets edits, manual DB writes outside a migration) get a dated line here. No PR / no version bump for pure data-only events; record what was done so future sessions can audit.

- **2026-04-28** — Dropped orphan Redis `line-player-map` entries surfaced by PR 6 backfill: Aleksandr Ivankov's second LINE ID (`U86cccdcbbcc00e4a44d6bfbe7f280ed8` — kept the first) and Nikolai Akira Kawabata's mapping (`U02a29d4afc55535ffb990aabe9080e65` — player not in current DB roster). Also DEL'd legacy slug-keyed `player-pic:nikolai-akira-kawabata` (the U86c and U02a29 LINE-ID-keyed pics didn't exist). HLEN before 33 → after 31. Verified both HGETs return null.

## Sheets→DB migration

Multi-PR cutover replacing Google Sheets with Neon Postgres as the source of truth for the public site. Plan: `/tmp/sheets-to-db-migration-plan.md` (v2, post-review).

Status:

- **PR 1 — Schema additions** ✅ shipped (`87cc64f`, 2026-04-27). Strictly additive: `Player.position`, `Team.shortName/color`, `Venue.url/courtSize`, `Venue.name @unique`, `Match @@unique`, `Availability` model + enums, `Setting` model. Public site behavior unchanged.
- **PR 1.5 — Testing + autonomy + runbook** ✅ shipped (`7f32896`, 2026-04-27). Vitest, Playwright config, GitHub Actions CI, `.claude/settings.json` autonomy rules, runbook.
- **PR 2 — Backfill script + DB→public adapter** ✅ shipped (`6648654`, 2026-04-27). Live backfill ran clean against prod Neon: 4 teams + 53 players (41 with positions) + 8 game weeks + 24 matches + 67 availability rows. Goals preserved per `--no-overwrite-goals` default. Re-runs are idempotent (verified). Default `dataSource='sheets'` → public site behavior byte-equivalent to PR 1.5.
- **PR 3 — Toggle UI + RSVP dual-write** ✅ shipped (`e80cf44`, 2026-04-27). Re-enables Settings tab, adds Data source / Write mode radios + `setDataSource`/`setWriteMode` server actions. RSVP route rewritten per C4 (DB-first dual-write, fail-fast on DB error, log-and-continue on Sheets error in dual mode). `revalidatePublicData()` wired into all 21 admin server actions. `Setting` rows seeded.
- **PR 4 — Operational toggle flip** ✅ executed 2026-04-27 16:48 UTC. Operator drove the admin Settings UI on prod, flipped `dataSource` from `sheets` to `db`. Verified: Setting row updated (`dataSource=db`, `updatedAt: 2026-04-27T16:48:55.064Z`), apex began reading from DB within ~30s SWR cycle. **MD9 expanded smoke** ran end-to-end: created MD9 (`gw-minato-2025-9`, date 2026-08-01) + 2 matches (Mariners 2-1 Fenix completed; Hygge vs Torpedo scheduled) + 1 goal (Ian Noseda, assist Vernieri Luca) + 1 Availability row (Ian Noseda RSVP=GOING). Apex correctly rendered the new MD9 entry with score, goal mapping (scorer/assister names + scoring/conceding teams), JST kickoff/fullTime formatting (`19:05`/`19:40`), and availability status. Test data cleaned up post-verification; apex returned to MD1–MD8 only. **Cutover stayed in place — `dataSource='db'`**, `writeMode='dual'` (Sheets continues receiving RSVP writes as redundant store). Caveat: dual-write code path was unit-tested in PR 3 but not exercised end-to-end (no public RSVP submission via LINE OAuth in this run); first real RSVP post-flip is the live test.
- **PR 5 — Saving-stuck fix + APP_VERSION in LINE-user dropdown** ✅ shipped (`d02a2ef`, 2026-04-28). Patch release; no schema change. Two small public-site UI fixes bundled.
- **PR 6 — Admin assign-player Flow B + B1 Redis→Prisma migration + LineLogin model** ✅ shipped (`12f5cbf`, 2026-04-28). Adds `LineLogin` Prisma model populated from `lib/auth.ts` JWT callback. Public self-assign route (`api/assign-player/route.ts`) writes `Player.lineId` (atomic transaction with @unique-collision clear); legacy Redis `line-player-map` writes removed. `lib/auth.ts#getPlayerMapping` now reads Prisma first, falls back to Redis with a `[auth] DEPRECATED Redis hit` warn (deprecation window — remove in PR 7+ after soak with zero hits). New admin server action `adminLinkLineToPlayer` + `AssignLineDialog.tsx` modal in PlayersTab. `scripts/backfillRedisLineMap.ts` reads the legacy hash and upserts `Player.lineId` + `LineLogin`; idempotent, skips conflicts. Post-merge live backfill against prod: 34 scanned / 31 linked / 1 already / 1 conflict / 1 missing / 34 LineLogin rows.
- **PR 7 — Saving-stuck UX fix v2** ✅ shipped (`f50328b`, 2026-04-28). PR #50 (v1.1.2) added `router.refresh()` after `router.push()` but only addressed RSC cache staleness, not the perceived hang. Real root cause: the `submitting` flag spanned API write + next-auth `update()` + `router.push` + destination RSC re-render — under the post-cutover Prisma-on-every-JWT auth path that's 5–7 seconds. Fix: extract pure state-machine helpers in `src/lib/assignButtonLabel.ts`, introduce a separate `redirecting` flag that takes precedence; flip `submitting → redirecting` the moment the API write resolves. Button leaves "Saving…" within ~1s of API success regardless of how slow navigation is. Vitest pins the precedence rules; Playwright spec documents the local-dev manual repro.
- **PR 8 — Prisma-on-every-JWT perf fix** ✅ shipped (`96d4605`, 2026-04-28). New `src/lib/playerMappingCache.ts` (Upstash, 60s TTL, `t9l:auth:map:` namespace, null sentinel for unmapped IDs) wraps `lib/auth.ts#getPlayerMapping`. Cache is busted at every Prisma `Player.lineId` write site: `api/assign-player` POST + DELETE, `admin/actions.ts#updatePlayer` (invalidates both old and new), `admin/actions.ts#createPlayer`, `admin/leagues/actions.ts#adminLinkLineToPlayer`. Local A/B against the dev preview Neon branch (Tokyo→Singapore network, real Upstash, line-mock session): `/api/auth/session` median 264ms → 108ms, max 1369ms → 379ms — ~60% reduction at p50, ~72% at tail. Cold-Vercel-lambda magnitude (1–3s pre-fix) not reproducible locally; relative improvement is the directional signal. Vitest covers cache-hit, cache-miss, null sentinel, invalidate, Redis-unavailable, and Redis-error fall-through paths. **Caveat addressed by PR 9:** the cache was busted on every write, so the read inside `await update()` *immediately following* a write was unconditionally cold — i.e. exactly the post-assign latency users complained about post-v1.2.3.
- **PR 9 — Post-write pre-warm (closes the invalidate-then-cold hole)** ✅ shipped (`f9f2db3`, prod `https://t9l-website-q01pe7pnv-t9l-app.vercel.app`, 2026-04-28). Replaces `invalidate(lineId)` with `setCached(lineId, freshMapping)` at every `Player.lineId` write site: `api/assign-player` POST sets the post-write `{ playerId, playerName, teamId }` (slug-only, no `p-`/`t-` prefix); DELETE sets the null sentinel; `admin/leagues/actions.ts#adminLinkLineToPlayer` and `admin/actions.ts#createPlayer` fetch the post-write shape via the now-exported `lib/auth.ts#getPlayerMappingFromDb` helper for shape parity with the JWT callback; `admin/actions.ts#updatePlayer` keeps `invalidate` for the OLD lineId (deliberate — that user's mapping is now `null`-on-this-player and the conservative fall-through to Prisma is fine) and pre-warms the NEW lineId. The post-assign `await update()` on the client now hits cache and returns within the v1.2.3 warm-cache envelope (median 108ms / max 379ms in the v1.2.3 A/B) instead of cold-pathing to 1–3s. New regression-prevention tests in `tests/unit/assignPlayerCachePrewarm.test.ts` (POST → setCached with slug-only mapping; DELETE → setCached with null; neither calls invalidate) and a "post-write pre-warm contract" suite added to `tests/unit/playerMappingCache.test.ts`. Auth/perf section in CLAUDE.md updated with a "writes pre-warm, do NOT invalidate" sticky note.
- **PR 10 — Drop redundant `router.refresh()` + wrap navigation in `startTransition`** ✅ shipped (`9f063af`, prod `https://t9l-website-rm9wtk2pd-t9l-app.vercel.app`, 2026-04-28). First in a multi-PR push targeting cold-lambda perceived latency on assign-player. Removes the second RSC fetch that was firing after every assign/unassign because the API route already calls `revalidatePath('/') + revalidateTag('public-data', { expire: 0 })` server-side; Next propagates that to the client router cache on next navigation, making `router.refresh()` strictly redundant. Under cold-lambda steady-state that redundant fetch was a 1–3s critical-path round-trip. Navigation extracted to `src/lib/postAssignNavigate.ts`; Vitest pins the call shape (push exactly once with `'/'`, `refresh` never, both inside the transition callback) in `tests/unit/postAssignNavigate.test.ts`. Vercel preview build hit the documented Neon-Vercel race (`P1012` / `DATABASE_URL_UNPOOLED`); admin-merged per runbook because Unit + type-check was green. Prod deploy clean.
- **PR 11 — Drop awaited `update()` — fire-and-forget session refresh** ✅ shipped (`6d37ca1`, prod `https://t9l-website-36ub5hp2d-t9l-app.vercel.app`, 2026-04-28). Replaces `await update()` between API success and `postAssignNavigate` with a fire-and-forget call via the new `kickOffSessionRefresh` helper. Pre-fix the user's critical path serialized API write → `/api/auth/session` round-trip → navigation; under cold-lambda steady-state the `update()` request itself can spin up its own cold lambda for 1–3s, on top of the API write's cold start. Now the refresh runs in parallel with navigation. Brief stale-flash on slow refetches accepted (next-auth client-cache catches up within ~1s — affects `Dashboard` "Playing as" badge, RSVP bar, etc.). Helper at `src/lib/kickOffSessionRefresh.ts`; Vitest in `tests/unit/kickOffSessionRefresh.test.ts` pins three contracts: update called exactly once, helper returns synchronously without awaiting (regression target — re-introducing `await` fails the test), rejections swallowed via console.warn. Playwright timing tightened from 1000ms to 200ms (Definition of Done). Minor bump (1.2.7 → 1.3.0) — auth-flow semantics change. Vercel preview hit Neon-Vercel race; admin-merged per runbook (Unit + type-check green).
- **PR 12 — Move Vercel Blob upload off API critical path** ✅ shipped (`9d51ed9`, prod `https://t9l-website-co1k0pqzm-t9l-app.vercel.app`, 2026-04-28). Schedules the LINE-profile-picture mirror (LINE-CDN fetch + Blob `put` + Redis SET + `Player.pictureUrl` update) as background work via `waitUntil` from `@vercel/functions`. Pre-fix the entire chain ran serially in the route handler before responding — 200–500ms warm and meaningfully more cold per assign with a LINE picture. Now only the Prisma transaction (lineId) + cache pre-warm + revalidate are on the response path; pictures land out of band, with `revalidateTag('public-data', { expire: 0 })` inside the background task so the new URL appears on the next render instead of waiting up to 30s for `unstable_cache` to expire. Destination uses `PlayerAvatar`'s fallback chain (LINE CDN URL → static `/player_pics/{name}.png` → `default.png`) for the brief gap. Vitest in `tests/unit/assignPlayerBackgroundPic.test.ts` pins five contracts including a hang-test (response returns even when `put` never resolves — proves no `await`). New dep: `@vercel/functions ^3.4.4`. Patch bump (1.3.0 → 1.3.1) — perf optimization, no semantic change. Vercel preview hit Neon-Vercel race; admin-merged per runbook (Unit + type-check green).
- **PR 12.5 — Ledger backfill + cold/warm timing capture** ✅ shipped (TBD merge SHA, 2026-04-28). Docs-only follow-up. Backfills PR 12's merge SHA + prod URL. Captures unauthenticated cold/warm timings on apex (post-PR-12) for the rough cold-lambda budget — `/api/auth/session` 1.37s cold / 0.52s warm, `/` 1.82s cold / 0.99s warm, `/api/assign-player POST` (401) 1.89s cold / 0.51s warm. Each cold lambda spin-up is roughly a second of fixed cost; the perceived "5–7s" the user reported was the sum of multiple cold round-trips on the assign-player flow (API write → `update()` → push → refresh = 4 round-trips × ~1.5s cold). PRs 10/11/12 collectively remove two of those round-trips (refresh, awaited update) and 200–500ms of inline blob work, so the post-PR critical path under cold-most-of-the-time should be ~2–3s instead of ~5–7s. Patch bump (1.3.1 → 1.3.2).
- **PR 13 — Optimistic UI rewrite of assign-player** ✅ shipped (TBD merge SHA, prod TBD, 2026-04-28). Replaces the auto-navigate-on-success pattern with `useOptimistic` + an inline success view rendered on `/assign-player`. The moment the user clicks Confirm, the form is replaced by "✓ You're linked to {Player Name}" with the team's color badge and a "Go to home →" button — *before* the API write resolves, fitting the <50ms perceived-instant DoD. Auto `router.push('/')` removed: the user pays the navigation cost on their schedule. The Go-home button awaits the in-flight API + next-auth `update()` if pressed before they settle (briefly shows "Finalizing…"), guaranteeing the destination renders with a fresh JWT — never with stale linkage data. On API failure, `useOptimistic` reverts the optimistic value to the committed value (`null`) at end-of-transition, and the error is surfaced with a "Wrong player? Undo" affordance on the success view; the user stays on `/assign-player` to retry. New helper `src/lib/optimisticLink.ts` owns the I/O boundary as the rollback gate (pure `attemptLink` / `attemptUnlink` returning `{ ok: true, ... } | { ok: false, error }`); component owns the optimistic state. Helpers `lib/postAssignNavigate.ts` and `lib/kickOffSessionRefresh.ts` (PRs 10/11) and their tests are deleted — the new flow no longer auto-navigates and the next-auth refresh is captured into a ref for Go-home to await rather than fire-and-forget. New unit tests in `tests/unit/optimisticLink.test.ts` (200 + 4xx-with-body + 4xx-no-body + network-throw + non-Error throw paths for both link/unlink). `tests/unit/assignButtonLabel.test.ts` updated for the simplified state machine (no `redirecting` state). Playwright spec replaced: success-view-visible-within-50ms-of-click DoD assertion (CI budget 150ms), plus a 2s-stall test that verifies Go-home awaits the pipeline before navigating. Minor bump (1.3.2 → 1.4.0) — UX behavior change (auto-redirect → inline success view).
- **PR 14+ — Retire Sheets path + remove Redis line-player-map fallback** — Pending; only after weeks of confidence operating on `dataSource='db'` AND zero `[auth] DEPRECATED Redis hit` log entries. Will switch `writeMode` to `'db-only'`, delete the legacy Sheets reads, and remove `getPlayerMappingFromRedis` from `lib/auth.ts`.

### How to run the backfill

\`\`\`bash
# Pull production env (or per-branch preview env via vercel env pull)
vercel env pull .env.production --environment=production --yes

# Source DB connection vars
grep -E '^(DATABASE_URL|DATABASE_URL_UNPOOLED|GOOGLE_)' .env.production > /tmp/bf.env
set -a; source /tmp/bf.env; set +a; rm /tmp/bf.env

# Always preview first
npx ts-node --project tsconfig.scripts.json scripts/sheetsToDbBackfill.ts --dry-run --verbose-diff

# Then run for real (defaults are safe: no goal overwrites, availability merge mode optional)
npx ts-node --project tsconfig.scripts.json scripts/sheetsToDbBackfill.ts

# To recreate goals (destructive — only if Sheets is the trusted source AND you've staged a Neon snapshot):
npx ts-node --project tsconfig.scripts.json scripts/sheetsToDbBackfill.ts --allow-overwrite-goals

# To preserve in-flight RSVPs during the dual-write window (PR 3+):
npx ts-node --project tsconfig.scripts.json scripts/sheetsToDbBackfill.ts --availability-merge
\`\`\`

### How to run the Redis → Prisma backfill (PR 6)

One-time migration of the legacy Upstash Redis `line-player-map` hash into `Player.lineId` + `LineLogin`. Run AFTER PR 6's preview deploy verifies, BEFORE merging — so prod's first request post-cutover hits an already-populated table.

\`\`\`bash
# Pull preview env first to validate against the per-PR Neon branch
vercel env pull .env.preview --environment=preview --yes \\
  --git-branch=feat/admin-assign-player-flow-b
grep -E '^(DATABASE_URL|DATABASE_URL_UNPOOLED|KV_REST_API_)' .env.preview > /tmp/bf6.env
set -a; source /tmp/bf6.env; set +a; rm /tmp/bf6.env
npx ts-node --project tsconfig.scripts.json scripts/backfillRedisLineMap.ts --dry-run --verbose
npx ts-node --project tsconfig.scripts.json scripts/backfillRedisLineMap.ts --verbose

# Then repeat against prod env BEFORE merging PR 6
vercel env pull .env.production --environment=production --yes
grep -E '^(DATABASE_URL|DATABASE_URL_UNPOOLED|KV_REST_API_)' .env.production > /tmp/bf6p.env
set -a; source /tmp/bf6p.env; set +a; rm /tmp/bf6p.env
npx ts-node --project tsconfig.scripts.json scripts/backfillRedisLineMap.ts --dry-run --verbose
npx ts-node --project tsconfig.scripts.json scripts/backfillRedisLineMap.ts --verbose
\`\`\`

Idempotent: re-runs are safe. Reports `LINK / SKIP / CONFLICT / MISSING` per Redis row plus a summary. The script also upserts `LineLogin` rows for every Redis entry so the historical population shows up in the admin Flow B dropdown.

## Known infra issues

### Neon-Vercel preview env race

**Symptom:** Vercel preview build fails on the first deploy of a new PR branch with:

\`\`\`
Error code: P1012
error: Environment variable not found: DATABASE_URL_UNPOOLED.
prisma/schema.prisma:8 — directUrl = env("DATABASE_URL_UNPOOLED")
\`\`\`

The Vercel build runs `prisma migrate deploy` immediately on push, but the Neon-Vercel marketplace integration's per-branch DB provisioning (which injects `DATABASE_URL` + `DATABASE_URL_UNPOOLED` for the new git branch) hasn't completed yet. Build dies in ~6 seconds.

**Hit on PRs 43, 47, 48** so far. Pattern: small change → fast push → first build wins the race against the integration. Larger PRs (PR 44, 45, 46) provisioned in time and built clean.

**Workaround in use:** if `Unit + type-check` is green on the PR (i.e. the change itself isn't broken — only the env wiring is missing), admin-merge via `gh pr merge <num> --admin --merge`. The merge to main triggers a prod deploy that uses the production Neon env (always provisioned), so prod always builds clean. We've done this on PR 47 and 48; the autonomy rule is otherwise strict on Vercel green.

**Proposed fix (future session):**
1. Investigate the Neon-Vercel integration provisioning latency. The integration may have a "pre-provision on PR open" setting we're missing.
2. Alternative: set `DATABASE_URL_UNPOOLED` as a non-Neon-managed branch-scoped env var (mirror prod's value) so new branches inherit it from a project-default instead of waiting on the integration. This re-introduces the prod-creds-on-preview risk we removed earlier — would need careful scoping (e.g. only point at a shadow/dev Neon DB, not prod).
3. Alternative: drop `prisma migrate deploy` from `npm run build` and run it as a separate Vercel build step gated on env-var presence. Decouples the build from migrations for branches that don't need DB access.

Tracked as a chore for the next session; not load-bearing on the migration work shipped through v1.1.1.

### Neon free-tier branch limit

Project `young-lake-57212861` is capped at **10 concurrent Neon branches** (free-tier limit). When `neonctl branches create` returns `branches limit exceeded`, the active session is blocked from cutting a new pre-PR snapshot.

**When this hits:**
- **Additive-only PRs** (e.g. PR 6's new `LineLogin` table — no alters to existing rows/columns) **may proceed without a Layer-3 snapshot**, with an explicit "Snapshot not taken" note in the ledger row including the rollback recipe (typically `DROP TABLE "X"` + code revert). Layers 1–2 (git tag + Vercel deploy promotion) still apply.
- **Non-additive PRs** (column drops, type changes, data migrations, anything that mutates existing rows) **must wait for cleanup** before merging — invoke the Neon branch hygiene rule above to retire an older snapshot, then cut the pre-PR branch normally.

Hit on PR 6 (auto session — couldn't prune because `Bash(neonctl branches delete*)` is denied in `.claude/settings.json` and the user wasn't at the terminal). PR 6 was additive-only so it proceeded without the snapshot; pre-pr-2-backfill is queued for retirement next session.
