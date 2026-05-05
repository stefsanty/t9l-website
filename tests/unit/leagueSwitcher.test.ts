import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import path from 'path'

/**
 * v1.59.0 — perf pass. Memberships are now resolved server-side in the root
 * layout via `getMembershipsForSession()` and threaded through
 * `<MembershipsProvider>` context. Pre-v1.59.0 the league switcher (header
 * chevron + account-menu entry) lazy-loaded via `/api/me/memberships` on
 * dropdown open, which produced a visible flash for multi-league users.
 *
 * The structural tests below pin v1.59.0 contracts:
 *   1. `/api/me/memberships` route stays as a refresh path, delegating
 *      to the shared helper.
 *   2. `LeagueSwitcher` reads from `useMemberships()` (context), no fetch.
 *   3. `AccountMenuLeagueSwitch` same — reads from context.
 *   4. Header mounts the LeagueSwitcher.
 *   5. LineLoginButton mounts the AccountMenuLeagueSwitch.
 *   6. Layout fetches memberships server-side and passes via provider.
 */

function read(relPath: string): string {
  return readFileSync(path.join(process.cwd(), relPath), 'utf8')
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
}

describe('v1.59.0 — /api/me/memberships route', () => {
  const routePath = 'src/app/api/me/memberships/route.ts'

  it('exists', () => {
    expect(existsSync(path.join(process.cwd(), routePath))).toBe(true)
  })

  it('exports GET handler', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/export\s+async\s+function\s+GET/)
  })

  it('uses getServerSession + authOptions for auth', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/getServerSession/)
    expect(src).toMatch(/authOptions/)
  })

  it('delegates to getMembershipsForSession (shared helper)', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/getMembershipsForSession/)
  })

  it('returns empty memberships array for unauthenticated', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/memberships:\s*\[\s*\]/)
  })
})

