import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import path from 'path'

/**
 * v1.50.0 (PR 1 of the original path-routing chain) — structural
 * assertions on the path-based route files. Updated for v1.54.0 to
 * reflect the route shortening:
 *
 *   - canonical render moved from `/league/[slug]/page.tsx`
 *     to `/id/[slug]/page.tsx`
 *   - both legacy entry points (`/league/[slug]` and `/[slug]`) are
 *     now 308-redirects to the new `/id/<slug>` form
 *
 * Companion behavior tests live in `leagueSlug.test.ts` (validation rules)
 * and the eventual e2e suite (full path-resolves-to-rendered-Dashboard).
 */

function read(relPath: string): string {
  return readFileSync(path.join(process.cwd(), relPath), 'utf8')
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('v1.54.0 — /id/[slug] canonical render', () => {
  const routePath = 'src/app/id/[slug]/page.tsx'

  it('exists', () => {
    expect(existsSync(path.join(process.cwd(), routePath))).toBe(true)
  })

  it('is a server component (default async export)', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/export default async function/)
  })

  it('resolves the slug via getLeagueIdBySlug', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/import.*getLeagueIdBySlug.*from\s+['"]@\/lib\/leagueSlugServer['"]/)
    expect(src).toMatch(/getLeagueIdBySlug\(\s*slug\s*\)/)
  })

  // v2.1.0 — /id/<slug> render tree is split across page.tsx +
  // LeagueBannersBlock + LeagueMatchdayContent + LeagueMatchdayClient.
  // These v1.54.0 regression targets pin contracts that survive the
  // split: the matchday surface still mounts, the heavy data still
  // comes from getPublicLeagueData, the failure surface still shows
  // "Data unavailable". They just live across the new component
  // boundary now.
  const idSlugTree = () =>
    stripComments(read(routePath)) +
    '\n' +
    stripComments(read('src/components/LeagueBannersBlock.tsx')) +
    '\n' +
    stripComments(read('src/components/LeagueMatchdayContent.tsx')) +
    '\n' +
    stripComments(read('src/components/LeagueMatchdayClient.tsx'))

  it('mounts a client matchday surface with league data', () => {
    // v1.54.0 originally pinned `<Dashboard>`. v2.1.0 the matchday
    // surface is rendered by `<LeagueMatchdayClient>` (server-fetched
    // by `<LeagueMatchdayContent>`); legacy routes still use Dashboard.
    const tree = idSlugTree()
    expect(tree).toMatch(/<LeagueMatchdayClient/)
    expect(tree).toMatch(
      /import\s+LeagueMatchdayClient\s+from\s+['"]\.\/LeagueMatchdayClient['"]/,
    )
  })

  it('calls notFound() when leagueId is null', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/import.*notFound.*from\s+['"]next\/navigation['"]/)
    expect(src).toMatch(/notFound\(\)/)
  })

  it('uses getPublicLeagueData with the resolved leagueId', () => {
    expect(idSlugTree()).toMatch(/getPublicLeagueData\(\s*leagueId\s*\)/)
  })

  it('handles getPublicLeagueData failure with the apex-style fallback', () => {
    const tree = idSlugTree()
    expect(tree).toMatch(/Data unavailable/)
    expect(tree).toMatch(/Try again in a moment/)
  })
})

describe('v1.54.0 — /id/[slug]/md/[id] canonical matchday render', () => {
  const routePath = 'src/app/id/[slug]/md/[id]/page.tsx'

  it('exists', () => {
    expect(existsSync(path.join(process.cwd(), routePath))).toBe(true)
  })

  it('renders Dashboard with initialMatchdayId', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/<Dashboard/)
    expect(src).toMatch(/initialMatchdayId=\{md\.id\}/)
  })

  it('does case-insensitive matchday-id match (v1.49.1 contract)', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/id\.toLowerCase\(\)/)
    expect(src).toMatch(/m\.id\.toLowerCase\(\)/)
  })
})

