import { describe, it, expect } from 'vitest'
import { existsSync, statSync } from 'fs'
import path from 'path'
import { RESERVED_LEAGUE_SLUGS, validateLeagueSlug } from '@/lib/leagueSlug'
import { getLeagueIdBySlug } from '@/lib/leagueSlugServer'

/**
 * v1.53.2 (PR 6 of the path-routing chain) — reserved-word route
 * conflict guard.
 *
 * v1.54.0 — namespacing every tenant URL under `/id/<slug>` made the
 * comprehensive route-vs-slug conflict guard no longer load-bearing
 * (top-level platform routes are siblings of `/id/`, not parents). The
 * reserved set collapsed to a single recursive guard ('id' itself, to
 * prevent visually confusing `/id/id` URLs). This test now pins:
 *
 *   1. The reserved set is exactly the recursive guard. A regression
 *      that re-broadens it would fail this assertion.
 *   2. Every entry in the reserved set is rejected by
 *      `validateLeagueSlug` and `getLeagueIdBySlug`. Belt-and-braces
 *      defense at the data layer in case the set ever grows.
 *   3. CI-guard test: every top-level segment in `src/app/` is sane —
 *      it's NOT under `/id/` (so they don't accidentally shadow the
 *      tenant namespace). This catches regressions where a developer
 *      accidentally creates a top-level directory inside `src/app/id/`
 *      (which would conflict with the dynamic `[slug]` segment there).
 *
 * Pre-v1.54.0 this test asserted every routing-reserved slug had a
 * matching `src/app/<slug>/` route. Post-v1.54.0 that contract no
 * longer holds because the reserved set isn't tracking routes anymore.
 */

const APP_ROOT = path.join(process.cwd(), 'src/app')
const APP_ID_ROOT = path.join(APP_ROOT, 'id')

function dirHasRouteFile(dir: string): boolean {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return false
  const candidates = [
    'page.tsx', 'page.ts', 'page.jsx', 'page.js',
    'route.ts', 'route.tsx', 'route.js',
    'layout.tsx', 'layout.ts',
  ]
  for (const c of candidates) {
    if (existsSync(path.join(dir, c))) return true
  }
  return false
}

describe('v1.54.0 — reserved set is the slim recursive guard', () => {
  it('contains exactly the {id} guard', () => {
    expect(Array.from(RESERVED_LEAGUE_SLUGS).sort()).toEqual(['id'])
  })

  it('every reserved slug fails validateLeagueSlug', () => {
    for (const slug of RESERVED_LEAGUE_SLUGS) {
      const result = validateLeagueSlug(slug)
      expect(result.ok).toBe(false)
    }
  })

  it('every reserved slug returns null from getLeagueIdBySlug (no DB hit)', async () => {
    for (const slug of RESERVED_LEAGUE_SLUGS) {
      const result = await getLeagueIdBySlug(slug)
      expect(result).toBeNull()
    }
  })
})

describe('v1.54.0 — `/id/` tenant namespace is well-formed', () => {
  it('app/id/ exists and contains the [slug] dynamic segment', () => {
    expect(existsSync(APP_ID_ROOT)).toBe(true)
    expect(existsSync(path.join(APP_ID_ROOT, '[slug]'))).toBe(true)
  })

  it('app/id/[slug]/page.tsx is the canonical per-league render', () => {
    const p = path.join(APP_ID_ROOT, '[slug]', 'page.tsx')
    expect(existsSync(p)).toBe(true)
  })

  it('app/id/[slug]/md/[id]/page.tsx is the canonical per-matchday render', () => {
    const p = path.join(APP_ID_ROOT, '[slug]', 'md', '[id]', 'page.tsx')
    expect(existsSync(p)).toBe(true)
  })

  it('app/id/ has no static sibling directories that could shadow [slug]', () => {
    // Regression target: a developer creating `src/app/id/foo/page.tsx`
    // would silently route `/id/foo` to that page instead of resolving
    // it as a league slug. Keep the `/id/` namespace clean — only
    // `[slug]` should live there.
    const fs = require('node:fs') as typeof import('node:fs')
    const entries = fs.readdirSync(APP_ID_ROOT, { withFileTypes: true })
    const dirNames = entries.filter((e) => e.isDirectory()).map((e) => e.name)
    expect(dirNames).toEqual(['[slug]'])
  })
})

describe('v1.54.0 — top-level platform routes still exist (sanity, not load-bearing)', () => {
  // These directories no longer need to be reserved (the `/id/`
  // namespacing isolates tenant URLs from them), but they still need
  // to exist as top-level routes — both legacy redirects (`/league/`,
  // `/matchday/`, `/<slug>` catch-all) and platform routes (`/admin`,
  // `/auth`, etc.). This block is a CI sanity-check that the route
  // tree didn't regress, not a routing-conflict guard.
  it.each([
    'admin',
    'auth',
    'auth-error',
    'join',
    'matchday',
    'account',
    'api',
    'assign-player',
    'dev-login',
    'schedule',
    'stats',
    'league',
    'id',
  ])('app/%s/ exists with a route file (or dynamic child)', (segment) => {
    const dir = path.join(APP_ROOT, segment)
    if (!existsSync(dir)) {
      throw new Error(`expected src/app/${segment}/ to exist`)
    }
    // Either the segment itself has a route file, or it has a dynamic
    // child like [slug] / [id] that owns the routing for it.
    if (dirHasRouteFile(dir)) return
    const fs = require('node:fs') as typeof import('node:fs')
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    const hasRoute = entries.some((e) => {
      if (!e.isDirectory()) return false
      return dirHasRouteFile(path.join(dir, e.name))
    })
    expect(hasRoute).toBe(true)
  })
})
