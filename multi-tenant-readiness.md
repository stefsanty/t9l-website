# Multi-Tenant Readiness Audit

Audit of `t9l-website` for migrating to a multi-tenant model where each league location gets its own subdomain (`shinjuku.t9l.me`) with row-level isolation against a shared DB. League is the tenant — already a model in Prisma.

## TL;DR

- **Subdomain routing already exists for `/`, but no other public route honors it.** `/schedule`, `/stats`, `/assign-player`, `/api/assign-player`, `/api/rsvp` all read the default league regardless of host. `/api/rsvp` literally hardcodes `LEAGUE_ID = 'l-minato-2025'`.
- **Three load-bearing models lack `leagueId`**: `Venue`, `Player`, `Team`. `Player.lineId @unique` is a global constraint that breaks if one human plays in multiple leagues.
- **Server actions are riddled with IDOR-shaped tenancy gaps**: most actions on `Match`/`GameWeek`/`Goal` accept an `id` from the client and Prisma `update`/`delete` by that id without verifying it belongs to the supplied (or session-bound) league.
- **Auth has no tenant context.** `session.isAdmin` is a global boolean from `ADMIN_LINE_IDS`; JWT carries no `leagueId` or per-league role.
- **Tests are well-mocked but assert zero tenant isolation.** Adding `where: { leagueId }` everywhere will compile + pass current tests without proving anything.

## Already Compatible

- **Schema FK plumbing** — `League → GameWeek → Match → Goal/Assist/Availability` all carry the `leagueId` chain (`prisma/schema.prisma:121–222`). The data model is ready; the queries are not.
- **Subdomain extraction** — `src/lib/getLeagueFromHost.ts` parses `host` correctly for `sub.t9l.me` and `sub.dev.t9l.me`. Works as-is for the homepage.
- **Per-league admin pages** — Everything under `src/app/admin/leagues/[id]/{schedule,players,teams,settings,stats}` is correctly scoped via the route param.
- **`League.subdomain @unique`** — `prisma/schema.prisma:45`. Lookup index exists.
- **All ids are CUIDs** — globally unique without coordination, so the RSVP Redis namespace (`t9l:rsvp:gw:<gameWeekId>`) is incidentally tenant-safe.
- **Cache-bust helper** — `src/lib/revalidate.ts` already centralizes invalidation. Single seam for adding tenant-scoped tags later.
- **NextAuth doesn't lock OAuth callback to a host** — auto-derives from request origin, so `*.t9l.me` subdomains can share one LINE OAuth registration if you accept multiple redirect URIs at the LINE Developer Console (one per subdomain) or canonicalize OAuth to apex.

## Blocking Issues

Must fix before starting the migration. File · why · fix shape.

