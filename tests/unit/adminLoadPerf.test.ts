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
  const dataPath = 'src/lib/admin-data/leagues.ts'

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

// v1.61.0 — the v1.58.0 perf optimization that gated `getDefaultLeagueId`
// + `getPlayerMapping` behind `if (!token.lineId)` is REVERTED. v1.61.0
// surfaces `session.allowSelfLink` (per-league `League.allowSelfLink`
// toggle) on every JWT callback regardless of provider; the helper read
// is the source of the toggle, so it has to run for non-LINE sessions
// too. Additionally v1.61.0 introduces a `getPlayerMappingByUserId`
// resolver that runs in the non-LINE branch (Google / email post-link)
// so `session.playerId` populates for them too. Cost: one cached
// (`unstable_cache` + `'leagues'` tag) read on the warm path; one
// Prisma round-trip per JWT refresh for non-LINE users with a
// User.playerId binding.
describe('v1.61.0 — JWT callback resolves leagueId for both LINE and non-LINE sessions', () => {
  const authPath = 'src/lib/auth.ts'

  it('always reaches getDefaultLeagueId (v1.58.0 short-circuit reverted)', () => {
    const src = stripComments(read(authPath))
    expect(src).toMatch(/getDefaultLeagueId/)
    // Regression target: the v1.58.0 `if (!token.lineId)` short-circuit
    // that nulled leagueId before any helper call must NOT survive in
    // v1.61.0. The helper now runs for both branches.
    expect(src).not.toMatch(/if\s*\(\s*!token\.lineId\s*\)\s*\{\s*token\.leagueId\s*=\s*null/)
  })

  it('LINE branch reaches getPlayerMapping with leagueId', () => {
    const src = stripComments(read(authPath))
    expect(src).toMatch(/getPlayerMapping\(/)
  })

  it('non-LINE branch reaches getPlayerMappingByUserId (v1.61.0)', () => {
    const src = stripComments(read(authPath))
    expect(src).toMatch(/getPlayerMappingByUserId\(/)
  })

  it('JWT callback reads getLeagueAllowSelfLink and surfaces token.allowSelfLink', () => {
    const src = stripComments(read(authPath))
    expect(src).toMatch(/getLeagueAllowSelfLink/)
    expect(src).toMatch(/token\.allowSelfLink\s*=/)
  })
})