describe('v1.59.0 — getMembershipsForSession helper', () => {
  const helperPath = 'src/lib/memberships.ts'

  it('exists', () => {
    expect(existsSync(path.join(process.cwd(), helperPath))).toBe(true)
  })

  it('exports getMembershipsForSession + Membership type', () => {
    const src = stripComments(read(helperPath))
    expect(src).toMatch(/export\s+(async\s+)?function\s+getMembershipsForSession/)
    expect(src).toMatch(/export\s+type\s+Membership/)
  })

  it('queries Player.findFirst via userId or lineId', () => {
    const src = stripComments(read(helperPath))
    expect(src).toMatch(/findFirst/)
    expect(src).toMatch(/userId/)
    expect(src).toMatch(/lineId/)
  })

  it('joins through leagueAssignments → leagueTeam → league', () => {
    const src = stripComments(read(helperPath))
    expect(src).toMatch(/leagueAssignments/)
    expect(src).toMatch(/leagueTeam/)
    expect(src).toMatch(/league:\s*\{/)
  })

  it('dedupes by leagueId', () => {
    const src = stripComments(read(helperPath))
    expect(src).toMatch(/seen\.has\(league\.id\)/)
  })

  it('falls back to DEFAULT_LEAGUE_SLUG when subdomain is null on the default league', () => {
    const src = stripComments(read(helperPath))
    expect(src).toMatch(/DEFAULT_LEAGUE_SLUG/)
  })

  it('returns [] on Prisma failure (defensive)', () => {
    const src = stripComments(read(helperPath))
    expect(src).toMatch(/catch[\s\S]{0,200}return\s*\[\s*\]/)
  })

  it('sorts by name', () => {
    const src = stripComments(read(helperPath))
    expect(src).toMatch(/localeCompare/)
  })
})

describe('v1.59.0 — MembershipsProvider context', () => {
  const providerPath = 'src/components/MembershipsProvider.tsx'

  it('exists', () => {
    expect(existsSync(path.join(process.cwd(), providerPath))).toBe(true)
  })

  it("declares 'use client'", () => {
    const src = read(providerPath)
    expect(src.split('\n')[0].trim().replace(/['";]/g, '')).toBe('use client')
  })

  it('exports MembershipsProvider + useMemberships', () => {
    const src = stripComments(read(providerPath))
    expect(src).toMatch(/export\s+function\s+MembershipsProvider/)
    expect(src).toMatch(/export\s+function\s+useMemberships/)
  })

  it('uses createContext + useContext (standard React context shape)', () => {
    const src = stripComments(read(providerPath))
    expect(src).toMatch(/createContext/)
    expect(src).toMatch(/useContext/)
  })
})

describe('v1.59.0 — LeagueSwitcher reads from context (no fetch)', () => {
  const componentPath = 'src/components/LeagueSwitcher.tsx'

  it('exists', () => {
    expect(existsSync(path.join(process.cwd(), componentPath))).toBe(true)
  })

  it("declares 'use client'", () => {
    const src = read(componentPath)
    expect(src.split('\n')[0].trim().replace(/['";]/g, '')).toBe('use client')
  })

  it('reads memberships from useMemberships() context (NOT a fetch)', () => {
    const src = stripComments(read(componentPath))
    expect(src).toMatch(/useMemberships\(\)/)
  })

  it('does NOT fetch /api/me/memberships in the component (regression target — would re-introduce the v1.52.0 round-trip)', () => {
    const src = stripComments(read(componentPath))
    // The fetch call inside the deprecated useLeagueMemberships shim is gone;
    // callers should use useMemberships() directly. The literal endpoint
    // string should not appear in this file at all post-v1.59.0.
    expect(src).not.toMatch(/['"]\/api\/me\/memberships['"]/)
  })

  it('does NOT use loadedRef / lazy-load pattern (gone with the fetch)', () => {
    const src = stripComments(read(componentPath))
    expect(src).not.toMatch(/loadedRef/)
  })

  it('renders nothing for users with fewer than 2 memberships', () => {
    const src = stripComments(read(componentPath))
    expect(src).toMatch(/memberships\.length\s*<\s*2/)
  })

  it('uses next/navigation router for switching to /id/<slug>', () => {
    const src = stripComments(read(componentPath))
    expect(src).toMatch(/from\s+['"]next\/navigation['"]/)
    expect(src).toMatch(/router\.push\(`\/id\/\$\{m\.slug\}`\)/)
    expect(src).not.toMatch(/router\.push\(`\/league\//)
  })

  it('outside-click + Escape close the dropdown', () => {
    const src = stripComments(read(componentPath))
    expect(src).toMatch(/mousedown/)
    expect(src).toMatch(/Escape/)
  })

  it('exposes test ids for trigger + menu + items', () => {
    const src = stripComments(read(componentPath))
    expect(src).toContain('data-testid="league-switcher-trigger"')
    expect(src).toContain('data-testid="league-switcher-menu"')
    expect(src).toMatch(/data-testid=\{`league-switcher-item-\$\{m\.slug\}`\}/)
  })

  it('exports useLeagueMemberships as a thin shim (compat)', () => {
    const src = stripComments(read(componentPath))
    expect(src).toMatch(/export\s+function\s+useLeagueMemberships/)
  })
})

describe('v1.59.0 — AccountMenuLeagueSwitch reads from context', () => {
  const componentPath = 'src/components/AccountMenuLeagueSwitch.tsx'

  it('exists', () => {
    expect(existsSync(path.join(process.cwd(), componentPath))).toBe(true)
  })

  it("declares 'use client'", () => {
    const src = read(componentPath)
    expect(src.split('\n')[0].trim().replace(/['";]/g, '')).toBe('use client')
  })

  it('reads memberships from useMemberships() context', () => {
    const src = stripComments(read(componentPath))
    expect(src).toMatch(/useMemberships\(\)/)
  })

  it('renders nothing when memberships.length < 2', () => {
    const src = stripComments(read(componentPath))
    expect(src).toMatch(/memberships\.length\s*<\s*2/)
  })

  it('renders Link to /id/<slug> per membership', () => {
    const src = stripComments(read(componentPath))
    expect(src).toMatch(/href=\{`\/id\/\$\{m\.slug\}`\}/)
    expect(src).not.toMatch(/href=\{`\/league\//)
  })

  it('exposes account-menu-switch-league testids', () => {
    const src = stripComments(read(componentPath))
    expect(src).toContain('data-testid="account-menu-switch-league"')
    expect(src).toMatch(/data-testid=\{`account-menu-switch-league-\$\{m\.slug\}`\}/)
  })

  it('marks the current league with the vibrant-pink highlight', () => {
    const src = stripComments(read(componentPath))
    expect(src).toMatch(/isCurrent.*vibrant-pink|vibrant-pink.*isCurrent/)
  })
})

describe('v1.59.0 — Header mounts LeagueSwitcher next to brand title', () => {
  const headerPath = 'src/components/Header.tsx'

  it('imports LeagueSwitcher', () => {
    const src = stripComments(read(headerPath))
    expect(src).toMatch(/import\s+LeagueSwitcher\s+from\s+['"]\.\/LeagueSwitcher['"]/)
  })

  it('mounts <LeagueSwitcher /> after the brand Link', () => {
    const src = stripComments(read(headerPath))
    expect(src).toMatch(/<\/Link>[\s\S]{0,400}<LeagueSwitcher/)
  })
})

describe('v1.59.0 — LineLoginButton mounts AccountMenuLeagueSwitch in dropdown', () => {
  const buttonPath = 'src/components/LineLoginButton.tsx'

  it('imports AccountMenuLeagueSwitch', () => {
    const src = stripComments(read(buttonPath))
    expect(src).toMatch(/import\s+AccountMenuLeagueSwitch\s+from\s+['"]\.\/AccountMenuLeagueSwitch['"]/)
  })

  it('mounts <AccountMenuLeagueSwitch /> in the dropdown', () => {
    const src = stripComments(read(buttonPath))
    expect(src).toMatch(/<AccountMenuLeagueSwitch/)
  })
})

describe('v1.59.0 — Root layout SSR-hydrates memberships into provider', () => {
  const layoutPath = 'src/app/layout.tsx'

  it('imports getMembershipsForSession + MembershipsProvider', () => {
    const src = stripComments(read(layoutPath))
    expect(src).toMatch(/getMembershipsForSession/)
    expect(src).toMatch(/MembershipsProvider/)
  })

  it('calls getMembershipsForSession after getServerSession (gated by truthy session)', () => {
    const src = stripComments(read(layoutPath))
    expect(src).toMatch(/await\s+getMembershipsForSession/)
  })

  it('wraps children with <MembershipsProvider memberships={...}>', () => {
    const src = stripComments(read(layoutPath))
    expect(src).toMatch(/<MembershipsProvider\s+memberships=\{memberships\}/)
  })
})
