import { describe, it, expect } from 'vitest'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * v1.80.2 — Phase 1 of the perf audit (handover-perf-audit.md):
 *
 *   C1  Bfcache reload listener removed from src/app/layout.tsx
 *   H5  /stats page parallelizes leagueFlags + publicData + unpaidFee
 *   M1  publicData unstable_cache revalidate raised 30 → 300
 *   H1  Stefan/Riki/Fenix public PNGs re-encoded down to <100 KB
 *
 * Each assertion fails on the pre-fix state. Verified by stash-pop sanity
 * check during PR authoring. Tests read source files (not mocks) so any
 * regression that reintroduces the broken pattern shows up here.
 */

const ROOT = path.resolve(__dirname, '../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

describe('perf phase 1 — C1: bfcache reload listener deleted', () => {
  const layout = read('src/app/layout.tsx')

  it('does not contain the pageshow.persisted reload snippet', () => {
    // Pre-fix: the layout shipped a window.addEventListener('pageshow', ...)
    // handler that called window.location.reload() on bfcache restore,
    // turning every back/forward navigation into a full TTFB + JS parse +
    // font fetch instead of the ~50ms bfcache snapshot restore.
    expect(layout).not.toMatch(/addEventListener\(\s*['"]pageshow['"]/)
    expect(layout).not.toMatch(/e\.persisted/)
    expect(layout).not.toMatch(/window\.location\.reload/)
  })
})

describe('perf phase 1 — H5: /stats parallelizes server fetches', () => {
  const stats = read('src/app/stats/page.tsx')

  it('does not await getLeagueFlags sequentially before publicData', () => {
    // Pre-fix: the page did `const flags = await getLeagueFlags(leagueId)`
    // BEFORE the Promise.all, adding a synchronous round trip on every
    // /stats render. Post-fix: getLeagueFlags is one of three legs in the
    // single Promise.all and the redirect check moves below it.
    expect(stats).not.toMatch(/const\s+flags\s*=\s*await\s+getLeagueFlags/)
  })

  it('fans flags + publicData + unpaidFee out via Promise.all', () => {
    // The Promise.all destructures all three. The arg list contains
    // getLeagueFlags, getPublicLeagueData, and getUnpaidFeeBannerData
    // calls — order-agnostic check.
    expect(stats).toMatch(/Promise\.all\(/)
    expect(stats).toMatch(/getLeagueFlags\(/)
    expect(stats).toMatch(/getPublicLeagueData\(/)
    expect(stats).toMatch(/getUnpaidFeeBannerData\(/)
  })
})

describe('perf phase 1 — M1: publicData revalidate raised (30s → 300s → 900s)', () => {
  const publicData = read('src/lib/publicData.ts')

  it('configures unstable_cache with revalidate: 900', () => {
    // Pre-fix value was 30 — pure belt-and-suspenders given that every
    // admin write busts the same tags via lib/revalidate.ts. Raising to
    // 300s (v1.80.2) then 900s (v2.4.0) keeps the cache hot longer with no
    // correctness change.
    //
    // v2.4.0 adds a hard floor to this pin: the TTL must stay ABOVE the
    // Neon branch's autosuspend window (300s on the current plan), or
    // stale-refresh reads re-wake compute before it can suspend and the
    // cache stops saving anything. If you lower this value, check the Neon
    // suspend timeout first.
    expect(publicData).toMatch(/revalidate:\s*900\b/)
    expect(publicData).not.toMatch(/revalidate:\s*(30|60|300)\b(?!\d)/)
  })
})

describe('perf phase 1 — H1: oversized PNGs re-encoded under 100 KB', () => {
  const targets = [
    'public/player_pics/Stefan.png',
    'public/player_pics/Riki Imai.png',
    'public/team_logos/Fenix FC.png',
  ]

  for (const rel of targets) {
    it(`${rel} is under 100 KB`, () => {
      // Pre-fix sizes: Stefan 502 KB, Riki Imai 305 KB, Fenix FC 259 KB.
      // The audit identified these three as the top oversized public
      // assets. 100 KB ceiling leaves headroom for future logo updates
      // without making this test a churn magnet.
      const bytes = statSync(path.join(ROOT, rel)).size
      expect(bytes).toBeLessThan(100 * 1024)
    })
  }
})
