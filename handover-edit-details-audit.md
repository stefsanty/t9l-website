# Edit-my-details audit & redesign proposal

**Status:** AUDIT complete + post-rebase scope locked. PR #235 (v1.82.0
multi-position) is merged and this branch is rebased clean on
`origin/main`. Execution begins at M3 with the scope locked in §3 below.

**Scope:** `/account/player` — the page reached from the account-menu
"Edit my details" link (`src/components/LineLoginButton.tsx:333`).

---

## 1. Current state

### 1.1 Files in scope

| File | Role |
|---|---|
| `src/app/account/player/page.tsx` | Server component — auth gate, DB read, props assembly |
| `src/app/account/player/AccountPlayerForm.tsx` | Client component — UI + client-side wiring |
| `src/app/account/player/actions.ts` | `updatePlayerSelf`, `uploadPlayerProfilePicture`, `removePlayerProfilePicture` |
| `src/app/account/player/validation.ts` | `PROFILE_PIC_MAX_BYTES`, `PROFILE_PIC_ALLOWED_TYPES` (kept neutral per the v1.59.2 standing rule) |
| `tests/unit/accountPlayerActions.test.ts` | Server-action tests |
| `tests/unit/accountPlayerPageGate.test.ts` | Page-gate tests |
| `tests/unit/accountPlayerCleanupV162.test.ts` | v1.62.0 preference-removal regression |
| `tests/unit/accountPlayerValidationModule.test.ts` | v1.59.2 module-split regression |
| `tests/unit/accountPlayerMenuLink.test.ts` | Account-menu link presence |

### 1.2 What the page currently edits / shows

**Editable (single text form + side picture-upload flow):**
- `Player.name` — text input (`AccountPlayerForm.tsx:253-267`).
- Position — single `<select>` (`AccountPlayerForm.tsx:269-285`), values `'GK' | 'DF' | 'MF' | 'FW' | ''`. Server action writes `position` to **every active PLM** for the player via `prisma.playerLeagueMembership.updateMany({ where: { playerId, toGameWeek: null } })` (`actions.ts:143-146`).
- Profile picture — independent upload flow that writes `Player.profilePictureUrl`.

**Read-only ("set by admin"):**
- "Team assignment" — `currentTeamName` ± `currentLeagueName` (`AccountPlayerForm.tsx:319-346`). Picked from a single PLM at `page.tsx:149-156` — `find(activeAssignment matching default league)` then `find(toGameWeek === null)` then `[0]`.
- "ID upload" — boolean state of `User.idUploadedAt` (`page.tsx:101-107`, surfaced at `AccountPlayerForm.tsx:347-358`).

