---
title: T9L Performance Audit — diagnose-only handover
branch: claude/tender-tesla-19978f
date: 2026-05-08
audit-target: t9l-website.vercel.app (v1.79.3, claude-opus-4-7)
---

# T9L Performance Audit

This is a **diagnose-only** audit. No code changes. Output is a triage doc the
user can break into shippable PRs.

The codebase is in good shape — server fetches are parallelized, RSC discipline
is solid, no raw `<img>` tags, lucide icons are cherry-picked, middleware is
JWT-only, no detected N+1 against Prisma. The wins below are about **shipping
less JS**, **shipping smaller images**, and **getting the right things first
above the fold**.

---

## Executive summary — top 6 wins

1. **Bfcache is being defeated on every navigation** — [src/app/layout.tsx:124-126](src/app/layout.tsx:124) reloads the page on `pageshow.persisted`. Removing it gives users instant back/forward. (Critical, 5 min effort.)
2. **3 raw PNGs in `public/` are oversized** (Stefan.png 502 KB, Riki Imai.png 305 KB, Fenix FC.png 259 KB) — convert to WebP/AVIF + serve via `next/image`. (High, 30 min effort, ~1 MB saved per cold visit if hit.)
3. **Fonts are 172 KB across 10 weight files** — Inter + 4× Barlow Condensed + 3× Barlow + 2× DM Mono. Drop unused weights and the codebase saves ~60-100 KB and a head-of-line render block. (High, 30 min, large LCP win on 3G.)
4. **`Dashboard` is one big `'use client'` tree** — every below-fold widget (`MatchdayAvailability`, `LeagueDetailsPanel`, `RsvpBar`, `SubmitGoalForm`) ships in the initial bundle even though `MatchdayAvailability` is the largest at 522 lines and only matters after scrolling. `next/dynamic({ ssr: true, loading: skeleton })` for these = ~50-100 KB initial JS removed. (High, 1-2 hours, biggest perceived win.)
5. **`/stats` has no dynamic split** — `LeagueTable` renders above the fold, but `TopPerformers` and `SquadList` are below. Both ship in the same client bundle. (High, 1 hour.)
6. **DCL is 2-5s on cached resources** — TTFB is 35-75ms (great), but JS parse is the bottleneck. The 226 KB top chunk is the framework + next-auth + sonner + radix. Reducing total JS is the only way to bring DCL down. Items 2-5 above all attack this.

---

## Live network waterfall (cached state, t9l.me Vercel apex)

Profiled with Chrome devtools `performance.getEntriesByType` against
`https://t9l-website.vercel.app/...`. All resources HTTP-cached on disk so
`transferSize=0` shows the parse weight (`decodedBodySize`).

| Page | TTFB | DCL | JS | CSS | Fonts | HTML | Total |
|------|-----:|----:|---:|----:|-----:|-----:|------:|
| `/` (home) | 36-72 ms | **2.8-5.5 s** | 756 KB | 100 KB | 172 KB | 65 KB | ~1.1 MB |
| `/id/t6l-26sp` | 69 ms | 2.2 s | 756 KB | 100 KB | 172 KB | 56 KB | ~1.1 MB |
| `/stats` | 71 ms | 2.9 s / load 4.3 s | 651 KB | 100 KB | 172 KB | 99 KB | ~1.0 MB |
| `/recruit/<slug>` | 76 ms | 1.7 s | 646 KB | 100 KB | 172 KB | 20 KB | ~940 KB |

JS chunks (decoded sizes):

