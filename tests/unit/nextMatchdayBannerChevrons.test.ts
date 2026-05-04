import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * v1.49.3 — Regression target for "users can miss that they can scroll
 * matchdays with the current design."
 *
 * Pre-v1.49.3 the left/right chevrons on NextMatchdayBanner were:
 *   - 28px buttons (w-7 h-7) with 14px icons (w-3.5 h-3.5)
 *   - bg-surface/80 plate (5% opacity surface × 80% alpha ≈ 4% white plate
 *     on dark, near-invisible)
 *   - border-border-subtle (8–10% opacity border)
 *   - text-fg-mid (65% contrast)
 *   - opacity-60 default fade
 * Net: chevrons read as floating low-contrast glyphs that users could miss.
 *
 * v1.49.3 strengthens to:
 *   - 36px buttons (w-9 h-9) with 20px icons (w-5 h-5) and strokeWidth 3
 *   - bg-header-bg backdrop-blur-md (95% theme-aware plate matching the
 *     established pattern in Header.tsx)
 *   - border-border-default + shadow-md for visible lift
 *   - text-fg-high (95% contrast)
 *   - opacity-100 default — the affordance is visible at rest
 *   - hover:text-vibrant-pink + hover:border-vibrant-pink + hover:scale-110
 *     for clear interactive feedback
 *
 * Position offsets (-translate-x-3 / translate-x-3) preserved so
 * surrounding layout is byte-equivalent to v1.49.2.
 *
 * Same shape as headerMobileSizing.test.ts — read the source as text and
 * assert the className pattern is present. Tailwind classes are inert
 * strings until compile time, so structural assertion catches a regression
 * that find-replaces away the prominence.
 */

const BANNER_PATH = resolve(__dirname, '../../src/components/NextMatchdayBanner.tsx')
const bannerSrc = readFileSync(BANNER_PATH, 'utf8')

// Strip line comments + block comments so docstring text describing the
// pre-fix state doesn't trigger negative assertions below.
function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

const code = stripComments(bannerSrc)

describe('NextMatchdayBanner chevron visibility (v1.49.3)', () => {
  it('chevron buttons are 36px (w-9 h-9), not 28px (w-7 h-7)', () => {
    // Both chevrons must match — the v1.49.2 shape used w-7 h-7.
    const matches = code.match(/w-9 h-9/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(2)
    expect(code).not.toMatch(/w-7 h-7 rounded-full bg-surface/)
  })

  it('chevron icon is 20px (w-5 h-5) with strokeWidth 3', () => {
    // Both icons match. Pre-fix was w-3.5 h-3.5 / strokeWidth 2.5.
    const sizes = code.match(/className="w-5 h-5" fill="none"/g) ?? []
    expect(sizes.length).toBeGreaterThanOrEqual(2)
    expect(code).not.toMatch(/className="w-3\.5 h-3\.5" fill="none"/)
    const strokes = code.match(/strokeWidth=\{3\}/g) ?? []
    expect(strokes.length).toBeGreaterThanOrEqual(2)
    expect(code).not.toMatch(/strokeWidth=\{2\.5\}/)
  })

  it('chevron plate uses bg-header-bg + backdrop-blur-md (theme-aware solid plate, not bg-surface/80)', () => {
    // bg-header-bg is rgba(…, 0.95) — same plate the Header uses.
    // bg-surface/80 was 5% × 80% ≈ 4% — invisible on most backgrounds.
    const plates = code.match(/bg-header-bg backdrop-blur-md/g) ?? []
    expect(plates.length).toBeGreaterThanOrEqual(2)
    expect(code).not.toMatch(/bg-surface\/80/)
  })

  it('chevron border is border-border-default (12–14% opacity, not border-border-subtle 8–10%)', () => {
    // Search inside the chevron buttons specifically — both should reference
    // border-border-default. Bare grep is acceptable here because the only
    // border classes in this file are on the chevrons (the matchday card
    // owns its own borders internally).
    const defaultBorders = code.match(/border border-border-default/g) ?? []
    expect(defaultBorders.length).toBeGreaterThanOrEqual(2)
    // Pre-fix substring no longer present:
    expect(code).not.toMatch(/border border-border-subtle text-fg-mid/)
  })

  it('chevron text is text-fg-high (95% contrast), not text-fg-mid (65%)', () => {
    const highContrast = code.match(/text-fg-high transition-all/g) ?? []
    expect(highContrast.length).toBeGreaterThanOrEqual(2)
    // Pre-fix shape gone:
    expect(code).not.toMatch(/text-fg-mid transition-all hover:text-fg-high hover:border-border-default/)
  })

  it('chevron has shadow-md for visible lift from page background', () => {
    const shadows = code.match(/shadow-md/g) ?? []
    expect(shadows.length).toBeGreaterThanOrEqual(2)
  })

  it('chevron is fully opaque at rest (opacity-100) when navigation is available, not opacity-60', () => {
    // Active state: opacity-100. Disabled state: opacity-0 pointer-events-none (preserved).
    expect(code).toMatch(/hasPrev \? 'opacity-100' : 'opacity-0 pointer-events-none'/)
    expect(code).toMatch(/hasNext \? 'opacity-100' : 'opacity-0 pointer-events-none'/)
    // Pre-fix shape gone — chevrons no longer fade to 60% at rest:
    expect(code).not.toMatch(/opacity-60 hover:opacity-100/)
  })

  it('chevron hover state surfaces vibrant-pink + scale for clear interactive feedback', () => {
    const hoverPinks = code.match(/hover:text-vibrant-pink hover:border-vibrant-pink hover:scale-110/g) ?? []
    expect(hoverPinks.length).toBeGreaterThanOrEqual(2)
  })

  it('disabled state preserved (opacity-0 pointer-events-none when no prev/next)', () => {
    // Load-bearing — without this the buttons remain clickable past the
    // edge of the matchday list, scrolling into a non-existent index.
    const disabled = code.match(/opacity-0 pointer-events-none/g) ?? []
    expect(disabled.length).toBeGreaterThanOrEqual(2)
  })

  it('chevron horizontal position offsets preserved (-translate-x-3 / translate-x-3)', () => {
    // Layout invariant — the chevrons sit slightly outside the card edges.
    // A regression that drops these would shift them onto the card body
    // and overlap with content.
    expect(code).toMatch(/-translate-x-3/)
    expect(code).toMatch(/translate-x-3/)
  })

  it('chevron buttons retain their aria-labels for screen readers', () => {
    expect(code).toMatch(/aria-label="Previous matchday"/)
    expect(code).toMatch(/aria-label="Next matchday"/)
  })
})
