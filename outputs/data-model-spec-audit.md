# Data-model spec audit — Player ↔ League ↔ Membership ↔ Stat

**Date:** 2026-05-06 · **Baseline:** v1.64.0 · **Status:** audit only (no code shipped)

> **TL;DR** — The current schema already has the right *bones*: `User ↔ Player` is 1:1, `League` exists, and `PlayerLeagueAssignment` is the de-facto membership table (just misnamed). The drift is that **per-league fields have been welded onto the global `Player` table over time** — `position`, `applicationStatus`, `applicationLeagueId`. The State D bug is a direct symptom of that drift: a Player can hold only one `applicationStatus` total, so Stefan-already-APPROVED-in-T9L cannot be PENDING-in-Shinjuku simultaneously.
>
> **Recommendation: Option B (ship the spec refactor).** Stage 1 alone (additive PR — `applicationStatus` migrates onto `PlayerLeagueAssignment`) fixes State D as a *natural side effect*, with no ugly hack to refactor away later. Total chain is 4–5 PRs at low blast radius (additive → dual-write → flip → drop), each test-pinned. Option A's hack would touch `Player.applicationLeagueId` semantics, then be deleted in stage 1 anyway — pure churn.

---

## 1. Current schema — where do per-league fields live today?

Inventory of every field that conceptually belongs to "this player, in this league" but currently lives elsewhere. Read directly from [`prisma/schema.prisma`](prisma/schema.prisma) at v1.64.0.

| Field | Current location | Should be (per spec) | Status | Notes |
|---|---|---|---|---|
| **Identity** | | | | |
| `lineId` | `Player.lineId @unique` AND `User.lineId @unique` | `User` only | DUAL-WRITE (mid-rework) | Identity-rework chain α–λ (v1.27→v1.39): User becomes canonical; `Player.lineId` retired in stage Δ (deferred). |
| `userId` | `Player.userId @unique` (additive mirror) | `Player.userId` (canonical 1:1 to User) | CORRECT (post-rework) | Aligns with spec "Player has 1:1 relationship with User". |
| **Profile** | | | | |
| `name` | `Player.name` (nullable since v1.33.0) | `Player.name` | CORRECT | Spec says "profile-level data (name, avatar, DOB) — no per-league data". |
| `pictureUrl` (LINE-CDN mirror) | `Player.pictureUrl` | `Player` | CORRECT | LINE-mirrored avatar; profile-level. |
| `profilePictureUrl` (user-uploaded) | `Player.profilePictureUrl` (v1.37.0) | `Player` | CORRECT | User-uploaded; profile-level. |
| `dob` | **does not exist yet** | `Player.dob` (per spec, optional) | **MISSING** | Spec mentions DOB; not present today. |
| **Per-league config (drifted onto Player)** | | | | |
| `position` | `Player.position PlayerPosition?` (v1.33.0 enum) | `PlayerLeagueMembership.position` | **DRIFTED** | A player's position can legitimately differ between leagues (a GK in T9L might be a DF in a casual Shinjuku league). Today schema enforces one position globally. |
| `applicationStatus` | `Player.applicationStatus PlayerApplicationStatus DEFAULT APPROVED` (v1.64.0) | `PlayerLeagueMembership.applicationStatus` | **DRIFTED — load-bearing for State D bug** | One per Player → blocks "Stefan APPROVED-in-T9L + PENDING-in-Shinjuku". |
| `applicationLeagueId` | `Player.applicationLeagueId String?` (v1.64.0) | (gone — implicit in PLM row) | **DRIFTED — anti-pattern** | Memo of "which league did this person apply to" because there's no way to encode it where it belongs (the PLM row). Goes away under Option B. |
| `idFrontUrl` / `idBackUrl` / `idUploadedAt` | `Player` (v1.35.0) | **AMBIGUOUS — see §1.1** | UNDECIDED | Government ID is global to the human; current usage is per-league venue booking. Recommend keeping on `Player` (one human = one ID) but per-league flag for "ID seen by this league". |
| **Membership (correct shape, wrong name)** | | | | |
| `PlayerLeagueAssignment` table | (named that way) | `PlayerLeagueMembership` | **NAME DRIFT** | Already IS the membership table with `(playerId, leagueTeamId, fromGameWeek, toGameWeek, onboardingStatus, joinSource)`. Rename via Prisma `@@map` is non-breaking at the DB level. |
| `PlayerLeagueAssignment.leagueTeamId` | exists | `PlayerLeagueMembership.leagueTeamId` | CORRECT | The `LeagueTeam` join handles per-league team binding. |
| `PlayerLeagueAssignment.onboardingStatus` | exists (v1.34.0 enum) | `PlayerLeagueMembership.onboardingStatus` | CORRECT | Already per-league. |
| `PlayerLeagueAssignment.joinSource` | exists (v1.34.0 enum) | `PlayerLeagueMembership.joinSource` | CORRECT | Already per-league. |
| `jerseyNumber` | **does not exist** | `PlayerLeagueMembership.jerseyNumber Int?` | **MISSING** | Spec calls it out; not in any current model. |
| `status` (ACTIVE/INACTIVE/SUSPENDED) | **does not exist** | `PlayerLeagueMembership.status` enum | **MISSING (semantically)** | Today `toGameWeek IS NULL` ≈ ACTIVE. INACTIVE/SUSPENDED have no representation. v1.41.0 already considered this and decided not to surface it; spec brings it back. |
| **Stats (raw events exist; no aggregates)** | | | | |
| `goals`, `assists`, etc. | derived from `MatchEvent` (v1.42.0) on every read | `PlayerLeagueStat` table (per spec) | **MISSING** | `MatchEvent` is per-event truth; spec calls for `PlayerLeagueStat(playerId, leagueId, seasonId?)` aggregate. v1.44.0's `buildScorerStatsFromEvents` already does the in-memory aggregation; spec moves it to a materialized table. |

