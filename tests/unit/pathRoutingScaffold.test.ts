import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import path from 'path'

/**
 * v1.50.0 (PR 1 of the path-routing chain) — structural assertions on the
 * new path-based route files. These are regression-prevention tests: they
 * fail if a future PR removes either route, drops the slug-validation
 * step, or stops rendering through `Dashboard`.
 *
 * Companion behavior tests live in `leagueSlug.test.ts` (validation rules)
 * and the eventual e2e suite (full path-resolves-to-rendered-Dashboard).
 */

function read(relPath: string): string {
  return readFileSync(path.join(process.cwd(), relPath), 'utf8')
}

function stripComments(src: string): string {
  // Strip block comments + single-line comments so docstrings that
  // legitimately reference symbols don't trip the "is X imported?" checks.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('PR 1 — /league/[slug] route', () => {
  const routePath = 'src/app/league/[slug]/page.tsx'

  it('exists', () => {
    expect(existsSync(path.join(process.cwd(), routePath))).toBe(true)
  })

  it('is a server component (default async export)', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/export default async function/)
  })

  it('resolves the slug via getLeagueIdBySlug', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/import.*getLeagueIdBySlug.*from\s+['"]@\/lib\/leagueSlug['"]/)
    expect(src).toMatch(/getLeagueIdBySlug\(\s*slug\s*\)/)
  })

  it('renders Dashboard with league data', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/import\s+Dashboard\s+from\s+['"]@\/components\/Dashboard['"]/)
    expect(src).toMatch(/<Dashboard/)
  })

  it('calls notFound() when leagueId is null', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/import.*notFound.*from\s+['"]next\/navigation['"]/)
    expect(src).toMatch(/notFound\(\)/)
  })

  it('uses getPublicLeagueData with the resolved leagueId', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/getPublicLeagueData\(\s*leagueId\s*\)/)
  })

  it('handles getPublicLeagueData failure with the apex-style fallback', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/Data unavailable/)
    expect(src).toMatch(/Try again in a moment/)
  })
})

describe('PR 1 — /[slug] catch-all route', () => {
  const routePath = 'src/app/[slug]/page.tsx'

  it('exists', () => {
    expect(existsSync(path.join(process.cwd(), routePath))).toBe(true)
  })

  it('resolves the slug via getLeagueIdBySlug (the same helper as /league/[slug])', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/import.*getLeagueIdBySlug.*from\s+['"]@\/lib\/leagueSlug['"]/)
    expect(src).toMatch(/getLeagueIdBySlug\(\s*slug\s*\)/)
  })

  it('calls notFound() when leagueId is null', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/notFound\(\)/)
  })

  it('renders Dashboard', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/<Dashboard/)
  })
})

describe('PR 1 — apex `/` is unchanged in shape (alias for default league)', () => {
  // The user's design: `/`, `/t9l`, `/league/t9l` all render the t9l league.
  // No redirect from `/` to `/league/t9l` — apex stays as the default render.
  // This test pins that contract: the apex page does NOT redirect anywhere.
  it('does not redirect (no `redirect()` call from next/navigation)', () => {
    const src = stripComments(read('src/app/page.tsx'))
    expect(src).not.toMatch(/redirect\(\s*['"]\/league\//)
    expect(src).not.toMatch(/redirect\(\s*['"]\/t9l['"]/)
  })

  it('still renders Dashboard (for backward-compat with v1.49.x callers)', () => {
    const src = stripComments(read('src/app/page.tsx'))
    expect(src).toMatch(/<Dashboard/)
  })
})

describe('PR 1 — migration backfills default league slug to t9l', () => {
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
    // Strip comments first so the rollback recipe in the header doesn't
    // trip these assertions.
    const code = sql.replace(/--.*$/gm, '')
    expect(code).not.toMatch(/\bDROP\s+(TABLE|COLUMN|TYPE|INDEX)/i)
    expect(code).not.toMatch(/\bALTER\s+TABLE.*ALTER\s+COLUMN/i)
    expect(code).not.toMatch(/\bTRUNCATE/i)
    expect(code).not.toMatch(/\bDELETE\s+FROM/i)
  })
})
