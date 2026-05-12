/**
 * v2.0.0 — Redis-backed dashboard cache regression targets.
 *
 * Pre-v2.0.0 every `/id/<slug>` / `<MultiLeagueHub>` render ran the
 * full bundle Promise.all (3–6 s warm on real browser measurements
 * per the v1.99.0 ledger). v2.0.0 wraps `getLeaguePageBundle` in a
 * Redis read-through cache keyed by `(viewerKey, leagueId)` with a
 * 60 s TTL and a global version-bump invalidation strategy chained
 * off `revalidate({ domain })`.
 *
 * Each assertion is a regression target. Stash-pop sanity verified.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')

const VERSION_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/version.ts'),
  'utf8',
)
const CLAUDE_MD = readFileSync(join(REPO_ROOT, 'CLAUDE.md'), 'utf8')
const LEDGER_MD = readFileSync(
  join(REPO_ROOT, 'docs/ledger.md'),
  'utf8',
)
const DASH_CACHE_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/dashboardCache.ts'),
  'utf8',
)
const REVALIDATE_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/revalidate.ts'),
  'utf8',
)
const BUNDLE_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/leaguePageData.ts'),
  'utf8',
)
const ID_SLUG_PAGE_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/id/[slug]/page.tsx'),
  'utf8',
)
const MULTI_HUB_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/homepage/MultiLeagueHub.tsx'),
  'utf8',
)

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

// ────────────────────────────────────────────────────────────────────────────
// 1) Version pins
// ────────────────────────────────────────────────────────────────────────────

describe('v2.0.0 — version pin', () => {
  it('APP_VERSION reads 2.0.0', () => {
    expect(VERSION_SRC).toMatch(/APP_VERSION\s*=\s*['"]2\.0\.0['"]/)
  })

  it('CLAUDE.md header reflects current release', () => {
    expect(CLAUDE_MD).toMatch(/\*\*Current release:\*\*\s*v2\.0\.0/)
  })

  it('docs/ledger.md top entry is v2.0.0', () => {
    const firstBullet = LEDGER_MD.split('\n').find((line) =>
      line.startsWith('- **v'),
    )
    expect(firstBullet).toBeDefined()
    expect(firstBullet).toMatch(/^- \*\*v2\.0\.0\*\*/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 2) dashboardCache.ts — module surface
// ────────────────────────────────────────────────────────────────────────────

