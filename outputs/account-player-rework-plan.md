# Account ↔ Player Rework — Design Doc

**Status:** design only, not implementation. Targets a multi-PR, backward-compatible path from today's `lineId → Player` identity model to a `(LINE | Google | email) → User → Player → many LeagueMembership` model with self-serve league join via codes / personalized invite links.

**Author note (read first):** the user's top concern is *abuse and confusion in onboarding*. The new join flow's job is to make "I am Stefan, here is my code, put me in the right league with the right team identity" both **self-serve** and **tamper-resistant**. Every section below is written with that thread visible — when a tradeoff comes up, the side that closes an abuse vector wins.

**Update 2026-05-01 — multi-provider scope.** The original v1 of this doc assumed LINE OAuth was the only sign-in path. The user has expanded the scope: the new world must support **LINE OAuth + Google OAuth + email** signup. Sections that previously read "LINE → User" now read "(LINE | Google | email) → User", and a new stage α.5 has been inserted between the v1.27.0 schema additions and the original β (dual-write) to lay the multi-provider foundation. Every other downstream stage is unchanged in shape — they just resolve identity through a provider-agnostic `Account` join instead of `User.lineId` directly.

---

## 1. Current state

### What's actually wired today (post-v1.26.0)

```
                         ┌──────────────────────────────────────┐
   LINE OAuth            │  Player                              │
   (line-mock,           │  ─────                               │
    line-prod)           │  id           cuid()                 │
        │                │  lineId       UNIQUE  ← THE identity │
        │                │  name                                │ 
        │                │  pictureUrl                          │
        │ JWT callback   │  position                            │
        └─────get────────►  …goals, assists, availability…     │
                         └──────────────┬───────────────────────┘
                                        │ 1—N
                                        ▼
                         ┌─────────────────────────────────────┐
                         │  PlayerLeagueAssignment             │
                         │  ────────────────────────           │
                         │  playerId                           │
                         │  leagueTeamId                       │
                         │  fromGameWeek / toGameWeek          │
                         └──────────────┬──────────────────────┘
                                        │ N—1
                                        ▼
                         ┌─────────────────────────────────────┐
                         │  LeagueTeam                         │
                         │  ───────────                        │
                         │  leagueId  ─►  League               │
                         │  teamId    ─►  Team (global brand)  │
                         └─────────────────────────────────────┘

   User                          LineLogin
   ─── (admin-only;              ───
   currently dormant for         (every distinct LINE user
   public flows. Has lineId       authenticating, regardless
   @unique, role, name, pic.      of whether they've been
   Used only for                  linked to a Player)
   admin-credentials.)
```

### What carries identity today

- **`Player.lineId @unique`** is the load-bearing constraint. *One LINE account ↔ one Player row, globally.* The schema already enforces "one account = one person" — it does NOT enforce "one account = one player per league" (because `Player` is global, not per-league).
- **`PlayerLeagueAssignment`** ties that one Player into 0..N leagues via 0..N `LeagueTeam` rows. So a LINE user assigned to teams in two leagues is *one Player row* with two assignments.
- **JWT per-league context (v1.26.0):** the JWT callback reads the request `Host` header, resolves `leagueId`, and walks `Player.leagueAssignments` to pick the right `teamId` for *this* league. So `session.teamId` already varies by subdomain even though `session.playerId` is stable across them.
- **`User`** is dormant for the public flow. Only admin-credentials login ever interacts with it (and even there, indirectly — admin auth uses env-var creds, not a DB-backed account). LINE users do NOT get a `User` row today.

### Why the user reports "an account can be linked to different players"

The schema constraint `Player.lineId @unique` actually prevents the literal case "one LINE account → two Player rows simultaneously." But the user-perceived problem is real and arises from these mechanics:

1. **Per-league rosters today are independent.** An admin spinning up League B typically imports a fresh roster (53 fresh `Player` rows for the new league), even if many of those humans already exist as `Player` rows in League A's roster. Without explicit deduplication, the same human Stefan ends up as `Player A` (League 1 roster) and `Player B` (League 2 roster). They are different rows. There is no `Person` concept above them.
2. **The `/assign-player` self-serve flow lets the user pick anyone.** When Stefan signs in on `tamachi.t9l.me`, `/assign-player` shows him League 2's full roster filtered to "not-yet-linked" rows. He picks `Player B`. The POST handler runs an atomic `updateMany lineId=null where lineId=X and id != B` — which **silently unlinks him from `Player A` in League 1.** Next time he signs in on apex, the JWT callback for League 1 returns no mapping → orphan → he has to re-link.
3. **Admin-side remap is also possible.** The admin "Remap" dialog moves a LINE link from one Player to another globally. If admin uses that to fix a typo in League 1, it can have the side effect of flipping Stefan's identity in League 2 too.
4. **Abuse vector:** any logged-in LINE user, on any subdomain, can pick *any unlinked Player slot* in that league's roster — including impersonating somebody who hasn't yet signed in. Today the only check is "is this Player already linked?" There is no proof-of-identity gate.

### Concrete failure modes the user wants closed

| # | Scenario | Today's behavior | Desired behavior |
|---|---|---|---|
| F1 | Admin creates League B. Stefan signs into League B subdomain, picks "Stefan S" from League B's roster. | Admin's roster of League A loses Stefan's link silently. He's orphaned in A on next sign-in. | Stefan stays linked in A. League B membership is added on top of (not in place of) League A. |
| F2 | New attacker signs in via LINE on `tamachi.t9l.me`. They open `/assign-player`, see the roster of real T9L players. They pick "Stefan S" while Stefan happens to not be linked yet. | Attacker captures Stefan's slot. Real Stefan lands on a screen that says "Stefan S is already linked." | Attacker hits a code/invite gate before they can claim ANY slot. The attacker without a code never sees the picker. |
| F3 | Stefan plays in two leagues at the same club. Wants to switch view between them. | No switcher. Has to manually type a different subdomain. | Header switcher lists his memberships. One click changes context. |
| F4 | A user picks the wrong player slot on `/assign-player` ("oops, my name is Steven, I clicked Stefan"). | Stefan's slot is now taken. Real Stefan sees "Stefan is already linked" and has to find an admin. | Either (a) the picker is gone — code-gated invite — or (b) self-correction is single-click and real Stefan can re-claim with proof of identity. |
| F5 | Admin wants to invite a known new player to a specific team without that player having to navigate any picker. | Admin manually creates a Player row, then waits for the player to sign in and find themselves on `/assign-player`. Or admin uses Flow B (admin-side dropdown) after the player has signed in once. | Admin sends a personalized join link. Player clicks it, signs in via LINE, ends up linked to the right slot. No picker UX. |

---

## 2. Target state

### Roles, separated cleanly

```
   LINE OAuth      Google OAuth    Email (magic link)
   (lineId)        (sub)           (verified address)
        │              │                  │
        │              │                  │
        ▼              ▼                  ▼
   ┌──────────────────────────────────────────────────┐
   │  Account                                         │  <- AUTH IDENTITIES (NextAuth adapter)
   │  ───────                                         │      0..N per User; one per (provider,
   │  id, userId, type, provider,                     │      providerAccountId). New row created
   │  providerAccountId, access_token,                │      automatically by NextAuth on each
   │  refresh_token, expires_at, …                    │      successful OAuth sign-in.
   │  @@unique([provider, providerAccountId])         │
   └──────────────────────────┬───────────────────────┘
                              │ N—1
                              ▼
   ┌─────────────────────────────────┐
   │  User                           │   <- CANONICAL HUMAN-AUTH IDENTITY
   │  ────                           │      one row per human, can have
   │  id            cuid()           │      multiple Accounts (LINE+Google),
   │  email         UNIQUE? (nullable│      and at most one Player.
   │                — LINE may not   │
   │                provide one)     │
   │  emailVerified DateTime?        │      set by EmailProvider on magic-link
   │  lineId        UNIQUE? (legacy; │      stage 4 drops this; legacy compat
   │                stages 1–3 only) │      column for the LINE OAuth path.
   │  name                           │      first-seen profile from any provider
   │  pictureUrl                     │
   │  role          ADMIN | VIEWER   │
   │  playerId      UNIQUE FK → Player │ ─── 1:1 link to canonical profile
   └────────────────┬────────────────┘
                    │ 1—1 via Player.userId
                    ▼
   ┌─────────────────────────────────┐
   │  Player                         │   <- CANONICAL PROFILE
   │  ──────                         │      one row per HUMAN, across leagues
   │  id          cuid()             │
   │  userId      UNIQUE? FK → User  │   ←── nullable until the human signs in
   │  name                           │      (admins can pre-create empty Player
   │  pictureUrl                     │       rows for an upcoming roster)
   │  position                       │
   │  (lineId is REMOVED from Player │
   │   in stage 4; lives on User in  │
   │   stages 1–3, then removed too.)│
   └────────────────┬────────────────┘
                    │ 1—N
                    ▼
   ┌─────────────────────────────────┐
   │  PlayerLeagueAssignment         │   <- LEAGUE-SCOPED ROSTER ENTRY
   │  ─────────────────────          │      (name unchanged per user-decided
   │  playerId                       │       2026-05-01)
   │  leagueTeamId                   │
   │  fromGameWeek / toGameWeek      │
   │  createdAt                      │      (existing — covers "joinedAt")
   │  joinSource: ADMIN |            │   ←── NEW in stage 2: how did this
   │              SELF_SERVE |       │       human get this assignment?
   │              CODE |             │       Backfilled rows default to ADMIN.
   │              PERSONAL           │
   └─────────────────────────────────┘

   ┌─────────────────────────────────┐
   │  LeagueInvite (NEW)             │   <- THE JOIN GATE
   │  ─────────────                  │
   │  id          cuid()             │
   │  leagueId    FK → League        │
   │  code        UNIQUE  (short,    │      e.g. "T9L-2026-K7M9"
   │              human-readable)    │
   │  kind        'code' | 'personal'│
   │  targetPlayerId  FK → Player?   │   ←── if 'personal': pre-bind to a slot
   │                                 │      so the user lands directly on the
   │                                 │      "you're Stefan, confirm?" screen
   │  createdBy   FK → User          │
   │  expiresAt   DateTime?          │
   │  maxUses     Int?               │   ←── null = unlimited
   │  usedCount   Int                │
   │  revokedAt   DateTime?          │
   │  createdAt   DateTime            │
   └─────────────────────────────────┘
```