describe('v1.54.0 — legacy /league/[slug] route is a 308-redirect to /id/<slug>', () => {
  const routePath = 'src/app/league/[slug]/page.tsx'

  it('exists', () => {
    expect(existsSync(path.join(process.cwd(), routePath))).toBe(true)
  })

  it('does NOT render Dashboard (regression target — pre-v1.54.0 it was canonical render)', () => {
    const src = stripComments(read(routePath))
    expect(src).not.toMatch(/<Dashboard/)
  })

  it('imports redirect from next/navigation', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/import.*redirect.*from\s+['"]next\/navigation['"]/)
  })

  it('redirects to /id/<slug>', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/redirect\(\s*`\/id\/\$\{[^}]+\}`\s*\)/)
  })

  it('lowercases the slug in the redirect target', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/normalizeLeagueSlug/)
  })
})

describe('v1.54.0 — legacy /[slug] route is a 308-redirect to /id/<slug>', () => {
  const routePath = 'src/app/[slug]/page.tsx'

  it('exists', () => {
    expect(existsSync(path.join(process.cwd(), routePath))).toBe(true)
  })

  it('does NOT render Dashboard (regression target — pre-v1.54.0 it was the short alias canonical render)', () => {
    const src = stripComments(read(routePath))
    expect(src).not.toMatch(/<Dashboard/)
  })

  it('imports redirect from next/navigation', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/import.*redirect.*from\s+['"]next\/navigation['"]/)
  })

  it('redirects to /id/<slug>', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/redirect\(\s*`\/id\/\$\{[^}]+\}`\s*\)/)
  })

  it('lowercases the slug in the redirect target', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/normalizeLeagueSlug/)
  })
})

describe('v1.54.0 — apex `/` is unchanged in shape (alias for default league)', () => {
  // The user's design: `/` and `/id/t9l` both render the t9l league.
  // No redirect from `/` to `/id/t9l` — apex stays as the default render.
  it('does not redirect (no `redirect()` call from next/navigation)', () => {
    const src = stripComments(read('src/app/page.tsx'))
    expect(src).not.toMatch(/redirect\(\s*['"]\/id\//)
    expect(src).not.toMatch(/redirect\(\s*['"]\/league\//)
    expect(src).not.toMatch(/redirect\(\s*['"]\/t9l['"]/)
  })

  it('still renders Dashboard (for backward-compat with v1.49.x callers)', () => {
    const src = stripComments(read('src/app/page.tsx'))
    expect(src).toMatch(/<Dashboard/)
  })
})

describe('v1.50.0 — migration backfills default league slug to t9l', () => {
  it('migration file exists', () => {
    const migPath = 'prisma/migrations/20260505000000_default_league_slug/migration.sql'
    expect(existsSync(path.join(process.cwd(), migPath))).toBe(true)
  })

  it('updates the default league subdomain to t9l (idempotent on already-set rows)', () => {
    const sql = read('prisma/migrations/20260505000000_default_league_slug/migration.sql')
    expect(sql).toMatch(/UPDATE\s+"League"/i)
    expect(sql).toMatch(/SET\s+"subdomain"\s*=\s*'t9l'/i)
    expect(sql).toMatch(/"isDefault"\s*=\s*TRUE/i)
    expect(sql).toMatch(/"subdomain"\s+IS\s+NULL/i)
  })

  it('migration is purely additive (no DROP / ALTER COLUMN / TRUNCATE)', () => {
    const sql = read('prisma/migrations/20260505000000_default_league_slug/migration.sql')
    const code = sql.replace(/--.*$/gm, '')
    expect(code).not.toMatch(/\bDROP\s+(TABLE|COLUMN|TYPE|INDEX)/i)
    expect(code).not.toMatch(/\bALTER\s+TABLE.*ALTER\s+COLUMN/i)
    expect(code).not.toMatch(/\bTRUNCATE/i)
    expect(code).not.toMatch(/\bDELETE\s+FROM/i)
  })
})