**NOT surfaced anywhere on the page (despite existing on the data model):**
- Other leagues the player is in (only the default league's assignment is shown).
- Application status per league (`PlayerLeagueMembership.applicationStatus` — `PENDING` / `APPROVED`).
- Membership status (`PlayerLeagueMembership.status` — `ACTIVE` / `INACTIVE` / `SUSPENDED`).
- Jersey number (`PlayerLeagueMembership.jerseyNumber`) — no UI surface anywhere in the codebase.
- Per-league ID-share consent (`PlayerLeagueMembership.idShared`) — no UI surface anywhere in the codebase.
- Per-league applicant comments (`PlayerLeagueMembership.comments`) — visible to admin only.
- Per-league paid status / fee (`PlayerLeagueMembership.paidStatus`, `paidAt`, `feeOverride` + resolved fee).
- Player DOB (`Player.dob`) — column exists since v1.65.0 with no UI surface.

### 1.3 Single-league assumption (the load-bearing bug)

The page calls `getDefaultLeagueId()` and resolves a single
`activeAssignment` (`page.tsx:142-156`). This means:

1. **A user in League A and League B sees only the default league's team.** If the default is League A, "your team is X" is shown for League A even if the user is also rostered in League B.
2. **Position edits silently overwrite every league.** `updateMany({ playerId, toGameWeek: null }, { position })` writes the same single value across every active PLM, so a user who plays GK in one league and FW in another can't represent that. The server action has no per-league discriminator on the input.
3. **Pending applications are invisible here.** A player who has applied to a third league via the recruiting flow has a PLM(`PENDING`, no team) for that league; the page either ignores it (filtered out by `realAssignments = filter(leagueTeam !== null)` at `page.tsx:149`) or, if it happens to be the default league, surfaces "No active assignment" with no clue an application is in flight.

### 1.4 Single-position assumption

The form, server action, page props, and tests all type position as
`'GK' | 'DF' | 'MF' | 'FW' | null`. Once the v1.82.0 multi-position
model lands (`PlayerLeagueMembership.positions: PlayerPosition[]`), this
whole stack is wrong-shape.

---

## 2. Multi-league gaps — itemised

| # | Gap | File:line | Fix in this PR |
|---|---|---|---|
| G1 | Page reads only the default league's PLM | `page.tsx:142-156` | Read **all** active PLMs for the player |
| G2 | Page props are scalar `currentTeamName / currentLeagueName / initialPosition` | `page.tsx:169-186` | Replace with `leagues: LeagueCard[]` |
| G3 | "Team assignment" rendered as one row | `AccountPlayerForm.tsx:319-346` | Replace with one card per league |
| G4 | `updatePlayerSelf` writes one position to every league | `actions.ts:118-147` | Split into `updatePlayerName` (player-level) and `updatePlayerLeaguePosition({ leagueId, positions })` (per-league, multi-select via v1.82.0 model) |
| G5 | No surface for application status | n/a | Per-league card shows PENDING badge when `applicationStatus === 'PENDING'` |
| G6 | No surface for `idShared` per-league consent | n/a | Per-league card has a checkbox-toggle that calls a new server action |
| G7 | No surface for jersey number | n/a | Per-league card shows it (read-only initially; defer editability — admins set it) |
| G8 | No surface for paid/fee status | n/a | Per-league card shows resolved fee + paid badge (read-only) |
| G9 | No surface for applicant comments | n/a | Per-league card shows "your application notes" (read-only — contact admin to amend) |
| G10 | DOB on `Player.dob` has no input | n/a | **OUT OF SCOPE** for this PR — surface as TODO. Adding a date picker is a separate prefs-flow design |

### 2.1 Out of scope (intentional)

- **Skill level.** No `skillLevel` column exists anywhere in the schema (`grep -rn skill prisma/schema.prisma` — empty). The user's hint that one was "added in the v1.81.0 area" is a misread. **Surface to user**: "doesn't exist yet; do you want me to add it as part of this PR or as a separate prefix?" — recommend separate.
- **DOB editability.** Column exists; no design decision yet. Out of scope.
- **Player→User name sync.** Already wired in v1.72.0 (`actions.ts:138-142`). Keep as-is.
- **Cross-league ID-upload re-flow.** Per `User.idUploadedAt` retention rule (forever, admin-only purge), the read-only "ID upload: front and back uploaded — ask admin to reset onboarding to re-upload" copy is correct and stays. The new per-league `idShared` consent toggle is independent and additive.

---

## 3. Proposed redesign

### 3.1 Layout (mobile-first, ~360px width)

```
┌─────────────────────────────────────┐
│  ← Home                             │
│  MY PLAYER DETAILS                  │
│  Update your name, picture, and     │
│  per-league position(s).            │
└─────────────────────────────────────┘

┌─ Profile ──────────────────────────┐
│  [avatar 80x80]  Name *            │
│                  ┌──────────────┐  │
│                  │ Stefan S     │  │
│                  └──────────────┘  │
│  [Replace]  [Remove]               │
│  JPEG/PNG/WebP — up to 5MB         │
│                                    │
│  ID upload                         │
│  Front and back uploaded ✓         │
│  Ask admin to reset onboarding to  │
│  re-upload.                        │
│                                    │
│             [ Save profile ]       │
└────────────────────────────────────┘

┌─ T9L · Tennozu 9-Aside League ─────┐
│  PENDING badge (only if pending)   │
│  Team   FC Stallions               │
│  Position(s) ☑ MF  ☐ GK ☐ DF ☐ FW  │
│  Jersey  #14                       │
│  Fee     ¥4,000  (PAID ✓)          │
│  ID share with this league's admin │
│  ☑ Yes                             │
│  Comments                          │
│  "Free agent, weekday-evening only"│
│                                    │
│             [ Save league ]        │
└────────────────────────────────────┘

┌─ Adult Saturday League ────────────┐
│  PENDING badge                     │
│  Team    — assigned on approval    │
│  Position(s) ☐ GK ☐ DF ☐ MF ☐ FW   │
│  Fee     ¥3,000 (UNPAID)           │
│  ID share with this league's admin │
│  ☑ Yes                             │
│                                    │
│             [ Save league ]        │
└────────────────────────────────────┘
```

### 3.2 Sectioning

1. **Header** (unchanged copy except the byline reflects per-league).
2. **Profile section** — User/Player-level fields:
   - Profile picture (existing flow, unchanged).
   - Name (existing input + Save button).
   - ID-upload state (existing read-only block — moved from the bottom into Profile because it's per-User, not per-league).
3. **One per-league card per active membership**, ordered:
   - Default league first.
   - Then APPROVED leagues (alphabetical by League.name).
   - Then PENDING applications last.
   Each card has its own form + Save button (server action scoped to one leagueId — no cross-league overwrites).

### 3.3 Per-league card fields

| Field | Source | Editable? |
|---|---|---|
| League name + abbreviation | `League.name`, `League.abbreviation` | n/a |
| Application status badge | `PlayerLeagueMembership.applicationStatus` | n/a |
| Membership status badge | `PlayerLeagueMembership.status` (only when not `ACTIVE`) | n/a |
| Team | `LeagueTeam.team.name` (or "— assigned on approval" when PENDING) | no |
| Position(s) | `PlayerLeagueMembership.positions: PlayerPosition[]` (post-v1.82.0) | yes — multi-select checkboxes |
| Jersey number | `PlayerLeagueMembership.jerseyNumber` | no (admin sets) |
| Fee | `resolvePlayerFee()` result + paid badge | no |
| ID-share consent | `PlayerLeagueMembership.idShared` | yes — single checkbox |
| Comments | `PlayerLeagueMembership.comments` | no — read-only ("contact admin to amend") |

### 3.4 Server actions (post-redesign)

Replace the monolithic `updatePlayerSelf({ name, position })` with:

- `updatePlayerProfile({ name })` — writes `Player.name` + `User.name`. Same Redis-mapping bust + revalidate.
- `updatePlayerLeague({ leagueId, positions, idShared })` — writes the single PLM. Owner gate: PLM must belong to the calling player. No cross-league bleed.

The picture upload/removal actions stay user-level — unchanged.

### 3.5 Auth gate / friendly empty states (unchanged)

- No session → redirect to sign-in.
- No `userId` AND no `lineId` → "Admin-only sessions can't edit here".
- Player not resolvable → "No player linked yet" (existing copy).
- Player resolvable but **zero active PLMs** → friendly "You're not currently rostered in any league" message (new — wasn't reachable in the single-league world because the page short-circuits earlier; reachable now since we read all PLMs).

---

## 4. Risks / open questions

| # | Question | Default if no answer |
|---|---|---|
| Q1 | Is `skillLevel` actually a planned field? Or was the hint a misread? | Treat as misread; do not add. |
| Q2 | Should DOB get an input on this PR? | No — separate PR. |
| Q3 | Should jersey number be editable here, or stays admin-only? | Read-only on this PR (admin-only matches the rest of the surface). |
| Q4 | Should `idShared` default-state surface a banner ("you're sharing your ID with these leagues' admins")? | Just an inline checkbox per card. Banner is overcaution. |
| Q5 | Should INACTIVE / SUSPENDED memberships render a card or be hidden? | Render with a muted style + status badge. Hiding could leave a player wondering where their data went. |
| Q6 | Should past memberships (`toGameWeek !== null`) render? | No — keep "active or pending" only. |
| Q7 | Order: PENDING first or last on the page? | Last — APPROVED is the primary state; PENDING is a callout. |
| Q8 | Save UX: per-card local optimistic + auto-save, or explicit Save button? | Explicit Save button per card (matches the existing single Save UX; one round-trip per user intent). |

---

## 5. Sizing — does this fit one PR?

**Yes**, with these scope guards:

- **In scope:** all G1–G9 from §2.
- **Out of scope:** G10 (DOB), skill-level (Q1), per-card auto-save (Q8 → button), past-memberships rendering (Q6).
- **Expected diff size:** ~250 LOC added to `page.tsx` + `AccountPlayerForm.tsx` + `actions.ts`; ~80 LOC of new tests; minus ~50 LOC of dead-code cleanup (single-league branches, scalar position prop). Net ~280 LOC.
- **Migration risk:** zero — no schema changes. The v1.82.0 multi-position-model PR carries the schema work; this PR only consumes its API.
- **Test budget:** 12-15 new test cases. Stash-pop the regression-target ones to verify they fail on broken state.

If, post-execution, the diff blows past ~400 LOC, the right phase split is:
- **Phase A (this PR):** drop the scalar `position` field; build per-league card scaffolding; surface application-status badges. No `idShared`, no fee surface, no comments display.
- **Phase B (next PR):** add idShared toggle + fee surface + comments display.
- **Phase C (later):** DOB + jersey-number editability if/when desired.

---

## 6. Post-v1.82.0 state — what shipped, what's left

PR #235 (v1.82.0) shipped the multi-position model AND a minimal
adaptation of `/account/player`:

- `PlayerLeagueMembership.positions: String[]` plus a one-cycle
  legacy-mirror on `PlayerLeagueMembership.position: PlayerPosition?`
  (`prisma/schema.prisma:473-485`).
- New `src/lib/positions.ts` — per-format vocabulary helpers
  (`getPositionVocabulary`, `normalizePositions`, `legacyPositionFromArray`,
  `readPositions`, `joinPositions`).
- New `src/components/PositionMultiSelect.tsx` — chip-toggle UI used by
  AccountPlayerForm, ApplyToLeagueModal, RegistrationFields,
  AddPlayerDialog, EditPlayerPanel.
- `AccountPlayerForm` now reads/writes a single `positions: string[]`
  bound to a single `ballType` for ONE league at a time
  (`AccountPlayerForm.tsx:73-116`).
- `updatePlayerSelf` now iterates active memberships and writes the
  same submitted positions to every one inside a transaction
  (`actions.ts:144-201`) — validating per-league but **still
  cross-league bleeding the same array everywhere**.

**What's still wrong** (this PR's scope):

| # | What | Where |
|---|---|---|
| W1 | Page reads only the default league's PLM → form sees one team / one set | `page.tsx:142-156`, `:172-183` |
| W2 | `updatePlayerSelf` writes the SAME `positions[]` to every active membership — a user playing GK in League A and FW in League B can't represent that | `actions.ts:144-201` |
| W3 | No surface for application status, paid status, idShared, feeOverride, comments, jerseyNumber | n/a |
| W4 | Single `ballType` from one league → user in soccer + futsal sees only one chip vocabulary | `page.tsx:183` |
| W5 | "Set by admin" team panel scalar — only renders one league | `AccountPlayerForm.tsx:319-348` |

## 7. Confirmed field locations (post-rebase)

Verified against `prisma/schema.prisma`:

| Field | Model | Per-? | Editable in this PR? |
|---|---|---|---|
| `name` | `Player` | per-person | yes (top section) |
| `profilePictureUrl` / `pictureUrl` | `Player` | per-person | yes (existing flow) |
| `dob` | `Player` | per-person | **no** — separate PR |
| `idFrontUrl` / `idBackUrl` / `idUploadedAt` | `User` | per-person | no — read-only state shown in top section |
| `email` | `User` | per-person | no — read-only display in top section |
| `applicationStatus` | `PlayerLeagueMembership` | **per-league** | no — read-only badge per card |
| `idShared` | `PlayerLeagueMembership` | **per-league** | **yes** — toggle per card |
| `paidStatus` / `paidAt` | `PlayerLeagueMembership` | **per-league** | no — read-only badge per card |
| `feeOverride` | `PlayerLeagueMembership` | **per-league** | no — read-only display |
| `comments` | `PlayerLeagueMembership` | **per-league** | no — read-only display ("your application notes") |
| `positions[]` (+ legacy `position`) | `PlayerLeagueMembership` | **per-league** | **yes** — `PositionMultiSelect` per card |
| `jerseyNumber` | `PlayerLeagueMembership` | **per-league** | no — read-only display |
| `status` (ACTIVE/INACTIVE/SUSPENDED) | `PlayerLeagueMembership` | **per-league** | no — read-only badge when not ACTIVE |

All five fields the user called out (`idShared`, `applicationStatus`,
`paidStatus`, `feeOverride`, `comments`) are **per-membership** —
they all surface on per-league cards.

## 8. Locked execution plan (post-rebase)

Target version: **v1.83.0** (minor — new user-visible feature).

**M3 — page + form scaffolding (largest chunk):**
1. `page.tsx`: drop `getDefaultLeagueId` resolution; read **all**
   active memberships ordered by (default-league-first → APPROVED
   alphabetical → PENDING last). Pass `leagues: LeagueCardData[]` to
   the form. Keep top-section props (`initialName`, picture,
   `hasUploadedId`).
2. `AccountPlayerForm.tsx`: split into `ProfileSection` (name +
   picture + ID-upload state) and one `LeagueCard` per league. Each
   card carries its own `useState` + Save button. Position chips use
   the card's own `ballType`.
3. `actions.ts`: split `updatePlayerSelf({ name, positions })` into
   - `updatePlayerProfile({ name })` — name-only, player-level (writes
     `Player.name` + `User.name` + Redis-mapping bust). No positions.
   - `updatePlayerLeague({ leagueId, positions, idShared })` — single-
     PLM write with owner gate (must belong to caller, must be
     `toGameWeek === null`). Validates `positions` against THAT league's
     `ballType`. Dual-writes the legacy `position` scalar so admin reads
     keep working.

**M4 — read-only display + tests:**
- Per card: team / application-status badge / membership-status badge
  (when not ACTIVE) / fee + paid badge / jersey number / comments
  block. All read-only with "to change, contact admin" copy where
  appropriate.
- Tests:
  - `accountPlayerActions.test.ts` — gate + per-league write + cross-
    league owner-gate (a player can't pass another league's id).
  - `accountPlayerPageGate.test.ts` — empty active-memberships state.
  - New `accountPlayerMultiLeague.test.ts` — pin that two leagues
    render two cards, that saving League A doesn't bleed into
    League B's positions, that PENDING badges render.
- Stash-pop sanity: regression-target tests must fail when
  `updatePlayerLeague` is replaced with the old write-everywhere
  shape.

**Phase A vs B (will decide at end of M4 based on diff size):**
- **Phase A (always in this PR):** scaffolding + per-league position
  multi-select + applicationStatus + paidStatus + team display +
  membership-status badge.
- **Phase B (split into a follow-up if the PR exceeds ~400 LOC):**
  `idShared` toggle + `feeOverride` display + `comments` display +
  `jerseyNumber` display.

**M5 — push PR with title `v1.83.0: per-league /account/player cards`,
report the per-push status line.**

---

*Generated 2026-05-09. M2 confirmed PR #235 merged + rebase clean.
Proceeding to M3.*
