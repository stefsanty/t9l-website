# Homepage UX Audit — `t9l.me/`

**Audit-only.** No code changes. Worktree: `claude/nice-perlman-fae9ea`. No production inspection — DNS for `t9l.me` is unreachable from the audit sandbox; analysis is grounded entirely in code at HEAD (post-rebase v1.83.0 + main `0aaf9c1`).

## TL;DR

Today `/` is a hard-coded alias for "the default league's dashboard" — semantically identical to `/id/<default-slug>`. That made sense when Tennozu was the only league. Post multi-league it's actively hostile: T6L players land on the Tennozu page, first-time visitors think T9L is one league rather than a platform, and there is **no public discovery surface for leagues at all**. The LeagueSwitcher chevron only renders for users with ≥2 active memberships, so single-league users in any non-default league have zero affordance pointing them at their actual league.

The recommended path is a **persona-aware apex**: signed-out → light explainer + league directory; signed-in single-league → redirect to that league; signed-in multi-league → cross-league dashboard with a "next match across all my leagues" surface plus per-league cards. Phase 1 (1-2 PRs) handles the redirect logic + minimal directory; phase 2 builds the unified dashboard.

---

## 1. Current state

### What `/` renders

Single render path: [`src/app/page.tsx:42`](src/app/page.tsx) calls `getDefaultLeagueId()`, fetches the same seven parallel datasets that `/id/[slug]` fetches ([`page.tsx:86-115`](src/app/page.tsx)), and hands them to `<Dashboard>`. The apex IS the default league's per-league page. The two route files are nearly line-for-line identical (compare against [`src/app/id/[slug]/page.tsx:53-140`](src/app/id/[slug]/page.tsx)).

The only `/`-vs-`/id/<slug>` differences:
- `/` resolves the league via `isDefault: true` flag ([`src/lib/leagueSlugServer.ts:34`](src/lib/leagueSlugServer.ts)).
- `/` falls back to a generic "Data unavailable" error if no league has `isDefault` flagged ([`page.tsx:45-61`](src/app/page.tsx)).
- `<Header>` brand title shows `league.abbreviation ?? league.name ?? "T9L '26 春"` — same on both routes.

### What `/` currently assumes about the user

- **No persona detection.** The page is rendered without consulting the session for routing decisions. `recruitingViewerState` is read for the banner, but it doesn't influence which league surfaces.
- **No fallback for "user has memberships in non-default leagues."** If someone in T6L lands on `/`, they see Tennozu data. The `LeagueSwitcher` chevron only renders if `memberships.length >= 2` ([`src/components/LeagueSwitcher.tsx:72`](src/components/LeagueSwitcher.tsx)) — a single-league T6L player has nothing pointing them home.
- **No public league directory anywhere in the codebase.** `prisma.league.findMany` only appears in `src/lib/admin-data.ts` (admin shell). There is no `League.isPublic` / `League.publiclyListed` flag in the schema ([`prisma/schema.prisma:145-245`](prisma/schema.prisma)). Discovery is implicit — you arrive at a league because someone gave you the slug.
- **No explainer/marketing.** The page assumes you know what T9L is and that this league is yours. There is no "what is this?" surface anywhere.

### Auth-state surfaces already on `/`

| Component | When it shows | What it does |
|---|---|---|
| `<UnpaidFeeBanner>` | signed-in player with unpaid fee in default league | actionable banner for own league |
| `<RecruitingBanner>` | `League.recruiting === true` | five-state context-aware banner; State E (unauth) → SignInLightbox, State C (no_player) → `/recruit/<slug>`, State D (other_league) → simplified apply modal |
| `<GuestLoginBanner>` | unauth, anywhere on dashboard | "RSVP to your matchdays — Sign in" CTA |
| `<LeagueSwitcher>` chevron | auth + ≥2 memberships | dropdown to other leagues |
| `<Header>` "ASSIGN TO MY PLAYER" first-login modal | auth, no playerId, default-league `allowSelfLink === true` | one-time prompt to claim a player slot |

### Sign-in callback behavior

`getCurrentCallbackUrl()` captures the *current path* at click time ([`src/lib/signInCallbackUrl.ts`](src/lib/signInCallbackUrl.ts) — referenced by `GuestLoginBanner`, `RecruitingBanner`, `LineLoginButton`). On `/`, that callback URL is `/`. So a user who signs in on the apex lands back on the apex (still showing the default league) regardless of which league(s) they belong to.

---

## 2. Persona walkthroughs

### Persona A — Single-league user, in the default league (Tennozu)

This is the ONLY persona today's homepage serves correctly.