```
226 KB  /_next/static/chunks/0_k762lvts5s2.js   ← largest, framework + auth
109 KB  /_next/static/chunks/08nqnwvixoxnk.js
 67 KB  /_next/static/chunks/0~ypbbis0v1y..js
 55 KB  /_next/static/chunks/0d3shmwh5_nmn.js   ← Dashboard / route bundle
 51 KB  /_next/static/chunks/0c~w.60cuesol.js
 47 KB  /_next/static/chunks/02oepk4qce3uz.js
 44 KB  /_next/static/chunks/0pqt~8bl3ukh4.js
 43 KB  /_next/static/chunks/05p6.r~grbng6.js
 33 KB  /_next/static/chunks/003f4iq.hnm58.js
 31 KB  /_next/static/chunks/02ye5r0o0878~.js
 28 KB  /_next/static/chunks/10qd__0r7a~.l.js
```

Read: TTFB is excellent (Vercel edge + 30s `unstable_cache`), but **DCL trails
TTFB by 2-5 seconds** because the browser has to parse ~750 KB of cached JS
plus 100 KB CSS plus 172 KB fonts before hydration completes. Cutting 100-200
KB off the initial bundle is the single biggest wall-clock win available.

---

## Findings (ordered by severity)

### 🔴 CRITICAL

#### C1. Bfcache disabled on every page

**Where:** [src/app/layout.tsx:124-126](src/app/layout.tsx:124)

```js
window.addEventListener('pageshow', function(e) {
  if (e.persisted) { window.location.reload(); }
});
```

When a user hits the back button, browsers serve from the back-forward cache —
zero network, zero JS parse, the page is restored as a frozen snapshot in
~50ms. This handler force-reloads on every bfcache restore, throwing that win
away. Every back-button press becomes a full TTFB + 750 KB JS parse + 172 KB
font fetch.

The git blame likely points at "stale auth state on iOS" or "stale RSVP after
form submit" — both can be solved with a much narrower trigger (e.g. only
reload if the user has just submitted an RSVP this session, or if the auth
cookie has changed). The blanket reload is the heaviest-possible fix.

**Recommended fix:** Delete the listener; if a specific stale-state bug
returns, fix it at the source (e.g. revalidate-on-focus for the RSVP store, or
a one-shot reload flag in `sessionStorage`).

**Effort:** 5 min to delete; 30 min if a focused replacement is needed.
**Impact:** Back/forward becomes instant (~50ms vs ~3s). Massive UX win,
especially during recruiting flows where users bounce between `/recruit/<slug>`
and `/id/<slug>`.

---

### 🟠 HIGH

#### H1. Three oversized PNGs in `public/`

**Where:**
- [public/player_pics/Stefan.png](public/player_pics/Stefan.png) — 502 KB
- [public/player_pics/Riki Imai.png](public/player_pics/Riki Imai.png) — 305 KB
- [public/team_logos/Fenix FC.png](public/team_logos/Fenix FC.png) — 259 KB
- [public/player_pics/default.png](public/player_pics/default.png) — 89 KB (smaller, but still 4× more than needed)

These are 800×800 (player pics) / unspecified (logo) RGBA PNGs. For a 64×64
avatar slot in `MatchdayCard` / `SquadList`, a 502 KB source means the browser
spends bandwidth + memory on bytes it will downscale anyway.

`next/image` *does* cover this on prod — `_next/image?url=...&w=3840&q=75` was
seen in the waterfall — but only the dimensions you ASK for matter. Several
callers use `<Image fill />` without `sizes`, which makes Next default to
`100vw` and serve the largest variant.

**Recommended fix (two-part):**
1. Convert all `public/` images to AVIF (or WebP) at appropriate intrinsic
   sizes — 256×256 for avatars, 512×512 for team logos. Tools: `cwebp -q 75
   in.png -o out.webp` or `cavif -Q 50 in.png -o out.avif`. Target <30 KB per
   asset.
