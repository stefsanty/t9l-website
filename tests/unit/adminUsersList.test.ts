import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import path from 'path'

/**
 * v1.57.0 (PR 4 of route-shortening chain) — structural assertions on
 * the new /admin/users surface.
 *
 * The PR adds:
 *   1. Route `src/app/admin/users/page.tsx` — server component, hard-gated
 *      to admin role, fetches via getAllUsersForAdmin, renders UsersList.
 *   2. Component `src/components/admin/UsersList.tsx` — client list with
 *      search + linked-state filter + per-row Unlink action.
 *   3. Helper `getAllUsersForAdmin()` in lib/admin-data.ts — joins User
 *      + Account + linked Player + LineLogin.
 *   4. Server action `adminUnlinkUserFromPlayer({ userId })` in
 *      app/admin/leagues/actions.ts — clears the User<->Player binding
 *      idempotently.
 *   5. AdminNav gains a "Users" link (desktop + mobile drawer).
 */

const ROOT = process.cwd()

function read(p: string): string {
  return readFileSync(path.join(ROOT, p), 'utf-8')
}
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
}

describe('v1.57.0 — /admin/users route', () => {
  const pagePath = 'src/app/admin/users/page.tsx'

  it('exists', () => {
    expect(existsSync(path.join(ROOT, pagePath))).toBe(true)
  })

  it('is a server component (default async export)', () => {
    const src = stripComments(read(pagePath))
    expect(src).toMatch(/export default async function/)
  })

  it('hard-gates non-admin sessions with a redirect to /admin/login', () => {
    const src = stripComments(read(pagePath))
    expect(src).toMatch(/redirect\(['"]\/admin\/login['"]\)/)
    expect(src).toMatch(/!session\?\.isAdmin|session\?\.isAdmin/)
  })

  it('fetches via getAllUsersForAdmin (the new helper)', () => {
    const src = stripComments(read(pagePath))
    expect(src).toMatch(/getAllUsersForAdmin\(\)/)
    expect(src).toMatch(/from\s+['"]@\/lib\/admin-data['"]/)
  })

  it('renders <UsersList users={users} />', () => {
    const src = stripComments(read(pagePath))
    expect(src).toMatch(/<UsersList\s+users=\{users\}/)
  })
})

describe('v1.57.0 — UsersList component', () => {
  const componentPath = 'src/components/admin/UsersList.tsx'

  it('exists', () => {
    expect(existsSync(path.join(ROOT, componentPath))).toBe(true)
  })

  it('declares "use client"', () => {
    const src = read(componentPath)
    expect(src.split('\n')[0].trim().replace(/['";]/g, '')).toBe('use client')
  })

  it('exports the UserRow type so other admin surfaces can re-import', () => {
    const src = stripComments(read(componentPath))
    expect(src).toMatch(/export\s+(?:type\s+)?interface\s+UserRow/)
  })

  it('exposes search input + filter buttons + summary + list testids', () => {
    const src = read(componentPath)
    expect(src).toMatch(/data-testid="admin-users-summary"/)
    expect(src).toMatch(/data-testid="admin-users-search"/)
    expect(src).toMatch(/data-testid="admin-users-list"/)
    expect(src).toMatch(/data-testid=\{`admin-users-filter-\$\{opt\}`\}/)
  })

  it('per-row testids cover desktop + mobile + provider + linked + unlink', () => {
    const src = read(componentPath)
    expect(src).toMatch(/data-testid=\{`admin-users-row-\$\{u\.id\}`\}/)
    expect(src).toMatch(/data-testid=\{`admin-users-row-mobile-\$\{u\.id\}`\}/)
    expect(src).toMatch(/data-testid=\{`admin-users-providers-\$\{userId\}`\}/)
    expect(src).toMatch(/data-testid=\{`admin-users-linked-\$\{userId\}`\}/)
    expect(src).toMatch(/data-testid=\{`admin-users-unlink-\$\{u\.id\}`\}/)
  })

  it('filters users by name/email/linked-player on the search input', () => {
    const src = stripComments(read(componentPath))
    expect(src).toMatch(/u\.name[\s\S]{0,100}\.toLowerCase\(\)/)
    expect(src).toMatch(/u\.email[\s\S]{0,100}\.toLowerCase\(\)/)
    expect(src).toMatch(/u\.linkedPlayer\?\.name[\s\S]{0,100}\.toLowerCase\(\)/)
  })

  it('linked-state filter offers all / linked / unlinked', () => {
    const src = stripComments(read(componentPath))
    expect(src).toMatch(/'all'.*'linked'.*'unlinked'/)
  })

  it('per-row Unlink action calls adminUnlinkUserFromPlayer', () => {
    const src = stripComments(read(componentPath))
    expect(src).toMatch(/adminUnlinkUserFromPlayer\(\{[\s\S]{0,80}userId:\s*userRow\.id/)
  })

  it('Unlink button only renders when the user is linked to a player', () => {
    const src = read(componentPath)
    // The conditional render `{u.linkedPlayer && (... Unlink ...)}` appears
    // for both desktop and mobile.
    const unlinkConditionals = src.match(/\{u\.linkedPlayer\s*&&\s*\(/g) ?? []
    expect(unlinkConditionals.length).toBeGreaterThanOrEqual(2)
  })

  it('admin-role users get a visible "Admin" pill', () => {
    const src = read(componentPath)
    expect(src).toMatch(/u\.role === 'ADMIN'[\s\S]{0,300}Admin/)
  })

  it('renders provider pills with LINE/Google/Email labels', () => {
    const src = stripComments(read(componentPath))
    expect(src).toMatch(/PROVIDER_LABELS[\s\S]{0,200}line:\s*'LINE'/)
    expect(src).toMatch(/google:\s*'Google'/)
    expect(src).toMatch(/email:\s*'Email'/)
  })
})

describe('v1.57.0 — getAllUsersForAdmin helper', () => {
  const dataPath = 'src/lib/admin-data.ts'

  it('exports getAllUsersForAdmin', () => {
    const src = stripComments(read(dataPath))
    expect(src).toMatch(/export\s+async\s+function\s+getAllUsersForAdmin\s*\(/)
  })

  it('selects User + accounts.provider in a single Prisma query', () => {
    const src = stripComments(read(dataPath))
    expect(src).toMatch(/prisma\.user\.findMany\([\s\S]{0,800}accounts:\s*\{\s*select:\s*\{\s*provider:\s*true\s*\}/)
  })

  it('dedupes provider strings via Set + sorts for stable display', () => {
    const src = stripComments(read(dataPath))
    expect(src).toMatch(/new\s+Set\([^)]*\.accounts\.map[\s\S]{0,80}\)\s*\)\.sort\(\)/)
  })

  it('joins LineLogin.lastSeenAt by lineId (only when lineId present)', () => {
    const src = stripComments(read(dataPath))
    expect(src).toMatch(/prisma\.lineLogin\.findMany\([\s\S]{0,200}lineId:\s*\{\s*in:\s*lineIds\s*\}/)
  })

  it('joins linked Player + their active league names', () => {
    const src = stripComments(read(dataPath))
    expect(src).toMatch(/prisma\.player\.findMany\([\s\S]{0,500}leagueAssignments:[\s\S]{0,200}toGameWeek:\s*null/)
  })

  it('returns ISO-string dates (not Date objects) at the boundary', () => {
    const src = stripComments(read(dataPath))
    expect(src).toMatch(/u\.createdAt\.toISOString\(\)/)
    expect(src).toMatch(/lastSeen\.toISOString\(\)/)
  })
})

describe('v1.57.0 — AdminNav gains a Users link', () => {
  const navPath = 'src/components/admin/AdminNav.tsx'

  it('includes /admin/users in the navLinks array', () => {
    const src = read(navPath)
    expect(src).toMatch(/href:\s*['"]\/admin\/users['"][\s\S]{0,80}label:\s*['"]Users['"]/)
  })

  it('mounts the desktop NavLink for /admin/users', () => {
    const src = read(navPath)
    expect(src).toMatch(/<NavLink\s+href="\/admin\/users"/)
  })
})