### 1. `/api/rsvp` hardcodes the league
**File:** `src/app/api/rsvp/route.ts:14, 175, 180`
**Why:** `const LEAGUE_ID = 'l-minato-2025'` (a string literal that doesn't even match a real `League.id` cuid — likely dead path or referring to slug-form). Used in the `gameWeek.findUnique` lookup. Every subdomain will write to whichever league this resolves to (or 404).
**Fix:** Resolve `leagueId` from the host on every request. Reuse `getLeagueFromHost()`. Refuse the request when the host has no matching league.

### 2. Public dashboard data path locked to `isDefault: true`
**File:** `src/lib/dbToPublicLeagueData.ts:76`
**Why:** `getFromDb` filters `prisma.league.findFirst({ where: { isDefault: true } })`. `getPublicLeagueData()` (`src/lib/publicData.ts:193`) takes no arguments. Every page that calls it (`/schedule`, `/stats`, `/assign-player`) ignores subdomain.
**Fix:** Pass `leagueId` (or the resolved League) into `getPublicLeagueData(leagueId)` / `dbToPublicLeagueData(leagueId)`. Page server components call `getLeagueFromHost()` first, then thread the id down. Cache key must include the id (`unstable_cache(... ['public-data:db', leagueId], ...)` or a function-form key).

### 3. `Player.lineId @unique` is global
**File:** `prisma/schema.prisma:95`
**Why:** A LINE user playing in two leagues cannot map to two `Player` rows. The whole link/RSVP flow keys off this. Forces a product decision (see Decisions Required).
**Fix:** Either (a) drop `@unique` and replace with `@@unique([leagueId, lineId])` after adding `Player.leagueId` and per-league `Player` rows, or (b) keep `Player` global but make the auth lookup return a list of `(leagueId, playerId)` pairs and pick by host.

### 4. Player picture Redis cache collides on slug
**File:** `src/app/api/assign-player/route.ts` (writes `player-pic:<slug>`), `src/app/stats/page.tsx` (reads `mget`)
**Why:** Slug is `slugify(Player.name)`. Two leagues with an "Ian Noseda" overwrite each other's blob URL. Already broken latent.
**Fix:** Prefix with league: `player-pic:<leagueId>:<slug>` at both sites. One-shot migration: re-derive on next link, or backfill from `Player.pictureUrl`.

### 5. Server actions take ids without ownership checks (IDOR + tenancy)
**Files & symbols:**
- `src/app/admin/leagues/actions.ts` — `updateMatch`, `deleteMatch`, `updateGameWeek`, `deleteGameWeek`, `removePlayerFromLeague` (all accept `leagueId` as a param but only use `id` in the Prisma `where`).
- `src/app/admin/actions.ts` — `updateMatchScore`, `addGoal`, `deleteGoal`, `updatePlayer`, `createPlayer` (no league context at all).
**Why:** A logged-in admin can mutate any league's data by guessing/observing ids. Trivially exploitable today *if* you have multiple leagues; latent because there's effectively one. Will be the first thing a security review flags.
**Fix:** Every action that takes a resource id must `findUnique` first, assert `record.leagueId === expectedLeagueId`, then mutate. Or use a compound `where: { id, leagueId }` (Prisma `update` rejects when no row matches). For `admin/actions.ts` actions that take no league, bind via session/route context instead of trusting the form payload.

### 6. `getLeague()` returns "first league by createdAt"
**File:** `src/lib/admin-data.ts:202` — `prisma.league.findFirst({ orderBy: { createdAt: 'asc' } })`
**Why:** Drives `/admin/settings` (the unscoped one). Picks an arbitrary tenant. Dangerous footgun in a multi-league world — you'd unknowingly edit league A's settings while reading league B.
**Fix:** Delete `getLeague()`. Move `/admin/settings` under `/admin/leagues/[id]/settings/` or remove it. There's already a per-league settings page.

### 7. Global admin pages leak across leagues
**Files & paths:**
- `src/app/admin/players/page.tsx` → `getAllPlayers()` (`admin-data.ts:236`)
- `src/app/admin/matches/page.tsx` → `getMatchesWithGoals()` (`admin-data.ts:247`)
- `src/app/admin/venues/page.tsx` → `getAllVenuesWithUsage()` (global; v1.18.0)
- `src/app/admin/settings/page.tsx` → `getLeague()` (see #6)
**Why:** These pages render rows from every league with no filter. As soon as a second league exists they expose cross-tenant data in the admin UI.
**Fix:** Either move each under `/admin/leagues/[id]/...`, or scope each query to a session/route-bound league. Venues are a separate decision (see Decisions Required #2).

## Prep Work

Non-blocking but will compound if deferred.

- **No middleware-level league resolution.** `src/middleware.ts` only handles admin auth (`withAuth`). Adding tenant resolution here (parse host → set `x-league-id` request header → read in pages via `headers()`) is the canonical Next 15 pattern and would let you delete repeated `getLeagueFromHost()` calls in every page. Doing it later means refactoring every public page twice.
- **`getLeagueFromHost()` does one Prisma round-trip per request, uncached.** `src/lib/getLeagueFromHost.ts:41`. Wrap in `unstable_cache` keyed on subdomain (TTL 60s) before this is on the hot path for every page.
- **`baseDomains` whitelist hardcodes `vercel.app`.** `src/lib/getLeagueFromHost.ts:27`. Vercel preview URLs (`t9l-website-xxx.vercel.app`) won't match a subdomain — fine for previews to fall back to default. But preview testing of subdomain routing will require a dedicated preview domain or `x-forwarded-host` override.
- **Hardcoded `t9l.me` in admin UI:** `src/components/admin/CreateLeagueModal.tsx:122,129`, `src/components/admin/SettingsTab.tsx:217,270`, `src/app/admin/page.tsx:68`, `src/app/admin/leagues/[id]/layout.tsx:72,77`. Externalize as `NEXT_PUBLIC_ROOT_DOMAIN` so dev/staging environments don't show prod URLs.
- **`/minato` and `/shinagawa` AppSheet redirects in `next.config.ts:18–32`.** These will collide with the subdomain pattern (`minato.t9l.me`). Decide whether to keep them as apex-only legacy links, move them, or delete them.
- **`Setting` table already has `leagueId @nullable`** (`schema.prisma:228`). Global rows currently exist (`leagueId IS NULL` for `dataSource`/`writeMode`). Decide whether per-league overrides are the model going forward and document the precedence rule clearly somewhere admins can see.
- **`Team` is global, joined via `LeagueTeam`.** Probably fine as-is — teams are brand identities (Mariners FC plays across multiple leagues) — but the `Team` admin UI (`/admin/leagues/[id]/teams`) needs to be clear about whether editing a team's name/color affects every league it plays in.
- **`LineLogin` is global** (`schema.prisma:255`). Acceptable — it's tracking distinct LINE users, not league membership — but the orphan-pick UI in remap dialogs shows users who may belong to a different league. Surface that in the UI.
- **Tests don't enforce tenant filters.** Add a small set of tests that mock Prisma and assert every admin-data query passes `where.leagueId`. Otherwise grepping for `leagueId` is your only safety net during refactor.

## Decisions Required

### 1. Player identity model — global vs per-league
**Status quo:** `Player` is global; `Player.lineId @unique`; `PlayerLeagueAssignment` does the league join.

**Option A — keep `Player` global, drop `lineId @unique`, add `(leagueId, lineId)` per-assignment.**
Pros: a human stays one row; profile picture, name edits propagate. Auth lookup returns "which player are you in *this* league" by joining lineId → assignments → leagueId.
Cons: requires reworking `getPlayerMappingFromDb`, the Redis mapping store, and every place `lineId` is read. The mapping is now host-dependent.

**Option B — make `Player` per-league** (add `Player.leagueId` FK, allow same human to be N rows).
Pros: cleanest tenant isolation, simplest Prisma queries (`where: { leagueId }` everywhere).
Cons: human edits (rename, photo) duplicate per league; cross-league stats become a manual join. PlayerLeagueAssignment becomes redundant.

Recommendation: **Option A** if a meaningful fraction of players actually play in multiple leagues; Option B if leagues are largely disjoint cohorts. Cheaper migration is A (FKs already exist via PlayerLeagueAssignment). Worth ~2 days.

### 2. Venue model — global vs per-league
**Status quo:** `Venue` is global; `name @unique` (`schema.prisma:28`).

**Option A — keep global, restrict admin access to "venue editor" role.** Venues are physical places; doesn't make sense to duplicate "Tennozu Pitch" across leagues.
**Option B — add `leagueId` FK; each league owns its venues.** Operationally simpler — each league admin manages their own list.

Recommendation: **A**, but move venue admin to a top-level `/admin/venues` page outside per-league navigation, and gate it on a "super-admin" role. The `name @unique` constraint is fine.

### 3. Admin role — global vs per-league
**Status quo:** `session.isAdmin` is a single boolean, sourced from `ADMIN_LINE_IDS` env var. There is no `LeagueAdmin` model.

**Option A — keep global super-admin only.** Same humans manage every league. Simplest.
**Option B — add `LeagueAdmin { userId, leagueId, role }`** join table; JWT carries `adminLeagueIds: string[]`.

Recommendation: **A** for v1 of multi-tenant; revisit when you onboard a league run by people who shouldn't see other leagues. JWT shape change is the gate.

### 4. League resolution placement — middleware vs per-page
**Option A — middleware injects `x-league-id` header.** Pages read from `headers()`. One source of truth.
**Option B — every page calls `getLeagueFromHost()` inline.** Status quo, but extended to all public pages.

Recommendation: **A**. Less repetition, single place to put the fall-through behavior (apex → default league), and lets you cleanly enforce "no public page may render without a resolved tenant."

### 5. Apex behavior post-migration
The default league at `t9l.me` is currently the T9L 2026 Spring league. Options:
- Keep apex serving the default league (current behavior).
- Make apex a marketing / league-picker landing page; force every league onto a subdomain.
- 301 the default league's apex traffic to its subdomain.

This is a product call, not technical, but it affects the migration's user-visible cutover.

## Operational Prep

- **Wildcard DNS:** Add `*.t9l.me` A/CNAME pointing at the Vercel project. Vercel needs `*.t9l.me` added as a project domain (Vercel Pro+ supports wildcard domains; verify your plan).
- **TLS:** Vercel auto-provisions Let's Encrypt for added subdomains, but wildcard certs require Pro and explicit `*.t9l.me` configuration. Confirm before launch.
- **LINE OAuth callback:** Currently registered at `https://t9l.me/api/auth/callback/line`. Either (a) register every subdomain individually with LINE Developer Console, (b) canonicalize OAuth to apex and 302 back to the originating subdomain post-callback (requires custom callback handling), or (c) use a fixed OAuth host (e.g. `auth.t9l.me`) and set a session cookie scoped to `.t9l.me`. Option (c) is the cleanest; option (a) doesn't scale beyond a handful of leagues.
- **Session cookie scope:** NextAuth sets cookies on the request host by default. For LINE login at one host to authenticate across all subdomains, set `cookies.sessionToken.options.domain = '.t9l.me'` in `authOptions`. Match for `csrfToken` and `callbackUrl`.
- **Env vars:** Single deployment. `NEXTAUTH_URL` is not used in code (auto-derived). All other env (`KV_*`, `DATABASE_URL`, `LINE_*`, `ADMIN_*`, `BLOB_*`) are already single-deployment-friendly.
- **Isolation strategy:** Row-level (single DB, `leagueId` FK on every tenant-bound row). Schema-per-tenant and DB-per-tenant are both overkill for current scale (4 teams × N leagues; rows-per-tenant in the low thousands). Document this decision once explicitly.
- **Redis namespace audit:** Three keyspaces today (`t9l:auth:map:*`, `t9l:rsvp:gw:*`, `player-pic:*`). Plan calls for prefixing the auth and pic spaces. Existing recovery scripts (`scripts/backfillRedisFromPrisma.ts`, `scripts/backfillRedisRsvpFromPrisma.ts`) need to learn the new key shape; the audit script (`scripts/auditRedisVsPrisma.ts`) needs to scan per-tenant.
- **Per-PR snapshot ledger:** Existing CLAUDE.md ledger pattern handles rollback. The multi-tenant work spans schema changes (Player), so each schema migration needs a Layer-3 Neon branch snapshot.
- **/minato and /shinagawa apex redirects:** Decide before the wildcard goes live whether `minato.t9l.me` should mean "the AppSheet form" or "the league subdomain". Probably the latter; move the AppSheet links somewhere else.

## Suggested Phasing

Roughly 2-3 weeks of work; phases are sequential because each is a stable rollback point.

**Phase 0 — Prep (½ week)**
- Add `Player.leagueId` (or `@@unique([leagueId, lineId])` per Decision #1) behind a feature flag, but keep `lineId @unique` until backfill complete.
- Land `getLeagueFromHost()` caching + middleware tenant resolution (`x-league-id` header).
- Externalize `t9l.me` references to `NEXT_PUBLIC_ROOT_DOMAIN`.
- Add tests that assert `where.leagueId` presence on critical Prisma calls.

**Phase 1 — Public read paths (½ week)**
- Thread `leagueId` through `getPublicLeagueData`, `dbToPublicLeagueData`, `getRsvpData`. Cache key includes `leagueId`.
- Update `/`, `/schedule`, `/stats`, `/assign-player` to pass the resolved league.
- Verify subdomain routing end-to-end for the existing test league.

**Phase 2 — Public write paths (½ week)**
- `/api/rsvp`: drop `LEAGUE_ID` constant; resolve from host.
- `/api/assign-player`: validate player belongs to the host's league before linking.
- Redis: add `leagueId` to `player-pic:` keys; decide on auth-map key shape per Decision #1.

**Phase 3 — Admin actions tenant guards (½ week)**
- Add ownership checks to every action in `admin/actions.ts` and `admin/leagues/actions.ts` (compound `where: { id, leagueId }` or pre-check pattern).
- Move global admin pages (`/admin/players`, `/admin/matches`, `/admin/settings`) under `/admin/leagues/[id]/` or scope them.
- Delete `getLeague()`; replace callers.

**Phase 4 — Auth + identity (½–1 week, only if Decision #1 = Option A)**
- Migrate `Player.lineId @unique` → `@@unique([leagueId, lineId])`.
- Update `getPlayerMappingFromDb`, `playerMappingStore`, JWT shape (add `leagueId`?).
- Migrate Redis auth-map namespace.
- Backfill via existing recovery script pattern.

**Phase 5 — Operational cutover (½ week)**
- Wildcard DNS + Vercel domain config + TLS verification.
- LINE OAuth callback strategy (Decision #1 plumbing).
- Session cookie domain `.t9l.me`.
- Onboard the first non-default league.

Phases 0–3 are tractable in the first week. Phase 4 is the biggest unknown and depends entirely on Decision #1. Phase 5 has external dependencies (Vercel plan, LINE Developer Console) that should be validated as the very first action.