**Journey:** lands on `/` → sees Tennozu's matchday banner → sees their team badge + RSVP bar → can RSVP. No friction.

**Notable:** no `LeagueSwitcher` chevron renders (1 membership). Header brand title = "T9L '26 春" / Tennozu abbreviation. Everything is contextually correct.

### Persona B — Single-league user, in a non-default league (e.g. T6L Tamachi)

**Journey:** lands on `/` → sees Tennozu's matchday banner. **The user's actual league is invisible**: no LeagueSwitcher chevron (only 1 membership), no "you have a different home league" hint, header still says Tennozu. The user's RSVP bar at the bottom shows nothing because their `playerId` exists but their team is not in Tennozu (`userTeamId` is default-league-scoped via the JWT — [`Dashboard.tsx:233-241`](src/components/Dashboard.tsx)). The user has to *manually type or remember* `/id/t6l-26sp` to find their league.

**Friction:** severe. A single-league T6L user has *no in-app affordance* pointing at their league from `/`. They're reliant on a bookmarked direct link, an admin-shared link, or remembering the slug. Sign-in callback returns them to `/` after auth, which still shows the wrong league.

**Likely outcome:** they assume the site doesn't include their league, contact the admin, or never figure out.

### Persona C — Multi-league user (in 2+ leagues)

**Journey:** lands on `/` → sees default-league dashboard → notices the small chevron next to the header brand title → opens `LeagueSwitcher` ([`src/components/LeagueSwitcher.tsx:75-117`](src/components/LeagueSwitcher.tsx)) → picks their actual league → navigates to `/id/<slug>`.

**Friction:** moderate. The chevron is small and visually subtle (just `<ChevronDown className="w-4 h-4" />` next to the title — see screenshot in [`src/components/LeagueSwitcher.tsx:84-86`](src/components/LeagueSwitcher.tsx)). Discoverability is fragile: many users will not realize the title is interactive. Once they DO find the switcher, the menu is functional but minimal — just a list of league names. There's no:
- "Next match across all your leagues" view
- Per-league unread/RSVP-pending count
- Visual cue for which league has an upcoming matchday vs. which is in pre-season vs. which is dormant
- Indication of what the apex `/` even represents to them (it's just "the platform's default league," which from their POV is arbitrary)

**Subtle bug for Persona C:** signing out from a non-default league hops them back to `/` (which is the default league) — fine. But if they're on `/`, their `userTeamId` is resolved against the default-league JWT, so banners like `UnpaidFeeBanner` and the team badge surface for whichever league happens to be flagged default — not for the league they were last looking at. The apex is structurally biased toward Tennozu's signal even for power users.

### Persona D — First-time uneducated user

**Journey:** they got the URL from a friend / Reddit / Google. They land on `/` → see "T9L '26 春" / Tennozu logos / matchday banner with team names they don't recognize. There is no explainer, no "what is this?", no league directory. The `RecruitingBanner` may or may not be on (depends on Tennozu's `recruiting` flag); even if on, it points only at applying to *Tennozu*, not at discovering whether T9L has *a league for them*.

**Friction:** very high. The page presents itself as a single league's dashboard, not as a platform. There's no concept that other leagues exist on the same domain. A user looking for "a futsal league in Tokyo" who was told "check t9l.me" has no path to discover the futsal league — they have to be told the slug.

**Likely outcome:** bounce. Or worse: they apply to Tennozu thinking that's the only option, when they actually wanted T6L or a futsal league.

---

## 3. Candidate strategies

Each strategy is described with: what it shows for each persona, build complexity (S/M/L), and main downsides.

### Strategy 1 — "Auth-aware redirect"

`/` becomes a redirect router with no rendered surface for authed users:
- **Unauth** → render a marketing/explainer page + a league directory.
- **Auth, exactly 1 membership** → 308-redirect to `/id/<that-slug>`.
- **Auth, ≥2 memberships** → render a "your leagues" hub page (cross-league dashboard).
- **Auth, 0 memberships** (linked User but no PLM, e.g. recently unrostered or never claimed) → render the directory + an account-status hint.

**Complexity:** M. Logic is straightforward but persona detection has to run server-side on every `/` request (turns the apex into a force-dynamic route — already effectively dynamic via the session read). The hub and directory are new surfaces.

