/**
 * v2.0.0 — Redis-backed per-(viewerKey, leagueId) cache for the league
 * dashboard bundle.
 *
 * Pre-v2.0.0 every render of `/id/<slug>` or `<MultiLeagueHub>` ran
 * the full `getLeaguePageBundle` Promise.all (publicData + flags +
 * recruitingViewerState + unpaidFee + plannedRosterStats +
 * leagueDetails). Each leg has its own `unstable_cache` warm-state,
 * but the slowest legs are per-user (recruitingViewerState + unpaidFee
 * — uncached because they depend on the viewer's identity) and the
 * combined critical path was 3–6 s warm on real browser measurements
 * (see v1.99.0 ledger). v1.99.0 streamed the body but didn't reduce
 * the body-stream time itself; this PR caches the whole bundle so a
 * repeat viewer renders from Redis (~30–80 ms) instead of re-running
 * the Promise.all.
 *
 * Architecture:
 *
 *   - Global integer version counter at `t9l:dash:ver`. Bumped via
 *     `bumpDashboardVersion()` on every `revalidate({ domain })`
 *     call. Per-league version-bumps were considered but rejected:
 *     there are ~100 `revalidate()` call sites in the codebase and
 *     retrofitting a `leagueIds` parameter on each is its own large
 *     refactor. A global bump invalidates ALL leagues' caches on any
 *     write, but the 60 s TTL bounds staleness either way and the
 *     dominant traffic shape (many concurrent reads per write) means
 *     the global bump only causes a brief cache-warm-up window — the
 *     winning property is that no stale data survives a write at all.
 *
 *   - Per-(leagueId, viewerKey) bundle entry at
 *     `t9l:dash:v<version>:<leagueId>:<viewerKey>`. The version
 *     prefix means version bumps invalidate every key without any
 *     SCAN+DEL — the old entries just become unreadable and expire
 *     naturally over their 60 s TTL.
 *
 *   - 60 s TTL on bundle entries. Picked because (a) it's well below
 *     the perceived freshness floor for league data (RSVPs, scores,
 *     etc.), and (b) any explicit invalidate via `revalidate()` bumps
 *     the version anyway, so the TTL is a safety net not the primary
 *     freshness mechanism.
 *
 *   - `viewerKey`:
 *       - authenticated by NextAuth User id → `userId`
 *       - authenticated by LINE-only (grandfathered pre-α.5) →
 *         `line:<lineId>`
 *       - unauthenticated → `anon`
 *     The anon key collapses all unauthenticated visitors into one
 *     cache entry per league (their bundles are bit-identical because
 *     recruitingViewerState + unpaidFee are no-op surfaces for them).
 *
 *   - Graceful degrade: every Redis read/write is wrapped in
 *     try/catch + console.warn. On Redis unavailability the helper
 *     falls through to the live fetcher — same correctness, just no
 *     speed-up.
 *
 *   - In-process version cache (5 s) deduplicates the per-render
 *     version GET across concurrent renders in the same lambda
 *     instance. Wrapped in React's `cache()` for the per-request
 *     dedup AND a process-local 5 s TTL via a module-scoped Map so
 *     bursts of concurrent renders don't all pay the version round
 *     trip. The 5 s window is sub-TTL so worst-case staleness is
 *     min(5 s in-proc + 60 s Redis TTL, version-bump propagation).
 */
import { cache } from 'react'

import type { LeaguePageBundle } from '@/lib/leaguePageData'

// Same minimal interface shape `playerMappingStore` uses so the
// dashboard cache can be swapped for a fake in tests without
// pulling `@upstash/redis` into Vitest setup.
export type RedisLike = {
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string, opts: { ex: number }) => Promise<unknown>
  incr: (key: string) => Promise<number>
}

const VERSION_KEY = 't9l:dash:ver'
const BUNDLE_KEY_PREFIX = 't9l:dash:v'
const BUNDLE_TTL_SECONDS = 60
const VERSION_LOCAL_CACHE_MS = 5_000

let testClientOverride: RedisLike | null = null
let cachedClient: RedisLike | null | undefined = undefined

/** Test seam — pass null to clear. Production code never calls this. */
export function __setDashboardCacheClientForTesting(
  client: RedisLike | null,
): void {
  testClientOverride = client
  cachedClient = undefined
  __resetVersionLocalCacheForTesting()
}

async function getClient(): Promise<RedisLike | null> {
  if (testClientOverride) return testClientOverride
  if (cachedClient !== undefined) return cachedClient
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    cachedClient = null
    return null
  }
  try {
    const { Redis } = await import('@upstash/redis')
    cachedClient = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    }) as unknown as RedisLike
    return cachedClient
  } catch {
    cachedClient = null
    return null
  }
}

interface VersionCacheEntry {
  value: number
  expiresAt: number
}

let versionLocalCache: VersionCacheEntry | null = null

export function __resetVersionLocalCacheForTesting(): void {
  versionLocalCache = null
}

