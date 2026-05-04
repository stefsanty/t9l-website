import { describe, it, expect } from 'vitest'
import { existsSync, statSync } from 'fs'
import path from 'path'
import { RESERVED_LEAGUE_SLUGS, validateLeagueSlug, getLeagueIdBySlug } from '@/lib/leagueSlug'

/**
 * v1.53.2 (PR 6 of the path-routing chain) — reserved-word route
 * conflict guard. Final safety test for the path-routing chain.
 *
 * Two layers of defense protect against a malformed `League.subdomain`
 * value shadowing a top-level route via the `/[slug]` catch-all:
 *
 *   1. **Routing layer (Next.js).** Static segments win over dynamic
 *      ones at the same level. So requests for `/admin`, `/auth`,
 *      `/account`, etc. always hit the dedicated route file regardless
 *      of any League row's slug. This test asserts a real top-level
 *      directory exists in `src/app/` for every routing-reserved slug.
 *
 *   2. **Data layer (`validateLeagueSlug`).** Reserved slugs fail
 *      `validateLeagueSlug` so `getLeagueIdBySlug` returns null for
 *      them — the `/[slug]` catch-all 404s before reaching `Dashboard`.
 *      This is the safety net for any slug NOT listed in the routing
 *      layer (today: `md`, which is reserved because it appears
 *      mid-path under `/league/<slug>/md/<id>` but has no top-level
 *      `/md` route).
 *
 * Adding a new top-level segment → update `RESERVED_LEAGUE_SLUGS` in
 * `src/lib/leagueSlug.ts` AND verify this test still passes.
 */

const APP_ROOT = path.join(process.cwd(), 'src/app')

/**
 * Slugs that are reserved at the data layer ONLY — they don't have a
 * dedicated top-level route, but they're reserved because they appear
 * elsewhere in the path tree (under a different prefix) and we want
 * to keep them off-limits as league slugs to avoid future collisions.
 *
 * `md` — used as the segment between `/league/<slug>/md/<id>`. A
 * league named `md` would create awkward URLs like
 * `/md/md/md1` (alias) or visual confusion.
 */
const DATA_LAYER_ONLY_RESERVED = new Set(['md'])

function dirHasRouteFile(dir: string): boolean {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return false
  // A Next.js App Router segment "exists" if it has a page.tsx, route.ts,
  // layout.tsx, default.tsx, or any of those + .ts/.jsx/.js variants.
  const candidates = [
    'page.tsx', 'page.ts', 'page.jsx', 'page.js',
    'route.ts', 'route.tsx', 'route.js',
    'layout.tsx', 'layout.ts',
  ]
  for (const c of candidates) {
    if (existsSync(path.join(dir, c))) return true
  }
  // Or it has a sub-directory with a page (e.g. /api/some-route/route.ts;
  // /league/[slug]/page.tsx — the parent /league/ directory itself
  // doesn't need a page.tsx because [slug]/page.tsx covers it).
  // Walk one level deep looking for ANY route file.
  const fs = require('node:fs') as typeof import('node:fs')
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const e of entries) {
    if (e.isDirectory()) {
      const subDir = path.join(dir, e.name)
      for (const c of candidates) {
        if (existsSync(path.join(subDir, c))) return true
      }
    }
  }
  return false
}

describe('PR 6 — every routing-reserved slug has a real top-level route', () => {
  it.each(
    Array.from(RESERVED_LEAGUE_SLUGS).filter(
      (s) => !DATA_LAYER_ONLY_RESERVED.has(s),
    ),
  )('reserved slug "%s" has a real route in src/app/', (slug) => {
    const dir = path.join(APP_ROOT, slug)
    expect(dirHasRouteFile(dir)).toBe(true)
  })

  it('every data-layer-only reserved slug is documented in DATA_LAYER_ONLY_RESERVED', () => {
    for (const slug of DATA_LAYER_ONLY_RESERVED) {
      // The slug must be in the global reserved set.
      expect(RESERVED_LEAGUE_SLUGS.has(slug)).toBe(true)
      // ... and there must NOT be a top-level route for it (otherwise it
      // shouldn't be in the data-layer-only set).
      const dir = path.join(APP_ROOT, slug)
      expect(dirHasRouteFile(dir)).toBe(false)
    }
  })
})

describe('PR 6 — every reserved slug fails validateLeagueSlug (data-layer safety net)', () => {
  it.each(Array.from(RESERVED_LEAGUE_SLUGS))(
    'validateLeagueSlug("%s") returns ok=false (regression target — reserved slugs MUST not pass validation)',
    (slug) => {
      const result = validateLeagueSlug(slug)
      expect(result.ok).toBe(false)
    },
  )
})

describe('PR 6 — getLeagueIdBySlug returns null for every reserved slug', () => {
  // This test asserts the `/[slug]` catch-all and `/league/[slug]` routes
  // never resolve a reserved slug to a leagueId, regardless of what's in
  // the DB. Even if some malformed seed populates `League.subdomain =
  // 'admin'`, requests for `/admin` still hit the dedicated admin route
  // (Layer 1), and `/league/admin` resolves to `null` here (Layer 2)
  // because validateLeagueSlug rejects 'admin'.
  it.each(Array.from(RESERVED_LEAGUE_SLUGS))(
    'getLeagueIdBySlug("%s") returns null without hitting the DB',
    async (slug) => {
      const result = await getLeagueIdBySlug(slug)
      expect(result).toBeNull()
    },
  )
})