describe('v2.0.0 — dashboardCache module surface', () => {
  it('exports getCachedBundle', () => {
    expect(DASH_CACHE_SRC).toMatch(
      /export\s+async\s+function\s+getCachedBundle/,
    )
  })

  it('exports buildViewerKey', () => {
    expect(DASH_CACHE_SRC).toMatch(/export\s+function\s+buildViewerKey/)
  })

  it('exports buildBundleKey for test seam', () => {
    expect(DASH_CACHE_SRC).toMatch(/export\s+function\s+buildBundleKey/)
  })

  it('exports bumpDashboardVersion + bumpDashboardVersionAsync', () => {
    expect(DASH_CACHE_SRC).toMatch(
      /export\s+async\s+function\s+bumpDashboardVersion\b/,
    )
    expect(DASH_CACHE_SRC).toMatch(
      /export\s+function\s+bumpDashboardVersionAsync\b/,
    )
  })

  it('exports __setDashboardCacheClientForTesting test seam', () => {
    expect(DASH_CACHE_SRC).toMatch(
      /export\s+function\s+__setDashboardCacheClientForTesting/,
    )
  })

  it('uses the canonical KV env vars', () => {
    expect(DASH_CACHE_SRC).toMatch(/process\.env\.KV_REST_API_URL/)
    expect(DASH_CACHE_SRC).toMatch(/process\.env\.KV_REST_API_TOKEN/)
  })

  it('lazy-imports @upstash/redis (no top-level eager load)', () => {
    // Tree-shaking / cold-start guard: the module must NOT have a
    // top-level `import { Redis } from '@upstash/redis'`. Inline
    // `await import(...)` inside getClient() is the pattern.
    expect(DASH_CACHE_SRC).not.toMatch(
      /^import\s+\{[^}]*Redis[^}]*\}\s+from\s+['"]@upstash\/redis['"]/m,
    )
    expect(DASH_CACHE_SRC).toMatch(
      /await\s+import\(\s*['"]@upstash\/redis['"]\s*\)/,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 3) buildViewerKey — viewer key shape
// ────────────────────────────────────────────────────────────────────────────

describe('v2.0.0 — buildViewerKey', () => {
  it('returns userId when present', async () => {
    const { buildViewerKey } = await import('@/lib/dashboardCache')
    expect(buildViewerKey({ userId: 'cuid-1', lineId: null })).toBe('cuid-1')
    // userId wins over lineId when both present
    expect(
      buildViewerKey({ userId: 'cuid-1', lineId: 'U-line' }),
    ).toBe('cuid-1')
  })

  it('returns line:<lineId> when only lineId is present', async () => {
    const { buildViewerKey } = await import('@/lib/dashboardCache')
    expect(buildViewerKey({ userId: null, lineId: 'U12345' })).toBe(
      'line:U12345',
    )
  })

  it('returns "anon" when both ids are null', async () => {
    const { buildViewerKey } = await import('@/lib/dashboardCache')
    expect(buildViewerKey({ userId: null, lineId: null })).toBe('anon')
    expect(buildViewerKey({})).toBe('anon')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 4) buildBundleKey — key shape
// ────────────────────────────────────────────────────────────────────────────

describe('v2.0.0 — buildBundleKey', () => {
  it('returns `t9l:dash:v<version>:<leagueId>:<viewerKey>`', async () => {
    const { buildBundleKey } = await import('@/lib/dashboardCache')
    expect(buildBundleKey(3, 'cuid-league', 'cuid-user')).toBe(
      't9l:dash:v3:cuid-league:cuid-user',
    )
    expect(buildBundleKey(1, 'cuid-l', 'anon')).toBe(
      't9l:dash:v1:cuid-l:anon',
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 5) Read-through cache behaviour
// ────────────────────────────────────────────────────────────────────────────

const fakeBundle = {
  data: {
    teams: [],
    players: [],
    matchdays: [],
    goals: [],
    availability: {},
    availabilityStatuses: {},
    played: {},
    guests: {},
  },
  flags: {
    preseasonMode: false,
    recruiting: false,
    visibility: 'PUBLIC_CLOSED' as const,
    league: {
      id: 'cuid-l',
      name: 'Test League',
      abbreviation: 'TL',
      ballType: 'SOCCER' as const,
    },
  },
  recruitingState: { kind: 'unauthenticated' as const },
  league: {
    id: 'cuid-l',
    name: 'Test League',
    abbreviation: 'TL',
    ballType: 'SOCCER' as const,
  },
  unpaidFee: null,
  plannedRosterStats: null,
  leagueDetails: null,
}

describe('v2.0.0 — getCachedBundle read-through behaviour', () => {
  let store: Map<string, string>
  let fakeClient: {
    get: (k: string) => Promise<string | null>
    set: (k: string, v: string, opts: { ex: number }) => Promise<unknown>
    incr: (k: string) => Promise<number>
  }

  beforeEach(async () => {
    store = new Map()
    fakeClient = {
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => {
        store.set(k, v)
      }),
      incr: vi.fn(async (k: string) => {
        const next = Number(store.get(k) ?? '0') + 1
        store.set(k, String(next))
        return next
      }),
    }
    const mod = await import('@/lib/dashboardCache')
    mod.__setDashboardCacheClientForTesting(fakeClient)
    mod.__resetVersionLocalCacheForTesting()
  })

  afterEach(async () => {
    const mod = await import('@/lib/dashboardCache')
    mod.__setDashboardCacheClientForTesting(null)
  })

  it('miss → calls fetcher → stores result with 60s TTL', async () => {
    const { getCachedBundle } = await import('@/lib/dashboardCache')
    const fetcher = vi.fn(async () => fakeBundle)
    const out = await getCachedBundle('league-1', 'user-1', fetcher)
    expect(out).toEqual(fakeBundle)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fakeClient.set).toHaveBeenCalledTimes(1)
    const setCall = (fakeClient.set as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(setCall[0]).toMatch(/^t9l:dash:v\d+:league-1:user-1$/)
    expect(setCall[2]).toEqual({ ex: 60 })
  })

  it('hit → returns cached value WITHOUT calling fetcher', async () => {
    const { getCachedBundle } = await import('@/lib/dashboardCache')
    const fetcher1 = vi.fn(async () => fakeBundle)
    await getCachedBundle('league-1', 'user-1', fetcher1)
    expect(fetcher1).toHaveBeenCalledTimes(1)
    // Second call with same key should hit cache
    const fetcher2 = vi.fn(async () => fakeBundle)
    const out2 = await getCachedBundle('league-1', 'user-1', fetcher2)
    expect(out2).toEqual(fakeBundle)
    expect(fetcher2).not.toHaveBeenCalled()
  })

  it('different viewerKey → different cache entry → fetcher called', async () => {
    const { getCachedBundle } = await import('@/lib/dashboardCache')
    const fetcher = vi.fn(async () => fakeBundle)
    await getCachedBundle('league-1', 'user-A', fetcher)
    await getCachedBundle('league-1', 'user-B', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('different leagueId → different cache entry → fetcher called', async () => {
    const { getCachedBundle } = await import('@/lib/dashboardCache')
    const fetcher = vi.fn(async () => fakeBundle)
    await getCachedBundle('league-A', 'user-1', fetcher)
    await getCachedBundle('league-B', 'user-1', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('version bump → existing entries become unreachable → fetcher re-called', async () => {
    const { getCachedBundle, bumpDashboardVersion } = await import(
      '@/lib/dashboardCache'
    )
    const fetcher = vi.fn(async () => fakeBundle)
    await getCachedBundle('league-1', 'user-1', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)

    await bumpDashboardVersion()

    // Cache key now incorporates the bumped version → miss → fetcher called again
    await getCachedBundle('league-1', 'user-1', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('fetcher returning null → does NOT write to cache', async () => {
    const { getCachedBundle } = await import('@/lib/dashboardCache')
    const fetcher = vi.fn(async () => null)
    const out = await getCachedBundle('league-1', 'user-1', fetcher)
    expect(out).toBeNull()
    expect(fakeClient.set).not.toHaveBeenCalled()
  })

  it('Redis error on GET → falls through to fetcher (graceful degrade)', async () => {
    const { getCachedBundle } = await import('@/lib/dashboardCache')
    fakeClient.get = vi.fn(async () => {
      throw new Error('upstash boom')
    })
    const fetcher = vi.fn(async () => fakeBundle)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = await getCachedBundle('league-1', 'user-1', fetcher)
    expect(out).toEqual(fakeBundle)
    expect(fetcher).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 6) revalidate() bumps dashboard version
// ────────────────────────────────────────────────────────────────────────────

describe('v2.0.0 — revalidate() chains a dashboard version bump', () => {
  it('imports bumpDashboardVersionAsync from dashboardCache', () => {
    expect(REVALIDATE_SRC).toMatch(
      /import\s*\{\s*bumpDashboardVersionAsync\s*\}\s+from\s+['"]@\/lib\/dashboardCache['"]/,
    )
  })

  it('calls bumpDashboardVersionAsync() inside the exported revalidate function', () => {
    // Regression target: removing the chain would silently let stale
    // dashboard bundles linger up to the 60s TTL even after explicit
    // tag invalidation, defeating the v2.0.0 freshness contract.
    expect(stripComments(REVALIDATE_SRC)).toMatch(
      /export\s+function\s+revalidate[\s\S]+?bumpDashboardVersionAsync\(\)/,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 7) getLeaguePageBundle threads viewerKey through cache
// ────────────────────────────────────────────────────────────────────────────

describe('v2.0.0 — getLeaguePageBundle wires cache when viewerKey supplied', () => {
  it('accepts optional viewerKey parameter', () => {
    expect(BUNDLE_SRC).toMatch(
      /export\s+async\s+function\s+getLeaguePageBundle\([\s\S]*?leagueId\s*:\s*string[\s\S]*?viewerKey\?\s*:\s*string[\s\S]*?\)/,
    )
  })

  it('imports getCachedBundle from dashboardCache', () => {
    expect(BUNDLE_SRC).toMatch(
      /import\s*\{\s*getCachedBundle\s*\}\s+from\s+['"]@\/lib\/dashboardCache['"]/,
    )
  })

  it('routes to getCachedBundle when viewerKey is provided', () => {
    expect(stripComments(BUNDLE_SRC)).toMatch(
      /if\s*\(\s*!viewerKey\s*\)[\s\S]+?getCachedBundle\(\s*leagueId\s*,\s*viewerKey\s*,/,
    )
  })

  it('preserves the live readLeaguePageBundle path for backward compat', () => {
    // Callers that haven't been migrated to thread a viewerKey skip
    // the cache entirely. Regression target: removing this would
    // either force every existing caller to migrate or silently
    // break them with a missing viewerKey.
    expect(BUNDLE_SRC).toMatch(/async\s+function\s+readLeaguePageBundle/)
    expect(stripComments(BUNDLE_SRC)).toMatch(
      /if\s*\(\s*!viewerKey\s*\)\s*\{[\s\S]+?return\s+readLeaguePageBundle\(/,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 8) /id/[slug]/page.tsx + MultiLeagueHub thread viewerKey
// ────────────────────────────────────────────────────────────────────────────

describe('v2.0.0 — /id/[slug]/page.tsx threads viewerKey to bundle', () => {
  it('imports buildViewerKey + getViewer', () => {
    expect(ID_SLUG_PAGE_SRC).toMatch(
      /import\s*\{\s*buildViewerKey\s*\}\s+from\s+['"]@\/lib\/dashboardCache['"]/,
    )
    expect(ID_SLUG_PAGE_SRC).toMatch(
      /import\s*\{\s*getViewer\s*\}\s+from\s+['"]@\/lib\/viewer['"]/,
    )
  })

  it('resolves viewer + computes viewerKey before bundle call', () => {
    const stripped = stripComments(ID_SLUG_PAGE_SRC)
    expect(stripped).toMatch(/const\s+viewer\s*=\s*await\s+getViewer\(\)/)
    expect(stripped).toMatch(
      /const\s+viewerKey\s*=\s*buildViewerKey\(\s*\{[\s\S]*?userId:\s*viewer\.userId[\s\S]*?lineId:\s*viewer\.lineId[\s\S]*?\}\s*\)/,
    )
  })

  it('threads viewerKey into getLeaguePageBundle', () => {
    expect(ID_SLUG_PAGE_SRC).toMatch(
      /getLeaguePageBundle\(\s*leagueId\s*,\s*viewerKey\s*\)/,
    )
  })
})

describe('v2.0.0 — MultiLeagueHub threads viewerKey to bundle', () => {
  it('imports buildViewerKey', () => {
    expect(MULTI_HUB_SRC).toMatch(
      /import\s*\{\s*buildViewerKey\s*\}\s+from\s+['"]@\/lib\/dashboardCache['"]/,
    )
  })

  it('computes viewerKey from viewer + passes to getLeaguePageBundle', () => {
    const stripped = stripComments(MULTI_HUB_SRC)
    expect(stripped).toMatch(
      /const\s+viewerKey\s*=\s*buildViewerKey\(\s*\{[\s\S]*?userId:\s*viewer\.userId[\s\S]*?\}\s*\)/,
    )
    expect(MULTI_HUB_SRC).toMatch(
      /getLeaguePageBundle\(\s*activeLeagueId\s*,\s*viewerKey\s*\)/,
    )
  })
})