### Why this shape

- **`Account` is the canonical multi-provider join (NextAuth Prisma adapter).** Stage α.5 wires the standard NextAuth `Account` table. One `User` can have many `Account` rows — e.g. Stefan signs in with LINE today and adds Google later; both `Account` rows point at his single `User.id`. Resolution at JWT time goes `(provider, providerAccountId) → Account.userId → User`.
- **`User` becomes the canonical auth identity carrier.** Today `Player.lineId` does this implicitly. After α.5 the `User` row is the join point: every authenticated request resolves through it, regardless of which provider signed the user in. `User.lineId` survives through stage 3 as a legacy compat column (read by the current `getPlayerMappingFromDb` path); stage 4 drops it once `Account` is the only resolution path.
- **`User.email` and `User.emailVerified` are NextAuth adapter requirements.** `email` is nullable because LINE OAuth doesn't always provide one — only Google and email-magic-link guarantee a verified address. The `@unique` constraint fires only when the value is non-null (PostgreSQL semantics).
- **Magic-link email over password** (recommended; user-confirmed acceptable). One implementation surface (NextAuth `EmailProvider`), inherent verification (you must click the link to authenticate), no password storage, no reset flow. Tradeoff: every login requires a fresh email round-trip (no "remember me past the JWT TTL"). For a league app with infrequent logins this is fine; if it becomes a friction point in stage 3+, password-with-bcrypt can be added as a parallel CredentialsProvider — adapter integration stays unchanged.
- **`Player` keeps its name** (user-decided 2026-05-01). Cost of churning every `playerId`, `playersByTeam`, `Player.lineId` reference across `src/`/`scripts/`/`tests/`/`CLAUDE.md` is large; the conceptual confusion is small.
- **`Player.userId` is the new bridge.** When a User is linked to a Player, we set `Player.userId = User.id`. The `@unique` constraint enforces 1:1 (one human ↔ one canonical Player). `Player.lineId` becomes a derived/legacy column kept around through stage 3 for compat, dropped in stage 4.
- **`PlayerLeagueAssignment` keeps its name** (user-decided 2026-05-01). It gains a `joinSource` audit column in stage 2 so we can answer "how did Stefan end up in League B?" The `joinedAt` field is NOT added — the existing `createdAt` already records this. No `@@map` rename, no TypeScript identifier churn. The model name stays as-is throughout all stages.
- **`LeagueInvite`** is the new gate. Two flavors:
  - **Code (open invite):** an admin generates `T9L-2026-K7M9`. Anyone holding the code can claim ONE unlinked Player slot in the league's roster. Use case: "I'm announcing the league in a Slack/LINE group chat — here's the code, pick your name."
  - **Personal (closed invite):** an admin generates a code AND pre-binds it to `targetPlayerId`. The recipient of the code lands directly on "Confirm: you are Stefan S." with no picker. Use case: "Stefan, here's your private link — click, sign in, you're linked."
- **The invite gate is provider-blind.** A user can sign up with Google or email and *still* not see any league roster until they redeem an invite code. This is critical: email signup is the easiest path for a bad actor to acquire an authenticated session, but `LeagueInvite` makes that session worthless without a code from the league's private channels.

### Keeping current onboarding alive (backward-compat)

- The existing `/assign-player` picker keeps working unchanged through stages 1–3. It writes `Player.userId` AND `Player.lineId` in stage 2 (dual-write); it reads `User.lineId` in stage 3 (flag-gated).
- Old `PlayerLeagueAssignment` table name stays in the database via Prisma `@@map`; only the TypeScript identifier changes.
- All admin tools (Flow B link, Remap, Unlink) keep working — they get a thin shim that updates both `Player.lineId` (legacy) and `User.playerId` (new) until stage 4.
- The Redis store's per-league `t9l:auth:map:<leagueId>:<lineId>` key shape stays exactly as v1.26.0 specced. The *value* shape gets one new field (`userId`) but is forward-compatible.

---

## 3. Schema migration in stages

Each stage is its own PR (or small chain of PRs). Each is **independently shippable** and **independently revertible** via Layer 1 (git tag) + Layer 3 (Neon snapshot). The DB table for `PlayerLeagueAssignment` is renamed *in code only* — the SQL table name stays stable through all four stages.

### Stage 1 — Additive schema. No behavior change. (this plan's first concrete PR)

```prisma
model User {
  // ... existing fields preserved unchanged ...
  playerId   String?  @unique         // NEW — nullable, no FK enforcement yet
  // (don't add @relation yet to keep the migration trivially additive)
}

model Player {
  // ... existing fields preserved unchanged ...
  userId     String?  @unique         // NEW — nullable mirror of User.playerId
  // No @relation between User<->Player yet — keeps both adds purely additive
  // and decoupled. Stage 2 wires the relation with explicit names so we don't
  // accidentally collide with any future field.
}

model LeagueInvite {                  // NEW table, isolated, no FK from existing
  id              String   @id @default(cuid())
  leagueId        String
  code            String   @unique    // human-readable: "T9L-2026-K7M9"
  kind            InviteKind          // CODE | PERSONAL
  targetPlayerId  String?             // populated only when kind == PERSONAL
  createdById     String?             // FK → User; nullable for system-generated
  expiresAt       DateTime?
  maxUses         Int?
  usedCount       Int      @default(0)
  revokedAt       DateTime?
  createdAt       DateTime @default(now())

  league          League   @relation(fields: [leagueId], references: [id], onDelete: Cascade)

  @@index([leagueId])
  @@index([code])
}

enum InviteKind {                     // NEW
  CODE
  PERSONAL
}
```

**`PlayerLeagueAssignment` rename:** *deferred to stage 2.* Even with `@@map`, renaming the model in stage 1 churns dozens of files (every `prisma.playerLeagueAssignment.…` call in admin actions and admin-data). Cleaner to keep stage 1 surgical and rename in stage 2 alongside the dual-write.

**Behavior:** none. Nothing reads or writes any of the new columns/tables in stage 1. The schema additions exist purely so stage 2 can dual-write into them without a separate migration step in the middle.

**Test contract:**
- A unit test that `prisma.user` accepts `playerId: 'p-...'` on create/update.
- A unit test that `prisma.player` accepts `userId: '...'` on create/update.
- A unit test that `prisma.leagueInvite.create` round-trips a `kind: 'CODE'` row and a `kind: 'PERSONAL'` row.
- A migration sanity test that `prisma migrate deploy` against the per-PR Neon branch DB doesn't break any existing query (i.e. select-all from `Player`, `User`, `LeagueInvite` succeeds).

**Rollback:** the Neon snapshot taken pre-PR; failing forward via a `DROP COLUMN User.playerId; DROP COLUMN Player.userId; DROP TABLE LeagueInvite; DROP TYPE InviteKind` revert migration.

**Status:** ✅ shipped as PR #102 / v1.27.0 (2026-05-01).

### Stage α.5 — Multi-provider auth foundation. Adds Google + email signup paths. (NEW — required by user 2026-05-01)

This stage was added after the v1.27.0 schema additions in response to the user's expanded scope: "we want to support email / google signups." Stage α.5 lays the multi-provider auth foundation BEFORE stage β (dual-write) so that β can write a single User-keyed identity model regardless of which provider the user signed in with.

**Schema delta (additive):**

```prisma
model User {
  // ... existing fields preserved unchanged ...

  // NEW — NextAuth Prisma adapter requires these on User. Both nullable
  // because LINE OAuth doesn't always provide an email address — only
  // Google OAuth and EmailProvider (magic link) guarantee a verified
  // address. PostgreSQL @unique fires only when the value is non-null,
  // so two LINE users with no email can coexist.
  email          String?   @unique
  emailVerified  DateTime?

  accounts       Account[]
}

// NextAuth adapter Account table (multi-provider join).
// Pattern matches https://authjs.dev/reference/adapter/prisma exactly so
// the official @auth/prisma-adapter wires up without custom field mapping.
model Account {
  id                       String   @id @default(cuid())
  userId                   String
  type                     String   // "oauth" | "email" | "credentials"
  provider                 String   // "line" | "google" | "email"
  providerAccountId        String   // line.sub | google.sub | email address
  refresh_token            String?  @db.Text
  access_token             String?  @db.Text
  expires_at               Int?
  token_type               String?
  scope                    String?
  id_token                 String?  @db.Text
  session_state            String?

  user                     User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
  @@index([userId])
}

// NextAuth EmailProvider verification tokens (one-shot magic-link codes).
// Token is hashed before storage; identifier is the email address. Expires
// 10 minutes after creation by NextAuth default.
model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}
```

**No `Session` model.** The project keeps `session: { strategy: "jwt" }` (deliberate — required by Redis-canonical mapping store and v1.24.0 cross-subdomain cookie scope). NextAuth v4's PrismaAdapter no-ops session methods under JWT strategy, so omitting the `Session` table is supported and conventional.

**Code delta:**

