# Match events epic — design doc

Aug-2026 multi-PR feature: introduce a unified MatchEvent log tied to a Match + Player(s), make scorelines a derived cache of events (with admin override), expose admin CRUD, add per-matchday public pages, and let players self-report their own goals.

Six PRs (α / β / γ / δ / ε / ζ). Each ships independently and atomically. PR α through γ are server-side / admin-side; PR δ is the public read-flip; PR ε exposes the per-matchday page; PR ζ adds the gated player-side write.

Locked decisions from the user brief (do not re-question):
- Single `MatchEvent` row per "thing that happened in a match" — `kind` enum is just `GOAL` to start (extensible later) and `goalType` covers OPEN_PLAY / SET_PIECE / PENALTY / OWN_GOAL.
- Scoreline is a derived cache off MatchEvent; `Match.scoreOverride` (new String? column) wins when non-null (forfeits, abandoned, etc.).
- Own-goal counts toward the **opposite** team's tally. The MatchEvent.scorerId still points at the OG-er — the team affiliation is what flips.
- Admin event editor uses smart pickers: for OPEN_PLAY/SET_PIECE/PENALTY scorer/assister both filter to the beneficiary team; for OWN_GOAL the scorer picker filters to the **opposing** roster (it's a player on the other team conceding to themselves), assister stays on the beneficiary side and is nullable.
- Player self-report: gated to logged-in + linked + after the matchday's earliest kickoff in JST. Auto-approved (no moderation) for v1; revisit if abused.
- Backfill from `GoalsRaw` sheet, dry-run first, log unresolved rows. Never mutate `Match.score` in the backfill — surface mismatches for user review and skip.

---

## Current data model (pre-α)

`Goal` + `Assist` Prisma models exist with this shape:
- `Goal { id, matchId, playerId (scorer), scoringTeamId, minute?, isOwnGoal, createdAt }`
- `Assist { id, matchId, playerId (assister), goalId (1:1), createdAt }`

Goals are read by:
- `src/lib/admin-data.ts#getLeagueStats` → `src/components/admin/StatsTab.tsx` (top scorers + table)
- `src/lib/dbToPublicLeagueData.ts` → flattens into `Goal[]` for public consumers
- `src/components/MatchdayCard.tsx` → per-match scorer ticks ("⚽️ Stefan (Alex)")
- `src/components/StatsDashboard.tsx`, `TopPerformers.tsx` etc. via `LeagueData.goals`

`Match.homeScore` / `Match.awayScore` (Int defaults 0) hold the scoreline today. `addGoal` / `deleteGoal` server actions in `src/app/admin/actions.ts` mutate Goal + Assist but do NOT recompute the score — `updateMatchScore` is a separate path. Two systems of truth that we're collapsing to one.

`Sheets!GoalsRaw` columns (from `src/lib/data.ts#parseGoals`):
| col | meaning |
|---|---|
| A | matchday label ("MD3") or `#REF!` |
| B | timestamp |
| C | scoring team name |
| D | conceding team name |
| E | scorer name |
| F | assister name (nullable) |

GoalsRaw does NOT carry `goalType` or `minute` today — historical events will land as `OPEN_PLAY` with `minute: null` unless the sheet has been edited to encode the type. Document the assumption in the backfill report.

---

## Target data model (post-α)

```prisma
enum EventKind {
  GOAL
}

enum GoalType {
  OPEN_PLAY
  SET_PIECE
  PENALTY
  OWN_GOAL
}

model MatchEvent {
  id          String    @id @default(cuid())
  matchId     String
  kind        EventKind @default(GOAL)
  goalType    GoalType?               // null when kind != GOAL (forward compat)
  scorerId    String                  // FK Player
  assisterId  String?                 // FK Player, nullable
  minute      Int?                    // event clock minute, nullable (event allowed without it)
  createdById String?                 // FK User — audit who entered the row
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  match    Match   @relation(fields: [matchId], references: [id], onDelete: Cascade)
  scorer   Player  @relation("EventScorer", fields: [scorerId], references: [id])
  assister Player? @relation("EventAssister", fields: [assisterId], references: [id])
  createdBy User?   @relation(fields: [createdById], references: [id])

  @@index([matchId])
  @@index([scorerId])
  @@index([assisterId])
}

model Match {
  // ... existing fields preserved
  homeScore     Int     @default(0)   // becomes derived cache
  awayScore     Int     @default(0)   // becomes derived cache
  scoreOverride String?                // NEW — non-null wins over the cache
  events MatchEvent[]
}

model Player {
  // ... existing
  scoredEvents   MatchEvent[] @relation("EventScorer")
  assistedEvents MatchEvent[] @relation("EventAssister")
}

model User {
  // ... existing
  authoredEvents MatchEvent[]
}
```

**Why both Goal+Assist AND MatchEvent for now.** Goal+Assist stays in the DB through PRs α–γ because:
- The Sheets backfill already lives there; nothing breaks.
- Public read paths (StatsTab, MatchdayCard) consume Goal records via `dbToPublicLeagueData`; flipping that is a separate, isolatable change (PR δ).
- The dual-table window is bounded — PR δ flips reads to MatchEvent, after which Goal+Assist are dead writes that we keep around for forensics.

A later PR (out of this epic, post-δ verify) can drop Goal+Assist once we're confident the new path is correct.

**Why `Match.homeScore`/`awayScore` stay as Int columns** (not removed). They become a **cache** that's recomputed inside `recomputeMatchScore(matchId)` whenever a MatchEvent row changes. Reads still use `Match.homeScore`/`awayScore` — fast, and matches the existing query shape. Override path: when `scoreOverride` is non-null, we still hold the cache as the "what events imply" and the override as "what gets displayed", so admins can flip the override on/off without losing event-implied scores.

`scoreOverride` shape: free-text String like `"3-0 (forfeit)"` or `"abandoned"`. Display logic prefers the override; computational paths (top scorers etc.) keep using events.

**Own-goal handling in cache compute.**
```
for each event in match.events where kind=GOAL:
  let scorerTeamId = team(event.scorerId in this match's roster)
  let beneficiaryTeamId = (goalType === 'OWN_GOAL') ? otherTeam(scorerTeamId) : scorerTeamId
  if beneficiaryTeamId === match.homeTeamId: home++
  else if beneficiaryTeamId === match.awayTeamId: away++
  else: skip (defensive — a goal credited to a player not on either team is a data bug)
```

Player→team resolution at compute time goes through `PlayerLeagueAssignment` filtered by `match.gameWeekId` (the canonical "what team was this player on this matchday" lookup). Cached if needed. v1 takes the simple round-trip — recompute fires on writes only, not on reads.

---

## PR sequencing

Each PR ships its own version bump + tests + ledger row + tag.

### PR α — Schema + score helpers (v1.42.0)

**Schema migration** (`prisma/migrations/<timestamp>_match_events`):
- `CREATE TYPE "EventKind" AS ENUM ('GOAL')`
- `CREATE TYPE "GoalType" AS ENUM ('OPEN_PLAY', 'SET_PIECE', 'PENALTY', 'OWN_GOAL')`
- `CREATE TABLE "MatchEvent"` with FKs + indexes per the schema above
- `ALTER TABLE "Match" ADD COLUMN "scoreOverride" TEXT NULL`

Purely additive. No DROP, no ALTER COLUMN. Existing rows unchanged. Layer-3 Neon snapshot likely skipped (over the 10/10 cap by now); document the rollback recipe in the ledger row.

**New file `src/lib/matchScore.ts`:**
- `computeScoreFromEvents(match, events, leagueAssignments) → { home: number, away: number }` — pure function, takes a Match + its MatchEvent rows + a player→team lookup, returns the cache values.
- `resolveDisplayScore(match) → { home: number, away: number, kind: 'cache' | 'override', overrideText?: string }` — applies the override fallback. The override is a String, so when set we also try to parse it as `"H-A"` to surface numeric values for places that need them; if it doesn't parse we expose the raw text for display and treat home/away as the cache values for sort math.
- `recomputeMatchScore(prisma, matchId) → Promise<void>` — call this after every MatchEvent write. Reads events + assignments + match, computes, writes `Match.homeScore`/`awayScore`. Idempotent. Wraps in a transaction so admin actions can chain without partial state.

**Tests** in `tests/unit/matchScore.test.ts`:
- regular goals scoring for both home and away teams
- mixed goal types (OPEN_PLAY + PENALTY + SET_PIECE all count for the scorer's team)
- own-goal flips to the opposite team
- empty events → 0-0
- override fallback when `scoreOverride` is set, parses `"3-0 (forfeit)"` shape
- override fallback when `scoreOverride` is unparseable text (`"abandoned"`) — raw text exposed; cache integers preserved
- defensive: event with scorer not on either team is skipped, not counted

**No UI change.** No call site is modified yet. The helpers exist, the schema exists, nothing reads from MatchEvent. CLAUDE.md gets a new "Match events" section + ledger row.

Bump `APP_VERSION` to `1.42.0` (minor — schema additions, new public-API helpers).

### PR β — Backfill from GoalsRaw sheet (v1.42.1)

**New script `scripts/backfillMatchEventsFromSheet.ts`:**
- Reads `GoalsRaw!A:F` via the existing service-account auth in `scripts/sheetsToDbBackfill.ts` (extract a small `fetchGoalsRaw()` helper that the existing backfill can also use, or import from the existing module — verify duplication risk).
- For each row: resolve `(matchday#, scoringTeamName, concedingTeamName) → Match.id` via Prisma. Resolve `(playerName, teamName) → Player.id` via `PlayerLeagueAssignment` joined to LeagueTeam. Use case-insensitive trimmed match; if no exact match, try fuzzy fallback (lowercase + collapse whitespace + strip diacritics — same shape as `slugify`). Log everything that doesn't resolve and SKIP it.
- Map each row to `MatchEvent { kind: GOAL, goalType: OPEN_PLAY (default — historical sheet rows have no type metadata), scorerId, assisterId?, minute: null, createdById: null }`.
- `--dry-run` (default) → print proposed inserts + unresolved rows.
- `--apply` → run inside a transaction per match. After all events for a match are inserted, **compute the score from events and compare to existing `Match.homeScore`/`awayScore`**. If mismatch, surface a warning and **DO NOT** mutate the cache; keep the inserted events but flag the match for user review. We never mutate the existing scoreline in this PR.

**Output:** `outputs/match-events-backfill-report.md` populated by the script's `--apply` run, listing per-match decisions: events inserted, unresolved rows, score-vs-cache deltas.

**Operator-side note:** the actual prod apply requires DB credentials I don't have inside the worktree. PR β ships the script + a dry-run report. Surface to dispatch that the user runs `--apply` against prod manually.

**Tests** in `tests/unit/backfillMatchEvents.test.ts`:
- pure decision helpers (resolve player, resolve match, decide goalType from sheet — always OPEN_PLAY in v1)
- `decideRowAction` returns INSERT / SKIP-UNRESOLVED-PLAYER / SKIP-UNRESOLVED-MATCH branches
- mismatch-with-cache reports but does NOT trigger a cache mutate

Bump `APP_VERSION` to `1.42.1` (patch — new script + backfill data; no behavior change in prod app).

### PR γ — Admin event CRUD (v1.43.0)

**Replace `src/components/admin/StatsTab.tsx`** with a redesigned events-first surface.

**New layout** (one `<StatsTab>` component, mobile-first):
- Toolbar: `[+ New event]` + matchday filter chips + search box (player or team substring)
- Events list: each row shows
  - Minute (or `—`)
  - GoalType chip (OG / OP / SP / PEN — color-coded; legend on hover)
  - Scorer name • team
  - Assister name • team (or `—`)
  - Match label (`MD4 · Mariners vs Fenix`)
  - `[Edit]` `[Delete]` per-row buttons
- Sort: by matchday desc, then by minute asc (events with null minute land at the end of their match group)

**Editor (modal or inline form):**
1. Match picker — filter to current league's matches; sorted by recent matchday first
2. Beneficiary team toggle — `[Home: Mariners FC] / [Away: Fenix FC]` (defaults to home)
3. GoalType picker — radio buttons: OPEN_PLAY (default) / SET_PIECE / PENALTY / OWN_GOAL
4. Scorer picker — depends on the toggles:
   - if `goalType === 'OWN_GOAL'`: shows roster of the **opposite** team (player conceding to themselves)
   - else: shows roster of the beneficiary team
5. Assister picker — defaults to "no assist"; when shown, lists the beneficiary team's roster minus the scorer (a player can't assist their own goal, even on an own-goal — though for OWN_GOAL the assister field is rarely meaningful, kept for consistency and per user's "leave nullable" call)
6. Minute input — number 0–120, optional

**Server actions** in `src/app/admin/leagues/actions.ts`:
- `adminCreateMatchEvent({ matchId, leagueId, scorerId, assisterId?, goalType, minute? })` — inserts MatchEvent, calls `recomputeMatchScore(matchId)`, revalidates `domain: 'admin' + paths: ['/admin/leagues/${leagueId}/stats', '/admin/leagues/${leagueId}/schedule']`.
- `adminUpdateMatchEvent({ eventId, leagueId, ...patch })` — updates fields, recomputes score on the affected match (and on the prior match if `matchId` changed — though we don't expose match-change in v1).
- `adminDeleteMatchEvent({ eventId, leagueId })` — deletes, recomputes.

Validation: scorer required, scorerId must exist in the beneficiary team's roster (or opposing team's for OWN_GOAL). All gates server-side; client picker is the affordance, not the contract.

**Existing `addGoal` / `deleteGoal` actions in `src/app/admin/actions.ts` are left untouched** — they still run against Goal+Assist. PR γ adds a second admin write path against MatchEvent. PR δ's read-flip is the trigger to retire the old path.

**Tests** in `tests/unit/adminMatchEventActions.test.ts`:
- create with valid scorer fires `recomputeMatchScore`
- create with scorer not on beneficiary team rejects
- create with own-goal scorer not on opposing team rejects
- update changes score cache idempotently
- delete recomputes and revalidates

Bump `APP_VERSION` to `1.43.0` (minor — new admin write capability + UI).

### PR δ — Read-flip + per-match event highlights (v1.44.0)

**Public read path flips** to compute scorelines from MatchEvent (via the cache `Match.homeScore`/`awayScore` columns, populated by `recomputeMatchScore` on every PR γ write).

`src/lib/dbToPublicLeagueData.ts` changes:
- Replace the `goals` Prisma include with `events` (or include both during a soak window — see below).
- The `LeagueData.goals` field flattening uses MatchEvent rows now; the public `Goal` interface stays the same shape (string scorer/assister names, scoringTeamId derived from scorer's team-on-this-matchday).
- `Goal.assister` continues to populate from `MatchEvent.assister.name`.
- New optional fields on the public Match shape: `events?: MatchEvent[]` carrying minute + goalType so the per-match highlights can render `"47' Stefan ⚽️ Alex 🅰️"` formatted.

**MatchdayCard / NextMatchdayBanner** consume the existing `Goal[]` fields; v1 of PR δ doesn't change their layout (the simple "⚽️ scorer (assister)" remains). The per-match event detail with minutes goes on the new per-matchday page (PR ε).

**Admin StatsTab read-flip** — same shift: replace `getLeagueStats` Goal query with a MatchEvent query. Compute top scorers / assists / table from MatchEvent.

**Soak window decision.** During PR δ I keep the Goal+Assist tables populated (PR γ's admin actions don't write to them, so the gap grows over time, but historic data stays). One option for safety: PR γ's admin actions ALSO mirror writes to Goal+Assist behind the scenes, so reads-from-Goal still work as a fallback. Decision: **don't dual-write**. The flip is verifiable in PR γ tests + the backfill rebuild, and historical Goal data is read-only legacy. If the read-flip surfaces a bug, revert PR δ; events stay populated and the next PR can re-attempt.

**Tests:**
- `tests/unit/dbToPublicLeagueDataEvents.test.ts` — adapter reshapes events into `Goal[]` correctly including own-goal team flip, minute exposure
- `tests/unit/statsTabEventReads.test.ts` — admin StatsTab reads from events

Bump `APP_VERSION` to `1.44.0` (minor — read path semantics change).

### PR ε — Per-matchday public page (v1.45.0)

**New route** `src/app/matchday/[id]/page.tsx`. Subdomain-aware: resolve leagueId via `getLeagueIdFromRequest()` (same pattern as `/schedule`, `/stats`). The `[id]` segment matches the public matchday id (e.g. `md4`).

**Page contents:**
- Header: matchday label + JST date + venue (link if `venueUrl`)
- Per-match section, ordered by kickoff:
  - `Mariners FC 2 — 1 Fenix FC` (scoreline; from PR δ's events-derived cache, with override fallback)
  - JST kickoff time
  - Per-event timeline: `47' ⚽️ Stefan (a. Alex)` etc., with goal-type icon (OG strikes through scorer? see below)
- Sitting-out section
- RSVP block (reuse `RsvpBar` if a current matchday) — gated to logged-in linked users on a relevant team
- Share link CTA — copy URL

**Visual taxonomy for events on the public page:**
- OPEN_PLAY → `⚽️`
- SET_PIECE → `⚽️ (set)` small pill
- PENALTY → `⚽️ (PEN)` small pill
- OWN_GOAL → `🟧 OG` small pill, scorer name italic + small footnote "(against own team)" — counts toward beneficiary's scoreline (already handled by cache)

**Linking from existing pages:**
- `/schedule` matchday cards get a `[View matchday]` link
- `Dashboard` matchday cards same

Tests: e2e via Playwright is heavyweight; settle for unit tests on the sub-components plus a manual screenshot in the PR description.

Bump `APP_VERSION` to `1.45.0` (minor — new public route).

### PR ζ — Player self-report (v1.46.0)

**On the per-matchday page** (PR ε): a `[Submit goals]` CTA, gated client-side AND server-side to:
- session is set
- `session.user.playerId` is non-null
- current JST time ≥ earliest kickoff in this matchday's matches
- matchday has at least one match with a kickoff (defensive — can't evaluate the gate otherwise; CTA hidden)

**Editor** (player-side, not admin):
- Lighter modal: same form fields as the admin editor but with `scorerId` LOCKED to `session.user.playerId` (read-only, not selectable)
- Match picker: filtered to matches in this matchday where the player's team is participating
- Beneficiary team toggle: derived — for OPEN_PLAY/SET_PIECE/PENALTY this is the player's team; for OWN_GOAL it's the **other** team (because OG benefits the opposite side). The form computes this from `goalType` rather than asking the user.
- Assister picker: any teammate on the player's team
- Minute: optional

**Server action** `submitOwnMatchEvent({ matchId, goalType, assisterId?, minute? })` in `src/app/api/match-events/route.ts` (or a co-located `src/app/matchday/[id]/actions.ts`):
- assertSession + assertHasPlayer
- assertMatchInThisMatchday
- assertKickoffPassed (re-evaluate the gate server-side; client UI is just an affordance)
- assertScorerOnRightTeam (player's own team for non-OG; opposing team — wait, the player can ONLY report OWN_GOALs against themselves, which they're scoring as the OG-er, so scorer = themselves on opposing team in the match's perspective... actually this collapses cleanly: scorer is always `session.user.playerId`, and the goalType decides who benefits. The validation is just "the player's team is participating in this match")
- insert MatchEvent + `recomputeMatchScore`

Auto-approved per user's call. `MatchEvent.createdById = session.user.id` so we can audit.

Tests:
- `tests/unit/playerSelfReportGate.test.ts` — pure helper for the kickoff-time gate, checks all branches
- `tests/unit/submitOwnMatchEvent.test.ts` — server action validates auth + ownership + match membership + recomputes

Bump `APP_VERSION` to `1.46.0` (minor — new player-facing write path).

---

## Hard constraints (per brief)

- Backward compat: pre-δ scoreline reads keep working (Goal+Assist tables alive through γ; δ flips reads).
- Backfill is non-destructive — never mutates `Match.homeScore`/`awayScore` directly. If event sum ≠ stored score, log + skip cache mutate; insert events anyway and surface for review.
- Per-push reporting: each PR push gets its own block per CLAUDE.md per-push rule.
- Admin-merge fallback for documented Neon-Vercel race.
- JST: `src/lib/jst.ts` for all kickoff comparisons.

## Out of scope (deferred)

- Retire Goal+Assist tables after PR δ verifies stable on prod (separate PR, post-epic)
- More EventKinds (cards, subs) — schema is ready (`EventKind` enum extensible) but no consumer wants them in v1
- Player-side event edit/delete — v1 is submit-only; if a player misclicks they ask admin
- Notification when a player submits an event — out of scope; admin watches the StatsTab CRUD list
