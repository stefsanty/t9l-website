/**
 * v1.97.2 — two user-reported defects on /test:
 *   1. "When I click on t9l 2026 Spring button nothing happens."
 *   2. "Loading takes too long between leagues."
 *
 * Defect 1 — URL/session mismatch in `currentLeagueId` derivation.
 *   The Header `<LeagueSwitcher>` derived `currentLeagueId` from
 *   `memberships.find(m => m.isCurrent)`, which is SSR-baked from
 *   `session.leagueId`. That value is fixed at JWT-refresh time and
 *   does NOT track in-hub navigation (`/test?league=<id>`). When a user
 *   viewing `/test?league=<other>` clicked their default-league pill
 *   (e.g. "t9l 2026 Spring"), the same-league-tap short-circuit fired
 *   and the click silently no-op'd.
 *
 *   Fix: on `/test`, derive `currentLeagueId` from
 *   `useSearchParams().get('league')` (verified against memberships;
 *   unknown ids fall through to the session-baked default). Off-hub
 *   routes (`/id/<slug>`) keep the SSR-baked behaviour.
 *
 * Defect 2 — cold prefetch window. `<Link prefetch>` only warms when
 *   the link is mounted; the bar's Links don't mount until the chevron
 *   opens, so a fast pill-tap misses the prefetch.
 *
 *   Fix: `router.prefetch()` each membership's destination in a
 *   `useEffect` gated on `onHub && memberships.length >= 2`. The
 *   prefetch is bounded by the user's roster (typically 2-4 leagues)
 *   so the cost is small.
 *
 * Tests pin:
 *   1. APP_VERSION bumped to 1.97.2.
 *   2. `useSearchParams` is imported + read in LeagueSwitcher.
 *   3. The new `currentLeagueId` derivation checks the searchParam on
 *      `/test` (verified against memberships) and falls back to
 *      `isCurrent` otherwise.
 *   4. A `router.prefetch(...)` call is wired into a `useEffect`,
 *      gated on `onHub` and `memberships.length >= 2`, iterating all
 *      memberships.
 *   5. The same-league-tap short-circuit is preserved (we still want
 *      to no-op when the URL-derived current matches the tapped pill;
 *      the user's "broken" experience came from `currentLeagueId`
 *      being WRONG, not from the short-circuit itself).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')
const VERSION_SRC = readFileSync(join(REPO_ROOT, 'src/lib/version.ts'), 'utf8')
const SWITCHER_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/LeagueSwitcher.tsx'),
  'utf8',
)

describe('v1.97.2 — version bump', () => {
  it('APP_VERSION is 1.97.2 or higher', () => {
    expect(VERSION_SRC).toMatch(
      /APP_VERSION\s*=\s*['"](?:1\..(9[7-9]|[1-9]\d{2,})\.([2-9]|\d{2,})|[2-9]\.\d+\.\d+)['"]|APP_VERSION\s*=\s*['"](?:1\..(9[89]|[1-9]\d{2,})\.\d+|[2-9]\.\d+\.\d+)['"]/,
    )
  })
})

describe('v1.97.2 — defect 1: URL-aware currentLeagueId on /test', () => {
  it('imports useSearchParams from next/navigation', () => {
    expect(SWITCHER_SRC).toMatch(
      /import\s*\{[^}]*useSearchParams[^}]*\}\s*from\s*['"]next\/navigation['"]/,
    )
  })

  it('calls useSearchParams() in the component body', () => {
    expect(SWITCHER_SRC).toMatch(/useSearchParams\(\)/)
  })

  it('reads ?league= from searchParams (only on /test, via onHub gate)', () => {
    // Comment-aware regex: search for the chained `onHub && searchParams ?
    // searchParams.get('league')` construct on a single line. Stripping
    // comments first so the doc-paragraph mention of `?league=` doesn't
    // false-positive on the source-only check.
    const stripped = SWITCHER_SRC
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    expect(stripped).toMatch(
      /onHub\s*&&\s*searchParams\s*\?\s*searchParams\.get\(\s*['"]league['"]\s*\)\s*:\s*null/,
    )
  })

  it('verifies the URL league against memberships before honouring it', () => {
    // An unverified `?league=<x>` cannot pin the switcher to a league
    // the user is not in — must be ∈ memberships.
    expect(SWITCHER_SRC).toMatch(
      /memberships\.some\(\(m\)\s*=>\s*m\.leagueId\s*===\s*urlLeagueId\)/,
    )
  })

  it('falls back to session-baked isCurrent when no URL league is set', () => {
    // The `?? sessionCurrentLeagueId` pattern preserves off-hub behaviour
    // for `/id/<slug>` and similar non-hub pages.
    expect(SWITCHER_SRC).toMatch(
      /currentLeagueId\s*=\s*verifiedUrlLeagueId\s*\?\?\s*sessionCurrentLeagueId/,
    )
  })

  it('still defines the session-derived fallback via Membership.isCurrent', () => {
    expect(SWITCHER_SRC).toMatch(
      /sessionCurrentLeagueId\s*=\s*[\s\S]+?memberships\.find\(\(m\)\s*=>\s*m\.isCurrent\)/,
    )
  })

  it('preserves the same-league-tap short-circuit', () => {
    // The fix is in `currentLeagueId` value derivation; the short-
    // circuit itself stays so that clicking the actually-current league
    // (matching the URL) still no-ops.
    expect(SWITCHER_SRC).toMatch(
      /m\.leagueId\s*===\s*currentLeagueId[\s\S]+?e\.preventDefault\(\)[\s\S]+?setOpen\(false\)/,
    )
  })
})

describe('v1.97.2 — defect 2: eager prefetch of hub destinations', () => {
  it('calls router.prefetch() inside a useEffect', () => {
    const stripped = SWITCHER_SRC
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    expect(stripped).toMatch(
      /useEffect\(\(\)\s*=>\s*\{[\s\S]+?router\.prefetch\(/,
    )
  })

  it('prefetch effect gated on onHub + memberships.length >= 2', () => {
    const stripped = SWITCHER_SRC
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    // The effect must skip non-hub routes (no point prefetching
    // ?league= URLs when the user is on /id/<slug>).
    expect(stripped).toMatch(
      /useEffect\(\(\)\s*=>\s*\{[\s\S]+?if\s*\(!onHub\)\s*return[\s\S]+?if\s*\(memberships\.length\s*<\s*2\)\s*return[\s\S]+?router\.prefetch\(/,
    )
  })

  it('iterates all memberships, building the ?league=<id> URL', () => {
    expect(SWITCHER_SRC).toMatch(
      /for\s*\(const m of memberships\)\s*\{[\s\S]+?router\.prefetch\(\s*`\/test\?league=\$\{encodeURIComponent\(m\.leagueId\)\}`/,
    )
  })

  it('includes onHub, memberships, router in the effect deps', () => {
    expect(SWITCHER_SRC).toMatch(
      /\}\s*,\s*\[onHub,\s*memberships,\s*router\]\s*\)/,
    )
  })
})

describe('v1.97.2 — defensive: cleanup pre-v1.97.2 duplication', () => {
  it('declares `onHub` exactly once', () => {
    // Pre-fix had `onHub` declared inside the function body BELOW the
    // early-return; the fix moves it to the top so the useEffect can
    // see it. There should be ONE `const onHub =` line now.
    const matches = SWITCHER_SRC.match(/const onHub\s*=/g) ?? []
    expect(matches.length).toBe(1)
  })
})
