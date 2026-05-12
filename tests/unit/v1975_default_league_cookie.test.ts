/**
 * v1.97.5 — cookie-backed default league.
 *
 * User feedback: "can we look at cookie and save settings on which
 * league to show by default". The DB `User.defaultLeagueId` is the
 * persistent server-side store; the cookie is the per-device fast-
 * path so a returning visitor's first `/test` render doesn't have to
 * wait on a Prisma round-trip to learn which league they want.
 *
 * Tests pin:
 *   1. APP_VERSION bumped to 1.97.5.
 *   2. `src/lib/defaultLeagueCookie.ts` exports the cookie name + a
 *      pure value-normaliser + a cookie-options builder.
 *   3. Normaliser rejects empty, non-string, oversized, and shape-
 *      abusive inputs; accepts valid cuid- and slug-shaped ids.
 *   4. Cookie options carry HttpOnly + SameSite=Lax + path=/ + a long
 *      maxAge; the `secure` flag mirrors NEXTAUTH_URL https detection.
 *   5. Server action file at `src/app/api/default-league/actions.ts`
 *      exists, is `'use server'`, exports `setDefaultLeagueCookie` and
 *      `clearDefaultLeagueCookie` as async functions ONLY (no
 *      non-async value exports per CLAUDE.md).
 *   6. `classifyPersona` accepts `cookieLeagueId`. Priority chain:
 *      URL `preferredLeagueId` > cookie > DB `defaultLeagueId` >
 *      alphabetical-first. Each branch validates against memberships.
 *   7. `<HomepageRouter>` reads the cookie via `cookies()` from
 *      `next/headers` and threads it into `resolveHomepagePersona`.
 *   8. `<LeagueSwitcher>` fires `setDefaultLeagueCookie(m.leagueId)`
 *      on pill click (fire-and-forget, before navigation).
 *   9. LineLoginButton + AdminNav signOut buttons call
 *      `clearDefaultLeagueCookie` before NextAuth's signOut.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_LEAGUE_COOKIE_NAME,
  DEFAULT_LEAGUE_COOKIE_MAX_AGE,
  defaultLeagueCookieOptions,
  normaliseDefaultLeagueCookieValue,
} from '@/lib/defaultLeagueCookie'

const REPO_ROOT = join(__dirname, '..', '..')
const VERSION_SRC = readFileSync(join(REPO_ROOT, 'src/lib/version.ts'), 'utf8')
const COOKIE_LIB_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/defaultLeagueCookie.ts'),
  'utf8',
)
const ACTION_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/api/default-league/actions.ts'),
  'utf8',
)
const ROUTING_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/homepageRouting.ts'),
  'utf8',
)
const ROUTER_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/homepage/HomepageRouter.tsx'),
  'utf8',
)
const SWITCHER_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/LeagueSwitcher.tsx'),
  'utf8',
)
const LINE_BUTTON_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/LineLoginButton.tsx'),
  'utf8',
)
const ADMIN_NAV_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/admin/AdminNav.tsx'),
  'utf8',
)

function stripComments(src: string): string {
  return src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('v1.97.5 — version bump', () => {
  it('APP_VERSION is 1.97.5 or higher', () => {
    expect(VERSION_SRC).toMatch(
      /APP_VERSION\s*=\s*['"]1\.(97\.([5-9]|\d{2,})|9[89]\.\d+|\d{3,}\.\d+)['"]/,
    )
  })
})

describe('v1.97.5 — defaultLeagueCookie lib', () => {
  it('exports the cookie name as a stable constant', () => {
    expect(DEFAULT_LEAGUE_COOKIE_NAME).toBe('t9l_default_league')
  })

  it('exports a long-lived maxAge (≥ 6 months)', () => {
    const sixMonths = 60 * 60 * 24 * 30 * 6
    expect(DEFAULT_LEAGUE_COOKIE_MAX_AGE).toBeGreaterThanOrEqual(sixMonths)
  })

  describe('defaultLeagueCookieOptions', () => {
    const originalUrl = process.env.NEXTAUTH_URL

    afterEach(() => {
      if (originalUrl === undefined) delete process.env.NEXTAUTH_URL
      else process.env.NEXTAUTH_URL = originalUrl
    })

    it('returns httpOnly + sameSite lax + path / + maxAge', () => {
      const opts = defaultLeagueCookieOptions()
      expect(opts.httpOnly).toBe(true)
      expect(opts.sameSite).toBe('lax')
      expect(opts.path).toBe('/')
      expect(opts.maxAge).toBe(DEFAULT_LEAGUE_COOKIE_MAX_AGE)
    })

    it('sets secure=true when NEXTAUTH_URL is https', () => {
      process.env.NEXTAUTH_URL = 'https://t9l.me'
      expect(defaultLeagueCookieOptions().secure).toBe(true)
    })

    it('sets secure=false on localhost http', () => {
      process.env.NEXTAUTH_URL = 'http://localhost:3000'
      expect(defaultLeagueCookieOptions().secure).toBe(false)
    })
  })

  describe('normaliseDefaultLeagueCookieValue', () => {
    it('accepts a Prisma cuid-shaped id', () => {
      expect(
        normaliseDefaultLeagueCookieValue('cmovaw1jr00000kg8s9r9bnq6'),
      ).toBe('cmovaw1jr00000kg8s9r9bnq6')
    })

    it('accepts admin-era slug-shaped ids (e.g. "l-minato-2025")', () => {
      expect(normaliseDefaultLeagueCookieValue('l-minato-2025')).toBe(
        'l-minato-2025',
      )
    })

    it('trims surrounding whitespace', () => {
      expect(normaliseDefaultLeagueCookieValue('  l-foo  ')).toBe('l-foo')
    })

    it('rejects empty / whitespace-only strings', () => {
      expect(normaliseDefaultLeagueCookieValue('')).toBe(null)
      expect(normaliseDefaultLeagueCookieValue('   ')).toBe(null)
    })

    it('rejects non-string values', () => {
      expect(normaliseDefaultLeagueCookieValue(undefined)).toBe(null)
      expect(normaliseDefaultLeagueCookieValue(null)).toBe(null)
      expect(normaliseDefaultLeagueCookieValue(42)).toBe(null)
      expect(normaliseDefaultLeagueCookieValue({})).toBe(null)
    })

    it('rejects shape-abusive characters (spaces, quotes, semicolons)', () => {
      expect(normaliseDefaultLeagueCookieValue('l foo')).toBe(null)
      expect(normaliseDefaultLeagueCookieValue('l;')).toBe(null)
      expect(normaliseDefaultLeagueCookieValue('"l-injected"')).toBe(null)
      expect(normaliseDefaultLeagueCookieValue('l\nfoo')).toBe(null)
    })

    it('rejects oversized values (>128 chars)', () => {
      const long = 'a'.repeat(129)
      expect(normaliseDefaultLeagueCookieValue(long)).toBe(null)
    })

    it('accepts at the 128-char boundary', () => {
      const boundary = 'a'.repeat(128)
      expect(normaliseDefaultLeagueCookieValue(boundary)).toBe(boundary)
    })
  })

  it('cookie name is prefixed `t9l_` to avoid NextAuth namespace collision', () => {
    expect(DEFAULT_LEAGUE_COOKIE_NAME.startsWith('t9l_')).toBe(true)
  })
})

describe('v1.97.5 — server actions module', () => {
  it("the actions file begins with 'use server'", () => {
    expect(ACTION_SRC).toMatch(/^['"]use server['"]/m)
  })

  it('exports `setDefaultLeagueCookie` as an async function', () => {
    expect(ACTION_SRC).toMatch(
      /export async function setDefaultLeagueCookie\s*\(/,
    )
  })

  it('exports `clearDefaultLeagueCookie` as an async function', () => {
    expect(ACTION_SRC).toMatch(
      /export async function clearDefaultLeagueCookie\s*\(/,
    )
  })

  it("does NOT export non-async values (CLAUDE.md 'use server' rule)", () => {
    // Strip comments + only inspect top-level export statements (skip
    // type-only exports). The rule forbids `export const X = ...` from
    // a 'use server' module because Next.js converts every export into
    // a server-action proxy.
    const stripped = stripComments(ACTION_SRC)
    const valueExports = stripped.match(/^export\s+(const|let|var|function)\s/gm)
    if (valueExports) {
      for (const m of valueExports) {
        expect(m).toMatch(/export\s+async\s+function/)
      }
    }
  })

  it('setDefaultLeagueCookie validates input via normaliseDefaultLeagueCookieValue', () => {
    expect(ACTION_SRC).toMatch(/normaliseDefaultLeagueCookieValue/)
  })

  it('uses cookies() from next/headers', () => {
    expect(ACTION_SRC).toMatch(
      /import\s*\{[^}]*cookies[^}]*\}\s*from\s*['"]next\/headers['"]/,
    )
  })

  it('setDefaultLeagueCookie calls jar.set with the cookie name', () => {
    expect(ACTION_SRC).toMatch(
      /jar\.set\(\s*DEFAULT_LEAGUE_COOKIE_NAME\s*,/,
    )
  })

  it('clearDefaultLeagueCookie calls jar.delete with the cookie name', () => {
    expect(ACTION_SRC).toMatch(
      /jar\.delete\(\s*DEFAULT_LEAGUE_COOKIE_NAME\s*\)/,
    )
  })
})

describe('v1.97.5 — classifyPersona honours cookieLeagueId', () => {
  it('accepts a new `cookieLeagueId` arg on classifyPersona', () => {
    expect(ROUTING_SRC).toMatch(/cookieLeagueId\?:\s*string\s*\|\s*null/)
  })

  it('priority: preferredLeagueId > cookieLeagueId > defaultLeagueId > alphabetical', async () => {
    const { classifyPersona } = await import('@/lib/homepageRouting')
    const a = { leagueId: 'l-a', leagueName: 'Alpha', slug: 'alpha' }
    const b = { leagueId: 'l-b', leagueName: 'Beta', slug: 'beta' }
    const c = { leagueId: 'l-c', leagueName: 'Gamma', slug: 'gamma' }
    const memberships = [a, b, c]

    // 1. preferredLeagueId beats cookie + DB.
    let r = classifyPersona({
      memberships,
      defaultLeagueId: 'l-c',
      preferredLeagueId: 'l-a',
      cookieLeagueId: 'l-b',
    })
    if (r.kind === 'multi') expect(r.activeLeagueId).toBe('l-a')

    // 2. No preferred → cookie beats DB.
    r = classifyPersona({
      memberships,
      defaultLeagueId: 'l-c',
      preferredLeagueId: null,
      cookieLeagueId: 'l-b',
    })
    if (r.kind === 'multi') expect(r.activeLeagueId).toBe('l-b')

    // 3. No preferred + no cookie → DB.
    r = classifyPersona({
      memberships,
      defaultLeagueId: 'l-c',
      preferredLeagueId: null,
      cookieLeagueId: null,
    })
    if (r.kind === 'multi') expect(r.activeLeagueId).toBe('l-c')

    // 4. Nothing set → alphabetical-first (the input is sorted).
    r = classifyPersona({
      memberships,
      defaultLeagueId: null,
      preferredLeagueId: null,
      cookieLeagueId: null,
    })
    if (r.kind === 'multi') expect(r.activeLeagueId).toBe('l-a')
  })

  it('stale cookie (not in memberships) silently falls through to DB', async () => {
    const { classifyPersona } = await import('@/lib/homepageRouting')
    const a = { leagueId: 'l-a', leagueName: 'Alpha', slug: 'alpha' }
    const b = { leagueId: 'l-b', leagueName: 'Beta', slug: 'beta' }
    const r = classifyPersona({
      memberships: [a, b],
      defaultLeagueId: 'l-b',
      preferredLeagueId: null,
      cookieLeagueId: 'l-no-longer-a-member',
    })
    if (r.kind === 'multi') {
      expect(r.activeLeagueId).toBe('l-b') // DB wins because cookie is stale
    }
  })

  it('tampered cookie cannot pin viewer to a non-member league', async () => {
    const { classifyPersona } = await import('@/lib/homepageRouting')
    const a = { leagueId: 'l-a', leagueName: 'Alpha', slug: 'alpha' }
    const b = { leagueId: 'l-b', leagueName: 'Beta', slug: 'beta' }
    const r = classifyPersona({
      memberships: [a, b],
      defaultLeagueId: null,
      preferredLeagueId: null,
      cookieLeagueId: 'l-attacker-league',
    })
    if (r.kind === 'multi') {
      expect(r.activeLeagueId).not.toBe('l-attacker-league')
      expect(['l-a', 'l-b']).toContain(r.activeLeagueId)
    }
  })

  it('cookieLeagueId is null/undefined by default — backward compat with callers that omit it', async () => {
    const { classifyPersona } = await import('@/lib/homepageRouting')
    const a = { leagueId: 'l-a', leagueName: 'Alpha', slug: 'alpha' }
    const b = { leagueId: 'l-b', leagueName: 'Beta', slug: 'beta' }
    // Caller omits cookieLeagueId entirely — must not throw, must
    // behave exactly like v1.93.0 (preferred → default → alpha).
    const r = classifyPersona({
      memberships: [a, b],
      defaultLeagueId: 'l-b',
    })
    if (r.kind === 'multi') expect(r.activeLeagueId).toBe('l-b')
  })
})

describe('v1.97.5 — resolveHomepagePersona threads cookieLeagueId', () => {
  it('ResolveInput interface declares optional cookieLeagueId', () => {
    expect(ROUTING_SRC).toMatch(
      /cookieLeagueId\?:\s*string\s*\|\s*null/,
    )
  })

  it('resolveHomepagePersona forwards cookieLeagueId into classifyPersona', () => {
    const stripped = stripComments(ROUTING_SRC)
    expect(stripped).toMatch(
      /classifyPersona\(\{[\s\S]+?cookieLeagueId:\s*input\.cookieLeagueId/,
    )
  })
})

describe('v1.97.5 — HomepageRouter reads cookie', () => {
  it('imports cookies() from next/headers', () => {
    expect(ROUTER_SRC).toMatch(
      /import\s*\{\s*cookies\s*\}\s*from\s*['"]next\/headers['"]/,
    )
  })

  it('imports DEFAULT_LEAGUE_COOKIE_NAME + normaliseDefaultLeagueCookieValue', () => {
    expect(ROUTER_SRC).toMatch(/DEFAULT_LEAGUE_COOKIE_NAME/)
    expect(ROUTER_SRC).toMatch(/normaliseDefaultLeagueCookieValue/)
  })

  it('reads the cookie value with normalisation before resolving persona', () => {
    const stripped = stripComments(ROUTER_SRC)
    // Sequence: get cookies() → read by name → normalise → pass into
    // resolveHomepagePersona as cookieLeagueId. The exact arg order
    // isn't pinned, only that all four steps appear in the function
    // body and `cookieLeagueId` is part of the resolve call.
    expect(stripped).toMatch(/await\s+cookies\(\)/)
    expect(stripped).toMatch(
      /normaliseDefaultLeagueCookieValue\([\s\S]*?DEFAULT_LEAGUE_COOKIE_NAME/,
    )
    expect(stripped).toMatch(
      /resolveHomepagePersona\(\{[\s\S]+?cookieLeagueId/,
    )
  })
})

describe('v1.97.5 — LeagueSwitcher writes cookie on pill click', () => {
  it('imports setDefaultLeagueCookie from the actions module', () => {
    expect(SWITCHER_SRC).toMatch(
      /import\s*\{\s*setDefaultLeagueCookie\s*\}\s*from\s*['"]@\/app\/api\/default-league\/actions['"]/,
    )
  })

  it('pickLeague calls setDefaultLeagueCookie before the navigation transition', () => {
    const stripped = stripComments(SWITCHER_SRC)
    // The cookie write must appear BEFORE startNavigation so the
    // server action fires immediately on click (fire-and-forget). The
    // sequence relaxed to "anywhere inside pickLeague before
    // startNavigation".
    const pickFn = stripped.match(
      /function pickLeague\([\s\S]+?startNavigation/,
    )
    expect(pickFn).toBeTruthy()
    expect(pickFn![0]).toMatch(/setDefaultLeagueCookie\(\s*m\.leagueId/)
  })

  it('cookie write is fire-and-forget (does not await blocking the transition)', () => {
    // `void setDefaultLeagueCookie(...)` OR a non-awaited call shape.
    // The negative regex catches the buggy "await setDefaultLeagueCookie"
    // form that would push the cookie write onto the click critical path.
    const stripped = stripComments(SWITCHER_SRC)
    expect(stripped).not.toMatch(/await\s+setDefaultLeagueCookie/)
  })
})

describe('v1.97.5 — sign-out clears cookie', () => {
  it('LineLoginButton imports clearDefaultLeagueCookie', () => {
    expect(LINE_BUTTON_SRC).toMatch(
      /import\s*\{\s*clearDefaultLeagueCookie\s*\}\s*from\s*['"]@\/app\/api\/default-league\/actions['"]/,
    )
  })

  it('LineLoginButton sign-out click invokes clearDefaultLeagueCookie before signOut', () => {
    const stripped = stripComments(LINE_BUTTON_SRC)
    // Match a click handler that calls clear before signOut.
    expect(stripped).toMatch(
      /clearDefaultLeagueCookie\([\s\S]+?signOut\(/,
    )
  })

  it('AdminNav imports clearDefaultLeagueCookie', () => {
    expect(ADMIN_NAV_SRC).toMatch(
      /import\s*\{\s*clearDefaultLeagueCookie\s*\}\s*from\s*['"]@\/app\/api\/default-league\/actions['"]/,
    )
  })

  it('AdminNav sign-out wrapper invokes clearDefaultLeagueCookie before signOut', () => {
    const stripped = stripComments(ADMIN_NAV_SRC)
    expect(stripped).toMatch(
      /clearDefaultLeagueCookie\([\s\S]+?signOut\(/,
    )
  })

  it('AdminNav signOut buttons use the wrapped handler (no naked signOut click)', () => {
    // Both dropdown + drawer sign-out buttons should point at the
    // wrapped function. The wrapped function name is the regression
    // target — a bare `signOut(...)` onClick would bypass the clear.
    const stripped = stripComments(ADMIN_NAV_SRC)
    // Allow exactly one definition of the wrapper. The two button
    // sites should reference the wrapper, not invoke signOut directly.
    const directInvocations = stripped.match(
      /onClick=\{\(\)\s*=>\s*signOut\(/g,
    )
    expect(directInvocations).toBeNull()
  })
})
