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