2. Audit `<Image>` callers using `fill` and add `sizes="64px"` (or whatever
   matches the rendered slot) so Next's image optimizer serves a small
   variant. Highest-traffic call sites:
   - [src/components/PlayerAvatar.tsx](src/components/PlayerAvatar.tsx) (used in NextMatchdayBanner, MatchdayAvailability, SquadList)
   - [src/components/MatchdayCard.tsx](src/components/MatchdayCard.tsx) (team logos)
   - [src/components/UserTeamBadge.tsx](src/components/UserTeamBadge.tsx)
   - [src/components/SquadList.tsx](src/components/SquadList.tsx)
   - [src/components/TopPerformers.tsx](src/components/TopPerformers.tsx)
   - [src/components/LeagueTable.tsx](src/components/LeagueTable.tsx)

**Effort:** 30 min (image re-encode) + 30 min (`sizes=` audit).
**Impact:** Largest assets in the repo become ~3-5× smaller. Cold-cache visits
on a recruiting league with many photos can save 1-3 MB of image bandwidth.

#### H2. Fonts ship 10 weight files, ~172 KB total

**Where:** [src/app/layout.tsx:14-35](src/app/layout.tsx:14)

```ts
const inter = Inter({ subsets: ["latin"] });                         // 1 file
const barlowCondensed = Barlow_Condensed({ weight: ["400","600","700","800"] });  // 4 files
const barlowSans     = Barlow({ weight: ["400","500","600"] });        // 3 files
const dmMono         = DM_Mono({ weight: ["400","500"] });             // 2 files
```

`/_next/static/media/*.woff2` returned 10 distinct font files in the network
waterfall. Largest is 48 KB; smallest 5 KB. Total decoded font weight: 172 KB.

Inspection of typical T9L UI suggests:
- **Barlow Condensed 400** — likely unused (display = 700/800/black via the
  4xl/6xl titles).
- **Barlow Sans 500** — verify; 400 + 600 cover most body text.
- **DM Mono 500** — verify; many monospace surfaces could collapse to 400.

**Recommended fix:** grep the codebase for each weight (`font-medium`,
`font-semibold`, etc.) and drop weights with zero usage. Conservative target:
6 files / ~100 KB. Aggressive: 4 files / ~70 KB.

**Effort:** 30 min to audit + verify visually.
**Impact:** ~70-100 KB removed from the critical path. Fonts block text paint
until they arrive (or the fallback flash kicks in), so each removed file
shaves both bytes AND a head-of-line request.

#### H3. `Dashboard` ships every below-fold widget in the initial bundle

**Where:** [src/components/Dashboard.tsx:1](src/components/Dashboard.tsx:1)

`Dashboard` is `'use client'` and statically imports all of:

```ts
import Header                       from './Header';                  //  78 lines
import GuestLoginBanner             from './GuestLoginBanner';
import UserTeamBadge                from './UserTeamBadge';
import RecruitingBanner             from './RecruitingBanner';        // 214 lines
import UnpaidFeeBanner              from './UnpaidFeeBanner';
import LeagueDetailsPanel           from './LeagueDetailsPanel';      // 301 lines
import PlannedRosterStats           from './PlannedRosterStats';
import ClassicLeagueHomepage        from './ClassicLeagueHomepage';   //  hub
                                    // └─ NextMatchdayBanner          // 228 lines
                                    // └─ MatchdayAvailability        // 522 lines
import CompressedMatchdaySchedule   from './CompressedMatchdaySchedule'; // 177 lines
import RsvpBar                      from './RsvpBar';                 // 326 lines
import SubmitGoalForm               from './matchday/SubmitGoalForm'; // 410 lines
```

Every one of these lands in the initial JS chunk for `/` and `/id/<slug>`,
even though many never render (e.g. `SubmitGoalForm` is only rendered when
`submitGateOpen` — kickoff has passed) and many render below the fold
(`MatchdayAvailability`, `RsvpBar`, `LeagueDetailsPanel` on classic mode).

**Recommended fix:** convert below-fold or rarely-rendered widgets to
`next/dynamic` with `ssr: true` so SSR'd HTML still shows up but the JS chunk
loads on demand. See **§ Above-the-fold lazy-load plan** below for the full
proposed split.