- New deps: `@auth/prisma-adapter@^2.x`, `nodemailer@^6.x` (email-magic-link transport).
- New env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `EMAIL_SERVER_HOST` / `EMAIL_SERVER_PORT` / `EMAIL_SERVER_USER` / `EMAIL_SERVER_PASSWORD` / `EMAIL_FROM` (or a single `EMAIL_SERVER` connection string per NextAuth EmailProvider docs).
- `src/lib/auth.ts`:
  - Add `adapter: PrismaAdapter(prisma)` to `authOptions`.
  - Add `GoogleProvider` and `EmailProvider` to the providers array.
  - The JWT callback gains a fork: when `account?.provider === "google"` or `account?.provider === "email"`, capture the user's identity from the adapter-managed `User` row instead of from `profile.sub`. The LINE branch keeps its existing path through stage 3 (legacy compat).
  - **LINE coexistence shim.** When `PrismaAdapter` is wired and `LineProvider` signs a user in, the adapter creates a fresh `User` row and an `Account(provider="line")` row. Existing LINE users have a v1.27.0 `User` row already, but no `Account` row. To prevent the adapter from creating duplicate User rows, α.5 ships a one-shot **pre-α.5 backfill** (`scripts/backfillAccountFromLineLogin.ts`): for every existing `User` with `lineId IS NOT NULL` (and for every `Player.lineId` that has no `User` yet — admin-created Players who never logged in but have lineId set via Flow B), insert `Account(provider="line", providerAccountId=lineId, userId=user.id)`. After backfill, the adapter's `linkAccount` call for an existing LINE user finds the existing Account row and reuses the matched User — no duplication.
  - **The pre-α.5 backfill MUST run between merge and the first LINE login.** Same cutover-protocol shape as v1.7.0 (`backfillRedisRsvpFromPrisma`): dry-run pre-merge, apply pre-merge, then merge. Otherwise the first LINE-user sign-in post-deploy creates a duplicate User row that the stage β dual-write can't reconcile.
- New routes:
  - `/auth/signin` — provider picker page (LINE | Google | "sign in with email"). Replaces the implicit NextAuth default sign-in page.
  - `/auth/verify-request` — "check your email" landing page after submitting an email for magic-link.
  - `/auth/callback/google` — auto-handled by NextAuth.
  - `/auth/callback/email` — auto-handled by NextAuth (consumes the magic-link token).

