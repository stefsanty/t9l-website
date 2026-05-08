# Data model

`prisma/schema.prisma` is the source of truth. Key models below; read the schema for full field lists.

## Identity model (post-v1.65.x)

The identity rework consolidated three legacy patterns (LINE-only on Player, anonymous Player rows, dual-write across User/Player) into a single canonical chain:

```
Account ←→ User ←→ Player ←→ PlayerLeagueAssignment (PLM) ←→ LeagueTeam ←→ League
```

- **`Account`** — auth-provider rows (LINE / Google / Email). Created by NextAuth's PrismaAdapter. `provider` + `providerAccountId` are the natural key.
- **`User`** — one row per real human. `User.email @unique`, `User.lineId @unique`, `User.playerId @unique`. The `email` column is populated for Google + email-magic-link users always; for LINE-only users it's populated on first registration form submit (post-v1.78.0).
- **`Player`** — global identity for someone who plays in any league. `Player.userId @unique` ↔ `User.playerId` (1:1 binding). Identity-rework stage 4 (v1.70.0) moved `idFrontUrl` / `idBackUrl` / `idUploadedAt` from Player to User — ID is per-person, not per-league. Picture (`pictureUrl`) and email are similarly per-person.
- **`PlayerLeagueAssignment` (PLM)** — Player's participation in a specific league. Has `fromGameWeek` / `toGameWeek` for time-scoping, `status` (PENDING / APPROVED / DECLINED / WITHDRAWN — see v1.64.0+), `joinSource` (ADMIN / SELF_SERVE / INVITE — see v1.34.0+), `paymentStatus` (UNPAID / PAID — see v1.73.x).
- **`LineLogin`** — tracks every distinct LINE user that has authenticated regardless of Player linkage. Drives admin "Assign Player" Flow B dropdown.

**Standing rule (v1.67.0):** admin role is **orthogonal** to user-facing UX. See [admin-orthogonal-ux.md](admin-orthogonal-ux.md).

**Standing rule (v1.61.0):** non-LINE sessions (Google / email) write Prisma synchronously rather than through the v1.8.0 `waitUntil` defer — they have no Redis-canonical store, so the JWT callback resolves their `playerId` via Prisma `User.playerId @unique` and a deferred write would race the `update()` refresh. LINE users keep the v1.8.0 inversion.

## Public-site models

- **`League`** — single league instance (e.g. "T9L 2026 Spring"). `subdomain @unique` is now interpreted as the URL slug (column rename deferred per v1.55.0). `isDefault Boolean` → exactly one row marked true. `allowSelfLink Boolean @default(true)` (v1.60.0) — admins can opt out of open self-linking. `preseasonMode Boolean` + `recruitingMode Boolean` (v1.64.0+) drive the front-page experience.
- **`Team`** + **`LeagueTeam`** — `Team` is the global brand identity; `LeagueTeam` is participation in one league. `Team.name` is **not `@unique`** (test-league seeds introduced duplicates); upserts key on `id` (slug).
- **`Venue`** — `name @unique`, optional `url`, `courtSize`.
- **`GameWeek`** — `(leagueId, weekNumber) @@unique`. Optional `venueId`. Date may be null (admin can clear it).
- **`Match`** — `@@unique([gameWeekId, homeTeamId, awayTeamId])`. Score derives from `MatchEvent` rows post-v1.42.0; `scoreOverride` exists for forced manual scores.
- **`MatchEvent`** (v1.42.0+) — GOAL / OWN_GOAL etc. Replaces the legacy `Goal` table for current matches.
- **`Goal`** + **`Assist`** — legacy historical-data tables. `Goal` cascades on `Match` delete; **does not cascade on `Player` delete** (admin "remove from league" only deletes PLM, not Player).
- **`Availability`** — RSVP per `(playerId, gameWeekId) @@unique`. `RsvpStatus { GOING, UNDECIDED, NOT_GOING }` and `ParticipatedStatus { JOINED, NO_SHOWED }`. Cascades on Player and GameWeek delete. The Postgres durable secondary; Redis is canonical at read time (see [redis-state.md](redis-state.md)).
- **`LeagueInvite`** (v1.27.0+) — admin-issued invite codes for the `/join/[code]` redemption flow. `code @unique`, `maxUses`, `usedCount`, `skipOnboarding`, `expiresAt`. Personal vs general invites (v1.33.x).
- **`Setting`** — `(category, key, leagueId) @@unique`. `leagueId IS NULL` rows are global. Current consumers: `identity.read-source`, `playerData.read-source`. The `dataSource` / `writeMode` toggles (Sheets cutover) were retired in v1.71.0; their Setting rows are dead data.
- **`LeaguePositionFee`** (v1.67.1+) — per-position fee overrides on top of `League.defaultFee`.
- **`LeagueDetails`** (v1.75.0+) — public-facing league info: registration deadline, season fee, register-by deadline, goal kick type, etc. Surfaced in the `LeagueDetailsPanel` component.

## Schema migration discipline

- **Additive migrations are safe to ship.** New nullable columns, new tables, new indexes. No backfill = no risk.
- **Non-additive (DROP COLUMN, type change, NOT NULL constraint without default)** require a Layer-3 Neon snapshot before merge — see [release-and-ship.md](release-and-ship.md).
- **Multi-step backfills** (v1.27.0 identity-rework, v1.42.1 events backfill) ship as: stage α (additive schema) → stage β (backfill writes) → stage γ (read-flip) → stage δ (cleanup). Never collapse stages into one PR.
- **The `directUrl` connection** in `datasource db { ... }` reads from `DATABASE_URL_UNPOOLED`. The legacy `DIRECT_URL` var is set on prod + Preview for back-compat but no longer referenced by the schema.
