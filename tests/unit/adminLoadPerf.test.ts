import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

/**
 * v1.58.0 (PR 5 of route-shortening chain) — /admin load perf
 * structural assertions.
 *
 * Two targeted optimizations:
 *
 *   1. `getAllLeagues()` in src/lib/admin-data.ts trims the Match
 *      include from `include: { matches: true }` to a `select`
 *      projection that picks only `status`. Cuts ~14 fields per Match
 *      row from the wire payload. Important on cold-Neon-Vercel paths
 *      where every JSON byte counts; warm hits are already cached.
 *
 *   2. JWT callback in src/lib/auth.ts skips `getDefaultLeagueId()` +
 *      `getPlayerMapping()` when there's no `token.lineId`. Non-LINE
 *      sessions (admin-credentials, Google, email) get a noticeably
 *      tighter callback path post-v1.58.0.
 */

const ROOT = process.cwd()

function read(p: string): string {
  return readFileSync(path.join(ROOT, p), 'utf-8')
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
}

describe('v1.58.0 — getAllLeagues uses minimal select projection', () => {
  const dataPath = 'src/lib/admin-data.ts'

  it('uses select: instead of include: at the top level', () => {
    const src = stripComments(read(dataPath))
    // The cached wrapper passes `select: { id, name, subdomain, endDate, gameWeeks: ... }`
    // to the prisma.league.findMany call.
    expect(src).toMatch(/getAllLeagues[\s\S]{0,400}prisma\.league\.findMany\(\{\s*select:/)
  })

  it('matches projection trims to status only (regression target — pre-v1.58.0 had `matches: true`)', () => {
    const src = stripComments(read(dataPath))
    // Look for the matches: { select: { status: true } } pattern inside the getAllLeagues block.
    expect(src).toMatch(/getAllLeagues[\s\S]{0,1000}matches:\s*\{\s*select:\s*\{\s*status:\s*true\s*\}/)
    // Regression: the pre-v1.58.0 `matches: true` shape (full row) must not survive
    // in the getAllLeagues call. Other queries can still use `matches: true`.
    const getAllBlock = src.match(/getAllLeagues[\s\S]{0,1500}\)\s*,\s*\['all-leagues'\]/)
    expect(getAllBlock).toBeTruthy()
    if (getAllBlock) {
      expect(getAllBlock[0]).not.toMatch(/matches:\s*true/)
    }
  })

  it('selects only the league fields actually rendered on the dashboard', () => {
    const src = stripComments(read(dataPath))
    // The select must include: id, name, subdomain, endDate (League level)
    // and gameWeeks → weekNumber, startDate, venue.name, matches.status.
    expect(src).toMatch(/getAllLeagues[\s\S]{0,500}id:\s*true/)
    expect(src).toMatch(/getAllLeagues[\s\S]{0,500}name:\s*true/)
    expect(src).toMatch(/getAllLeagues[\s\S]{0,500}subdomain:\s*true/)
    expect(src).toMatch(/getAllLeagues[\s\S]{0,500}endDate:\s*true/)
  })

  it('preserves the unstable_cache wrapper + 30s revalidate + leagues tag', () => {
    const src = stripComments(read(dataPath))
    expect(src).toMatch(/getAllLeagues[\s\S]{0,1500}\['all-leagues'\]/)
    expect(src).toMatch(/getAllLeagues[\s\S]{0,1500}revalidate:\s*30/)
    expect(src).toMatch(/getAllLeagues[\s\S]{0,1500}tags:\s*\['leagues'\]/)
  })
})

describe('v1.58.0 — JWT callback skips league lookup when no lineId', () => {
  const authPath = 'src/lib/auth.ts'

  it('JWT branches on token.lineId before calling getDefaultLeagueId', () => {
    const src = stripComments(read(authPath))
    // The new shape is: `if (!token.lineId) { ... } else { ... getDefaultLeagueId ... }`
    expect(src).toMatch(/if\s*\(\s*!token\.lineId\s*\)\s*\{[\s\S]{0,400}token\.leagueId\s*=\s*null/)
  })

  it('non-LINE branch nulls leagueId/playerId/playerName/teamId on the token', () => {
    const src = stripComments(read(authPath))
    // The early-return for non-LINE sessions sets all four fields to null.
    const branchMatch = src.match(/if\s*\(\s*!token\.lineId\s*\)\s*\{([\s\S]{0,500})\}/)
    expect(branchMatch).toBeTruthy()
    if (branchMatch) {
      const body = branchMatch[1]
      expect(body).toMatch(/token\.leagueId\s*=\s*null/)
      expect(body).toMatch(/token\.playerId\s*=\s*null/)
      expect(body).toMatch(/token\.playerName\s*=\s*null/)
      expect(body).toMatch(/token\.teamId\s*=\s*null/)
    }
  })

  it('LINE-id branch still reaches getDefaultLeagueId + getPlayerMapping', () => {
    const src = stripComments(read(authPath))
    expect(src).toMatch(/getDefaultLeagueId/)
    expect(src).toMatch(/getPlayerMapping\(/)
  })
})
