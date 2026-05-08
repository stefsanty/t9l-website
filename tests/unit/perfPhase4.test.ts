import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * perf phase 4 tests — closes out the perf audit chain that opened in
 * v1.80.2 and ran through v1.80.5.
 *
 *   v1.80.6 (this PR) — LCP font + first-load weight:
 *     1. Hypothesis A from docs/perf-phase3-lcp-handoff.md confirmed via
 *        Chrome MCP DOM area scan: the LCP element on `/` is the
 *        `<h2 class="font-display text-4xl font-black ...">May 14 (Thu)
 *        </h2>` matchday date heading rendered in Barlow Condensed at
 *        weight 800. `display: 'swap'` was triggering a late re-paint
 *        when the web font finished loading; switching to
 *        `display: 'optional'` falls back to system fonts within ~100ms
 *        and never re-fires LCP.
 *     2. Barlow Sans + DM Mono were loaded in the root layout pre-
 *        v1.80.6 but used ONLY in the admin shell (Barlow Sans = admin
 *        body font; DM Mono = `font-mono` / `font-condensed` admin
 *        aliases). Public visitors paid ~50 KiB of woff2 on every page
 *        for fonts they never see. Both moved into
 *        `src/app/admin/layout.tsx` so admin still gets them and public
 *        visitors get neither.
 *     3. Barlow Condensed weight 400 was loaded but never paired with
 *        `font-display` or `font-condensed` anywhere in `src/`. Drop it.
 *        Keep 600/700/800 because admin uses `font-condensed
 *        font-semibold` (600) on table headers and "no leagues yet"
 *        empty states.
 *     4. `@next/bundle-analyzer` added as a devDependency; `ANALYZE=true
 *        npx next experimental-analyze` writes the Turbopack analyzer
 *        report under `.next/diagnostics/analyze/`. Default builds are
 *        unchanged (analyzer is a no-op wrapper unless ANALYZE=true).
 *
 * Each assertion fails on the pre-v1.80.6 state. Stash-pop verified
 * during PR authoring (see docs/perf-phase3-lcp-handoff.md hypothesis
 * tree for the diagnostic chain).
 */

