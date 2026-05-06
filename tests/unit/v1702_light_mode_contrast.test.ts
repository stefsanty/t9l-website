/**
 * v1.70.2 — Light-mode contrast pass: pin that the league-due banner +
 * the apex success/pending surfaces route through the semantic
 * `success`/`warning` CSS tokens (which adapt to light vs dark) instead
 * of raw Tailwind `amber-*` / `emerald-*` / `electric-green` literals
 * (which do not). The light-mode token values are darkened so
 * `text-warning` / `text-success` clear WCAG AA contrast (~4.5:1)
 * against `bg-warning/15` / `bg-success/15` over the light background.
 *
 * Each negative regex is a regression target — re-introducing any
 * of the raw color literals on these specific surfaces would re-create
 * the "too bright, contrast poor" rendering the user reported.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const REPO_ROOT = resolve(__dirname, '..', '..')

function read(path: string): string {
  return readFileSync(resolve(REPO_ROOT, path), 'utf8')
}

describe('v1.70.2 — UnpaidFeeBanner uses semantic warning token', () => {
  const src = read('src/components/UnpaidFeeBanner.tsx')

  it('renders with semantic warning border + bg', () => {
    expect(src).toMatch(/border-warning\/40/)
    expect(src).toMatch(/bg-warning\/10/)
  })

  it('icon circle and eyebrow use text-warning', () => {
    expect(src).toMatch(/text-warning/)
    expect(src).toMatch(/bg-warning\/15/)
  })

  it('regression target — no raw amber-* or red-500 literals', () => {
    expect(src).not.toMatch(/amber-(?:300|400|500|600)/)
    expect(src).not.toMatch(/red-(?:300|400|500|600)/)
    expect(src).not.toMatch(/from-amber/)
    expect(src).not.toMatch(/to-red/)
  })
})

describe('v1.70.2 — RecruitingBanner State A (success) uses semantic success token', () => {
  const src = read('src/components/RecruitingBanner.tsx')

  it('approved-this branch uses border-success + bg-success', () => {
    expect(src).toMatch(/data-testid="recruiting-banner-approved"[\s\S]*?border-success\/40/)
    expect(src).toMatch(/data-testid="recruiting-banner-approved"[\s\S]*?bg-success\/10/)
  })

  it('approved-this eyebrow + initial-fallback use text-success', () => {
    expect(src).toMatch(/text-success/)
  })

  it('regression target — approved-this no longer uses electric-green', () => {
    // Strip block-level/explanatory comments so docstring mentions of
    // the legacy color name don't trip the negative regex below. Then
    // slice the file from the State A testid to the next testid (or
    // end of file) so we only test the approved-this block.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
    const startIdx = code.indexOf('recruiting-banner-approved')
    const nextIdx = code.indexOf('recruiting-banner-pending', startIdx)
    expect(startIdx).toBeGreaterThan(-1)
    const approvedBlock = code.slice(startIdx, nextIdx > -1 ? nextIdx : undefined)
    expect(approvedBlock).not.toMatch(/electric-green/)
  })
})

describe('v1.70.2 — RecruitingBanner State B (pending) uses semantic warning token', () => {
  const src = read('src/components/RecruitingBanner.tsx')

  it('pending-this branch uses border-warning + bg-warning', () => {
    expect(src).toMatch(/data-testid="recruiting-banner-pending"[\s\S]*?border-warning\/40/)
    expect(src).toMatch(/data-testid="recruiting-banner-pending"[\s\S]*?bg-warning\/10/)
  })

  it('regression target — pending-this no longer uses raw amber-*', () => {
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
    const startIdx = code.indexOf('recruiting-banner-pending')
    // Pending block runs until the State C/D/E CTA testids start.
    const nextIdx = code.indexOf('recruiting-banner-cta-', startIdx)
    expect(startIdx).toBeGreaterThan(-1)
    const pendingBlock = code.slice(startIdx, nextIdx > -1 ? nextIdx : undefined)
    expect(pendingBlock).not.toMatch(/amber-(?:300|400|500|600)/)
  })
})

describe('v1.70.2 — MatchdayCountdown LIVE indicator uses semantic success token', () => {
  const src = read('src/components/MatchdayCountdown.tsx')

  it('Live indicator uses text-success and bg-success', () => {
    expect(src).toMatch(/text-success/)
    expect(src).toMatch(/bg-success\b/)
  })

  it('regression target — no raw emerald-400 literal anywhere', () => {
    expect(src).not.toMatch(/emerald-400/)
  })
})

describe('v1.70.2 — Light-mode CSS tokens darkened for AA contrast', () => {
  const css = read('src/app/globals.css')

  it('html.light --success is the darkened #006633 (was #00A855 pre-v1.70.2)', () => {
    expect(css).toMatch(/html\.light\s*{[\s\S]*?--success:\s*#006633/)
    expect(css).toMatch(/html\.light\s*{[\s\S]*?--tertiary:\s*#006633/)
  })

  it('html.light --warning is the darkened #92400E (was #B45309 pre-v1.70.2)', () => {
    expect(css).toMatch(/html\.light\s*{[\s\S]*?--warning:\s*#92400E/)
  })

  it('prefers-color-scheme: light fallback also carries the darkened tokens', () => {
    const fallback = css.match(/@media \(prefers-color-scheme: light\)[\s\S]*?\n\}/)
    expect(fallback).not.toBeNull()
    expect(fallback?.[0] ?? '').toMatch(/--success:\s*#006633/)
    expect(fallback?.[0] ?? '').toMatch(/--warning:\s*#92400E/)
  })

  it('regression target — light-mode --success is no longer the brighter #00A855', () => {
    expect(css).not.toMatch(/--success:\s*#00A855/)
  })

  it('regression target — light-mode --warning is no longer the lighter #B45309', () => {
    expect(css).not.toMatch(/--warning:\s*#B45309/)
  })

  it('dark mode tokens unchanged (suite parity check)', () => {
    expect(css).toMatch(/:root\s*{[\s\S]*?--success:\s*#00FF85/)
    expect(css).toMatch(/:root\s*{[\s\S]*?--warning:\s*#FACC15/)
  })
})
