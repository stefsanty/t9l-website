import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, statSync, readdirSync } from 'fs'
import path from 'path'

/**
 * v1.54.0 — route shortening regression suite.
 *
 * The user's design: every tenant URL is namespaced under `/id/<slug>`
 * (and `/id/<slug>/md/<id>`) so league slugs can never shadow top-level
 * platform routes. Pre-v1.54.0 the canonical render was `/league/<slug>`
 * (with `/<slug>` as a short alias). Both legacy entry points are now
 * 308-redirects to the new `/id/` namespace.
 *
 * This file pins the v1.54.0 contracts as a single regression block:
 *
 *   1. The `/id/[slug]` and `/id/[slug]/md/[id]` routes exist + render.
 *   2. Every legacy tenant URL form has a 308-redirect to the new form.
 *   3. The legacy redirects do NOT render Dashboard.
 *   4. CopyMatchdayLink builds the v1.54.0 URL form.
 *   5. Internal navigation (LeagueSwitcher, AccountMenuLeagueSwitch)
 *      uses the v1.54.0 URL form.
 *   6. Admin CreateLeagueModal preview uses `/id/<slug>` form.
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

describe('v1.54.0 — /id/ tenant namespace is the canonical render', () => {
  it('app/id/[slug]/page.tsx exists and renders Dashboard via getLeagueIdBySlug', () => {
    const src = read('src/app/id/[slug]/page.tsx')
    expect(src).toMatch(/getLeagueIdBySlug/)
    expect(src).toMatch(/<Dashboard/)
    expect(src).toMatch(/notFound/)
  })

  it('app/id/[slug]/md/[id]/page.tsx exists and renders Dashboard with initialMatchdayId', () => {
    const src = read('src/app/id/[slug]/md/[id]/page.tsx')
    expect(src).toMatch(/getLeagueIdBySlug/)
    expect(src).toMatch(/<Dashboard/)
    expect(src).toMatch(/initialMatchdayId=\{md\.id\}/)
  })

  it('app/id/ has only the [slug] dynamic segment (no static siblings to shadow it)', () => {
    const idDir = path.join(ROOT, 'src/app/id')
    const entries = readdirSync(idDir, { withFileTypes: true })
    const dirNames = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()
    // Regression target: a developer adding `src/app/id/foo/page.tsx`
    // would silently route `/id/foo` to that page instead of resolving
    // it as a league slug. Keep the namespace clean.
    expect(dirNames).toEqual(['[slug]'])
  })
})

describe('v1.54.0 — legacy tenant URLs all 308-redirect to /id/<slug>', () => {
  it('/league/[slug]/page.tsx redirects to /id/<slug> and does NOT render Dashboard', () => {
    const src = read('src/app/league/[slug]/page.tsx')
    const noComments = stripComments(src)
    expect(noComments).not.toMatch(/<Dashboard/)
    expect(noComments).not.toMatch(/<Dashboard/)
    expect(src).toMatch(/redirect\(\s*`\/id\/\$\{[^}]+\}`\s*\)/)
    expect(src).toMatch(/normalizeLeagueSlug/)
  })

  it('/league/[slug]/md/[id]/page.tsx redirects to /id/<slug>/md/<id> and does NOT render Dashboard', () => {
    const src = read('src/app/league/[slug]/md/[id]/page.tsx')
    const noComments = stripComments(src)
    expect(noComments).not.toMatch(/<Dashboard/)
    expect(src).toMatch(/redirect\(\s*`\/id\/\$\{[^}]+\}\/md\/\$\{[^}]+\}`\s*\)/)
  })

  it('/[slug]/page.tsx redirects to /id/<slug> and does NOT render Dashboard', () => {
    const src = read('src/app/[slug]/page.tsx')
    const noComments = stripComments(src)
    expect(noComments).not.toMatch(/<Dashboard/)
    expect(src).toMatch(/redirect\(\s*`\/id\/\$\{[^}]+\}`\s*\)/)
    expect(src).toMatch(/normalizeLeagueSlug/)
  })

  it('/matchday/[id]/page.tsx redirects to /id/<slug>/md/<id> (was /league/<slug>/md/<id> pre-v1.54.0)', () => {
    const src = read('src/app/matchday/[id]/page.tsx')
    expect(src).toMatch(/redirect\(\s*`\/id\/\$\{[^}]+\}\/md\/\$\{[^}]+\}`\s*\)/)
    // Regression: the pre-v1.54.0 redirect target must NOT remain.
    expect(stripComments(src)).not.toMatch(/redirect\(\s*`\/league\//)
  })
})

describe('v1.54.0 — apex `/` keeps rendering default league directly (no redirect)', () => {
  it('app/page.tsx does NOT redirect to /id/<slug>', () => {
    const src = stripComments(read('src/app/page.tsx'))
    expect(src).not.toMatch(/redirect\(/)
  })

  it('app/page.tsx still renders Dashboard with leagueSlug={DEFAULT_LEAGUE_SLUG}', () => {
    const src = read('src/app/page.tsx')
    expect(src).toMatch(/<Dashboard/)
    expect(src).toMatch(/leagueSlug=\{DEFAULT_LEAGUE_SLUG\}/)
  })
})

describe('v1.54.0 — internal callers use /id/<slug> URL form', () => {
  it('CopyMatchdayLink composes /id/<slug>/md/<id>', () => {
    const src = read('src/components/CopyMatchdayLink.tsx')
    expect(src).toMatch(/window\.location\.origin/)
    expect(src).toMatch(/\/id\/\$\{slug\}\/md\/\$\{matchdayId\}/)
    // Regression: must not still build the v1.51.0 form.
    expect(stripComments(src)).not.toMatch(/window\.location\.origin[^`]*`\/league\//)
  })

  it('LeagueSwitcher router.push uses /id/<slug>', () => {
    const src = read('src/components/LeagueSwitcher.tsx')
    expect(src).toMatch(/router\.push\(`\/id\/\$\{m\.slug\}`\)/)
    expect(stripComments(src)).not.toMatch(/router\.push\(`\/league\//)
  })

  it('AccountMenuLeagueSwitch href uses /id/<slug>', () => {
    const src = read('src/components/AccountMenuLeagueSwitch.tsx')
    expect(src).toMatch(/href=\{`\/id\/\$\{m\.slug\}`\}/)
    expect(stripComments(src)).not.toMatch(/href=\{`\/league\//)
  })
})

describe('v1.54.0 — admin CreateLeagueModal preview uses /id/<slug>', () => {
  it('URL preview prefix is `/id/`, not `/league/`', () => {
    const src = read('src/components/admin/CreateLeagueModal.tsx')
    // The two visible URL hints in the modal — the inline prefix and the
    // status-row preview — both display `/id/<slug>`.
    expect(src).toMatch(/>\/id\/</)
    expect(src).toMatch(/\/id\/\{subdomain\}/)
    // Regression: the v1.51.0 form must NOT still appear in the modal.
    expect(stripComments(src)).not.toMatch(/>\/league\/</)
    expect(stripComments(src)).not.toMatch(/\/league\/\{subdomain\}/)
  })

  it('warning copy reflects the slim post-v1.54.0 reserved set (mentions "id" reserved)', () => {
    const src = read('src/components/admin/CreateLeagueModal.tsx')
    expect(src).toMatch(/"id" is reserved/)
    // Regression: the old "Reserved words (admin, auth, api, ...)" copy
    // must be gone — it's both inaccurate post-v1.54.0 (those slugs are
    // now allowed) and confusing.
    expect(stripComments(src)).not.toMatch(/admin, auth, api/)
  })
})

describe('v1.54.0 — sanity: route file shape (the file tree didn\'t regress)', () => {
  function dirHasRouteFile(dir: string): boolean {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return false
    const candidates = [
      'page.tsx', 'page.ts', 'route.ts', 'layout.tsx', 'layout.ts',
    ]
    return candidates.some((c) => existsSync(path.join(dir, c)))
  }

  it.each([
    'src/app/page.tsx',
    'src/app/id/[slug]/page.tsx',
    'src/app/id/[slug]/md/[id]/page.tsx',
    'src/app/league/[slug]/page.tsx',
    'src/app/league/[slug]/md/[id]/page.tsx',
    'src/app/[slug]/page.tsx',
    'src/app/matchday/[id]/page.tsx',
  ])('%s exists', (relPath) => {
    expect(existsSync(path.join(ROOT, relPath))).toBe(true)
  })

  it('top-level platform routes still resolve (CI guard for future regressions)', () => {
    const platformSegments = [
      'admin', 'auth', 'auth-error', 'join', 'matchday', 'account',
      'api', 'assign-player', 'dev-login', 'schedule', 'stats',
      'league', 'id',
    ]
    for (const seg of platformSegments) {
      const dir = path.join(ROOT, 'src/app', seg)
      expect(existsSync(dir)).toBe(true)
      // Either the segment owns a route file, or it has a dynamic
      // child like `[slug]` that does.
      if (dirHasRouteFile(dir)) continue
      const entries = readdirSync(dir, { withFileTypes: true })
      const hasRouteUnder = entries.some((e) => {
        if (!e.isDirectory()) return false
        return dirHasRouteFile(path.join(dir, e.name))
      })
      expect(hasRouteUnder).toBe(true)
    }
  })
})
