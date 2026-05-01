# Onboarding Flow — Brainstorm Brief

**Status:** brief, not design. Lays out the design space + options + tradeoffs. Not a proposal — meant to be read and reacted to before any of these surfaces gets built.

**Trigger context:** infrastructure-only chain α / α.5 / β / γ shipped 2026-05-01 → 2026-05-02. The rework's plumbing is now live but no user-facing onboarding flow exists yet — that's deliberately deferred to brainstorm-then-design.

---

## 0. The post-γ landscape — what's already true

Worth stating explicitly so each design question below sits on the same ground:

1. **Three providers are wired** at `/auth/signin`: LINE OAuth (production), Google OAuth (gated on env vars), email magic-link (gated on env vars). Admin-credentials keeps its dedicated `/admin/login` form. Per-provider env vars haven't been set yet — Google + email signup paths will become available the moment the operator adds `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and `EMAIL_SERVER`/`EMAIL_FROM` to Vercel.

2. **Account is the cross-provider join.** `Account(provider, providerAccountId, userId)` lets one User row hold multiple sign-in identities. A user signing in with both LINE and Google via `/auth/signin` doesn't get two User rows automatically — but **account-linking UX doesn't exist yet** (deferred — see §13 of the rework plan). Right now if a Stefan signs in with LINE, then later signs in with Google using a different email, he gets two distinct User rows. **Design question: does this matter for the first wave of the new onboarding, or is that a v2 problem?**

3. **`User.playerId` ↔ `Player.userId` are populated** for every existing linked human (32 of 32 prod rows post-β backfill). The legacy `Player.lineId` column also still works — γ ships a Setting flag (default `'legacy'`) to swap which path the JWT callback takes. Stage 4 will eventually drop `Player.lineId`. **For onboarding design: assume `User.playerId` is the canonical "is this human linked to a Player?" check.**

4. **`LeagueInvite` table exists** with `kind: CODE | PERSONAL` and the full lifecycle fields (expiresAt / maxUses / usedCount / revokedAt). **Nothing reads or writes it yet** — admin UI for creation + the `/join/[code]` redemption flow are the next infrastructure pieces, but they're inside the onboarding-design scope.

5. **Multi-tenant routing already works.** Apex serves the default league via `Dashboard`; each `*.t9l.me` subdomain serves its own league via the same `Dashboard`. Cross-subdomain JWT cookie shares the session. So a logged-in user on `tamachi.t9l.me` is the same human as on `t9l.me` from auth's perspective — only the league context changes.

6. **What the post-γ JWT carries on every request:** `{ lineId, userId, playerId, playerName, teamId, leagueId, isAdmin, ... }`. `playerId` is null for "logged in but no Player binding" — i.e. the new state Google/email signups land in. Existing dashboard renders already handle null gracefully (UserTeamBadge hides, RsvpBar hides, etc.).

---

## 1. The five design surfaces

The user asked for design-space exploration on these areas. Treat each as a section to react to with preferences/decisions before any implementation lands.

| § | Surface | Decision shape |
|---|---|---|
| 2 | First-impression for a logged-in lurker (no playerId) | What does Stefan-with-Google-account see when he lands on `/`? |
| 3 | Invite redemption UX (CODE flavor) | Where does the code field live? What's the picker post-validation? |
| 4 | Invite redemption UX (PERSONAL flavor) | What's the "confirm Stefan?" surface? |
| 5 | Header league switcher | Placement, behavior on 0 / 1 / N memberships, navigation pattern |
| 6 | Admin invite creation + revocation | Where in admin UI? What's the form? Single vs bulk? |
| 7 | Abuse-mitigation story | Knobs the admin gets, defaults, observability |

---

## 2. First-impression: logged-in lurker (no playerId)

**Scenario:** new user signs up with Google, lands on `/` (apex). They have a session but no playerId — `Dashboard` currently renders the matchday banner / availability / standings / etc. all read-only.

### What's different from a never-logged-in user?

Today both states (no session OR session-with-no-playerId) render almost identically — the difference is `GuestLoginBanner` shows for the no-session case (CTA: "Sign in with LINE") and is absent for the logged-in case. **There's no "you're logged in but not on a roster" surface yet.**

### Design options

**Option A — A persistent "Join a league" pill in the header.**
Lurker sees their name in the top-right, plus a "Join a league" button that opens the code-entry surface. No banner / no modal interruption. They can browse the league dashboard freely.
- Pros: respects browsing. Doesn't feel like a paywall. Natural for a "I clicked the apex link to see what this is" arrival.
- Cons: easily overlooked. Admin might want a stronger CTA for someone the personal-invite link was sent to.