**SEO:** redirects mean `/` is no longer a stable indexable URL for the default league. Move SEO weight to `/id/<default-slug>` and 308-redirect old paths to it (mirror of v1.54.0's pattern for `/<slug>` and `/league/<slug>`). The marketing/directory page becomes the new indexable apex, which is arguably better for organic discovery.

**Pros:** persona-correct out of the box. Lowers friction for B/C/D dramatically. Solves the discovery gap.

**Cons:** redirect-on-load can feel jarring; the redirect target is computed server-side so there's no flash, but bookmarks of `/` no longer point at "the league" — they point at the directory. Persona A loses the muscle-memory home (mitigation: honor `?keep=1` or a "set this as your home" preference, persisted in `localStorage` or `User.defaultLeagueId`).

### Strategy 2 — "Single page with progressive disclosure"

Keep `/` as a stable URL. Above the fold, render content based on persona:
- **Unauth** → "What is T9L?" + sign-in CTA + league directory grid.
- **Auth, 1 membership** → that league's matchday banner (mirror of `/id/<slug>` content) + a small "your league" header.
- **Auth, ≥2 memberships** → unified "next match across your leagues" + per-league cards + recruiting banners for any league you're not yet in.

**Complexity:** L. The page becomes a polymorphic surface that has to handle all four personas + the unauth state. Reuses Dashboard for the single-league branch but needs new components for the cross-league + unauth branches.

**SEO:** apex stays indexable but its content varies per session — server cache becomes per-persona, harder to ISR. Default content (unauth) gets cached for crawlers.

**Pros:** zero redirects, stable URL, every persona sees a useful first paint.

**Cons:** the highest implementation cost of the four. Per-persona render branches multiply the test matrix. Risk of feature bloat — the apex becomes the most complex page in the app.

### Strategy 3 — "League directory + auth-aware top section"

`/` always renders the same skeleton: small auth-aware top section (your-leagues panel for authed users, sign-in CTA for unauth) + a public league directory below.
- All personas see the directory.
- Single-league + multi-league users see their league(s) in the top panel, click through to `/id/<slug>`.
- Unauth users see the directory + a sign-in CTA.

**Complexity:** M. Requires a new directory component and a "your leagues" panel; both reuse the existing memberships query.

**SEO:** apex becomes a directory page (good — easier to crawl + index as a "platform" page); each league's page stays at `/id/<slug>` with its own metadata.

**Pros:** discovery problem solved cleanly. No redirect side effects. Persona D lands on something useful immediately.

**Cons:** Persona A (Tennozu single-league) loses the apex matchday banner — they have to click through to `/id/<tennozu-slug>`. Mitigation: top-panel "your leagues" cards can include a "next match" mini-block, so the click is one tap and the info above-the-fold isn't gone, just compressed.

### Strategy 4 — "Default-league apex, explicit directory route"

Keep `/` as today (default league). Add a new route `/leagues` (or `/discover`) for the public directory; surface it from the header. Add a "make this league my home" preference for non-default-league single-league users.

**Complexity:** S. Smallest scope. Adds one route + one header link + one user preference column.

**Pros:** lowest risk. Backward compatible with existing bookmarks + admin scripts.

**Cons:** doesn't fix the core problem — `/` still shows Tennozu by default for everyone, including T6L single-league users. The directory is reachable but secondary. First-time visitors still land on Tennozu and may never click into `/leagues`.

---

## 4. Trade-off matrix

| | A: Tennozu solo | B: T6L solo | C: Multi-league | D: First-time | SEO impact | Build effort |
|---|---|---|---|---|---|---|
| **1. Auth-aware redirect** | ⚠ loses muscle memory | ✓ goes home | ✓ hub | ✓ directory | apex ↔ directory; default league moves to `/id/<slug>` | M |
| **2. Progressive disclosure** | ✓ no change | ✓ shows their league | ✓ unified | ✓ explainer | apex has split content | L |
| **3. Directory + top panel** | ⚠ extra click | ✓ league card up top | ✓ league cards | ✓ directory | apex = platform page | M |
| **4. Default + `/leagues`** | ✓ no change | ✗ unchanged friction | ⚠ chevron remains primary | ⚠ directory hidden behind nav | minimal | S |

Strategies 1 and 3 carry the bulk of the persona benefit. Strategy 2 is the "everything everywhere" pick at proportional cost. Strategy 4 is a safety-valve fallback if the others get pushed back.

---

## 5. Recommended path

**Strategy 1 (auth-aware redirect) for phase 1**, with Strategy 3's directory as the unauth surface. Phase 2 adds the multi-league hub.

### Phase 1 — shippable in 1-2 PRs

**PR 1 — Persona-aware apex routing.**
- `/` becomes a routing-only page that reads the session + memberships and decides.
- **Unauth or auth+0-memberships:** render a new `<HomepageDirectory>` surface (described below). No redirect.
- **Auth + exactly 1 membership:** server-side redirect to `/id/<that-slug>` via `next/navigation#redirect`.
- **Auth + ≥2 memberships:** render a placeholder cross-league hub for now (just a stylized list of the user's leagues with last-known matchday date) — phase 2 fleshes this out.
- Add a `User.defaultLeagueId` column (or `Player.defaultLeagueId`) so users can pin a preferred home league. Nullable; falls back to "first APPROVED PLM alphabetically" when unset.
- Move SEO weight: `/id/<default-slug>` becomes the canonical default league URL; the apex's metadata becomes the platform-level T9L description.

**Risk to manage in PR 1:** the `<Header>` "home" link href is hard-coded to `/` ([`Header.tsx:41`](src/components/Header.tsx)). Once `/` is no longer the user's league, that link should resolve to the user's preferred league for authed users — make it dynamic via a `useMemberships()` read or a small server-component header variant.

**PR 2 — Directory component.**
- New file `src/components/HomepageDirectory.tsx` rendered by the unauth branch of `/`.
- Shows: T9L explainer (3 lines: "What is T9L? A network of recreational football leagues in Tokyo. Players claim a roster slot and RSVP to matchdays."), a card per league pulled from `prisma.league.findMany({ where: { listed: true } })` (new `League.listed` boolean column, default `true`), and a sign-in CTA.
- Each card surfaces: name, ball type icon (soccer/futsal), location, "recruiting" pill, link to `/id/<slug>`.
- Sort by `recruiting === true` first, then alphabetical.
- Add `League.listed` column with a default of `true` so existing leagues opt-in by default; an admin toggle lets a league opt out (private leagues, archive seasons).

**Test surface for phase 1 (regression-target):**
- Apex serves directory for unauth (HTML contains expected hero + league cards).
- Apex 308s to `/id/<slug>` for auth + 1 membership.
- Apex serves hub for auth + ≥2 memberships.
- League with `listed === false` does NOT appear in the directory.
- Default-league `/id/<slug>` is still indexable.

### Phase 2 — multi-league hub (1-2 PRs after phase 1)

- `<MultiLeagueHub>` for the auth+≥2 case.
- "Next match across your leagues" header card: aggregate the next upcoming matchday across all the user's APPROVED PLMs, sorted by date. Show team, kickoff, RSVP status pill, league badge.
- Per-league cards below: name, abbreviation, your team logo + name, your RSVP for the league's next matchday, click → `/id/<slug>`.
- Pending-application visibility: any PLM with `applicationStatus === PENDING` shows a small "awaiting approval" pill on the league card.
- Optional follow-on: "Recruiting now" carousel of leagues the user is NOT in but is eligible for (any league with `recruiting === true && listed === true && Player has no PLM there`) — direct hand-off to the existing `RecruitingBanner` State D modal.

---

## 6. Wireframe sketches

### Unauth `/` (phase 1)

```
┌──────────────────────────────────┐
│  T9L                       Sign in│  ← Header (no chevron, no league title)
├──────────────────────────────────┤
│                                  │
│   T9L                            │
│   Recreational football in Tokyo │
│                                  │
│   A network of leagues for       │
│   players to RSVP, track stats,  │
│   and find a team.               │
│                                  │
│   ┌──────────────────────────┐   │
│   │ TENNOZU 9-ASIDE   [⚽ 9-a-side] │
│   │ Tennozu, Tokyo            │   │
│   │ ●● Recruiting now         │   │
│   └──────────────────────────┘   │
│   ┌──────────────────────────┐   │
│   │ TAMACHI 6-ASIDE   [⚽ 6-a-side] │
│   │ Tamachi, Tokyo            │   │
│   │ ●● Recruiting now         │   │
│   └──────────────────────────┘   │
│   ┌──────────────────────────┐   │
│   │ FUTSAL X        [🏐 Futsal]   │
│   │ Shinagawa, Tokyo          │   │
│   └──────────────────────────┘   │
│                                  │
│   [ Sign in with LINE ]          │
│   [ Sign in with Google ]        │
│                                  │
└──────────────────────────────────┘
```

### Auth, single-league user (phase 1)

Server-side `redirect('/id/<their-slug>')`. No new render surface — they land directly on their league. Header chevron stays hidden (1 membership).

### Auth, multi-league user — phase 2 hub

```
┌──────────────────────────────────┐
│  T9L                  [profile▼] │
├──────────────────────────────────┤
│   YOUR LEAGUES                   │
│                                  │
│   ┌──────────────────────────┐   │
│   │ NEXT UP                  │   │
│   │ Sat May 17 · 14:00       │   │
│   │ [logo] FENIX vs MARINERS │   │
│   │ TENNOZU 9-ASIDE          │   │
│   │ Your RSVP: ✓ GOING       │   │
│   └──────────────────────────┘   │
│                                  │
│   ┌──────────────────────────┐   │
│   │ TENNOZU 9-ASIDE          │   │
│   │ [team logo] Mariners FC  │   │
│   │ Next: Sat May 17  14:00  │   │
│   │ →                        │   │
│   └──────────────────────────┘   │
│   ┌──────────────────────────┐   │
│   │ TAMACHI 6-ASIDE          │   │
│   │ [team logo] FC Torpedo   │   │
│   │ Next: Sun May 18  10:00  │   │
│   │ ⚠ RSVP pending            │   │
│   │ →                        │   │
│   └──────────────────────────┘   │
│                                  │
│   ── DISCOVER ──                 │
│   ┌──────────────────────────┐   │
│   │ FUTSAL X · Recruiting →  │   │
│   └──────────────────────────┘   │
└──────────────────────────────────┘
```

---

## 7. Open questions for the user

1. **Is T9L invitation-only or a public marketplace?** The directory in phase 1 only makes sense if leagues are happy to be publicly listed. If some leagues are private (closed friend groups), `League.listed` defaults to `true` may be wrong — flip default to `false` and require explicit admin opt-in.
2. **Should `User.defaultLeagueId` be required or always inferred?** If inferred, what's the rule? Most-recent APPROVED PLM? The league with the soonest upcoming matchday? Pinned by user explicitly? Recommendation: nullable, inferred as "first APPROVED PLM alphabetical" (matches the `account/player` v1.83.0 sort) until the user pins one via a small toggle on `/account/player`.
3. **Default-league concept itself** — once `/` becomes the directory, does `League.isDefault` still mean anything? Suggestion: keep `isDefault` for canonical-URL purposes (`/id/t9l-26sp` stays as the historical apex with SEO weight), but stop using it as a routing default for `/`.
4. **Fate of legacy `/<slug>` and `/league/<slug>`** — already 308-redirect to `/id/<slug>` ([`src/app/[slug]/page.tsx:34-38`](src/app/[slug]/page.tsx)). No change needed.
5. **Recruiting hand-off in the hub** — should the cross-league hub surface State D recruiting banners for leagues the user isn't in? More signal but also more visual noise. Recommendation: yes but capped at 2 cards, sorted by recency of `recruiting === true` toggle.
6. **Persona A regression** — Tennozu single-league users will lose the muscle-memory experience of "/. = Tennozu." They get redirected to `/id/<tennozu-slug>` instead, which is one extra DOM round-trip on first load. Acceptable? Mitigation: pre-fetch the redirect target via `<link rel="prefetch">` in unauth landing; for authed users the server-side `redirect()` is a single 307 with no flash.
7. **Header brand title** — should "T9L" still always appear, or should it switch to the user's preferred-league abbreviation when they have one? Today `<Header>` renders `leagueTitle ?? "T9L '26 春"`. On the directory page (no league context) it should show "T9L". On the multi-league hub, ditto. On per-league pages, current behavior is correct.

---

## 8. Out of scope for this audit

- Per-league page UX (covered separately — your in-flight `/id/t6l-26sp` audit on skill level, fee breakdown, photos, comm channels).
- Mobile vs. desktop layout differences for the directory (T9L is mobile-first; desktop layout follows the same column widths).
- I18n copy for the directory hero (Japanese strings) — defer to ship.
- Analytics instrumentation for "did we actually fix Persona D bounce" — instrument the new directory and the redirect path with a per-persona funnel before rollout.
- Branding & visual refresh — out of scope.

---

## Citations

- Apex: [`src/app/page.tsx`](src/app/page.tsx) (whole file)
- Per-league: [`src/app/id/[slug]/page.tsx`](src/app/id/[slug]/page.tsx)
- Default-league lookup: [`src/lib/leagueSlugServer.ts:34-44`](src/lib/leagueSlugServer.ts)
- League switcher visibility: [`src/components/LeagueSwitcher.tsx:72`](src/components/LeagueSwitcher.tsx)
- Memberships fetch: [`src/lib/memberships.ts:34-95`](src/lib/memberships.ts)
- Recruiting state machine: [`src/lib/recruitingViewerState.ts`](src/lib/recruitingViewerState.ts)
- Header: [`src/components/Header.tsx`](src/components/Header.tsx)
- Sign-in callback URL: [`src/components/GuestLoginBanner.tsx:25-28`](src/components/GuestLoginBanner.tsx)
- League schema (no `listed` flag yet): [`prisma/schema.prisma:145-245`](prisma/schema.prisma)