**Effort:** 1-2 hours including verifying SSR fallback skeletons render
correctly.
**Impact:** ~50-100 KB shaved from the home page initial bundle. Ranks here
because it directly attacks the 2-5s DCL.

#### H4. `/stats` ships `TopPerformers` + `SquadList` in the route bundle

**Where:** [src/components/StatsDashboard.tsx](src/components/StatsDashboard.tsx)

The `/stats` page renders three stacked sections:

- `LeagueTable` — above the fold (8-team table is short).
- `TopPerformers` — below the fold for most viewports; uses player pictures.
- `SquadList` — definitely below the fold, accordion-collapsed by default.

All three import statically. `SquadList` (176 lines) and `TopPerformers` (179
lines) plus their image-rendering deps could be `next/dynamic`'d.

**Recommended fix:** wrap both in `dynamic(() => import('./X'), { loading:
SkeletonRow })`.

**Effort:** 30-45 min.
**Impact:** Drops `/stats` initial bundle by ~30-50 KB.

#### H5. `/stats` does sequential awaits that should parallelize

**Where:** [src/app/stats/page.tsx:45-65](src/app/stats/page.tsx:45)

```ts
const leagueId = await getDefaultLeagueId();          // await 1
if (leagueId) {
  const flags = await getLeagueFlags(leagueId);       // await 2 (sequential)
  if (flags.preseasonMode) redirect('/');
}
[data, unpaidFee] = await Promise.all([                // await 3 (sequential)
  getPublicLeagueData(leagueId ?? undefined),
  leagueId ? getUnpaidFeeBannerData(leagueId) : Promise.resolve(null),
]);
const playerPictures = await fetchPlayerPictures(...); // await 4 (sequential, depends on data.players)
```

`getLeagueFlags` is independent of `getPublicLeagueData` *until* the redirect
decision; the redirect-on-preseason check forces it to be sequential. But the
flags + data + unpaidFee CAN be one big `Promise.all` — speculatively fetch
everything, then post-check `flags.preseasonMode` and discard if needed. The
cost of a wasted fetch on the rare preseason `/stats` hit is one cached
30-second `unstable_cache` round trip; the win on the common path is two
network round trips merged into one.

**Recommended fix:**

```ts
const leagueId = await getDefaultLeagueId();
if (!leagueId) { /* render fallback */ }
const [flags, data, unpaidFee] = await Promise.all([
  getLeagueFlags(leagueId),
  getPublicLeagueData(leagueId),
  getUnpaidFeeBannerData(leagueId),
]);
if (flags.preseasonMode) redirect('/');
const playerPictures = await fetchPlayerPictures(data.players.map(p => p.id));
```

**Effort:** 5 min.
**Impact:** Saves ~50-150 ms on the `/stats` server render at p50.

#### H6. `findNextMatchday` is uncached and runs on every public page load

**Where:** [src/lib/stats.ts:198-212](src/lib/stats.ts:198)

`findNextMatchday(matchdays)` does an O(n) scan of the matchdays array on every
request to `/`, `/id/<slug>`, `/stats`, etc. The `matchdays` array IS already
in cache via `getPublicLeagueData`, so the scan is in-process and cheap, but
it runs N times per request because it's called from each page that imports
it.

This is **probably fine** today (n ≤ 20), but worth noting. Possible
optimization: thread the result as a derived field on `LeagueData` itself
(compute once during `dbToPublicLeagueData`, cache alongside the data).

**Effort:** 15 min if pursued.
**Impact:** Marginal — micro-optimization. Listed for completeness; defer
unless profiling flags it.

---

### 🟡 MEDIUM

#### M1. `revalidate: 30` on the public-data cache may be too aggressive

**Where:** [src/lib/publicData.ts:41](src/lib/publicData.ts:41)

```ts
const getFromDb = unstable_cache(
  async (leagueId?: string) => dbToPublicLeagueData(leagueId),
  ['public-data:db'],
  { revalidate: 30, tags: ['public-data', 'leagues'] },
)
```

