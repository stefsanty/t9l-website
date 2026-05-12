/**
 * v1.97.3 — combined league-name + chevron picker trigger.
 *
 * Two user-reported issues, one root cause:
 *
 *   1. "Clicking on t9l 2026 spring button still does nothing."
 *      The "button" is the Header league-name text, which pre-v1.97.3
 *      was a `<Link href="/">` wrapper. For a multi-league user on
 *      `/test` whose default league matches the page (the dominant
 *      case), navigating to `/` re-renders the SAME content — the
 *      user perceives "nothing happened". v1.97.2 only fixed the pill
 *      behaviour, not the league-name link.
 *
 *   2. "Remove the hyperlink from the league name text, and instead
 *      make it just open the League picker."
 *
 * Fix: when `memberships.length >= 2`, Header renders
 * `<LeagueSwitcher leagueTitle={titleText} />` — the switcher absorbs
 * the title text into the trigger button, so clicking either the text
 * OR the chevron toggles the picker bar. Single-league users keep the
 * legacy `<Link href="/">` (no picker exists for them; home link
 * stays useful as a "back to apex" affordance).
 *
 * Tests pin:
 *   1. APP_VERSION bumped to 1.97.3.
 *   2. LeagueSwitcher accepts an optional `leagueTitle` prop and
 *      mounts the title span inside the trigger button when present.
 *   3. The combined trigger keeps all v1.97.1 contract (aria-*,
 *      data-testid, ChevronDown, memberships.length < 2 returns null).
 *   4. Header reads `useMemberships()` and branches on
 *      `memberships.length >= 2`.
 *   5. Multi-league branch renders `<LeagueSwitcher leagueTitle=…>`;
 *      single-league branch keeps `<Link href="/">` with the legacy
 *      brand styling + `data-testid="header-home-link"`.
 *   6. The standalone `<Link href="/">{leagueTitle}</Link>` form is
 *      GONE from the unconditional render path (regression target).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')
const VERSION_SRC = readFileSync(join(REPO_ROOT, 'src/lib/version.ts'), 'utf8')
const HEADER_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/Header.tsx'),
  'utf8',
)
const SWITCHER_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/LeagueSwitcher.tsx'),
  'utf8',
)

function stripComments(src: string): string {
  return src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('v1.97.3 — version bump', () => {
  it('APP_VERSION is 1.97.3 or higher', () => {
    expect(VERSION_SRC).toMatch(
      /APP_VERSION\s*=\s*['"]1\.(97\.([3-9]|\d{2,})|9[89]\.\d+|\d{3,}\.\d+)['"]/,
    )
  })
})

describe('v1.97.3 — LeagueSwitcher accepts leagueTitle prop', () => {
  it('declares a LeagueSwitcherProps interface with optional leagueTitle', () => {
    expect(SWITCHER_SRC).toMatch(/interface LeagueSwitcherProps/)
    expect(SWITCHER_SRC).toMatch(/leagueTitle\?:\s*string\s*\|\s*null/)
  })

  it('destructures leagueTitle from props with a default empty object', () => {
    const stripped = stripComments(SWITCHER_SRC)
    expect(stripped).toMatch(
      /export default function LeagueSwitcher\(\s*\{\s*leagueTitle\s*\}\s*:\s*LeagueSwitcherProps\s*=\s*\{\}\s*\)/,
    )
  })

  it('renders the title span inside the trigger button when leagueTitle is set', () => {
    const stripped = stripComments(SWITCHER_SRC)
    // The trigger button must contain a conditional title span gated on
    // `leagueTitle`. The span carries the legacy `header-league-title`
    // testid so existing v1.73.0 tests stay green.
    expect(stripped).toMatch(
      /\{leagueTitle\s*\?\s*\(\s*<span[\s\S]+?data-testid="header-league-title"[\s\S]+?\{leagueTitle\}/,
    )
  })

  it('trigger button className adapts when leagueTitle is provided', () => {
    // When the trigger doubles as the brand-title surface it picks up
    // the legacy Header brand-link styling (font-display + uppercase).
    const stripped = stripComments(SWITCHER_SRC)
    expect(stripped).toMatch(
      /leagueTitle[\s\S]+?font-display[\s\S]+?uppercase[\s\S]+?tracking-tight/,
    )
  })
})

describe('v1.97.3 — Header branches on memberships count', () => {
  it('Header imports useMemberships from MembershipsProvider', () => {
    expect(HEADER_SRC).toMatch(
      /import\s*\{\s*useMemberships\s*\}\s*from\s*['"]\.\/MembershipsProvider['"]/,
    )
  })

  it('Header reads memberships via useMemberships()', () => {
    expect(HEADER_SRC).toMatch(/const memberships\s*=\s*useMemberships\(\)/)
  })

  it('Header derives `hasPicker = memberships.length >= 2`', () => {
    expect(HEADER_SRC).toMatch(
      /const hasPicker\s*=\s*memberships\.length\s*>=\s*2/,
    )
  })

  it('multi-league branch renders <LeagueSwitcher leagueTitle=...>', () => {
    const stripped = stripComments(HEADER_SRC)
    expect(stripped).toMatch(
      /hasPicker\s*\?\s*\([\s\S]*?<LeagueSwitcher\s+leagueTitle=\{titleText\}\s*\/>/,
    )
  })

  it('single-league fallback keeps <Link href="/"> with header-home-link testid', () => {
    const stripped = stripComments(HEADER_SRC)
    expect(stripped).toMatch(
      /:\s*\([\s\S]*?<Link\s+href="\/"[\s\S]+?data-testid="header-home-link"/,
    )
  })

  it('titleText derived from leagueTitle ?? legacy default', () => {
    expect(HEADER_SRC).toMatch(
      /const titleText\s*=\s*leagueTitle\s*\?\?\s*["']T9L\s*['‘’]26\s*春["']/,
    )
  })
})

describe('v1.97.3 — regression targets', () => {
  it('Header does NOT render an unconditional <Link href="/">…leagueTitle…</Link>', () => {
    // Pre-v1.97.3 form: a single top-level Link always wrapped the
    // title. After the fix it must be inside the single-league
    // fallback branch, NOT in the main render path. The check looks
    // for the legacy unconditional shape: a `<Link href="/">` that is
    // NOT preceded by a `: (` (the JSX ternary fallback marker).
    const stripped = stripComments(HEADER_SRC)
    // Find every `<Link href="/"` occurrence and ensure each one sits
    // within ~120 chars of either a `: (` (ternary fallback) or the
    // `header-home-link` testid (single-league branch identifier).
    const linkMatches = [...stripped.matchAll(/<Link\s+href="\/"/g)]
    expect(linkMatches.length).toBeGreaterThan(0)
    for (const match of linkMatches) {
      const idx = match.index ?? 0
      const window = stripped.substring(Math.max(0, idx - 200), idx + 200)
      const isFallback =
        /\?\s*\(/.test(window) || /header-home-link/.test(window)
      expect(isFallback).toBe(true)
    }
  })

  it('LeagueSwitcher keeps the v1.97.1 trigger contract (testid + aria + ChevronDown)', () => {
    // The refactor must not break v1.97.1's contract — the picker is
    // still triggered by an `<button data-testid="league-switcher-trigger">`
    // with the documented aria-* attributes and a ChevronDown icon.
    expect(SWITCHER_SRC).toMatch(/data-testid="league-switcher-trigger"/)
    expect(SWITCHER_SRC).toMatch(/aria-expanded=\{open\}/)
    expect(SWITCHER_SRC).toMatch(/aria-haspopup="menu"/)
    expect(SWITCHER_SRC).toMatch(/aria-controls="league-switcher-bar"/)
    expect(SWITCHER_SRC).toMatch(/<ChevronDown/)
  })

  it('LeagueSwitcher still returns null for memberships.length < 2', () => {
    expect(SWITCHER_SRC).toMatch(
      /memberships\.length\s*<\s*2[\s\S]+?return\s+null/,
    )
  })

  it('v1.97.2 URL-aware currentLeagueId derivation preserved', () => {
    // The `?league=` searchParam fix must survive the trigger refactor.
    expect(SWITCHER_SRC).toMatch(/useSearchParams\(\)/)
    expect(SWITCHER_SRC).toMatch(
      /currentLeagueId\s*=\s*verifiedUrlLeagueId\s*\?\?\s*sessionCurrentLeagueId/,
    )
  })

  it('v1.97.2 eager prefetch effect preserved', () => {
    const stripped = stripComments(SWITCHER_SRC)
    expect(stripped).toMatch(
      /useEffect\(\(\)\s*=>\s*\{[\s\S]+?router\.prefetch\(/,
    )
  })
})
