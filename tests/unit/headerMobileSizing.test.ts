import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * v1.41.2 — Regression target for the header wrapping to two rows on
 * iPhone-width viewports.
 *
 * Pre-v1.41.2 the header content (~366px including the Sign-in pill at
 * 11px text + `px-4` padding) exceeded available space (~358px at 390px
 * viewport after the container `px-4` padding). Wrap visible at 375 /
 * 390 / sometimes 430 — the user reported "the banner takes up 2
 * vertical spaces instead of 1".
 *
 * Fix trims mobile padding and gaps WITHOUT shrinking the brand title
 * font (text-xl on both breakpoints). All trims use `md:` overrides so
 * the desktop layout is byte-equivalent to pre-v1.41.2.
 *
 * The test reads the source files as text and asserts the className
 * pattern is present. This is the right level — Tailwind classes are
 * inert strings until compile time; structural assertion catches a
 * regression that finds-and-replaces away the responsive prefix.
 */

const HEADER_PATH = resolve(__dirname, '../../src/components/Header.tsx')
const LINE_LOGIN_PATH = resolve(__dirname, '../../src/components/LineLoginButton.tsx')

describe('Header mobile sizing (v1.41.2 regression target)', () => {
  const headerSrc = readFileSync(HEADER_PATH, 'utf8')

  it('inner container uses px-3 on mobile + px-4 on desktop', () => {
    // Pre-v1.41.2 was bare `px-4`; if a future PR drops the responsive
    // prefix the iPhone wrap returns.
    expect(headerSrc).toMatch(/px-3 md:px-4/)
    expect(headerSrc).not.toMatch(/className="flex items-center gap-2 px-4 h-12"/)
  })

  it('nav margin uses ml-2 on mobile + ml-3 on desktop', () => {
    expect(headerSrc).toMatch(/ml-2 md:ml-3/)
    expect(headerSrc).not.toMatch(/flex items-center gap-1 ml-3"/)
  })

  it('Stats link padding uses px-2 on mobile + px-2.5 on desktop', () => {
    expect(headerSrc).toMatch(/px-2 md:px-2\.5 py-1/)
  })

  it('right-aligned cluster uses gap-1.5 on mobile + gap-2 on desktop', () => {
    expect(headerSrc).toMatch(/flex-1 flex justify-end items-center gap-1\.5 md:gap-2/)
  })

  it('does not render a drop shadow (v1.41.3 — shadow removed; border-b is the seam)', () => {
    // v1.41.3 — pre-fix the header carried `shadow-[0_4px_20px_rgba(0,0,0,0.15)]`
    // creating a soft drop shadow under the fixed bar. User asked for it
    // removed; the existing `border-b border-border-default` provides the
    // visual separation between header and body content.
    expect(headerSrc).not.toMatch(/shadow-\[/)
    expect(headerSrc).toMatch(/border-b border-border-default/)
  })

  it('keeps the brand title at text-xl on both breakpoints (load-bearing brand mark)', () => {
    // Both spans inside the title <Link> stay at text-xl across breakpoints.
    // If a future PR adds `text-lg md:text-xl` (or similar) it would
    // visually weaken the brand without buying meaningful horizontal
    // savings beyond what trim gives us.
    const lines = headerSrc.split('\n').filter((l) => l.includes('text-xl'))
    expect(lines.length).toBeGreaterThanOrEqual(2)
    for (const line of lines) {
      expect(line).not.toMatch(/text-(xs|sm|base|lg) md:text-xl/)
    }
  })
})

describe('Sign-in pill mobile sizing (v1.41.2 regression target)', () => {
  const lineLoginSrc = readFileSync(LINE_LOGIN_PATH, 'utf8')

  it('header Sign-in pill uses px-3 on mobile + px-4 on desktop', () => {
    // Locate the header sign-in button by its data-testid for stability.
    // Search for the className that contains the testid context.
    const signinIdx = lineLoginSrc.indexOf('data-testid="header-signin"')
    expect(signinIdx).toBeGreaterThan(-1)
    // Read 600 chars before the testid to find the className on the same button.
    const window = lineLoginSrc.slice(Math.max(0, signinIdx - 600), signinIdx)
    expect(window).toMatch(/px-3 md:px-4/)
    expect(window).not.toMatch(/text-\[11px\] font-black uppercase tracking-wider px-4 py-1\.5/)
  })
})