const ROOT = path.resolve(__dirname, '../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

describe('perf phase 4 — LCP fix: Barlow Condensed display: optional', () => {
  const layout = read('src/app/layout.tsx')

  it('Barlow_Condensed loader uses display: "optional"', () => {
    // Pre-fix: no `display:` arg → next/font defaults to 'swap', which
    // triggered a late re-paint on the LCP `<h2>` matchday heading
    // when the web font finally loaded. PSI lab + Chrome MCP DOM scan
    // both identified that <h2> as the LCP element (area ~19,710 px²,
    // dwarfing every other above-fold element). With 'optional' the
    // browser uses the system fallback for the entire first paint
    // unless the web font is ready inside ~100ms — eliminates the
    // swap-induced LCP regression completely.
    const block = layout.match(/Barlow_Condensed\(\s*\{[\s\S]*?\}\s*\)/m)
    expect(block, 'Barlow_Condensed loader block not found').not.toBeNull()
    expect(block![0]).toMatch(/display:\s*['"]optional['"]/)
  })

  it('Barlow_Condensed loads only weights 600/700/800 (drops 400)', () => {
    // Audit: `font-display font-{normal|black|bold|semibold|...}` paired
    // with Barlow Condensed never uses `font-normal` (400) anywhere on
    // public OR admin. 600 stays for admin `font-condensed
    // font-semibold` table headers; 700 stays for `font-bold`; 800 for
    // `font-black` (the LCP heading and most public-site display copy).
    const block = layout.match(/Barlow_Condensed\(\s*\{[\s\S]*?\}\s*\)/m)!
    expect(block[0]).not.toMatch(/['"]400['"]/)
    expect(block[0]).toMatch(/['"]600['"]/)
    expect(block[0]).toMatch(/['"]700['"]/)
    expect(block[0]).toMatch(/['"]800['"]/)
  })
})

describe('perf phase 4 — admin-only fonts moved out of public root layout', () => {
  const rootLayout = read('src/app/layout.tsx')
  const adminLayout = read('src/app/admin/layout.tsx')

  it('root layout no longer imports Barlow (sans) or DM_Mono', () => {
    // Pre-fix: `import { Inter, Barlow_Condensed, Barlow, DM_Mono } from
    // "next/font/google"` → 5 woff2 files (3 weights of Barlow Sans,
    // 2 weights of DM Mono) shipped on every public page load even
    // though no public surface uses them. Post-fix: Inter and
    // Barlow Condensed only.
    const importLine = rootLayout.match(
      /import\s+\{[^}]*\}\s+from\s+["']next\/font\/google["']/m,
    )
    expect(importLine, 'next/font/google import in root layout').not.toBeNull()
    expect(importLine![0]).not.toMatch(/\bBarlow\b(?!_Condensed)/)
    expect(importLine![0]).not.toMatch(/\bDM_Mono\b/)
    expect(importLine![0]).toMatch(/\bInter\b/)
    expect(importLine![0]).toMatch(/\bBarlow_Condensed\b/)
  })

  it('root layout <html> className threads only Inter + Barlow Condensed', () => {
    // The CSS variables (`--font-inter`, `--font-barlow-condensed`)
    // get applied via the className of the `<html>` element. Pre-fix
    // it also added `--font-barlow-sans` and `--font-dm-mono`; those
    // now belong to the admin layout's wrapper className.
    const htmlOpen = rootLayout.match(/<html[^>]*>/m)
    expect(htmlOpen, '<html> element').not.toBeNull()
    expect(htmlOpen![0]).toMatch(/inter\.variable/)
    expect(htmlOpen![0]).toMatch(/barlowCondensed\.variable/)
    expect(htmlOpen![0]).not.toMatch(/barlowSans\.variable/)
    expect(htmlOpen![0]).not.toMatch(/dmMono\.variable/)
  })

  it('admin layout imports Barlow + DM_Mono from next/font/google', () => {
    expect(adminLayout).toMatch(
      /import\s+\{[^}]*\bBarlow\b[^}]*\bDM_Mono\b[^}]*\}\s+from\s+["']next\/font\/google["']/,
    )
  })

  it('admin layout wrapper threads barlowSans + dmMono CSS variables', () => {
    // Variables must reach the admin shell so `font-mono`,
    // `font-condensed`, and the inline `var(--font-barlow-sans)` style
    // on the wrapper still resolve.
    expect(adminLayout).toMatch(/barlowSans\.variable/)
    expect(adminLayout).toMatch(/dmMono\.variable/)
  })
})

describe('perf phase 4 — globals.css falls back cleanly when admin fonts undefined', () => {
  const css = read('src/app/globals.css')

  it('--font-mono provides an in-var() fallback for public pages', () => {
    // Pre-fix: `--font-mono: var(--font-dm-mono), monospace;` — when
    // `--font-dm-mono` is undefined (public pages post-v1.80.6),
    // `var()` resolves to its initial value, which leaves the comma-
    // separated font-family list partially valid but inconsistent
    // across browsers. Post-fix: `var(--font-dm-mono, ui-monospace),
    // monospace` — the `var()` itself has an explicit fallback so
    // unset → `ui-monospace`, which renders as a real system mono.
    expect(css).toMatch(
      /--font-mono:\s*var\(--font-dm-mono,\s*ui-monospace\)/,
    )
  })

  it('--font-barlow provides an in-var() fallback for public pages', () => {
    expect(css).toMatch(
      /--font-barlow:\s*var\(--font-barlow-sans,\s*system-ui\)/,
    )
  })
})

describe('perf phase 4 — bundle analyzer wired (opt-in)', () => {
  const pkg = JSON.parse(read('package.json'))
  const config = read('next.config.ts')

  it('@next/bundle-analyzer is a devDependency', () => {
    expect(pkg.devDependencies).toBeDefined()
    expect(pkg.devDependencies['@next/bundle-analyzer']).toBeDefined()
  })

  it('next.config.ts wraps export with the analyzer', () => {
    // Wrap is a no-op unless ANALYZE=true is set — default builds
    // (CI / Vercel) skip the analyzer overhead entirely. The Turbopack
    // analyzer (next experimental-analyze) writes its report under
    // .next/diagnostics/analyze/ regardless of this wrapper, but the
    // wrapper preserves a webpack-fallback path (`next build --webpack`)
    // for cases where Turbopack analyzer output is insufficient.
    expect(config).toMatch(/from\s+["']@next\/bundle-analyzer["']/)
    expect(config).toMatch(/ANALYZE\s*===\s*['"]true['"]/)
    expect(config).toMatch(/withBundleAnalyzer\(nextConfig\)/)
  })
})

describe('perf phase 4b (v1.80.7) — server-only DB lookups split out of mixed lib modules', () => {
  // Bundle analyzer surfaced ~47 KB (parsed) / ~17 KB (gzip) of
  // `@prisma/client/runtime/index-browser.js` shipped to EVERY public
  // route. Root cause: two lib modules (`leagueSlug.ts`,
  // `leagueDetails.ts`) co-located pure exports (`DEFAULT_LEAGUE_SLUG`,
  // `validateLeagueSlug`, `BALL_TYPE_LABELS`, `formatPlayerFormat`, etc.)
  // with `unstable_cache(...)` Prisma readers. Client components like
  // `CopyMatchdayLink`, `RecruitingBanner`, `CreateLeagueModal`, and
  // `LeagueDetailsPanel` legitimately imported the pure helpers, and
  // Webpack's module-evaluation rules then dragged the whole module —
  // including the side-effect `import { prisma }` — into the public
  // bundle. The fix splits each file into pure + server modules.
  //
  // These assertions pin the split: pure modules MUST stay free of
  // prisma + next/cache imports, and server callers MUST import the DB
  // lookups from the new server modules. A regression that re-co-located
  // the cached reader back into the pure module would re-introduce the
  // ~17 KB gzip leak per route.

  it('leagueSlug.ts (pure) imports neither prisma nor next/cache', () => {
    const src = read('src/lib/leagueSlug.ts')
    expect(src).not.toMatch(/from\s+['"]@\/lib\/prisma['"]/)
    expect(src).not.toMatch(/from\s+['"]\.\/prisma['"]/)
    expect(src).not.toMatch(/from\s+['"]next\/cache['"]/)
  })

  it('leagueSlugServer.ts owns getLeagueIdBySlug + getDefaultLeagueId', () => {
    const src = read('src/lib/leagueSlugServer.ts')
    expect(src).toMatch(/export async function getLeagueIdBySlug/)
    expect(src).toMatch(/export async function getDefaultLeagueId/)
    expect(src).toMatch(/from\s+['"]\.\/prisma['"]/)
    expect(src).toMatch(/from\s+['"]next\/cache['"]/)
  })

  it('leagueDetails.ts (pure) imports neither prisma nor next/cache', () => {
    const src = read('src/lib/leagueDetails.ts')
    expect(src).not.toMatch(/from\s+['"]@\/lib\/prisma['"]/)
    expect(src).not.toMatch(/from\s+['"]next\/cache['"]/)
  })

  it('leagueDetailsServer.ts owns the cached getLeagueDetails reader', () => {
    const src = read('src/lib/leagueDetailsServer.ts')
    expect(src).toMatch(/export const getLeagueDetails = unstable_cache/)
    expect(src).toMatch(/from\s+['"]@\/lib\/prisma['"]/)
    expect(src).toMatch(/from\s+['"]next\/cache['"]/)
  })

  it('client components that import from leagueSlug.ts only pull pure exports', () => {
    // Pre-v1.80.7, these client components transitively pulled in prisma
    // because their pure imports lived in a module that also imported
    // prisma at top-level. Pin: the client surface keeps using
    // `@/lib/leagueSlug` (the pure module) for these specific symbols.
    expect(read('src/components/CopyMatchdayLink.tsx')).toMatch(
      /import\s+\{\s*DEFAULT_LEAGUE_SLUG\s*\}\s+from\s+['"]@\/lib\/leagueSlug['"]/,
    )
    expect(read('src/components/RecruitingBanner.tsx')).toMatch(
      /import\s+\{\s*DEFAULT_LEAGUE_SLUG\s*\}\s+from\s+['"]@\/lib\/leagueSlug['"]/,
    )
    expect(read('src/components/admin/CreateLeagueModal.tsx')).toMatch(
      /import\s+\{\s*validateLeagueSlug\s*\}\s+from\s+['"]@\/lib\/leagueSlug['"]/,
    )
  })

  it('LeagueDetailsPanel imports only pure values from leagueDetails.ts', () => {
    // The label maps + formatPlayerFormat helper live in the pure file;
    // the panel never needs the DB reader. Re-introducing a server
    // import here would re-leak prisma into the lazy panel chunk.
    const src = read('src/components/LeagueDetailsPanel.tsx')
    expect(src).toMatch(/from\s+['"]@\/lib\/leagueDetails['"]/)
    expect(src).not.toMatch(/from\s+['"]@\/lib\/leagueDetailsServer['"]/)
  })
})

describe('perf phase 4c (v1.80.8) — modal chunks deferred via next/dynamic', () => {
  // Bundle analyzer surfaced two modals (`SignInLightbox`, ~9 KB / ~3 KB
  // gzip; `ApplyToLeagueModal`, ~5 KB / ~2 KB gzip) statically imported
  // by three eagerly-loaded callers (`Header → LineLoginButton`, the
  // landing-page `RecruitingBanner`, and `GuestLoginBanner`). The modals
  // mount only after a user click — keeping their bytes on the eager
  // first-load critical path is wasted weight on every visit that
  // never opens a modal.
  //
  // Webpack measurements (parsed bytes, with `ANALYZE=true npx next
  // build --webpack`):
  //   - Chunk 1347 (root Header layer): 27,577 → 21,509 (-6,068 / -1,059 gz)
  //   - Chunk 7206 (Dashboard layer):   33,725 → 26,174 (-7,551 / -2,203 gz)
  // The modals now ship as their own async chunks (~9 KB + ~5 KB parsed)
  // that fetch only when a user actually opens them.
  //
  // Each assertion below would fail if a static `import SignInLightbox
  // from './SignInLightbox'` (or the analogous ApplyToLeagueModal import)
  // crept back in — this is the exact regression target.

  it('LineLoginButton uses next/dynamic for SignInLightbox', () => {
    const src = read('src/components/LineLoginButton.tsx')
    // Must NOT contain a static default import of SignInLightbox.
    expect(src).not.toMatch(
      /^import\s+SignInLightbox\s+from\s+['"]\.\/SignInLightbox['"]/m,
    )
    // Must declare it via next/dynamic with the lazy import callback.
    expect(src).toMatch(/from\s+['"]next\/dynamic['"]/)
    expect(src).toMatch(
      /const\s+SignInLightbox\s*=\s*dynamic\(\s*\(\s*\)\s*=>\s*import\(\s*['"]\.\/SignInLightbox['"]\s*\)/,
    )
    // Must gate the JSX so the chunk only fetches when state opens it.
    expect(src).toMatch(
      /\{showSignInLightbox\s*&&\s*\(?\s*<SignInLightbox\b/,
    )
  })

  it('RecruitingBanner lazy-loads SignInLightbox + ApplyToLeagueModal', () => {
    const src = read('src/components/RecruitingBanner.tsx')
    expect(src).not.toMatch(
      /^import\s+SignInLightbox\s+from\s+['"]\.\/SignInLightbox['"]/m,
    )
    expect(src).not.toMatch(
      /^import\s+ApplyToLeagueModal\s+from\s+['"]\.\/ApplyToLeagueModal['"]/m,
    )
    expect(src).toMatch(/from\s+['"]next\/dynamic['"]/)
    expect(src).toMatch(
      /const\s+SignInLightbox\s*=\s*dynamic\(\s*\(\s*\)\s*=>\s*import\(\s*['"]\.\/SignInLightbox['"]\s*\)/,
    )
    expect(src).toMatch(
      /const\s+ApplyToLeagueModal\s*=\s*dynamic\(\s*\(\s*\)\s*=>\s*import\(\s*['"]\.\/ApplyToLeagueModal['"]\s*\)/,
    )
    // JSX is gated on the open-state booleans so the chunks defer.
    expect(src).toMatch(/applyOpen\s*&&\s*\(?\s*<ApplyToLeagueModal\b/)
    expect(src).toMatch(/signInOpen\s*&&\s*\(?\s*<SignInLightbox\b/)
  })

  it('GuestLoginBanner uses next/dynamic for SignInLightbox', () => {
    const src = read('src/components/GuestLoginBanner.tsx')
    expect(src).not.toMatch(
      /^import\s+SignInLightbox\s+from\s+['"]\.\/SignInLightbox['"]/m,
    )
    expect(src).toMatch(/from\s+['"]next\/dynamic['"]/)
    expect(src).toMatch(
      /const\s+SignInLightbox\s*=\s*dynamic\(\s*\(\s*\)\s*=>\s*import\(\s*['"]\.\/SignInLightbox['"]\s*\)/,
    )
    expect(src).toMatch(/\bopen\s*&&\s*<SignInLightbox\b/)
  })
})
