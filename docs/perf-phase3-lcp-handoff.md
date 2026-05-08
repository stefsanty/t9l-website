# Perf phase 3 — LCP handoff

**Status:** investigation handoff. Phase 3 (v1.80.4) shipped Google Translate
deferral, browserslist polyfill prune, and unused-JS scoping. The 5.7s LCP
problem reported by PageSpeed Insights is **pre-existing** (not a phase 1 or
phase 2 regression) and is left for phase 4 because the diagnosis surfaces
several possible causes that need direct prod measurement to disambiguate.

## What phase 3 *probably* moved

The PSI report blamed the network critical path on
`gstatic.com/.../translate_http/.../el_main_css` (4.87 KiB on the critical
path, 1,634 ms chain). Phase 3 removes the Google Translate script entirely
for EN visitors via [GoogleTranslateLoader](../src/components/GoogleTranslateLoader.tsx) —
GT only injects when `t9l-lang === 'ja'` (or the `googtrans=/en/ja` cookie is
set). PSI runs as an EN visitor by default, so the next PSI run should drop
GT from the critical path entirely. That alone may shave ~500–1500ms off LCP.

This is the **single biggest probable contributor** that we could safely
remove without prod measurement. If LCP doesn't move materially after phase 3
ships, the remaining causes below need a real Lighthouse run on prod with the
"LCP element" filter to disambiguate.

## What phase 3 didn't address

The 2,690 ms "element render delay" reported by PSI — the gap between the
LCP element being present in the DOM and it actually being painted — has
several plausible causes that we can't disambiguate from the codebase alone.
Each requires a live PSI / Lighthouse run with the LCP element identified to
prove which is dominant.

### Hypothesis A — Font swap is dragging text-LCP

The default Lighthouse-flagged LCP element on this codebase is most likely
the `<h2>` inside [MatchdayCard](../src/components/MatchdayCard.tsx) — the
matchday date heading at `text-4xl font-black` (36 px, Barlow Condensed).
That's the largest contentful element above the fold on `/` for the default
classic-mode league.

`next/font/google` defaults to `display: 'swap'`, which has a short block
period (~100 ms) before the fallback paints, then a swap to the web font
when it loads. Lighthouse's LCP detection is supposed to fire on the
fallback paint, but in practice the swap re-shapes the text and the LCP
element can be re-recorded on the swap event.

**To test:**
- Open prod in Chrome DevTools → Performance → record a load.
- Inspect the LCP marker: does it land on the fallback paint (good) or on
  the web-font swap (bad — large render delay)?
- If swap is dominant, try `display: 'optional'` on Barlow Condensed (the
  font used by `font-display`/`font-black` headings). `'optional'` uses the
  fallback for the entire first load if the web font isn't ready inside
  100 ms — eliminates the swap, kills the render delay, but loses the
  branded font on slow connections.

### Hypothesis B — LCP element renders post-hydration on `/id/<slug>`

On `/id/<slug>` pages with recruiting on (e.g. `/id/t6l-26sp`), the LCP
candidate is more ambiguous. Candidates:

- The `<h2>` inside MatchdayCard (classic mode).
- `RECRUITING NOW` heading at `text-2xl` inside
  [RecruitingBanner](../src/components/RecruitingBanner.tsx) (recruiting on).
- The `<dl>` rows inside [LeagueDetailsPanel](../src/components/LeagueDetailsPanel.tsx)
  (preseason mode + show-league-details on).

LeagueDetailsPanel was lazy-loaded in phase 2. If it's the LCP on `t6l-26sp`,
the SSR'd HTML still paints (default `ssr: true` for `next/dynamic`), but
hydration may delay the visual confirmation by waiting for the chunk. **This
is the only phase 2 hypothesis that wasn't ruled out by the user's
correction:** the user ruled out "we lazy-loaded an above-the-fold element",
which is correct for the apex `/`, but for the preseason variant of the
panel it's worth confirming the SSR'd HTML actually renders pre-hydration.

**To test:**
- Open prod `/id/t6l-26sp` in Chrome DevTools → disable JS → reload.
- The LCP-candidate element should still paint visually. If it doesn't,
  it's a Server-only or post-hydration render path and needs to be moved.

### Hypothesis C — Hero image without `priority`

Phase 1 (v1.80.2) re-encoded three oversized PNGs but did not flag any
above-the-fold image as `priority`. The matchday card's team logos are
`<Image fill>` without `priority` — small (36×36), unlikely to be the LCP,
but worth confirming on the actual report.

**To test:**
- In the prod Lighthouse report, click the LCP element pill. If it's an
  `<img>`, confirm whether `priority` is set. If not, add it.

### Hypothesis D — `.animate-in` opacity 0 → 1 keyframe delays paint

Both [Dashboard](../src/components/Dashboard.tsx#L312-L313) and
[NextMatchdayBanner](../src/components/NextMatchdayBanner.tsx#L147) wrap their
trees in `<div className="animate-in">`. The keyframe (defined in
[globals.css](../src/app/globals.css#L232-L246)) is:

```
@keyframes fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.animate-in { animation: fade-in 0.3s ease-out forwards; }
```

The animation runs on the compositor and shouldn't depend on JS, but
Lighthouse's LCP detector won't count an element as "painted" until its
opacity crosses ~5%. With nested `.animate-in` (Dashboard wraps NextMatchdayBanner,
which has its own `.animate-in`), the visible-paint moment is multiplicative
of the two animations starting in lockstep. In practice this delays LCP by
~30 ms — small but measurable. If the budget is genuinely tight, dropping
`.animate-in` from at least the LCP-candidate ancestor is worth a try.

### Hypothesis E — Vercel cold start dragging TTFB

PSI says TTFB = 0 ms in the report we received, which is odd given Vercel
serverless cold starts can be 300–800 ms. If the report was taken from a
warm cache, TTFB on cold visits could be a hidden factor. Phase 1 already
tightened public-data cache to 300 s, so warm hits should be sub-50 ms — but
the FIRST visit from a fresh region still pays the cold start.

**To test:**
- Run PSI 3× in a row from a single region. Compare cold vs warm LCP. If
  cold is materially worse, address with edge caching or warmer functions
  (Vercel Pro feature).

## Phase 3 unused-JS work

The PSI report flagged `0_k762lvts5s2.js` (70.3 KiB transferred / 21.6 KiB
unused). This chunk hash regenerates per build, so the same chunk is now a
different hash. Phase 3's browserslist config should drop the SWC legacy
polyfill chunk (Array.prototype.at, Object.fromEntries, etc.) — that was
listed as 14 KiB. The remaining 7.6 KiB of unused first-party code in
that chunk is below the threshold where it's worth shipping
`@next/bundle-analyzer` and a vendored split — defer to phase 4 when we can
batch it with a real LCP fix.

## What should the next agent do?

1. **Re-run PSI on prod after v1.80.4 deploys.** Compare LCP and the
   network critical path against the v1.80.3 report.
2. **If LCP is still > 2.5s, identify the LCP element directly** — open the
   prod Lighthouse report, click the LCP element pill, capture the HTML
   path. Don't guess.
3. **Apply the targeted fix** for whichever hypothesis (A–E) the data
   identifies. Don't shotgun multiple fixes — one PR, one diagnosis, one
   targeted change, one before/after measurement.
4. **Bundle analyzer is worth the dep cost** if the LCP fix doesn't also
   resolve the unused-JS line item. Add `@next/bundle-analyzer` as a
   devDependency, gate it behind `ANALYZE=true`, run once to identify the
   30% dead-code culprits, ship a removal PR.
