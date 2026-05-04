import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import path from 'path'

/**
 * v1.52.0 (PR 3 of the path-routing chain) — structural tests for the
 * league-switcher UI surfaces:
 *
 *   1. `/api/me/memberships` API route — returns the signed-in user's
 *      leagues with slugs for path-based navigation.
 *   2. `LeagueSwitcher` header dropdown — small chevron next to the
 *      brand title; lazy-loads memberships on first open.
 *   3. `AccountMenuLeagueSwitch` — inline section in the LineLoginButton
 *      account dropdown; renders nothing when memberships.length < 2.
 *   4. Header mounts the LeagueSwitcher.
 *   5. LineLoginButton mounts the AccountMenuLeagueSwitch.
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

describe('PR 3 — /api/me/memberships route', () => {
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

  it('returns empty memberships array for unauthenticated', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/memberships:\s*\[\s*\]/)
  })

  it('queries via session.userId (canonical, post-α.5)', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/session\.userId/)
  })

  it('falls back to session.lineId for legacy LINE-only sessions', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/session\.lineId/)
  })

  it('joins through Player → leagueAssignments → leagueTeam → league', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/leagueAssignments/)
    expect(src).toMatch(/leagueTeam/)
    expect(src).toMatch(/league:\s*\{/)
  })

  it('dedupes by leagueId (player can have multiple PLAs in same league across timespans)', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/seen\.has\(league\.id\)/)
  })

  it('falls back to DEFAULT_LEAGUE_SLUG for the default league when subdomain is null', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/DEFAULT_LEAGUE_SLUG/)
  })

  it('marks isCurrent based on session.leagueId', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/isCurrent:\s*session\.leagueId\s*===\s*league\.id/)
  })

  it('sorts memberships by name', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/localeCompare/)
  })
})

describe('PR 3 — LeagueSwitcher header component', () => {
  const componentPath = 'src/components/LeagueSwitcher.tsx'

  it('exists', () => {
    expect(existsSync(path.join(process.cwd(), componentPath))).toBe(true)
  })

  it("declares 'use client'", () => {
    const src = read(componentPath)
    expect(src.split('\n')[0].trim().replace(/['";]/g, '')).toBe('use client')
  })

  it('exports useLeagueMemberships hook (shared with AccountMenuLeagueSwitch)', () => {
    const src = stripComments(read(componentPath))
    expect(src).toMatch(/export\s+function\s+useLeagueMemberships/)
  })

  it('hook fetches /api/me/memberships', () => {
    const src = stripComments(read(componentPath))
    expect(src).toMatch(/['"]\/api\/me\/memberships['"]/)
  })

  it('hook caches via loadedRef so repeated open does not re-fetch', () => {
    const src = stripComments(read(componentPath))
    expect(src).toMatch(/loadedRef/)
  })

  it('default export renders nothing for unauthenticated sessions', () => {
    const src = stripComments(read(componentPath))
    expect(src).toMatch(/status\s*===\s*['"]authenticated['"]/)
    expect(src).toMatch(/!hasSession.*return\s*null|hasSession.*null/)
  })

  it('renders nothing for users with fewer than 2 memberships', () => {
    const src = stripComments(read(componentPath))
    expect(src).toMatch(/memberships\.length\s*<\s*2/)
  })

  it('uses next/navigation router for switching', () => {
    const src = stripComments(read(componentPath))
    expect(src).toMatch(/from\s+['"]next\/navigation['"]/)
    expect(src).toMatch(/router\.push\(`\/league\/\$\{m\.slug\}`\)/)
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
})

describe('PR 3 — AccountMenuLeagueSwitch (inline account-menu list)', () => {
  const componentPath = 'src/components/AccountMenuLeagueSwitch.tsx'

  it('exists', () => {
    expect(existsSync(path.join(process.cwd(), componentPath))).toBe(true)
  })

  it("declares 'use client'", () => {
    const src = read(componentPath)
    expect(src.split('\n')[0].trim().replace(/['";]/g, '')).toBe('use client')
  })

  it('reuses the useLeagueMemberships hook from LeagueSwitcher', () => {
    const src = stripComments(read(componentPath))
    expect(src).toMatch(/from\s+['"]\.\/LeagueSwitcher['"]/)
    expect(src).toMatch(/useLeagueMemberships/)
  })

  it('renders nothing when memberships.length < 2', () => {
    const src = stripComments(read(componentPath))
    expect(src).toMatch(/memberships\.length\s*<\s*2/)
  })

  it('renders Link to /league/<slug> per membership', () => {
    const src = stripComments(read(componentPath))
    expect(src).toMatch(/href=\{`\/league\/\$\{m\.slug\}`\}/)
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

  it('lazy-loads memberships only when dropdownOpen is true', () => {
    const src = stripComments(read(componentPath))
    expect(src).toMatch(/dropdownOpen/)
    expect(src).toMatch(/dropdownOpen.*load\(\)|if\s*\(dropdownOpen\)/)
  })
})

describe('PR 3 — Header mounts LeagueSwitcher next to brand title', () => {
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

describe('PR 3 — LineLoginButton mounts AccountMenuLeagueSwitch in dropdown', () => {
  const buttonPath = 'src/components/LineLoginButton.tsx'

  it('imports AccountMenuLeagueSwitch', () => {
    const src = stripComments(read(buttonPath))
    expect(src).toMatch(/import\s+AccountMenuLeagueSwitch\s+from\s+['"]\.\/AccountMenuLeagueSwitch['"]/)
  })

  it('mounts <AccountMenuLeagueSwitch /> with dropdownOpen + onNavigate props', () => {
    const src = stripComments(read(buttonPath))
    expect(src).toMatch(/<AccountMenuLeagueSwitch[\s\S]{0,300}dropdownOpen=\{open\}/)
    expect(src).toMatch(/<AccountMenuLeagueSwitch[\s\S]{0,300}onNavigate=\{/)
  })
})