**Option B — A dismissible banner at the top of the dashboard.**
"You're signed in but not on a roster yet. Have a code? [Enter code] · Have a personal invite link? Just open it."
- Pros: stronger CTA than a header pill. Easy to dismiss for casual browsers.
- Cons: more page noise. Risks looking spammy for return visits if they keep dismissing.

**Option C — A modal on first sign-in only.**
Right after Google/email sign-up, intercept with "Welcome! Let's get you onto a roster. [Enter code] · [I just need to browse]." Subsequent visits show only the header pill (Option A).
- Pros: high engagement on the first impression — exactly when the user expects an onboarding step. Doesn't bother return visits.
- Cons: requires a "first sign-in detected" flag (could be `User.createdAt > now()-30s`, or a one-shot localStorage bit). Adds complexity.

**Option D — Auto-redirect to `/join` on every page if they have no playerId.**
Treat the no-playerId state as "incomplete onboarding" and gate access until they redeem an invite or explicitly opt out.
- Pros: maximally directive. No way to "miss" the onboarding.
- Cons: hostile to tire-kickers (people who want to see what T9L is before committing). Probably wrong for a community league site.

### Hidden question worth surfacing

Should a lurker be allowed to see the league's roster / matchday details / standings at all without an invite? **In §7 we discuss this from the abuse angle** — high-trust leagues might want to require an invite to even see the roster (closes A4 from the rework plan), low-trust leagues are fine with public read access.

This design surface is downstream of §7's roster-visibility decision.

### Recommendation slot

(Empty — for the user to fill in or react to)

---

## 3. Invite redemption — CODE flavor

**Scenario:** admin posts `T9L-2026-K7M9` in a Slack/LINE group. Stefan clicks an apex link, signs in with Google, has the code. Now what?

### Surface options for code entry

**Option A — Standalone `/join` route.**
Dedicated page with a prominent code input + "Continue" button. Header link from anywhere on the site. Validated route at `/join/T9L-2026-K7M9` works as direct-link variant (skip the input step).
- Pros: clean, sharable, easy to deep-link. The "paste your code" UX is universal and obvious.
- Cons: requires navigating away from wherever they were (if any).

**Option B — Inline in the header / banner from §2.**
Click "Have a code?" → expanding inline input → submit fires validation → on success, show the picker inline. Never navigates away.
- Pros: contextual. No page change.
- Cons: harder to share a redemption flow ("just go to /join"). Picker has to fit the inline surface or trigger a modal post-validation.

**Option C — Both.** `/join/[code]` deep-link works (admin-shared URL), `/join` empty-form works (paste-your-code), AND header pill on the dashboard surfaces the same thing for browsing users.

### Validation flow + states

After the user submits a code (or arrives at `/join/[code]`), the server validates:
- **Valid + active + within use limit** → continue to picker
- **Expired** → "This code expired on [date]. Ask the league admin for a new one."
- **Revoked** → "This code is no longer active. Ask the admin."
- **Over-uses** → "This code has been used the maximum number of times."
- **Unknown** → "We don't recognize this code. Check for typos."
- **Not signed in** → bounce to `/auth/signin?callbackUrl=/join/[code]`, then resume

### Picker post-validation

Code is valid. User now sees a picker of **Players in this league with no current `User.playerId` binding** (i.e. unlinked roster slots). Some questions here:

**Q3.1 — What's the picker's grouping?** Today's `/assign-player` picker groups by team. The new picker could do the same, OR list alphabetically with a team badge per row, OR group by position. **Reaction needed.**

**Q3.2 — Is the user's current "linked elsewhere" Player surfaced?** Edge case: Stefan is linked in League A (apex) and now redeems a CODE for League B (subdomain). The picker for League B's roster will show fresh slots. But League B might have a Player named "Stefan S" already — should that match be highlighted ("looks like you might be this person")? Risky if the names collide accidentally; easy fluff if names are unique. **Reaction needed.**

**Q3.3 — Search?** Once leagues scale (current T9L is ~30 names), search-as-you-type is helpful. Pre-mature for v1.

**Q3.4 — What if the picker is empty?** All Players already linked. "This league's roster is full. Ask the admin to add a slot for you." Code's `usedCount` doesn't increment.

### Confirmation step