30s is fine, but the codebase already has tag-based busting via
[src/lib/revalidate.ts](src/lib/revalidate.ts) — every admin write that affects
public data calls `revalidate({ domain: 'public' })` which busts both tags
above. So the 30s timer is pure belt-and-suspenders. With the tags doing the
real work, the timer could be `revalidate: 300` (5 min) and serve far more
requests from the warm cache, materially reducing Neon round trips.

**Recommended fix:** bump to `revalidate: 300`. Low risk because every
mutation already invalidates tags.

**Effort:** 1 line.
**Impact:** Lower DB load on cold cache. Minor TTFB improvement on warmed
nodes.

#### M2. Unbounded `findMany()` calls in admin-data hot paths

**Where:**
- [src/lib/admin-data.ts:168-174](src/lib/admin-data.ts:168) — active personal invites
- [src/lib/admin-data.ts:277-284](src/lib/admin-data.ts:277) — goals
- [src/lib/admin-data.ts:323-340](src/lib/admin-data.ts:323) — match events

Several admin queries `findMany` with no `take`. Cardinality is bounded by
roster size today, but if a league accrues a few seasons of goals + events
this becomes an unbounded query (and a large JSON payload back to the admin
page).

**Recommended fix:** add defensive `take: 5000` or paginate. Track in
follow-up.

**Effort:** 15 min for `take`, 1 hour for proper pagination.
**Impact:** Defensive — flips a future foot-gun into a hard error rather than
a slow page.

#### M3. `Toaster` from `sonner` is mounted globally

**Where:** [src/app/layout.tsx:137-142](src/app/layout.tsx:137)

`sonner` ships ~12-15 KB minified+gzipped to every page even though toasts
are a rare interaction (post-RSVP, post-admin-write). Could move into the
client provider chain only when actually needed, or bundle on-demand via
`dynamic`. Lower priority because it's small.

**Effort:** 30 min.
**Impact:** ~10-15 KB off the initial bundle.

#### M4. Many `useSession()` consumers (32 call sites)

**Where:** grep `useSession\b` — 32 callers across the codebase.

Each one re-renders on session change. Not a perf bug per se (NextAuth's
SessionProvider memoizes the value), but a future refactor opportunity: pass
session-derived booleans as props rather than letting each child subscribe.
Reduces React re-renders during hydration.

**Effort:** moderate — touches many files.
**Impact:** Smaller hydration cost, harder to measure. Defer.

#### M5. Schedule page renders the full season, no virtualization

**Where:** [src/app/schedule/page.tsx](src/app/schedule/page.tsx) — renders
`data.matchdays.map()` with no cap.

For an 8-week league this is 8 cards = ~4 KB hydration. For a 20-week season
or a multi-year archive view this becomes meaningful. Today: not urgent.

**Effort:** 1 hour to add `take` / virtualization.
**Impact:** Defer until matchday count > 15.

---

### 🟢 LOW

#### L1. `bodySizeLimit: '2mb'` on server actions is fine for now

[next.config.ts:20](next.config.ts:20) — already documented in the comment;
the recruit form went client-direct to Vercel Blob in v1.71.1 so server
actions only see URLs. No action needed.

#### L2. `qrcode` is dynamically imported, good

[src/components/admin/InviteDisplay.tsx:40-41](src/components/admin/InviteDisplay.tsx:40) —
already lazy-loaded via `import('qrcode')`. No change needed.

#### L3. Middleware does no I/O

[src/middleware.ts](src/middleware.ts) — pure JWT check. No fix needed.

#### L4. Lucide icons are cherry-picked

30 imports across the codebase, all named imports (`import { Plus, X } from
'lucide-react'`). Tree-shaking works correctly. No fix needed.

---

## Above-the-fold lazy-load plan

The user explicitly called this out: *"we should consider trying to load the
topmost components first and load later the bottom sections such as
PlayerAvailability"*.