**Behavior:**
- Existing LINE users: their first sign-in post-deploy goes through the adapter, which finds the pre-α.5-backfilled Account row and reuses the existing User. **No user-visible change** if the backfill ran. JWT callback continues to populate `playerId`/`teamId` via the existing `lineId → Player` path (β handles the resolver swap).
- New users via Google or email: adapter creates a fresh `User` row with no `lineId`, no `Player` association. They land on `/` signed in but with no playerId. They see the landing page; to do anything league-specific they need to redeem a `LeagueInvite` (PRs #5/#6 ship that flow; until then they're a logged-in lurker with no league context).
- Admin Flow B continues to work — orphan dropdown still reads `LineLogin`. New Google/email users do NOT appear in Flow B (they have no LINE link to bind). Admin-side handling of non-LINE users is a separate later concern (admin can use the upcoming PR #5 personal-invite flow to bind them).

**Test contract:**
- Unit: `Account.@@unique([provider, providerAccountId])` enforced.
- Unit: pre-α.5 backfill maps `User.lineId → Account(provider="line", providerAccountId=lineId)` 1:1, idempotent on second run.
- Unit: pre-α.5 backfill creates `User` rows for `Player.lineId` values that have no existing User (admin pre-created Players who never logged in).
- Unit: NextAuth `signIn` callback rejects malformed Google `sub` / missing email.
- Unit: `EmailProvider` token round-trip — generated token validates exactly once, second use 404s.
- E2E (Playwright): Google sign-in to a fresh dev environment creates exactly one `User` and one `Account(provider="google")` row.
- E2E: Email magic-link round-trip — request token, click link, land on `/` signed in.
- Regression: pre-α.5 LINE user signs in; `User` count is unchanged; new `Account(provider="line")` row appears; JWT callback resolves `playerId` from the existing path.

**Rollback:** Drop `Account` and `VerificationToken` tables; drop `User.email` / `emailVerified`. Remove `adapter: PrismaAdapter(prisma)` from `authOptions`. Drop `GoogleProvider` and `EmailProvider`. The JWT callback's LINE path was untouched, so reverting α.5 leaves the LINE flow exactly as it was at v1.27.0.

### Stage 2 (β) — Dual-write only. Provider-agnostic. Behavior unchanged for readers.

(Originally the immediate sequel to stage 1; now sequenced after α.5 so dual-write can be keyed on `User.id`, not `lineId`.)

Schema delta:

```prisma
model PlayerLeagueAssignment {        // NAME UNCHANGED per user-decided 2026-05-01
  // ... existing fields preserved unchanged ...
  joinSource  JoinSource?             // NEW — null for backfilled rows; new
                                      // rows default to ADMIN at the
                                      // application layer (no DB-level default
                                      // so we can distinguish "explicitly
                                      // backfilled" from "explicitly admin").
}

enum JoinSource {                     // NEW
  ADMIN          // existing rows backfill to ADMIN
  SELF_SERVE     // /assign-player picker (legacy)
  CODE           // claimed via league code
  PERSONAL       // claimed via personal invite
}
```

(`joinedAt` field dropped from this plan — `createdAt` already records it.
Adding a parallel column would be redundant and noise.)

**Code delta:**

- Identity resolution is now provider-agnostic. The JWT callback resolves `userId` via the adapter-managed `Account` table (via `Account.userId` join, unique on `(provider, providerAccountId)`). The LINE path keeps reading via `User.lineId` through stage 3 for compat — but α.5 already ensures every LINE-authenticated user has an `Account` row, so β has a unified identity at the User layer regardless of which provider was used.
- Every write site that links a Player to a User (`/api/assign-player` POST/DELETE, `adminLinkLineToPlayer`, `updatePlayer` when lineId changes, the upcoming `/api/leagues/:id/claim-player` endpoint when stage β ships) now writes `User.playerId` AND `Player.userId` in addition to the existing `Player.lineId` (when applicable). The dual-write lands in the same Prisma `$transaction` so it's atomic w.r.t. the existing semantics.
- The Redis-canonical store's *value* shape gains a `userId` field (still a JSON object). Old values without `userId` parse as before; new values include it. Auth-side reads that don't need `userId` ignore it. No format-version bump needed.
- Provider-keyed write sites: when a non-LINE user (Google, email) claims a Player slot via the upcoming `/join/[code]` flow, the link sets `Player.userId` directly with NO `Player.lineId` (because there isn't one). This is the first time the codebase has a logged-in Player with `lineId IS NULL`. Read paths that crash on missing lineId will be fixed in stage 3.

**Reads still go through `Player.lineId`** for LINE users. Stage 2 is exclusively about *populating* the new columns so stage 3 has data to switch onto.

**Backfill:** a one-shot script `scripts/backfillUserPlayerLink.ts`:
1. For every `Player` where `lineId IS NOT NULL`: find the matching `User` via `User.lineId` (post-α.5 every LINE login has produced a User row via the adapter; backfilled Users from the pre-α.5 cutover already exist).
2. Set `User.playerId = player.id` AND `Player.userId = user.id`.
3. For Players with no matching User: log a warning and skip. (This case shouldn't exist post-α.5 backfill; if it does, it's drift to investigate.)
4. Pure decision helper `decideUserBackfillAction` exported and unit-tested.
5. `--dry-run` reports a punch list. `--apply` runs the upserts. Idempotent — safe to re-run.
6. Run pre-PR-merge against prod.

**Test contract:**
- The dual-write fires in `$transaction` (regression: a test mocks `prisma.$transaction` and asserts both writes are part of the same call).
- The backfill is idempotent (run twice, second run is all MATCH).
- Backfill handles the edge case where a `User` row already exists for that `lineId` (admin already had it).
- The `joinSource` field on existing PlayerLeagueAssignment rows backfills to `ADMIN`.
- The model name `PlayerLeagueAssignment` stays — `prisma.playerLeagueAssignment.…` remains the call shape across `src/` and `scripts/`.

**Rollback:** drop the new columns; the dual-write code is gated by a new `Setting` row (`category: 'identity', key: 'dual-write', value: 'on' | 'off'`), so a config flip stops the writes without a redeploy.

### Stage 3 — Switch reads to the new model behind a flag. Old path stays as fallback.

**Setting flag:** `category: 'identity', key: 'read-source', value: 'legacy' | 'user'`.

When `'user'` is set, the JWT callback resolves identity via:

```ts
async function getPlayerMappingNew(lineId: string, leagueId: string) {
  const user = await prisma.user.findUnique({
    where: { lineId },
    select: {
      playerId: true,
      player: {
        include: {
          leagueAssignments: { include: { leagueTeam: { include: { team: true } } } }
        }
      }
    }
  })
  // ... pick assignment by leagueId ...
}
```

When `'legacy'` is set, the existing `getPlayerMappingFromDb` path runs unchanged.

The Redis store keeps the same key shape; the cached value already has `userId` from stage 2.

**Cutover protocol** (mirrors v1.4.0 → v1.5.0 dataSource flip):
1. Deploy stage 3 code with `Setting('identity.read-source') = 'legacy'`. Identity reads use the old path.
2. Verify `Setting` is honored — flip on a per-PR preview env first.
3. Operator-run smoke check on the legacy path (a known LINE user signs in, `session.playerId` resolves correctly).
4. Operator flips `Setting('identity.read-source') = 'user'` via admin Settings tab.
5. Smoke check on the new path (same LINE user, fresh session, JWT callback now reads via `User.playerId`).
6. Soak for 1–2 weeks.

**Test contract:**
- A unit test that toggles the flag and asserts `getPlayerMapping` calls the right resolver.
- A contract test that the new resolver returns identical output to the legacy resolver across the prod-shaped fixture set (10–20 representative rows: linked, orphan, multi-league, edge cases).
- A "drift detector" admin endpoint that runs both resolvers in shadow on every authenticated request and logs any divergence (`[v1.30 DRIFT] lineId=… legacy=… new=…`). Removed in stage 4.

**Rollback:** flip the `Setting` back to `'legacy'`. Code stays in place.

### Stage 4 — Drop the old per-league mapping. Delete the legacy column. (NOT now.)

Earliest 3–4 weeks after stage 3 cutover. Specifically:
- Drop `Player.lineId` column.
- Drop the legacy resolver branch.
- Drop the `Setting('identity.read-source')` flag.
- Drop the shadow drift detector.
- Update CLAUDE.md and `outputs/multi-tenant-readiness.md` to reflect the final shape.

This is a real schema migration (column removal), so it gets its own pre-PR Neon snapshot, dry-run on a prod-clone, and operator sign-off.

---

## 4. Auth + JWT changes

### Stage 1 (shipped, v1.27.0): no change

JWT callback does what it does today. The new columns exist but are not read.

### Stage α.5: Adapter wired; new providers active; LINE branch unchanged

- `authOptions.adapter = PrismaAdapter(prisma)` is added.
- `GoogleProvider` and `EmailProvider` are added to the providers array.
- The JWT callback gains a small fork at the top of `jwt({ token, account, profile, user })`:
  - `account?.provider === "google"`: capture `token.userId = user.id` from the adapter-supplied User row. No `lineId`. No Player association yet (until they redeem an invite).
  - `account?.provider === "email"`: same as Google — `token.userId` from the adapter, no `lineId`.
  - `account?.provider === "line"`: existing path runs. Adapter's `linkAccount` has already created the `Account(provider="line")` row by this point. `token.lineId` is set; `token.userId` is captured from `user.id` for forward use.
- For LINE users, the existing `getPlayerMappingFromDb(lineId, leagueId)` path is unchanged through stage 3. The new `userId` field on the token is captured but not used in resolution yet — it's there so stage β's dual-write knows which User to update.

### Stage 2: dual-populate `userId` on the JWT

The JWT callback, after `getPlayerMapping(lineId, leagueId)` succeeds, also queries `prisma.user.findUnique({ where: { lineId }, select: { id: true } })` and stashes `userId` on the token. This is added defensively — it's metadata that doesn't affect routing yet, but lets client components like the future header league switcher resolve "who am I globally?" without a separate round-trip.

```ts
// next-auth.d.ts
declare module "next-auth" {
  interface Session extends DefaultSession {
    // ... existing fields ...
    userId: string | null;            // NEW — the cross-league User.id
  }
}
```

### Stage 2.5: surface `memberships` on the JWT (separate small PR)

Once dual-write is settled, the JWT can additionally include the user's full league membership list:

```ts
session.memberships = [
  { leagueId: 'l-tamachi-2026', leagueName: 'Tamachi 2026', subdomain: 'tamachi', teamId: 't-...', teamName: '...' },
  { leagueId: 'l-minato-2025',  leagueName: 'Minato 2025',  subdomain: null,        teamId: 't-...', teamName: '...' },
]
```

Powers the header league switcher. Cached in Redis under the per-User namespace (`t9l:user:memberships:<userId>`, 10-minute TTL, busted on any `LeagueMembership` write — admin add/remove). Each session refresh reads from Redis on hit, falls through to Prisma on miss. Mirror of the v1.5.0 player-mapping store pattern.

### Stage 3: read identity via `User`

The JWT callback's `getPlayerMapping` now goes through `User.lineId → User.playerId → Player.leagueAssignments[leagueId]`. The fallback chain on miss/error stays identical to v1.26.0 semantics.

The Redis key shape stays as v1.26.0: `t9l:auth:map:<leagueId>:<lineId>`. The lookup key is still `lineId` (because that's what's on the JWT), but the *resolution path* is `lineId → User → Player → Membership`.

### Multi-league cross-subdomain coexistence

The cookie domain logic (v1.24.0 `getAuthCookieDomain`) already shares the JWT across `*.t9l.me`. The JWT's `leagueId` field is recomputed on every callback from the `Host` header, so navigating from `tamachi.t9l.me` to `minato.t9l.me` produces a fresh JWT with `leagueId` flipped without any new infrastructure. The `memberships` list is computed once per session refresh from `Player.leagueAssignments`, so it doesn't churn per-host.

---

## 5. League join flow design

### Two flavors, both worth shipping

The user asked "league codes vs personalized invite links — recommend one." My recommendation is **both, with code-as-default and personal-as-first-class**, because they cover non-overlapping use cases:

| Flavor | Use case | UX |
|---|---|---|
| **Code** | Announcing the league in a chat group. "Hey everyone, here's our league code: T9L-2026-K7M9." Anyone in the chat enters it. | User goes to the league subdomain (or apex), clicks "Join a league" in the header, enters code, then **picks their player** from the unlinked roster. Code-gated entry to today's `/assign-player`. |
| **Personal** | Admin pre-stages a roster and invites known people. "Stefan, here's your link: t9l.me/join/PERSONAL-X9M2K1" | User clicks the link, signs in via LINE, lands on a "Confirm: you are Stefan S." screen. No picker. One click → linked. |

Both go through one new route: `/join/[code]` (server component). The code lookup decides which UX to render.

### Flow A: code (open) join

```
   [user is in chat group, copies "T9L-2026-K7M9"]
                    │
                    ▼
   t9l.me  →  Header: [Sign in] [Join a league]  →  user clicks
                    │
                    ▼
   /join (no code in URL) — input form: "Paste your league code"
                    │
                    │ submit
                    ▼
   /join/T9L-2026-K7M9  →  validates: not expired, not revoked,
                          not over maxUses, league exists
                    │
                    ├─ not signed in → bounce to /api/auth/signin?callbackUrl=/join/T9L-2026-K7M9
                    │
                    ▼
   Player picker for THIS league's roster, filtered to:
     - Players in this league only
     - Not already linked to anyone
     - Not the viewer's already-linked player (shown but greyed,
       so they can re-confirm if needed)
                    │
                    │ user picks "Stefan S"
                    ▼
   POST /api/leagues/:id/claim-player
     body: { code: 'T9L-2026-K7M9', playerId: 'stefan-s' }
                    │
                    │ server: validates code, validates player is unlinked,
                    │         validates player belongs to this league's roster,
                    │         transactionally:
                    │           - upsert User by lineId, capture userId
                    │           - set Player.userId = userId, Player.lineId = lineId (dual-write)
                    │           - increment LeagueInvite.usedCount
                    │           - set joinSource='CODE' on the resulting
                    │             PlayerLeagueAssignment row (or no-op if a
                    │             matching assignment already exists — re-link
                    │             case)
                    ▼
   Redirect to / (the league subdomain home)
   Toast: "You're linked to Stefan S in Tamachi 2026."
```

### Flow B: personal invite

```
   [admin generates link in /admin/leagues/:id/invites]
   [link is t9l.me/join/PERSONAL-X9M2K1]
   [admin sends link to Stefan via LINE / Slack / email]
                    │
                    ▼
   user opens link, not signed in → LINE OAuth
                    │
                    ▼
   /join/PERSONAL-X9M2K1  →  server resolves code, sees kind=PERSONAL,
                             reads targetPlayerId, fetches Player, renders:
                             ┌──────────────────────────────────────┐
                             │  You're being invited to Tamachi 2026 │
                             │                                       │
                             │      [photo]   STEFAN S               │
                             │                Defender                │
                             │                Team: Mariners FC      │
                             │                                       │
                             │  Is this you?                          │
                             │  [ Yes, that's me ]   [ No, not me ]  │
                             └──────────────────────────────────────┘
                    │
                    │ "Yes" → POST /api/invites/:code/accept
                    │
                    ▼
   Server transactionally:
     - upsert User
     - set Player.userId / .lineId
     - mark LeagueInvite as used (single-use unless maxUses configured)
     - audit row joinSource='PERSONAL'
                    │
                    ▼
   Redirect to / on the league subdomain.
```

"No, not me" path: the user is shown a generic "this invite is for someone else; please ask the admin for your own invite" page. The invite is NOT consumed. The admin can see in the `LeagueInvite` table whether the link was visited and rejected (we'd add a `lastRejectedAt` audit field if we care; out of scope for the first PR).

### Code format

Format: `<LEAGUE_PREFIX>-<YEAR>-<4-CHAR-RANDOM>` for `CODE` kind (e.g. `T9L-2026-K7M9`), `PERSONAL-<6-CHAR-RANDOM>` for `PERSONAL` kind (e.g. `PERSONAL-X9M2K1`). Random portion uses an alphabet that excludes 0/O/I/1/L to avoid copy-typing errors. 4 chars from a 31-char alphabet ≈ 924k combinations — collision probability acceptable at code-volume of <1000.

Generation centralized in `src/lib/inviteCodes.ts` (pure helpers, unit-tested for: alphabet purity, prefix shape, collision against an existing code set).

### Default expiry

`LeagueInvite.expiresAt` is set to **`now() + 7 days`** at create time by the application layer (user-decided 2026-05-01). The schema column itself is `DateTime?` — nullable — because:
1. Computed defaults (`now() + interval`) aren't expressible in Prisma schema syntax,
2. Admins may explicitly opt out (`null`) or override the duration via the create dialog.

The "+7 days at creation" default is enforced in `src/lib/inviteCodes.ts#defaultExpiresAt(now)` (pure helper, unit-tested), called from the create-invite server action. NULL in the column means "no expiry" — distinct from "default of 7 days." Stage 1 doesn't ship the create flow, so the default is documented now and applied when PR #5 lands.

### Race conditions

The "two users open the picker simultaneously and both pick Stefan" race is already mitigated by `Player.lineId @unique` (the second writer hits a unique-constraint violation and gets a friendly error). We add an explicit pre-check in the route handler that returns a structured 409 with `{ error: 'Player already linked to someone else.' }` before falling into a 500.

For `LeagueInvite.usedCount`: the increment is `prisma.leagueInvite.update({ where: { id, usedCount: { lt: maxUses } }, data: { usedCount: { increment: 1 } } })` — Prisma's optimistic `where` check makes the over-use case a clean update-not-found rather than a lost-update.

---

## 6. Header league switcher

### Where it lives

Top-right of the existing header on the public site. Component name `LeagueSwitcher.tsx`. Placement is the same on apex, subdomain, and `/admin` — a small dropdown trigger showing the current league name with a chevron.

### What it shows

```
   ┌────────────────────────────────────────┐
   │  ☰  T9L                       Stefan S │
   │                          ┌─────────────┐│
   │                          │ Tamachi 2026││  <- current
   │                          ├─────────────┤│
   │                          │ Minato 2025 ││  <- click to switch
   │                          ├─────────────┤│
   │                          │ + Join a    ││  <- to /join
   │                          │   league    ││
   │                          └─────────────┘│
   └────────────────────────────────────────┘
```

Clicking another league navigates to that league's subdomain (or apex if `subdomain IS NULL`). Cross-subdomain JWT (v1.24.0) means the user stays signed in.

When the user has 0 memberships: switcher renders only "+ Join a league". When 1: switcher is hidden by default; the league name displays as static text ("Tamachi 2026") with no dropdown chrome. When 2+: full dropdown.

### Subdomain awareness

The switcher reads `session.memberships` (added in stage 2.5). Each entry has `subdomain` — that's the destination URL. For memberships in leagues with `subdomain IS NULL` (default league served from apex), the switcher routes to apex.

**Edge case:** the user's session shows a membership in League X with `subdomain='tamachi'`, but they're currently on `minato.t9l.me`. The switcher highlights "Minato 2025" as current (matched by `session.leagueId`, not URL parsing), and shows "Tamachi 2026" as a clickable option. Clicking navigates to `tamachi.t9l.me`.

**Apex case:** apex serves the default league (today: Minato 2025). When a user with both memberships is on apex, the switcher shows "Minato 2025" as current. Clicking "Tamachi 2026" → `tamachi.t9l.me`. Clicking the explicit "Apex (Minato)" entry... actually we don't need that, because the dropdown's "current" entry is always non-clickable. Single-click trip from any league to any other league is what matters.

### Admin shell

The admin shell already has a "League" picker for which league's tabs to show (in `/admin/leagues/[id]/...` routes). That stays as-is — it's a different picker for a different purpose (admin-managed leagues, not "leagues I'm a member of"). The header switcher we're adding is for the public-site identity context.

---

## 7. Abuse / bad-faith vectors

### What's broken today (concrete)

1. **Anyone with a LINE account can claim any unlinked Player slot.** The only check is "is this Player.lineId NULL?" There is zero proof-of-identity gate. An attacker who knows that real player Stefan hasn't yet signed in can claim "Stefan S" for themselves. Real Stefan is then locked out, must contact an admin, admin must Remap.
2. **Cross-league silent re-linking.** Picking a Player on a subdomain silently nulls the lineId in the user's other league's Player. Confused users blame the app.
3. **No audit trail for a join.** If Stefan complains, "I never signed up for League B," there's nothing in the schema saying *when* his Player got its lineId. (`Player.updatedAt` exists but is overloaded.)
4. **Subdomain-level enumeration.** The `/assign-player` page on any subdomain leaks the full roster of that league to any logged-in LINE user. Today this isn't a problem (one league, all rostered humans known to each other), but in a multi-tenant world it's roster data exposure.
5. **Picker overload.** As leagues scale, the picker shows tens or hundreds of names; high error rate ("oops, wrong Stefan").

### How the new flow closes each

| # | Vector | Mitigation in new flow |
|---|---|---|
| A1 | Slot impersonation | The `/assign-player` open-picker becomes code-gated. No code → no picker. Code is shared in the league's private channels, raising the cost of impersonation to "be in the channel." Personal invites remove the picker entirely — Stefan's link goes straight to "Confirm: Stefan." |
| A2 | Cross-league silent unlink | Linking via the new flow uses `User.playerId` (1:1 globally), not `Player.lineId` (1:1 globally with side-effect-on-write). Adding a second league membership goes through `LeagueMembership` rows — additive, not destructive. The `updateMany lineId=null on others` pattern in `/api/assign-player` POST is replaced by an upsert that respects existing memberships. |
| A3 | No audit trail | `LeagueMembership.joinedAt` + `joinSource` records exactly when and via what mechanism. Personal-invite consumption updates `LeagueInvite.usedCount` and a `usedAt` audit field. |
| A4 | Roster enumeration | The picker is only visible to a holder of a valid league code. Without a code, the page returns 404. (We could keep an admin-only roster view at `/admin/...` for league operators.) Limits roster exposure to channel members. |
| A5 | Picker overload / wrong-pick | Personal invites eliminate the picker. For code-based joins, the picker is filtered to "unlinked players in this league" so the search space is bounded. We can add a "self-correction" UI ("This isn't me — undo") visible for 24h after a join, that re-opens the slot without admin involvement. |

### What this design does NOT close

- **A user who has a real lineId but isn't on the roster.** Today they hit `/assign-player` and pick from the visible list; in the new world they hit the join page, enter the code, and... still see the picker. If they pick someone else's slot, we're back to A1 — but only within the code-holding cohort. Mitigation: the admin can choose to issue only personal invites (no codes) for high-trust leagues.
- **A user who somehow has another user's personal-invite URL.** Personal invites are a possession-based credential. If the URL leaks, it's claimable by whoever has it. Mitigations: (a) one-shot consumption (`maxUses=1`), (b) optional expiry (`expiresAt`), (c) admin can revoke (`revokedAt`), (d) admin can require LINE-verification gate ("Confirm: you are Stefan" still requires the user's *current LINE display name* to match a fuzzy comparison; this is a UI-side soft gate, not a hard check).
- **An admin who creates fake Player rows.** Out of scope — admin-trust assumed.

### Multi-provider abuse surface (added 2026-05-01)

Email signups change the abuse surface in two material ways:

1. **The cost of acquiring an authenticated session drops to "have an email address."** Today, signing up requires a LINE OAuth account (low friction in Japan, but still a real provider account with a phone number behind it). With email-magic-link, anyone with a disposable inbox (`temp-mail.org`, `10minutemail.com`, etc.) can complete sign-up. Google OAuth is intermediate — Google does some abuse detection on its side but disposable Google accounts exist.
2. **`User`-row spam.** A bad actor could script account creation to fill the `User` table with junk rows. There's no per-IP rate limit on `/api/auth/signin/email` today.

**Why this is acceptable for stage α.5:** the `LeagueInvite` gate (PRs #5/#6) is what protects league access. A spammer with 10,000 disposable-email `User` rows still can't see any league's roster, can't RSVP, can't appear on any leaderboard, can't be linked to any Player. They have only a logged-in session that does nothing. The `User` table grows but that's storage, not exploitation.

**Mitigations available without further design (operator-flippable as needed):**
- Disposable-email blocklist on `/api/auth/signin/email` — a small `BLOCKED_EMAIL_DOMAINS` env var or DB table; the `EmailProvider`'s `sendVerificationRequest` callback rejects matches before sending. Optional, off by default.
- Per-IP rate limit on email signups (Upstash @upstash/ratelimit, mirror of how RSVP submissions could be rate-limited if needed). Add only if abuse materializes.
- Admin "purge unlinked Users older than X days with no Account activity" maintenance script — runs on a cron, no UX impact.
- Google OAuth's own abuse detection covers the Google path.

**What this design does not handle for non-LINE users:**
- A Google-signed-up user whose Google email matches a real T9L player's email but who isn't actually that player — they could redeem a `LeagueInvite CODE` and pick that player's slot in the picker. Mitigation: `PERSONAL` invites bypass the picker; high-trust leagues issue only `PERSONAL`. Same shape as the existing A1 vector for LINE users.
- An email-signed-up user is identifiable only by an email address, with no automatic display name or picture. The `/assign-player` picker shows them a roster of Players whose names they may not recognize. Mitigation: name + photo are visible on the roster; PERSONAL invites bypass the picker entirely.

---

## 8. Backward-compat surface

These flows MUST keep working unchanged through stages 1, 2, and 3. Each is a regression-prevention test target.

| Flow | Stage 1 ✅ | Stage α.5 | Stage 2 | Stage 3 | Stage 4 |
|---|---|---|---|---|---|
| LINE OAuth → JWT callback resolves session.{playerId, teamId} for the active league. | unchanged | unchanged for LINE; adapter creates `Account(provider="line")` row in parallel; resolution still goes through `Player.lineId` | unchanged (dual-write fires alongside) | uses `User.playerId` resolver; falls back to legacy on flag-off | new path only |
| Google OAuth sign-in | n/a | NEW — adapter creates User + Account; JWT has `userId` but no `playerId` until invite redeemed | dual-writes via `User.playerId` if/when user redeems an invite | unchanged | unchanged |
| Email magic-link sign-in | n/a | NEW — adapter creates User + Account on token consumption; JWT has `userId` but no `playerId` | dual-writes via `User.playerId` if/when user redeems an invite | unchanged | unchanged |
| `/assign-player` picker shows unlinked players in the active league's roster. | unchanged | unchanged | unchanged (until we swap to /join — separate later PR) | replaced by `/join` |
| Admin "Assign Player" Flow B dialog (admin-side dropdown of orphans → bind to Player). | unchanged | dual-writes | dual-writes; new resolver | reads via User |
| Admin "Remap" dialog (move LINE link from Player A to Player B). | unchanged | dual-writes | dual-writes; new resolver | reads via User |
| Admin "Unlink" button. | unchanged | dual-clears | dual-clears | clears via User |
| `/api/auth/session` returns playerId stable across requests within a league. | yes | yes | yes | yes |
| Cross-subdomain JWT (v1.24.0). | yes | yes | yes | yes |
| Per-league JWT context (v1.26.0). | yes | yes | yes (resolver swap is transparent) | yes |
| Redis-canonical mapping store (v1.5.0). | unchanged | unchanged (value gains `userId` field, parser is forward-compatible) | unchanged | drop `Player.lineId` reference in serializer |
| RSVP route `/api/rsvp` writes to `Availability` keyed on `Player.id`. | unchanged | unchanged | unchanged | unchanged |
| RSVP store v1.7.0 (`t9l:rsvp:gw:<gwId>`). | unchanged | unchanged | unchanged | unchanged |

The only externally-visible changes are *additive*: new join routes, new admin invite-management page, new header switcher.

---

## 9. Test strategy

### Per-stage invariants

**Stage 1 (additive schema):**
- Migration applies cleanly to a snapshot of prod's schema (sanity test in CI on the per-PR Neon branch).
- All existing tests pass without modification.
- New table `LeagueInvite` accepts code/personal rows.
- `User.playerId` and `Player.userId` accept null and a valid id; `@unique` constraint enforces 1:1.

**Stage 2 (dual-write + rename):**
- Dual-write atomicity: every site that updates `Player.lineId` also updates `Player.userId` AND `User.playerId` AND `User.lineId` in the same transaction. Test by mocking `prisma.$transaction` and asserting the call list.
- Backfill idempotency: run `backfillUserFromPlayerLineId.ts --apply` twice; second run reports all MATCH, no rows updated.
- Backfill collision: handle the case where a `User` row already exists with that `lineId` (admin had pre-created); test that the playerId binding is added without dropping the existing user data.
- The `LeagueMembership` rename's `@@map` keeps the DB table name stable. Test by asserting `prisma.leagueMembership.findMany` returns the same rows as the pre-rename `prisma.playerLeagueAssignment.findMany` did.

**Stage 3 (read-source flag):**
- Flag dispatch: `Setting('identity.read-source', 'legacy')` calls the old resolver; `'user'` calls the new resolver.
- Resolver parity: golden-fixture set of 20 representative LINE users (linked, orphan, single-league, multi-league, with-old-link, edge-cases) — both resolvers return identical output for every fixture.
- Drift detector: the shadow-run logger captures every divergence to `console.warn('[v1.30 DRIFT] ...')`. A test asserts no drift on the fixture set; another test injects a deliberate drift scenario and asserts the log fires.

**Stage 4 (drop legacy):**
- Schema migration drops `Player.lineId` only after a successful prod soak. Pre-merge test that `prisma.player.findMany` works without the column.
- Code grep: `git grep -n "Player\.lineId\|player.lineId\|lineId.*Player"` returns no matches outside test fixtures and historical CLAUDE.md entries.

### New flow tests

**Code generation:**
- Alphabet purity (no 0/O/I/1/L).
- Prefix shape (`T9L-2026-` for code, `PERSONAL-` for personal).
- Collision-rejection in a 1000-code stress run.

**Code claim flow (`/join/[code]`):**
- Valid code, valid player, valid LINE user → success path.
- Expired code → friendly "expired" page, no DB write.
- Revoked code → friendly "revoked" page, no DB write.
- Over-uses code → friendly "code is full" page, no DB write.
- Race: two simultaneous claims of the same Player → first wins, second sees structured 409, no orphaned `LeagueInvite.usedCount` increment for the loser.

**Personal invite flow:**
- Valid personal code → "Confirm: you are Stefan" → "Yes" → linked.
- Personal code's `targetPlayerId` already linked to someone else → friendly error.
- "No, that's not me" → page is rendered, no consumption, audit row.
- Re-visiting a single-use consumed personal code → "this invite has been used" page.

**Header switcher:**
- 0 memberships: switcher hidden / shows only "Join a league".
- 1 membership: static text, no dropdown.
- 2+ memberships: full dropdown, current league marked, click navigates to subdomain.
- Membership in a default-league (subdomain IS NULL) → routes to apex.

---

## 10. Rollout sequence

| PR | Title | Stage | Schema touch | Behavior change | Approx LOC | Estimated risk |
|---|---|---|---|---|---|---|
| **#1** | **Identity rework α — additive schema** ✅ shipped (PR #102 / v1.27.0) | 1 | yes (additive) | none | ~250 | low; fully revertible |
| **#2** | **Multi-provider auth foundation — Account + VerificationToken + Google + email magic-link** (NEW — required by user 2026-05-01) | α.5 | yes (additive: `Account`, `VerificationToken`, `User.email`, `User.emailVerified`) | new Google + email signup paths; LINE behavior unchanged post-backfill | ~600 | medium; pre-merge backfill mandatory to avoid duplicate User rows on first LINE login |
| #2.5 | Pre-α.5 backfill: `Account` rows for existing LINE users (one-shot script + dry-run) | α.5 (companion) | none | none | ~200 | low; idempotent; MUST run pre-merge |
| #3 | Identity rework β — dual-write `User.playerId` ↔ `Player.userId` + add `joinSource` to PlayerLeagueAssignment | 2 | yes (additive: `joinSource` enum + column) | dual-write fires; reads unchanged | ~500 | medium; tests gate dual-write atomicity |
| #3.5 | Backfill `User.playerId` ↔ `Player.userId` from existing `Player.lineId` (one-shot script + dry-run) | 2 (companion) | none | none | ~200 | low; idempotent |
| #4 | Identity rework γ — User-side resolver behind a Setting flag (default OFF) | 3 | none | none yet | ~400 | low; flag is OFF |
| #5 | Operator flip: `Setting('identity.read-source')` → 'user' | 3 (operator) | none | yes — reads now go through User | 0 | medium; reversible by flipping back |
| #6 | LeagueInvite admin UI (admin can create code / personal invites for a league) + `inviteCodes.ts` helpers + 7-day default expiry | new feature | none | new admin route | ~500 | low |
| #7 | Public `/join/[code]` route + `/api/leagues/:id/claim-player` endpoint | new feature | none | new public route | ~700 | medium; new auth-gated write |
| #8 | Header LeagueSwitcher component + `session.memberships` plumbing | new feature | none | header change | ~400 | low |
| #9 | Stage 4 — drop `Player.lineId` + `User.lineId` columns, drop legacy resolver, drop drift detector | 4 | yes (destructive) | reads via User-via-Account only | ~150 | medium; needs Layer 3 snapshot |

PRs #1 through #5 are the identity-rework chain. PRs #6 through #8 are the join-flow chain. They're parallelizable after #3.5 lands. PR #9 closes the identity work. Total: **9 PRs** spanning ~7–11 sessions of focused work, gated on prod soak between #3 and #4 and between #5 and #9.

**Out of scope per user-decided 2026-05-01:** retiring the `/assign-player` open picker. The picker stays live indefinitely alongside the new `/join` flow. Once the new flow is proven in production, a future ticket can revisit retirement — but that's not on this chain.

---

## 11. Redis key shapes — what changes when

| Stage | Key | Value | Notes |
|---|---|---|---|
| Now (v1.26.0) | `t9l:auth:map:<leagueId>:<lineId>` | `{ playerId, playerName, teamId }` or NULL_SENTINEL | unchanged through stages 1–3 |
| Stage 2+ | `t9l:auth:map:<leagueId>:<lineId>` | `{ playerId, playerName, teamId, userId }` | parser already tolerates extra fields; old values without userId still parse |
| Stage 2.5+ | `t9l:user:memberships:<userId>` | `[{ leagueId, leagueName, subdomain, teamId, teamName }, ...]` | NEW, 10-min TTL, busted on `LeagueMembership` write |
| Stage 4 | unchanged from stage 2 | `{ playerId, playerName, teamId, userId }` | same shape; `Player.lineId` is dropped from the source data only |

No key namespace migration is required. The new `userId` field is additive; the new `t9l:user:memberships:` namespace is independent.

---

## 12. Next PR proposal — Multi-provider auth foundation (stage α.5)

**Branch:** `claude/multi-provider-auth-foundation`
**Version bump:** 1.27.0 → 1.28.0 (additive feature schema + new providers + new auth surfaces; minor)
**Status:** ready to ship — no orchestrator gate needed beyond the user reviewing this proposal.

### Why this PR before β

Stage β was originally drafted to dual-write `User.playerId ↔ Player.userId` keyed on `lineId`. The user has now expanded scope to include Google + email signups — for those users there is no `lineId`, so β has no key to dual-write FROM. Building the multi-provider foundation first means:
1. Stage β's dual-write is keyed on `User.id` directly (resolved from `Account` for any provider), one path that handles all three sign-up surfaces uniformly.
2. The `Account` join table is the canonical multi-provider identity at the User layer — no per-provider branching in the rest of the codebase.
3. New non-LINE users are immediately first-class; they sign up, they get a `User`, they can be linked to a `Player` via the upcoming `/join/[code]` flow without a separate "are you a LINE user or not" gate.

The cost is one extra PR in the chain (9 instead of 8) and one extra prod soak window. Acceptable.

### Schema diff

```diff
 model User {
   id         String   @id @default(cuid())
   lineId     String?  @unique
   name       String?
   pictureUrl String?
   role       Role     @default(VIEWER)
   createdAt  DateTime @default(now())
   updatedAt  DateTime @updatedAt
   playerId   String?  @unique
+
+  // Stage α.5 of account-player-rework (v1.28.0). NextAuth Prisma adapter
+  // requires these on User. Both nullable: LINE OAuth doesn't always provide
+  // an email, only Google OAuth and EmailProvider (magic link) guarantee a
+  // verified address. PostgreSQL @unique fires only when value is non-null.
+  email          String?    @unique
+  emailVerified  DateTime?
+
+  accounts       Account[]
 }
+
+// Stage α.5. NextAuth adapter Account table (multi-provider join).
+// One User can have many Account rows — e.g. Stefan signs in with LINE,
+// later adds Google; both rows point at his single User.id. Resolution
+// at JWT time goes (provider, providerAccountId) → Account.userId → User.
+model Account {
+  id                       String   @id @default(cuid())
+  userId                   String
+  type                     String                       // "oauth" | "email" | "credentials"
+  provider                 String                       // "line" | "google" | "email"
+  providerAccountId        String                       // LINE sub | Google sub | email address
+  refresh_token            String?  @db.Text
+  access_token             String?  @db.Text
+  expires_at               Int?
+  token_type               String?
+  scope                    String?
+  id_token                 String?  @db.Text
+  session_state            String?
+
+  user                     User     @relation(fields: [userId], references: [id], onDelete: Cascade)
+
+  @@unique([provider, providerAccountId])
+  @@index([userId])
+}
+
+// Stage α.5. NextAuth EmailProvider verification tokens (one-shot magic-link
+// codes). Token is hashed before storage; identifier is the email address.
+// Default expiry 10 minutes (NextAuth-managed). Standard adapter shape;
+// matches @auth/prisma-adapter's expected schema exactly.
+model VerificationToken {
+  identifier String
+  token      String   @unique
+  expires    DateTime
+
+  @@unique([identifier, token])
+}
```

**No `Session` model.** JWT-only sessions stay as-is (load-bearing for v1.5.0 Redis-canonical mapping store and v1.24.0 cross-subdomain cookie scope). NextAuth v4's `PrismaAdapter` no-ops session methods under JWT strategy.

### Files touched

```
prisma/schema.prisma                                              ~50 lines added
prisma/migrations/<TS>_multi_provider_auth_foundation/migration.sql  (auto-generated)
src/lib/version.ts                                                1 line (1.27.0 → 1.28.0)
tests/unit/version.test.ts                                        1 line
package.json                                                      +2 deps:
                                                                    "@auth/prisma-adapter": "^2.x"
                                                                    "nodemailer": "^6.x"
                                                                  +1 devDep:
                                                                    "@types/nodemailer": "^6.x"

src/lib/auth.ts                                                   ~80 lines added/changed
                                                                    - import PrismaAdapter, GoogleProvider, EmailProvider
                                                                    - adapter: PrismaAdapter(prisma) on authOptions
                                                                    - 2 new providers
                                                                    - JWT callback fork: google / email / line branches
                                                                    - LINE branch unchanged in resolution; captures token.userId

src/types/next-auth.d.ts                                          ~5 lines
                                                                    - Session.userId: string | null
                                                                    - Session.email: string | null

src/app/auth/signin/page.tsx                                      NEW — ~120 lines
                                                                    - provider picker: LINE | Google | "sign in with email"
                                                                    - replaces NextAuth default sign-in page

src/app/auth/verify-request/page.tsx                              NEW — ~30 lines
                                                                    - "check your email" landing after email submit

scripts/backfillAccountFromLineLogin.ts                           NEW — ~250 lines
                                                                    - reads existing User.lineId and Player.lineId rows
                                                                    - upserts Account(provider="line", providerAccountId=lineId)
                                                                    - --dry-run / --apply / --verbose modes
                                                                    - pure decideBackfillAction helper exported
                                                                    - idempotent

tests/unit/multiProviderAuthSchema.test.ts                        NEW — ~150 lines
                                                                    - Account @@unique([provider, providerAccountId]) enforced
                                                                    - VerificationToken @@unique([identifier, token]) enforced
                                                                    - User.email @unique fires only on non-null
                                                                    - User has many Account; Account belongs to User

tests/unit/backfillAccountFromLineLogin.test.ts                   NEW — ~200 lines
                                                                    - decideBackfillAction CREATE/MATCH/SKIP branches
                                                                    - covers User-with-lineId + Account-missing → CREATE
                                                                    - covers Account-already-exists → MATCH
                                                                    - covers Player.lineId without User → CREATE-USER-AND-ACCOUNT
                                                                    - idempotent: second --apply run is all MATCH

tests/unit/authJwtCallback.test.ts                                EXTENDED — ~80 lines
                                                                    - line-mock provider: existing path passes (regression)
                                                                    - google: token.userId set, lineId null
                                                                    - email: token.userId set, lineId null
                                                                    - LINE adapter-managed: existing User reused (no dup)

tests/e2e/multi-provider-signin.spec.ts                           NEW — ~150 lines (gated to localhost)
                                                                    - Google sign-in creates exactly one User + one Account
                                                                    - email magic-link round-trip end-to-end
                                                                    - existing LINE user signs in post-α.5: User count stable

CLAUDE.md                                                         ~80 lines added
                                                                    - top frontmatter: v1.28.0 ledger entry
                                                                    - new "Auth providers" subsection under "Architecture Overview"
                                                                    - per-PR ledger row
                                                                    - File Structure: noted Account/VerificationToken adapter tables
                                                                    - Environment Variables: GOOGLE_CLIENT_ID/SECRET, EMAIL_*
                                                                    - Sheets→DB Migration / Identity rework chain entry for α.5
```

### Behavior shipped

**Existing LINE users:** post-merge their first sign-in goes through the wired adapter, which finds their pre-α.5-backfilled `Account(provider="line")` row and reuses the existing `User`. JWT callback continues to populate `playerId` / `teamId` via the existing `lineId → Player` path. **No user-visible change.**

**New Google sign-in:** adapter creates a fresh `User` row (with email from Google profile) + an `Account(provider="google")` row. JWT callback sets `token.userId` but no `playerId`. They land on `/` signed in but with no league context. To do anything, they need to redeem a `LeagueInvite` (PRs #6/#7).

**New email sign-in:** user enters email on `/auth/signin` → submits → `EmailProvider.sendVerificationRequest` mails a magic link → user clicks link → `VerificationToken` is consumed → adapter creates User + Account(provider="email"). JWT callback sets `token.userId`. Same lurker-with-no-league-context state as Google until they redeem an invite.

**Admin-credentials login:** unchanged. Admin still uses env-var creds; no DB User row exists for admin, so the JWT callback's existing admin branch is untouched.

### CI / verification

- `prisma migrate deploy` runs on the per-PR Neon branch DB during build (already in pipeline).
- `prisma generate` produces a Prisma client with the new types.
- `tsc --noEmit` confirms no existing call sites broke.
- New unit tests pin the schema invariants and the JWT callback branches.
- Playwright e2e (gated to localhost) exercises the full Google + email flows against a dev preview.

### Pre-merge protocol

1. **Neon snapshot** (Layer 3): `neonctl branches create --name pre-pr-43-multi-provider --parent production --project-id young-lake-57212861`. Snapshot before merge for rollback.
2. **Pre-α.5 backfill DRY RUN against prod** before merge. Pulls prod env, runs `npx tsx scripts/backfillAccountFromLineLogin.ts --dry-run --verbose`, expects all CREATE actions for existing LINE users (~30+ Account rows expected on first run). Surface output for sign-off.
3. **Pre-α.5 backfill APPLY against prod** before merge. Same env, `--apply`. Verifies idempotent on second run.
4. **Per-PR Neon branch CI** confirms migration applies cleanly.
5. **Type-check + Vitest green** before requesting merge.
6. **Per-push reporting** per CLAUDE.md autonomy rule: "PR #N pushed", "merged at <SHA>", "v1.28.0 live on apex".
7. **Post-deploy smoke:** an existing LINE user signs in to confirm no duplicate User / orphan session. Log volume check for the new auth paths.

### Provider env-var requirements

The PR description must surface these env vars for the operator to set on Vercel BEFORE prod deploy (otherwise the providers fail silently):

```
GOOGLE_CLIENT_ID         — from Google Cloud Console OAuth credentials
GOOGLE_CLIENT_SECRET     — same
EMAIL_SERVER             — SMTP connection string (recommended: Resend)
                           e.g. smtp://resend:RESEND_API_KEY@smtp.resend.com:587
EMAIL_FROM               — sending address (e.g. "T9L <noreply@t9l.me>")
```

If any of `GOOGLE_*` is unset, the GoogleProvider is omitted from the providers array (defensive — avoids "missing client_id" runtime errors on signin page render). Same for `EMAIL_*`. Documented in `src/lib/auth.ts`.

### What this PR DOES NOT do

- Does not write to `Player.userId` or `User.playerId` from any code path. (Stage β.)
- Does not add `joinSource` to `PlayerLeagueAssignment`. (Stage β.)
- Does not change `getPlayerMappingFromDb` or its callers. (Stage γ.)
- Does not change `/api/assign-player`, `/api/rsvp`, or any league-write path.
- Does not introduce `LeagueInvite` reads/writes. (PRs #6/#7.)
- Does not change Redis key shapes or values. The `t9l:auth:map:<leagueId>:<lineId>` namespace stays exactly as v1.26.0 specced.
- Does not introduce a `/account/connections` UI for linking a second provider to an existing User. (Deferred — see §13.)
- Does not retire the `LineLogin` table. It stays alongside `Account` through stage 4 since it's load-bearing for the admin Flow B orphan dropdown.
- Does not change the admin-credentials flow.

It's the smallest possible thing that adds Google + email signup paths and lets stage β build provider-agnostic dual-write. By design.

---

## 12.legacy. First PR proposal (historical) — Identity rework α (additive schema)

**Status:** ✅ shipped as PR #102 / v1.27.0 (2026-05-01). Body retained below for reference.

**Branch:** `claude/identity-rework-alpha`
**Version bump:** 1.26.0 → 1.27.0 (additive feature schema; minor)

### Schema diff

```diff
 model User {
   id         String   @id @default(cuid())
   lineId     String?  @unique
   name       String?
   pictureUrl String?
   role       Role     @default(VIEWER)
   createdAt  DateTime @default(now())
   updatedAt  DateTime @updatedAt
+
+  // Stage 1 of account-player-rework. 1:1 link to the canonical Player
+  // profile this human is associated with. Nullable because:
+  //   (a) admin-credentials Users have no Player counterpart;
+  //   (b) brand-new LINE users sign in BEFORE picking a Player slot.
+  // The 1:1 is enforced by @unique. The reverse mirror lives on
+  // Player.userId. Stage 2 adds @relation; this stage keeps the columns
+  // independent so the migration is fully additive (no FK to fail).
+  playerId   String?  @unique
 }

 model Player {
   id         String   @id @default(cuid())
   name       String
   position   String?
   lineId     String?  @unique
   pictureUrl String?
   createdAt  DateTime @default(now())
   updatedAt  DateTime @updatedAt
+
+  // Stage 1 of account-player-rework. Mirror of User.playerId — the
+  // 1:1 binding from the canonical Player profile to its global User
+  // identity. Nullable through stage 3 (existing rows backfill in
+  // stage 2; stage 3 reads from this column with a flag). Stage 4
+  // drops Player.lineId and makes this the only identity column.
+  userId     String?  @unique

   leagueAssignments PlayerLeagueAssignment[]
   goals             Goal[]
   assists           Assist[]
   availability      Availability[]
 }

+enum InviteKind {
+  CODE
+  PERSONAL
+}
+
+// Stage 1 of account-player-rework. The join gate that replaces the
+// open `/assign-player` picker. Two flavors:
+//   - CODE: a shared code (e.g. "T9L-2026-K7M9") that any user can
+//     redeem to claim ONE unlinked Player slot in the league's roster.
+//   - PERSONAL: a code pre-bound to a specific Player (targetPlayerId);
+//     the recipient lands on a "Confirm: you are X" screen with no picker.
+//
+// Stage 1 introduces the table only. Reads/writes added in PRs #5/#6.
+// Cascades on League delete — invites for a deleted league are
+// meaningless, and we'd rather have the row vanish than dangle.
+model LeagueInvite {
+  id              String     @id @default(cuid())
+  leagueId        String
+  code            String     @unique
+  kind            InviteKind
+  targetPlayerId  String?    // populated only when kind == PERSONAL
+  createdById     String?    // FK → User.id (nullable for system-generated)
+  expiresAt       DateTime?
+  maxUses         Int?       // null = unlimited
+  usedCount       Int        @default(0)
+  revokedAt       DateTime?
+  createdAt       DateTime   @default(now())
+
+  league          League     @relation(fields: [leagueId], references: [id], onDelete: Cascade)
+
+  @@index([leagueId])
+  @@index([code])
+}
```

That's the full schema delta. Three additive columns, one new table, one new enum. No FK enforcement between the new columns yet (User.playerId and Player.userId are independent unique nullable columns) so the migration is trivially revertible.

### Files touched (PR #1)

```
prisma/schema.prisma                            ~30 lines added
prisma/migrations/<TIMESTAMP>_identity_rework_alpha/migration.sql   (auto-generated)
src/lib/version.ts                              1 line (1.26.0 → 1.27.0)
tests/unit/version.test.ts                      1 line
tests/unit/identityReworkAlphaSchema.test.ts    NEW — ~150 lines
                                                  - User.playerId accepts null/string/@unique
                                                  - Player.userId accepts null/string/@unique
                                                  - LeagueInvite round-trips CODE/PERSONAL rows
                                                  - LeagueInvite cascades on League delete
CLAUDE.md                                       ~40 lines added
                                                  - top frontmatter: v1.27.0 ledger entry
                                                  - new "Identity rework chain (α/β/γ/δ)" section
                                                    under [Sheets→DB Migration] (mirroring shape)
                                                  - per-PR ledger row for PR 42 (or whatever number)
                                                  - File Structure: schema additions noted in models
```

**No source-code changes** in `src/`. No reads, no writes, no JWT changes. The schema sits inert until PR #2 starts dual-writing.

### CI / verification

- `prisma migrate deploy` runs on the per-PR Neon branch DB during the build (already in pipeline).
- `prisma generate` produces a Prisma client with the new types.
- `tsc --noEmit` confirms no existing call sites broke (none should — fields are additive).
- New unit test file pins the column-level invariants; failing it would catch a missing `@unique` or a wrong type.

### Pre-merge protocol

1. **Neon snapshot before merge** (Layer 3): `neonctl branches create --name pre-pr-42-identity-alpha --parent production --project-id young-lake-57212861`. The migration is additive but we want the rollback path documented. Update CLAUDE.md ledger row pre-merge.
2. **Per-PR Neon branch CI**: confirm migration applies cleanly.
3. **Type-check + Vitest green** before requesting merge.
4. **Per-push reporting** per CLAUDE.md autonomy rule: surface "PR #42 pushed", then "PR #42 merged at <SHA>", then "v1.27.0 live on apex".

### What this PR DOES NOT do

- Does not write to `User.playerId` from any code path.
- Does not write to `Player.userId` from any code path.
- Does not write to `LeagueInvite` from any code path.
- Does not change `getPlayerMappingFromDb`.
- Does not change `/api/assign-player`.
- Does not change the JWT callback.
- Does not change Redis key shapes or values.
- Does not introduce `@relation` between `User` and `Player`.
- Does not touch `PlayerLeagueAssignment` (rename is stage 2, not stage 1).

It's the smallest possible thing that lets PR #2 land without a separate migration step. By design.

---

## 13. Open questions

### Resolved (user-decided 2026-05-01)

- ✅ **Naming.** Keep `Player` as the canonical-profile entity. Don't rename to `Person`/`Profile`/`Member`.
- ✅ **`PlayerLeagueAssignment` rename.** Don't rename. Keep the model name as-is across all stages.
- ✅ **Invite-code default expiry.** `expiresAt = createdAt + 7 days` by default at the application layer (admin can override or set null per-invite).
- ✅ **`/assign-player` picker retirement.** Don't retire as part of this chain. It stays live indefinitely; revisit only after the new flow is proven.
- ✅ **Multi-provider scope (added).** Support LINE + Google OAuth + email signups. Stage α.5 lays the multi-provider foundation before stage β dual-write.
- ✅ **OAuth provider for non-LINE.** Google. (Apple / Microsoft / GitHub deferred; can add later via the same `Account` join.)
- ✅ **Email-auth flavor.** Magic-link (NextAuth EmailProvider) over password — recommended for fewer surfaces and inherent verification. Password+bcrypt remains an option to add later as a parallel CredentialsProvider if magic-link friction becomes a real complaint; the adapter integration doesn't change.

### Deferred — surface when relevant in later stages

- **`User.id` shape.** Currently `cuid()`. Should the *public-facing* user identifier be a slug (mirror of how `Player.id` carries `"p-"` prefix today)? Recommendation: keep `User.id` as opaque cuid; never expose it client-side. Use `Player.id` (which already has a public slug shape) for any UI-visible references. Surface in PR #3 (β / dual-write) if it affects the dual-write helper signatures.
- **`Player.lineId` removal timing.** Stage 4 plan says 3–4 weeks after stage 3 cutover. Recommendation: tie to "no DRIFT logs for 14 consecutive days post-cutover" rather than a calendar window. Surface in PR #4 (introduces the drift detector) and again at the operator flip (PR #5) so the soak gate is documented.
- **Switcher placement on small viewports.** The mockup in §6 is desktop-shaped. On mobile, inside the hamburger menu or as a top-of-page banner? Recommendation: inside the hamburger menu when one exists; dropdown adjacent to the user-name pill otherwise. Surface in PR #8 when the switcher actually ships.
- **Account-linking UX for existing users.** Stefan signed up with LINE; later wants to add Google so he can also sign in from his work laptop. NextAuth's adapter supports this via the `linkAccount` callback when a signed-in user initiates a second OAuth flow, but we need a `/account/connections` page in the UI to expose it. Out of scope for α.5; surface for a later PR after stage 3 cutover. Until then, a user with two providers needs admin help (admin can manually `prisma.account.create({ ... })` to link).
- **Email change / removal.** A user signed up with email `a@example.com` and wants to change to `b@example.com`. NextAuth's adapter doesn't expose this natively — needs a custom flow (verify new address → update User.email). Out of scope for α.5. Operationally, the user can sign up fresh with the new address and ask admin to merge.
- **Disposable-email blocklist.** Section §7 documents the abuse vector. Don't pre-emptively ship a blocklist — wait for actual abuse signal. Operator can add via env var when needed.
- **LINE without email.** LINE OAuth doesn't always provide an email. Adapter creates a User row with `email = null`, which is fine. But: a user who signed up with LINE-no-email later wants to add Google (which has email) — the adapter's account-linking flow may try to merge by email and find no match, or create a fresh User. Resolution: in the future `/account/connections` page, the linking is initiated from a signed-in session, so the userId is fixed; email match is irrelevant. Surface in the deferred account-linking PR.
- **Vercel email transport.** EmailProvider needs an SMTP server. Recommendation: Resend (free tier covers test volume; integrates with NextAuth's `EmailProvider` via SMTP relay) OR a transactional provider Stefan already uses. Document the `EMAIL_SERVER` env var format in the α.5 PR description.

---

## 14. Stop conditions (would pause the chain)

Surfaced explicitly so future-me knows what to flag immediately rather than papering over:

- **Real LINE users can't authenticate after α.5 goes live.** Most likely failure mode: the pre-α.5 backfill didn't run (or ran incomplete), so the adapter creates a duplicate User row on first LINE login post-deploy. Surfaces as "I just signed in but my session has no playerId / teamId" or as a unique-constraint violation in Vercel logs (`Account.@@unique([provider, providerAccountId])` race). Roll back α.5 by reverting the merge; backfilled `Account` rows are harmless to leave in place.
- **Real LINE users can't authenticate after dual-write goes live (stage 2).** This means the JWT callback is silently swallowing a Prisma error from the new write — surface, do not deploy, roll back stage 2.
- **A new email signup creates a duplicate User row when an existing User with the same email exists.** PostgreSQL's `@unique` on `User.email` should reject this at the DB layer with a 500. If the adapter SILENTLY merges, that's a bigger problem (data leak across accounts). Investigate via the e2e regression in §9 before flipping α.5 on.
- **EmailProvider's `sendVerificationRequest` is failing silently.** Users click "sign in with email", form submits, no email arrives. Logs should show the SMTP failure. Verify the `EMAIL_SERVER` config and `EMAIL_FROM` address are correct.
- **Drift detector logs persistent divergence (stage 3 shadow run).** If `[v1.30 DRIFT]` lines appear at any rate beyond test-injected scenarios, do NOT flip the `Setting` to `'user'`. Investigate source first.
- **A LINE user with a default-league membership AND a subdomain membership reports "I'm logged out when I switch subdomains."** This means the cross-subdomain JWT (v1.24.0) regressed. Stage 3 must not weaken cookie scope.
- **Backfill collision rate >5% on the dry-run.** Means there are more `User` rows or `Player` rows out there than the model expects (admin-created Players with manually-set `lineId` that don't have a corresponding `LineLogin`, etc.) — investigate before applying.
- **Schema migration on Neon snapshot fails with anything other than "column already exists" or "table already exists".** Means the schema isn't as additive as we thought.

---

End of design doc.