After picking, do we go straight to `POST /api/leagues/:id/claim-player` or interpose a "You're claiming **Stefan S**, captained by **Mariners FC**. Confirm?" page?

- Direct-claim: faster, fewer screens.
- Confirmation step: matches the personal-invite flavor's UX shape (consistent feel) and gives a chance to back out from a misclick.

**Reaction needed: do we want a uniform confirm-step UX across CODE + PERSONAL, or are they distinct flavors?**

### Post-claim landing

Server transactionally:
- Sets `Player.userId = user.id`, `User.playerId = player.id`, `Player.lineId = ...` (only if user signed in via LINE; for Google/email this stays null forever — which is fine, since γ's resolver swap will make `User.playerId` the canonical path)
- Increments `LeagueInvite.usedCount`
- Sets `joinSource = CODE` on the (existing) `PlayerLeagueAssignment` for that user's seat in this league

**Then where do they land?** Apex (default league)? Or the league subdomain (`tamachi.t9l.me`)? The subdomain is correct — they just joined that league.

Toast: "You're linked to **Stefan S** in **Tamachi 2026**."

### Self-correction

**Scenario:** Stefan misclicked and selected "Steven S" instead. The plan §7 mentions a 24h "undo" affordance. Concrete options:

**Option A — A small "Wrong player? Undo" link on the post-claim landing dashboard for 24h.**
Click → unclaims, sets the slot back to unlinked, brings them back to the picker.

**Option B — No undo; admin handles it.**
User contacts admin, admin Remaps. Higher friction but enforces accountability.

**Option C — Undo only within 30 minutes of the join.**
Tighter window. Reduces abuse vectors (someone keeps undoing and re-claiming).

### Recommendation slot

(Empty)

---

## 4. Invite redemption — PERSONAL flavor

**Scenario:** admin generates a personal invite pre-bound to `targetPlayerId = stefan-s` and DMs Stefan the link `https://t9l.me/join/PERSONAL-X9M2K1`.

### Surface

`/join/[code]` server-side resolves the code, sees `kind === 'PERSONAL'`, fetches the target Player, renders the confirmation card:

```
   ┌──────────────────────────────────────┐
   │  You're being invited to             │
   │  Tamachi 2026                         │
   │                                       │
   │      [photo]   STEFAN S               │
   │                Defender                │
   │                Team: Mariners FC      │
   │                                       │
   │  Is this you?                          │
   │  [ Yes, that's me ]   [ No, not me ]  │
   └──────────────────────────────────────┘
```

(Same shape as in the rework plan §5.)

### Q4.1 — What if they're already signed in vs not?

If signed in: render the card directly. "Yes" → POST → done.

If not signed in: do we (a) bounce to `/auth/signin?callbackUrl=/join/PERSONAL-X9M2K1` and resume, OR (b) show the card first ("You're being invited as Stefan — sign in with [LINE] [Google] [Email] to confirm")?

(b) is more inviting (pun intended) — they see what they're being invited to before being asked to sign in.

### Q4.2 — What does "No, not me" do?

Audit-only: log the rejection (potentially as `LeagueInvite.lastRejectedAt` field — schema addition needed). Do NOT consume `usedCount`. Admin can re-issue or investigate.

Optional courtesy: a small text input "Tell us who you are or who this should be" → admin sees this in their invite-management view.

### Q4.3 — Already-claimed personal invites

If `usedCount >= maxUses` (typically `maxUses = 1`), the link goes to a "This invite has been used" page. No re-claim possible without admin re-issue.

### Q4.4 — Display-name fuzzy check

The plan suggested a "soft gate" — comparing the user's LINE display name to the targetPlayer's name and warning if they differ wildly. Useful or paranoid?
- For LINE-only users where we have a display name from the OAuth profile, comparison is cheap.
- For Google/email users where display name might be "Stefan S" but the targetPlayer is "Stephen Smith", we'd false-positive a lot.
- Probably skip for v1; revisit if abuse materializes.

### Recommendation slot

(Empty)

---

## 5. Header league switcher

**Scenario:** Stefan plays in two leagues (Tamachi 2026 + Minato 2025). He's on `tamachi.t9l.me`. He wants to switch to Minato.

### Component placement

**Option A — Top-right pill, adjacent to the user-name pill.**
Mirrors the v3 mockup. On click, dropdown shows memberships.

**Option B — Inside the existing hamburger menu (mobile) / inline (desktop).**

**Option C — A persistent breadcrumb-style "[Apex] / Tamachi 2026" with click-to-switch.**

### Behavior on N memberships

- **0 memberships:** switcher hidden; only "Join a league" CTA in the header
- **1 membership:** static label (just shows the league name); no dropdown
- **2+ memberships:** full dropdown with current league marked; click to switch

### Cross-subdomain navigation

Each membership has a `subdomain` (or null for default-league apex). Click → `window.location.href = 'https://tamachi.t9l.me'`. The cross-subdomain JWT cookie (v1.24.0) means the user stays signed in.

### Q5.1 — Where does `session.memberships` come from?

The plan §4.5 specified a Redis-backed cache (10-min TTL, busted on `LeagueMembership` write). Adds a new namespace. Worth it for the switcher? **Reaction needed.**

Alternative: compute on every JWT callback by walking `User.player.leagueAssignments` (Prisma query). The JWT callback today already does a similar walk for the per-league `teamId`. Adding the full memberships list is one more `include`. ~Same cost. Cheaper to implement than a new Redis namespace.

### Q5.2 — Does the switcher show admin-only leagues?

Stefan might be an admin of "Test League 2026" (admin-only context, no Player). Should it appear in the switcher? Probably no — the switcher is for "leagues I'm a roster member of"; admin context has its own picker at `/admin/leagues/[id]`.

### Q5.3 — Multi-league dashboard view

Edge case: Stefan is on `t9l.me` (apex, default league = Minato). The switcher highlights Minato as current. Should there be a "view all my leagues at once" surface that shows next matchdays across all his memberships?

That's a much bigger UX commitment (separate route, design, query model). Probably out of scope for the first wave; surface as a future extension.

### Recommendation slot

(Empty)

---

## 6. Admin invite creation + revocation

**Scenario:** league operator wants to create invites, see existing ones, and revoke when needed.

### Where does it live?

Admin shell already has:
- `/admin` — top-level, league-agnostic dashboard
- `/admin/leagues/[id]` — per-league admin (players, schedule, settings)
- `/admin/players` — global-Player management
- `/admin/venues` — global venue management

**Most natural placement:** `/admin/leagues/[id]/invites` — per-league invite management. Same shape as `/admin/leagues/[id]/players`.

### Form options

**Single-invite create:**
- Kind: CODE / PERSONAL (radio)
- If PERSONAL: target Player picker
- Expires: default +7 days, override (datepicker / "never")
- Max uses: default 1 (PERSONAL) or unlimited (CODE), override

**Bulk personal-invite create (for new-roster setup):**
- Pick league
- Pick a set of unlinked Players
- "Generate one personal link per player"
- Output: copy-pasteable CSV with `name,email-if-known,join-url`

**Q6.1 — Is bulk creation worth shipping in v1?**
Probably yes for the multi-tenant rollout — admin onboarding a fresh league of 30 players via 30 manual creates is painful. **Reaction needed.**

### Invite list + state

Per-row columns:
- Code (with copy-link button)
- Kind (CODE / PERSONAL)
- Target (only for PERSONAL — shows player name + photo)
- Expires
- Uses (e.g. "0 / 1" or "12 / unlimited")
- Status (active / expired / revoked / used-up)
- Actions: [Copy link] [Revoke] [Re-issue]

### Revoke

Soft-delete via `revokedAt`. After revoke, the code returns the "this code is no longer active" page on attempted use.

### Re-issue (PERSONAL only)

If a personal invite expires or gets revoked but the player still hasn't claimed, generate a fresh personal invite for the same `targetPlayerId`. Old code stays revoked. New code is sharable.

### Q6.2 — Sharing surface

Once admin creates a personal invite, what's the share UX?
- A copy-to-clipboard button on the row
- A QR code display for in-person hand-out
- Email-the-link-to-the-player (would need an email field on Player or a separate "where to send" input — adds scope)

### Q6.3 — Audit visibility

Should admin see "this PERSONAL link was visited but the user clicked 'No, not me'"? Yes if we add `lastRejectedAt`. Helps admin diagnose "Stefan didn't sign up" vs "Stefan got the link but rejected".

### Recommendation slot

(Empty)

---

## 7. Abuse-mitigation story

**Scenario:** the new flow's job is to prevent the failure modes the rework plan listed (F1–F5). Let's enumerate the knobs.

### Roster visibility

**Q7.1 — Should the league dashboard / roster / standings be publicly visible to anyone (logged out, logged-in lurker without invite)?**

Today: yes (everything public).
Post-flow: still yes, OR gate behind invite redemption?

- **Public:** preserves "club showcase" use case. Anyone who hears about T9L can browse it. Loses the A4 mitigation (roster enumeration).
- **Logged-in only:** requires sign-up but no invite. Lower bar. Roster visible to spammers who can sign up with disposable emails.
- **Invite-required:** highest bar. Roster only visible after redeeming a code or personal invite. Closes A4 fully but feels gated for a casual visitor.

This is a per-league policy question. Options:
- Hard-coded site-wide ("public dashboard = always public")
- Per-league setting (admin toggles)
- League-default with admin override

**Reaction needed: which level of gating? A per-league setting is the most flexible but adds UI scope.**

### Disposable email blocklist

If we ship email magic-link to prod:
- **Default off:** any email works. Maximum sign-up flexibility.
- **Blocklist on:** known disposable-email domains rejected. Modest reduction in spam.
- **Allowlist on:** only known-good email providers allowed. High friction; probably wrong for a community.

A simple env var `BLOCKED_EMAIL_DOMAINS=tempmail.com,10minutemail.net` covers the simple case. Worth shipping as part of the email-provider wiring? Maybe; it's tiny.

### Per-IP signup rate limit

Upstash @upstash/ratelimit can throttle `/api/auth/signin/email` to prevent automated User-row spam. Default off; turn on if abuse materializes.

### Slot impersonation (code-holders picking the wrong slot)

The CODE flavor's picker is the residual A1 vector — a code-holder can still pick anyone. The rework plan's mitigation:
- Use PERSONAL instead of CODE for high-trust leagues
- Add "self-correction" (24h undo on the post-claim dashboard) to make wrong-clicks recoverable
- Audit `joinSource = 'CODE'` for forensic trace

**Q7.2 — Does the admin UI surface a clear distinction between "high-trust league: only personal invites" vs "casual league: shared code"?**

Could be a per-league setting that disables CODE creation entirely. Or just admin discipline (don't create codes for the league you don't want).

### Roster-fullness as soft signal

If `LeagueInvite` is consumed but the picker is empty (all slots claimed), the redeemer is stuck. Admin sees `usedCount=0` despite the invite being "used" on the visit log. Worth a "claim attempted but no slot available" audit row? Probably overengineered for v1.

### Q7.3 — What does the admin "incident" workflow look like?

If Stefan reports "someone took my slot," what does admin do?
1. Find the join event in `PlayerLeagueAssignment` (need an audit log, which `joinSource` + `createdAt` provide partial)
2. Use existing Remap dialog to move the link to the right player
3. Optionally revoke the offending User (we don't have a "revoke User" UI — would they need to reset password / lose all access?)

**Reaction needed: does v1 need a "revoke User" path beyond Remap?** Or is "the impersonator gets to keep their account but loses the slot" acceptable?

### Recommendation slot

(Empty)

---

## 8. Cross-cutting: what infrastructure is missing post-γ?

Things that are NOT yet built but would be needed before any of the above can ship:

1. **Per-league subdomain attachment UI** — admin needs a way to attach `*.t9l.me` subdomains to League rows. Today this is manual via direct DB write. Out-of-scope for the rework chain but blocks multi-tenant rollout.
2. **Account-linking UI** (`/account/connections`) — for users who want to add a second provider to an existing User. Deferred per §13 of the rework plan.
3. **Email change / removal flow** — same.
4. **`session.memberships` plumbing** — needed for the header switcher (§5).
5. **`/api/leagues/:id/claim-player` endpoint** — backend for both invite flows.
6. **Per-league subdomain DNS provisioning runbook** — operational; not code.

**Question for the brainstorm: is any of (1)–(6) load-bearing for the first wave of onboarding-flow rollout, or can we sequence the first wave as "default-league apex only" and defer the multi-tenant operator concerns to a follow-up?**

---

## 9. Decision shape — what to react to

For each section, the user can either:
- Pick an option (e.g. "§2 → Option C; §3.1 → group by team; §3 confirm-step → uniform with PERSONAL")
- Express a preference direction without picking a specific option
- Flag a missing consideration / edge case
- Defer ("v1 should ship the simplest correct version, fancy version v2")

The shape of the next conversation is "user reads this, marks up the design space, then we converge on a small set of decisions that constitute the implementation plan for PRs #5 / #6 / #7 in the rework chain."

---

End of brief.