The component name is `MatchdayAvailability`, not `PlayerAvailability`. Here
is the proposed split:

### `/` and `/id/<slug>` (Dashboard)

**Stays in initial bundle (above fold, on-screen at first paint):**
- `Header` — always visible.
- `UnpaidFeeBanner` — top of page, often null.
- `RecruitingBanner` — top of page when `recruiting` flag is on.
- `NextMatchdayBanner` — the hero card, biggest LCP candidate.
- `GuestLoginBanner` — small banner under hero.
- `UserTeamBadge` — small badge.

**`next/dynamic({ ssr: true, loading: skeleton })` (below fold):**
- `MatchdayAvailability` (522 lines, the biggest single below-fold component)
- `LeagueDetailsPanel` (301 lines, conditional)
- `PlannedRosterStats` (mid-page when present)
- `RsvpBar` (only renders for authenticated linked players AND when matchday
  is open — a minority of viewers)
- `SubmitGoalForm` (only renders when kickoff has passed AND user is
  authenticated linked player — even smaller minority)
- `CompressedMatchdaySchedule` (only in preseason mode — mutually exclusive
  with `ClassicLeagueHomepage`, both can be split)

**Suggested implementation pattern (Server-Component-friendly):**

```tsx
// in Dashboard.tsx — keep 'use client' for the orchestration
import dynamic from 'next/dynamic';

const MatchdayAvailability = dynamic(
  () => import('./MatchdayAvailability'),
  { loading: () => <MatchdayAvailabilitySkeleton /> }
);
const RsvpBar = dynamic(() => import('./RsvpBar'));
const SubmitGoalForm = dynamic(() => import('./matchday/SubmitGoalForm'));
const LeagueDetailsPanel = dynamic(() => import('./LeagueDetailsPanel'));
```

`MatchdayAvailability` is the single biggest win — it's 522 lines and contains
team rosters, position pills, status pills, and pill-list rendering, all of
which only matter once the user scrolls past the hero card.

### `/stats` (StatsDashboard)

**Stays in initial bundle:**
- `Header`, `UnpaidFeeBanner`
- `LeagueTable` — first section, short table, render eagerly.

**`next/dynamic` (below fold):**
- `TopPerformers` — middle section, ships player avatar grid.
- `SquadList` — bottom section, accordion default-collapsed.

### Ordering / sequencing

The user's intent ("load topmost components first") maps cleanly to:

1. SSR'd HTML for above-fold content paints immediately (Next.js does this
   already — pages are RSC).
2. Above-fold JS hydrates from the initial route bundle.
3. Below-fold JS loads on idle / on intersection (`next/dynamic` does this for
   you when wrapped components mount further down the tree).

If we want to be more aggressive: wrap below-fold dynamic components in
`<Suspense>` with `<IntersectionObserver>`-driven mounting (e.g. lazy-mount
the wrapper itself, not just lazy-load the JS). That's a bigger refactor; not
recommended in phase 1.

---

## Phased ship plan

### Phase 1 — ship this week (low risk, high impact)

| # | Item | Effort | Severity |
|---|------|-------:|---------:|
| 1 | Delete bfcache-defeating reload in [src/app/layout.tsx:124](src/app/layout.tsx:124) (C1) | 5 min | Critical |
| 2 | Re-encode Stefan.png + Riki Imai.png + Fenix FC.png to AVIF/WebP, replace in `public/` (H1, part 1) | 30 min | High |
| 3 | Bump `revalidate: 30 → 300` in [src/lib/publicData.ts:41](src/lib/publicData.ts:41) (M1) | 1 line | Medium |
| 4 | Parallelize `/stats` server fetches (H5) | 5 min | High |
| 5 | Audit + drop unused font weights in [src/app/layout.tsx:19-35](src/app/layout.tsx:19) (H2) | 30 min | High |

Cumulative effort: ~75 minutes. Each ships as its own PR per the repo's
small-focused-PR rule.