### 1.1 ID upload field: where does it belong?

Spec says profile-level data on `Player`, per-league data on `PlayerLeagueMembership`. Government ID is one-per-human (the document doesn't change per league), so `Player` is the right home for the URLs. But the *consent context* is per-league: a player who uploads ID to T9L for venue booking might not consent to Shinjuku admins viewing it.

**Two reasonable options:**

1. **(simpler, recommended)** Keep `idFrontUrl` / `idBackUrl` / `idUploadedAt` on `Player` as today. Add a per-league `PlayerLeagueMembership.idShared Boolean @default(false)` — admins of league X can only view the ID if `idShared=true` for the PLM in their league. Backfill `idShared=true` for all existing PLMs (the only league using ID upload today is T9L; by uploading, the player has consented to T9L viewing it).
2. (more granular) Move ID URLs onto `PlayerLeagueMembership` — re-upload per league. Costs storage and creates an asymmetry where `idFrontUrl` is per-league but `name` is global.

Going with option 1 in the recommendation. It's a small additive column, not a load-bearing rework.

### 1.2 What's already correctly aligned

Worth naming explicitly so we don't pretend the schema is more broken than it is:

- `User ↔ Player` 1:1 mirror via `User.playerId @unique` + `Player.userId @unique` (v1.27.0 / α). **Matches the spec exactly.** Today's drift is just that `Player.lineId` still exists alongside `User.lineId` — stage Δ retires it.
- `League` model has competition-instance config (name, subdomain, startDate, endDate, allowSelfLink, preseasonMode, recruiting). **Matches the spec.**
- `LeagueTeam` is the league × team junction; teams are global brand identities, league participation is the join. **Matches the spec's concept of teams reused across leagues.**
- `PlayerLeagueAssignment` IS the membership table — it has the FK to LeagueTeam (which encodes leagueId), per-league timing (`fromGameWeek` / `toGameWeek`), per-league onboarding state. **The data shape is right; the name is wrong.**
- `MatchEvent` (v1.42.0) is the unified event log scoped to `Match` (which is scoped to `League`). Per-league stats are already derivable per match.

So: the *primary structural gap is `Player.position` + `Player.applicationStatus` + `Player.applicationLeagueId`*. Everything else is naming, additive columns, and a future stats aggregate.

---

## 2. Spec gap analysis — what needs to change

Concrete schema diff to align with the spec:

```diff
 model Player {
   id                String   @id @default(cuid())
   name              String?
-  position          PlayerPosition?         // ← drifted, move to PLM
   lineId            String?  @unique        // (retired in stage Δ)
   pictureUrl        String?
   profilePictureUrl String?
   userId            String?  @unique
   onboardingPreferences Json?
   idFrontUrl        String?
   idBackUrl         String?
   idUploadedAt      DateTime?
-  applicationStatus   PlayerApplicationStatus @default(APPROVED)  // ← drifted
-  applicationLeagueId String?                                     // ← anti-pattern, gone
+  dob               DateTime?               // ← new, per spec
   createdAt         DateTime @default(now())
   updatedAt         DateTime @updatedAt
   …relations…
 }

-model PlayerLeagueAssignment {
+model PlayerLeagueMembership {                    // ← rename via @@map (non-breaking at DB)
   id           String   @id @default(cuid())
   playerId     String
   leagueTeamId String
   fromGameWeek Int
   toGameWeek   Int?
   onboardingStatus OnboardingStatus @default(NOT_YET)
   joinSource       JoinSource?
+  position         PlayerPosition?              // ← moved from Player
+  jerseyNumber     Int?                          // ← new
+  status           MembershipStatus @default(ACTIVE)  // ← new (ACTIVE | INACTIVE | SUSPENDED)
+  applicationStatus PlayerApplicationStatus @default(APPROVED)  // ← moved from Player
+  idShared         Boolean  @default(true)      // ← new (per §1.1 option 1)
   createdAt    DateTime @default(now())
   …relations…
+  @@map("PlayerLeagueAssignment")                // ← keep DB table name, rename Prisma model
   @@unique([playerId, leagueTeamId, fromGameWeek])  // (existing index extended if needed)
 }

+enum MembershipStatus {
+  ACTIVE
+  INACTIVE
+  SUSPENDED
+}

+model PlayerLeagueStat {                         // ← new, per spec
+  id           String  @id @default(cuid())
+  playerId     String
+  leagueId     String
+  seasonId     String?            // optional per spec; null = league lifetime
+  goals        Int     @default(0)
+  assists      Int     @default(0)
+  yellowCards  Int     @default(0)
+  redCards     Int     @default(0)
+  appearances  Int     @default(0)
+  recomputedAt DateTime @default(now())
+
+  player Player @relation(fields: [playerId], references: [id], onDelete: Cascade)
+  league League @relation(fields: [leagueId], references: [id], onDelete: Cascade)
+  @@unique([playerId, leagueId, seasonId])
+  @@index([leagueId])
+  @@index([playerId])
+}
```

### 2.1 The `@@map` trick — rename without DB migration

Prisma supports `@@map("OldTableName")` to keep the SQL table name while renaming the Prisma model. So the migration to rename `PlayerLeagueAssignment` → `PlayerLeagueMembership` is **zero SQL** — purely a code change to `schema.prisma` and to every TypeScript reference. Saves us a destructive migration and lets every existing Prisma client query keep working transactionally.

99 references to `PlayerLeagueAssignment` / `playerLeagueAssignment` / `playerAssignments` / `leagueAssignments` across `src/` (grep count). Mechanical find-and-replace; type-checker catches anything missed.

### 2.2 Stats aggregate: defer the materialization

Spec says `PlayerLeagueStat` exists as a separate table for "queried, aggregated, or reset per season without touching membership records". Today `MatchEvent` is the source of truth and v1.44.0's `buildScorerStatsFromEvents` does the aggregation in-memory per page render.

**Recommendation: ship the table in stage 1 but leave the aggregation logic for v2.** The table is empty until a future PR wires the recompute (e.g. on every `MatchEvent` write, or on a cron). Reads continue going through `MatchEvent` until then. This is exactly the same shape as `Match.homeScore`/`awayScore` (cache columns) vs `MatchEvent` (truth) since v1.42.0 / PR α.

Why not block on it: aggregation correctness needs careful design (when to recompute, how to handle MatchEvent edits, cards aren't even logged today — `EventKind` only has `GOAL`). Spec puts stats in a separate table for *future-proofing*, not because the current behavior is broken.

---

## 3. Migration strategy — additive then read-flip then drop

Same playbook as the v1.27.0–v1.39.0 identity-rework chain (α/β/γ/λ): every stage is reversible until the final drop, and each stage is a small PR with test pins.

### Stage 1 — Schema additions (additive, no behavior change)

**Files touched:**
- `prisma/schema.prisma` — add columns (`PlayerLeagueAssignment.position`, `PlayerLeagueAssignment.applicationStatus`, `PlayerLeagueAssignment.jerseyNumber`, `PlayerLeagueAssignment.status`, `PlayerLeagueAssignment.idShared`, `Player.dob`), add `MembershipStatus` enum, add `PlayerLeagueStat` model. Keep all old fields. Don't add `@@map` yet (rename happens in stage 4).
- `prisma/migrations/<datestamp>_player_league_membership_alpha/migration.sql` — additive; default existing rows by copying `Player.position` → `PLA.position` (CASE-WHEN backfill mirroring v1.33.0's pattern), `Player.applicationStatus` → `PLA.applicationStatus` (default APPROVED for non-pending; PENDING gets the right row via `applicationLeagueId` join). `MembershipStatus` defaults ACTIVE on every existing PLA. `PlayerLeagueStat` is empty.
- `tests/unit/membershipReworkAlphaSchema.test.ts` — pin all new columns nullable/default, migration purely additive, no DROPs.

**No source-code changes.** Reads continue from `Player.position` + `Player.applicationStatus`. Stage 1 just lays the rails.

### Stage 2 — Dual-write at every write site

**Files touched:**
- `src/app/admin/leagues/actions.ts`:
  - `adminUpdatePlayerPosition` writes both `Player.position` AND `PLA.position` (every PLA for that player — typically one for active players).
  - `adminApproveApplication` writes both `Player.applicationStatus = APPROVED` AND the new `PLA.applicationStatus = APPROVED` on the new PLM row.
  - `adminRejectApplication` deletes the PLM (gone with the Player) — no dual-write needed.
  - `adminCreatePlayer` writes `position` to BOTH places when creating with assignment.
- `src/app/api/recruiting/actions.ts` (`applyToLeague`):
  - State C creates a Player + a PLM row (instead of just memo'ing in `applicationLeagueId`). The PLM is a "shell" with `applicationStatus = PENDING`, `leagueTeamId = null` (or a sentinel — see §3.1), `position` from the form.
  - **State D fixes itself.** A user with an existing Player can now create a *second* PLM row in a different league with `applicationStatus = PENDING`. No more "contact admin" toast.
- `src/app/join/[code]/actions.ts` (`submitOnboarding`) — write position to both Player and PLM.
- `src/app/account/player/actions.ts` (`updatePlayerSelf`) — position writes to PLM (the user's *current* league context); name + dob stay on Player.
- `src/lib/identityLink.ts` (`linkUserToPlayer`) — no change (identity is global).

Reads still go through `Player.position` + `Player.applicationStatus`. Drift between the two stores is monitored by an inline structured log + a follow-up audit script (mirror of the v1.5.0 / v1.7.0 pattern).

### Stage 2 sub-issue — "PLM with no LeagueTeam yet" (§3.1)

Today `PlayerLeagueAssignment.leagueTeamId` is required. A pending-application PLM doesn't have a team yet (admin assigns on approval). Three options:

1. Make `leagueTeamId` nullable (add a `leagueId` column directly to PLM as a backup discriminator). Cleanest semantically. **Recommended.**
2. Sentinel `LeagueTeam` row per league called "Pending applications". Ugly.
3. Keep `applicationLeagueId` on PLM as a "leagueId hint" until a team is assigned. Same anti-pattern just relocated.

Going with option 1 in the sub-PR breakdown.

### Stage 3 — Switch reads to the new fields

**Files touched** (gating behind a `Setting('membership.read-source')` flag like v1.30.0 did):
- `src/lib/recruitingViewerState.ts` — read `applicationStatus` from PLM, not Player.
- `src/components/SquadList.tsx`, `src/components/MatchdayAvailability.tsx`, `src/lib/dbToPublicLeagueData.ts`, `src/types/index.ts` — read `position` from PLM.
- `src/app/admin/leagues/[id]/players/page.tsx` and `src/components/admin/PlayersTab.tsx` — read both per-league fields from PLM.
- `src/lib/admin-data.ts#getLeaguePlayers` — pending applications query flips from `Player.applicationLeagueId` to `PlayerLeagueAssignment.applicationStatus = PENDING` join.

Default `'legacy'` ships the code in place but inert. Operator flips after a soak window. Same pattern as v1.30.0 (PR γ).

### Stage 4 — Drop legacy columns + rename model

**Files touched:**
- `prisma/schema.prisma`:
  - Drop `Player.position`, `Player.applicationStatus`, `Player.applicationLeagueId`.
  - Rename `PlayerLeagueAssignment` → `PlayerLeagueMembership` + add `@@map("PlayerLeagueAssignment")` (zero SQL — Prisma table name unchanged).
- Migration: only the column drops; rename is code-only.
- All source code: rename `playerLeagueAssignment` → `playerLeagueMembership` everywhere (mechanical; type-checker catches misses).
- All test fixtures.

This is the only destructive step in the whole chain, gated behind several PRs of soak time on the read-flip.

### Stage 5 (later, separate chain) — Stats materialization

**Files touched:**
- A new recompute helper `src/lib/playerLeagueStat.ts` (mirror of `src/lib/matchScore.ts` from v1.42.0).
- Hook into every `MatchEvent` write path (admin CRUD + player self-report) inside the existing `prisma.$transaction`.
- Read flip on the public stats page from `MatchEvent`-derived to `PlayerLeagueStat`-direct.

Independent from the membership chain.

---

## 4. Bug-fix paths under Option A vs Option B

### Option A — hot-fix using existing schema

**Goal:** unblock State D so a signed-in player with an existing Player can register a PENDING application in a *different* league.

The current schema can't represent two simultaneous applications cleanly. The cleanest hack is:

> Treat `Player.applicationStatus` as "the current pending application" rather than a player-global state. When State D fires, *change* `Player.applicationStatus` from APPROVED back to PENDING and set `Player.applicationLeagueId` to the new league. On approval in the new league, flip back to APPROVED + create the PLA. On rejection, ask admin to flip back manually.

Problems with this hack:

1. **Loses the "this person is APPROVED in T9L" semantic.** While the PENDING-Shinjuku application is in flight, Stefan's `Player.applicationStatus` reads PENDING — the T9L admin's player list now shows him as a pending application *in T9L*, even though he's already approved there.
2. The State A renderer in `RecruitingBanner` checks `applicationStatus === 'APPROVED' && activeAssignment` — would still work because the T9L PLA is what determines APPROVED, but the UI logic is now arguing against the column's apparent meaning.
3. `applicationLeagueId` becomes load-bearing in a way it isn't today (today it's a memo; under Option A it's the discriminator that disambiguates "PENDING for which league").
4. **Every fix has to be ripped out in stage 1 of Option B.** Pure churn.

Alternative hack — leave `applicationStatus = APPROVED`, allow the State D click to create *just a PLA* with no PENDING semantic (relying on `joinSource: 'SELF_SERVE'` + `onboardingStatus: NOT_YET` to mark "not yet a real member"). This is closer to the spec's shape but is essentially **stage 1 + stage 2 of Option B for one tiny slice of the surface**, leaving every other call site (admin, getLeaguePlayers, RecruitingBanner) reading from the global Player columns. Inconsistent.

**Estimated PR size:** 1 PR, ~150–200 LOC + tests. Fast. Reads from a confusingly-overloaded column.

### Option B — proper fix as side-effect of stage 1+2

`adminApproveApplication` already writes a PLA on approval. Once `PlayerLeagueAssignment.applicationStatus` exists (stage 1) and `applyToLeague` writes a PLA-with-PENDING for State D (stage 2), the State D bug is fixed *by construction*:

```diff
 // src/app/api/recruiting/actions.ts (post-stage-2)
 if (user.playerId) {
-  // State D — multi-league application. Punted in v1.64.0.
-  return { ok: false, error: 'Contact the league admin…' }
+  // State D — multi-league application. Create a new PLM row tied to
+  // the existing Player with applicationStatus = PENDING.
+  await prisma.$transaction(async (tx) => {
+    await tx.playerLeagueAssignment.create({
+      data: {
+        playerId: user.playerId!,
+        leagueId: league.id,        // (new column from stage 1)
+        leagueTeamId: null,         // (nullable from stage 1)
+        fromGameWeek: 1,
+        applicationStatus: 'PENDING',
+        position: input.position ?? null,
+        joinSource: 'SELF_SERVE',
+        onboardingStatus: 'NOT_YET',
+      },
+    })
+  })
+  return { ok: true, playerId: user.playerId }
 }
```

Stefan-in-T9L stays APPROVED (via his existing PLA). His new Shinjuku PLA carries PENDING. Two rows, two states, no contradiction.

`getRecruitingViewerState` evolves naturally: instead of checking `Player.applicationStatus === 'PENDING' && Player.applicationLeagueId === leagueId`, it checks `there exists a PLM in this league with applicationStatus = PENDING`. The same query already underpins `getLeaguePlayers`'s pending-applications surface — no new query shape.

Admin UX is unchanged: the admin Players tab for Shinjuku surfaces the new PENDING PLM via the same query that already powers v1.64.0. They Approve → flip the existing PLM's applicationStatus to APPROVED + assign team. They Reject → delete the PLM only (not the Player, since Stefan still exists in T9L).

**Estimated PR size:** stage 1 alone is ~250 LOC schema+migration+tests; State D fix lands as a one-block change inside stage 2's broader dual-write PR (~100 LOC inside the larger refactor). State D fix is then provably correct *because the schema permits the state*.

---

## 5. Recommendation

**Ship Option B.**

Rationale:

1. **State D is a load-bearing data-model bug, not a UX cosmetic issue.** Every workaround at the application layer is a layer of cruft over a misshapen schema. Option A's hack literally inverts the semantic of `Player.applicationStatus` to dodge the constraint.
2. **The refactor is mostly already done.** `User ↔ Player` is 1:1; `PlayerLeagueAssignment` IS the membership table; `LeagueTeam` is the league × team junction. The remaining work is **moving 2 columns** (`position`, `applicationStatus`), **adding 3 new columns** (`jerseyNumber`, `status`, `idShared`), **renaming 1 model** (`@@map` keeps it zero-SQL), and **adding 1 new table** for stats. The stage 1 PR is purely additive — same shape as v1.27.0's α schema PR which shipped without incident.
3. **Risk profile is the same as the identity-rework chain (α–λ).** That chain shipped 4 PRs over 6 weeks, each test-pinned, each behind a Setting flag at the read-flip stage. No incidents, no rollbacks.
4. **Option A is throwaway code.** Every line written for Option A would be deleted in stage 1 of Option B. Option B's stage-1 PR would land *faster* than Option A would because there's no hack to design.
5. **The spec is right and worth aligning to.** Today's schema reads will get worse the longer drift accumulates. Three drifted columns now → six in a year if we don't draw a line. The spec gives us a north star.

The only argument for Option A is "we want the State D bug fixed *this hour*." If that's the operational driver — fine, Option A is doable in an afternoon. But the user explicitly said this is a "decide between" question, not a "fix it right now" emergency. So: Option B.

---

## 6. Sub-PR breakdown for Option B

Estimated **5 PRs, ~3–4 days of work**, each test-pinned and rollback-safe. Mirrors the v1.27→v1.39 identity-rework cadence.

### PR 1 — Stage 1: additive schema (`v1.65.0`)

**Scope:** schema additions + migration + structural test pins. Zero source-code changes outside `schema.prisma`.

- New columns on `PlayerLeagueAssignment`: `position`, `applicationStatus`, `jerseyNumber`, `status`, `idShared`, plus `leagueId String?` (the Stage 2 sub-issue resolution; nullable through Stage 4).
- New `Player.dob DateTime?` column.
- New `MembershipStatus` enum (ACTIVE | INACTIVE | SUSPENDED).
- New `PlayerLeagueStat` table (empty; no code reads it yet).
- Make `PlayerLeagueAssignment.leagueTeamId` nullable (so PENDING-no-team-yet PLAs are valid).
- Migration backfill: copy `Player.position` → every active PLA's `position`. Copy `Player.applicationStatus` to PLA via the `applicationLeagueId` join (PENDING players get PENDING PLA in their target league). All PLAs default `MembershipStatus = ACTIVE` and `idShared = true`.
- Tests: schema additive invariants (no DROP / no ALTER COLUMN against existing data), migration SQL shape, every backfill clause.

**Estimated:** 1 day. ~250 LOC + tests.

### PR 2 — Stage 2 dual-write + State D fix (`v1.66.0`)

**Scope:** every write site dual-writes; the State D click creates a PENDING PLM (this is where the user-reported bug actually closes).

- `adminUpdatePlayerPosition`, `adminCreatePlayer`, `adminApproveApplication`, `adminRejectApplication`: dual-write.
- `applyToLeague`:
  - State C: create Player AND a PLA in target league with `applicationStatus = PENDING`.
  - **State D**: create a NEW PLA for the existing Player in the new league with `applicationStatus = PENDING`. (Removes the "contact admin" toast path; updates `RecruitingBanner` to call `applyToLeague` for State D too.)
- `submitOnboarding`, `updatePlayerSelf`: position dual-write.
- Drift telemetry: structured log on writes that succeed in one store but not the other (mirror of `[v1.8.0 DRIFT]`).
- Tests: the State D regression test (Stefan APPROVED-in-T9L can submit a PENDING-in-Shinjuku application; both PLMs survive); dual-write call shape on every action.

**Estimated:** 1 day. ~400 LOC + tests.

### PR 3 — Stage 3 read-flip behind `Setting` flag (`v1.67.0`)

**Scope:** every read site behind `Setting('membership.read-source', 'legacy' | 'plm')`; default `'legacy'`. Code lands inert.

- `recruitingViewerState.ts`, `dbToPublicLeagueData.ts`, `SquadList.tsx`, `MatchdayAvailability.tsx`, `admin-data.ts#getLeaguePlayers` (pending applications query), `PlayersTab.tsx`.
- Tests: parity test that runs both resolvers side-by-side on the same fixtures and asserts identical output (mirror of v1.30.0's identity resolver parity test).
- Operator flip is a separate manual step (raw SQL or admin Settings UI; TBD if we add an admin toggle for this).

**Estimated:** 0.5 day. ~200 LOC + tests.

### PR 4 — Operator flip + soak (no code, just an ops event)

Operator flips `Setting('membership.read-source')` to `'plm'`. Smoke test for one full day. Optional: backfill audit script that compares Player-side vs PLM-side for every player and logs any drift.

### PR 5 — Stage 4 drop + rename (`v1.68.0`)

**Scope:** the destructive cleanup. Requires soak window from PR 4.

- Schema: drop `Player.position`, `Player.applicationStatus`, `Player.applicationLeagueId`. Rename Prisma model `PlayerLeagueAssignment` → `PlayerLeagueMembership` with `@@map("PlayerLeagueAssignment")` (zero SQL for the rename; existing column drops are the only DDL).
- Source code: mechanical rename across ~99 references. Type-check catches every miss.
- Drop the `Setting('membership.read-source')` flag and the legacy resolver.
- Tests updated for the new model name; no parity test needed anymore.

**Estimated:** 0.5–1 day. ~300 LOC of mechanical edits + test updates.

### Out of scope for this chain

- **Stats materialization** (`PlayerLeagueStat` recompute). Table ships in stage 1 but stays empty; future PR ε wires recompute on `MatchEvent` writes. Reads continue going through `MatchEvent` until then. Independent.
- **`Player.lineId` retirement** (identity-rework stage Δ). Deferred independently.
- **Multi-league header switcher UX** for users with PLMs in multiple leagues. v1.52.0 already handles this for "linked players in multiple leagues"; PENDING applications don't need a switcher entry until they're approved.

---

## 7. What this audit does NOT cover

- Concrete SQL migration text (deferred to PR 1 of the implementation chain).
- Whether to add `seasonId` to `PlayerLeagueStat` now or defer (spec marks it optional; implementation can ship with `seasonId String?` from the start at zero cost).
- The header league-switcher UX changes if a user has an *application* (not a membership) in a second league — does the switcher show it? Probably no (membership not granted yet); needs a product decision but not a blocker.
- Cross-league transfer flows (player approved in T9L, applies to Shinjuku, gets approved → does anything change in T9L?). Today the answer is "nothing" and Option B preserves that.
