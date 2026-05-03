import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * v1.41.1 — Regression target for the invite error / roster-full button
 * "Go to homepage" being invisible against the magenta primary background.
 *
 * Pre-v1.41.1 nine call sites in `src/app/join/**`, `src/app/account/**`,
 * etc. used the Tailwind utility `text-on-primary`, but the matching
 * `--color-on-primary` token was never declared in `@theme inline`. The
 * compiled CSS therefore set `color: var(--color-on-primary)` to nothing
 * → the button text rendered with the inherited foreground (invisible /
 * very low contrast on the magenta button background).
 *
 * Fix: alias `--color-on-primary` to `--primary-foreground` (white) inside
 * the `@theme inline` block in `globals.css`. Removing or breaking the
 * alias would re-introduce the invisible-text bug across all call sites.
 *
 * Test reads `globals.css` as text. We deliberately avoid asserting any
 * specific value — just that the alias is declared. That keeps the test
 * stable if the underlying `--primary-foreground` palette ever shifts.
 */
describe('--color-on-primary token (v1.41.1 regression target)', () => {
  const css = readFileSync(
    resolve(__dirname, '../../src/app/globals.css'),
    'utf8',
  )

  it('declares --color-on-primary inside @theme inline', () => {
    // @theme inline { ... --color-on-primary: ...; ... }
    // The block can be long; assert presence + non-empty value.
    expect(css).toMatch(/--color-on-primary:\s*[^;]+;/)
  })

  it('aliases --color-on-primary to --primary-foreground (single source of truth)', () => {
    expect(css).toMatch(/--color-on-primary:\s*var\(--primary-foreground\)\s*;/)
  })

  it('declares the alias inside the @theme inline block (so Tailwind picks it up)', () => {
    const themeMatch = css.match(/@theme\s+inline\s*\{([\s\S]*?)\n\}/)
    expect(themeMatch, '@theme inline block must exist').toBeTruthy()
    const themeBody = themeMatch![1]
    expect(themeBody).toMatch(/--color-on-primary:\s*var\(--primary-foreground\)\s*;/)
  })
})