### Phase 2 — ship next week (medium-touch refactors)

| # | Item | Effort | Severity |
|---|------|-------:|---------:|
| 6 | `next/dynamic` for below-fold Dashboard widgets (`MatchdayAvailability`, `LeagueDetailsPanel`, `RsvpBar`, `SubmitGoalForm`, `CompressedMatchdaySchedule`) (H3) | 1-2 hr | High |
| 7 | `next/dynamic` for `/stats` `TopPerformers` + `SquadList` (H4) | 30-45 min | High |
| 8 | Audit + add `sizes=` to `<Image fill />` callers (H1, part 2) | 30 min | High |
| 9 | Defensive `take` on unbounded `admin-data.ts` queries (M2) | 15 min | Medium |

### Phase 3 — research / requires design call

| # | Item | Notes |
|---|------|-------|
| 10 | Investigate making `Dashboard` a Server Component | Currently `'use client'` because `useSession` + `useState(selectedMatchdayId)` + `useMemo` — the hero requires client state. The shell could split: a server component for the static frame, with `<HeroBanner client />` and `<BelowFold client />` inside. Significant refactor. |
| 11 | Move `Toaster` (sonner) to a route-level provider | Saves ~10-15 KB but needs care because toasts are fired from many places. |
| 12 | Replace 32 `useSession()` consumers with prop-drilled session derivatives | Reduces hydration re-renders. Touches many files. |
| 13 | Cache `findNextMatchday` derived value alongside `LeagueData` | Trivial perf. Defer until profiling demands it. |
| 14 | Virtualize long lists if league season grows past 15 weeks | Only matters for archive/multi-season views. |

---

## Out-of-scope notes

- **TTFB is excellent.** Vercel edge + 30s cache + parallelized RSC fetches.
  No DB indexes are missing on hot paths (verified against
  [prisma/schema.prisma](prisma/schema.prisma)). Don't optimize what isn't
  broken.
- **Server actions are well-structured.** Most hot-path writes use
  `waitUntil()` to defer Prisma backups behind a Redis-canonical write. RSVP
  and assign-player are exemplars.
- **Cache invalidation is centralized.** Every write goes through
  `revalidate({domain})`; the lint guard at
  [tests/unit/revalidatePrimitivesGuard.test.ts](tests/unit/revalidatePrimitivesGuard.test.ts)
  prevents primitive-call leaks. Don't touch this without strong reason.
- **No N+1 against Prisma** detected on the public hot paths. The
  `dbToPublicLeagueData` adapter is a single round trip with proper
  `include:` projection.
- **Middleware does zero I/O.** JWT-only auth gate.
- **No raw `<img>` tags.** Everything goes through `next/image`.
- **Lucide icons are tree-shaken correctly** (named imports throughout).
- **`qrcode` is dynamically imported** (admin-only, not on hot path).

---

## Verification checklist for the phase-1 PR(s)

When shipping any item above, the repo's standing rules apply:

- [ ] Bump `APP_VERSION` in [src/lib/version.ts](src/lib/version.ts).
- [ ] Update test in [tests/unit/version.test.ts](tests/unit/version.test.ts).
- [ ] Add a regression test that fails on the broken state and passes on the
      fix (per CLAUDE.md "End-to-end verification" rule). For C1 (bfcache),
      that means a Playwright test that navigates back and asserts the
      pageshow handler does not reload. For H1 (image weight), an asset-size
      test that asserts no public/ PNG over 100 KB. For H2 (fonts), a config
      test against the layout's font weight list. For H3/H4 (dynamic split),
      a Playwright test that asserts initial JS payload < threshold.
- [ ] Update CLAUDE.md ledger entry in the same PR (per Maintenance rule).
- [ ] Verify on the deployed Vercel preview that DCL drops as expected
      (Chrome devtools `performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd`).

---

*End of audit. The repo is healthy; the wins are concentrated in shipping
less to the client.*