/**
 * Derive the cache version key. Reads through a 5 s process-local
 * cache; on miss reads Redis; on Redis miss or error returns `0` so
 * the first bump (Redis INCR on a missing key → 1) produces a
 * distinct version. The bundle keys incorporate this version, so
 * version bumps invalidate without any explicit DEL.
 *
 * Why default 0 and not 1: Redis `INCR` on a missing key sets the
 * key to 0 then increments to 1. If we defaulted to 1 in-process,
 * the very first bump would produce version 1 too — same key, no
 * invalidation. Starting from 0 means the first bump moves us to
 * v1, the second to v2, and so on, monotonic forever.
 */
async function getCacheVersion(): Promise<number> {
  const now = Date.now()
  if (versionLocalCache && versionLocalCache.expiresAt > now) {
    return versionLocalCache.value
  }
  const client = await getClient()
  if (!client) {
    versionLocalCache = { value: 0, expiresAt: now + VERSION_LOCAL_CACHE_MS }
    return 0
  }
  try {
    const raw = await client.get(VERSION_KEY)
    const parsed = raw === null || raw === undefined ? 0 : Number(raw)
    const value = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
    versionLocalCache = { value, expiresAt: now + VERSION_LOCAL_CACHE_MS }
    return value
  } catch (err) {
    console.warn('[dashboardCache] version GET failed:', err)
    versionLocalCache = { value: 0, expiresAt: now + VERSION_LOCAL_CACHE_MS }
    return 0
  }
}

/**
 * Build the per-(viewer, league) cache key. Exported for tests.
 */
export function buildBundleKey(
  version: number,
  leagueId: string,
  viewerKey: string,
): string {
  return `${BUNDLE_KEY_PREFIX}${version}:${leagueId}:${viewerKey}`
}

/**
 * Build a stable viewerKey from session identifiers. Exported for
 * tests and for callers that need to scope follow-up state to the
 * same key shape.
 *
 *   - `userId` present (canonical post-α.5) → `userId`
 *   - `userId` absent + `lineId` present (grandfathered) →
 *     `line:<lineId>`
 *   - both absent (anon, admin-credentials) → `anon`
 */
export function buildViewerKey(input: {
  userId?: string | null
  lineId?: string | null
}): string {
  if (input.userId) return input.userId
  if (input.lineId) return `line:${input.lineId}`
  return 'anon'
}

/**
 * Read-through wrapper. Returns the cached bundle on hit, falls
 * through to the supplied `fetcher` on miss / Redis error and writes
 * the result back with a 60 s TTL.
 *
 * `fetcher` is called at most once per (leagueId, viewerKey) inside
 * a single React render boundary thanks to React's `cache()` wrapping
 * upstream in `getLeaguePageBundle`. The Redis layer adds another
 * level of dedup across concurrent renders in the same lambda.
 */
export async function getCachedBundle(
  leagueId: string,
  viewerKey: string,
  fetcher: () => Promise<LeaguePageBundle | null>,
): Promise<LeaguePageBundle | null> {
  const client = await getClient()
  if (!client) return fetcher()

  const version = await getCacheVersion()
  const key = buildBundleKey(version, leagueId, viewerKey)

  let raw: string | null = null
  try {
    raw = await client.get(key)
  } catch (err) {
    console.warn('[dashboardCache] GET failed for', key, err)
  }

  if (raw !== null && raw !== undefined) {
    const parsed = parseBundle(raw)
    if (parsed !== null) return parsed
  }

  const fresh = await fetcher()
  if (fresh === null) return null

  try {
    await client.set(key, JSON.stringify(fresh), { ex: BUNDLE_TTL_SECONDS })
  } catch (err) {
    console.warn('[dashboardCache] SET failed for', key, err)
  }

  return fresh
}

/**
 * Pure parser. Upstash's REST client may return either a raw string
 * or an already-parsed object depending on the value's serialized
 * shape; both paths normalise to the typed bundle.
 */
function parseBundle(raw: string | object): LeaguePageBundle | null {
  try {
    if (typeof raw === 'object' && raw !== null) {
      return raw as LeaguePageBundle
    }
    return JSON.parse(raw as string) as LeaguePageBundle
  } catch {
    return null
  }
}

/**
 * Bump the global version, invalidating every cached bundle.
 * Fire-and-forget by design — callers from `revalidate()` should
 * never wait on it (the user already gets fresh data via the
 * existing Next.js tag invalidation; this just additionally bypasses
 * the dashboard cache on the next render).
 *
 * Also clears the in-process version cache so the same lambda
 * instance sees the bump on the very next render, not 5 s later.
 */
export async function bumpDashboardVersion(): Promise<void> {
  versionLocalCache = null
  const client = await getClient()
  if (!client) return
  try {
    await client.incr(VERSION_KEY)
  } catch (err) {
    console.warn('[dashboardCache] INCR failed:', err)
  }
}

/**
 * Synchronous, fire-and-forget bump used by `revalidate()` so the
 * caller doesn't await Redis on the response critical path. Errors
 * are caught and warned at the same level as the async path.
 */
export function bumpDashboardVersionAsync(): void {
  bumpDashboardVersion().catch(() => {
    /* already logged inside */
  })
}

/**
 * Wrap a per-render viewer-key derivation so callers can share the
 * same key shape without re-computing it in each page. Wrapped in
 * React `cache()` so a single render's multiple call sites resolve
 * once.
 */
export const getDashboardCacheViewerKey = cache(
  (input: { userId?: string | null; lineId?: string | null }): string => {
    return buildViewerKey(input)
  },
)
