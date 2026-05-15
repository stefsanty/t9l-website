/**
 * v2.2.14 — source-pin tests for the two fixes shipped in this PR.
 *
 *   (1) `--electric-green` CSS variable is theme-aware: defined neon
 *       (#00FF85) in `:root`, darkened (#006633 — the same WCAG-AA
 *       shade as `--success`) in `html.light` AND the
 *       `:root:not(.dark)` `prefers-color-scheme: light` fallback.
 *       `@theme inline`'s `--color-electric-green` now indirects
 *       through `var(--electric-green)` so every Tailwind utility
 *       (`text-/bg-/border-electric-green`) picks up the override.
 *   (2) Position pills are opaque (`bg-{c}-200 text-{c}-900`) with no
 *       `dark:` variants and no alpha modifiers — verified
 *       behaviourally in tests/unit/v2213_fixes.test.ts +
 *       tests/unit/v1853_formation_pitch_tweaks.test.ts. This file
 *       owns the CSS-source pin so a future refactor of globals.css
 *       can't silently drop the per-mode variable.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const root = resolve(__dirname, '../..')
const globals = readFileSync(resolve(root, 'src/app/globals.css'), 'utf8')

describe('v2.2.14 — fix 1: --electric-green is theme-aware', () => {
  it('@theme inline indirects --color-electric-green through var()', () => {
    // Pre-v2.2.14 this was a fixed literal hex; v2.2.14 routes it
    // through --electric-green so the per-mode override below wins.
    expect(globals).toMatch(/--color-electric-green:\s*var\(--electric-green\)/)
    // The legacy literal hex must be gone from the @theme inline slot
    // so the CSS variable indirection is the only path.
    expect(globals).not.toMatch(/--color-electric-green:\s*#00FF85/)
  })

  it(':root (dark default) defines --electric-green as neon #00FF85', () => {
    // First block: :root { ... --electric-green: #00FF85 ... }
    expect(globals).toMatch(/:root\s*\{[\s\S]*?--electric-green:\s*#00FF85/)
  })

  it('html.light overrides --electric-green to #006633 (WCAG-AA dark green)', () => {
    expect(globals).toMatch(/html\.light\s*\{[\s\S]*?--electric-green:\s*#006633/)
  })

  it('prefers-color-scheme: light SSR fallback also overrides to #006633', () => {
    // The :root:not(.dark) block inside the @media query covers the
    // no-JS / pre-hydration SSR case.
    expect(globals).toMatch(
      /@media\s*\(prefers-color-scheme:\s*light\)[\s\S]*?:root:not\(\.dark\)[\s\S]*?--electric-green:\s*#006633/,
    )
  })

  it('uses the same WCAG-AA shade as --success in light mode (#006633)', () => {
    // Visual continuity hint — operator already approved #006633 in
    // v1.70.2 for --success / --tertiary. Pinning the equality so a
    // future colour-pass on --success doesn't accidentally drift the
    // two apart without an explicit decision.
    const lightSuccessMatch = globals.match(/html\.light\s*\{[\s\S]*?--success:\s*(#[0-9a-fA-F]{6})/)
    const lightElectricMatch = globals.match(/html\.light\s*\{[\s\S]*?--electric-green:\s*(#[0-9a-fA-F]{6})/)
    expect(lightSuccessMatch?.[1]?.toLowerCase()).toBe('#006633')
    expect(lightElectricMatch?.[1]?.toLowerCase()).toBe('#006633')
  })
})
