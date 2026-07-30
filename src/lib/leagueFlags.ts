/**
 * v1.63.0 — per-league public-facing flags (`preseasonMode`, `recruiting`).
 * v1.84.0 — also reads `visibility` so the banner gate can switch from
 * the legacy `recruiting` boolean to the three-tier enum without
 * threading a new fetch through every page consumer.
 *
 * v1.98.0 — also reads `id`, `name`, `abbreviation`, `ballType` so the
 * `getLeaguePageBundle` no longer needs a separate
 * `prisma.league.findUnique` to populate `bundle.league`. Pre-v1.98.0
 * that standalone read fired on every league-scoped render (apex,
 * /id/<slug>, /id/<slug>/md/<id>, /id/<slug>/join), uncached, even
 * though `getLeagueFlags` already hit the same row and was cached
 * under the `leagues` tag. Folding the four extra columns onto the
 * existing cached read costs nothing — same query plan, same row, same
 * 30 s TTL — and removes one Prisma round-trip per render. Returned
 * shape is augmented with `league: { id, name, abbreviation, ballType }
 * | null` so the bundle can read both safety + identity from a single
 * call.
 *
 * Reads the toggles for a given leagueId. Cached for 30s under the
 * canonical `'leagues'` tag so admin writes (which always bust this tag
 * via the v1.16.0 `revalidate({ domain: 'admin' })` helper) propagate to
 * public reads on the next render.
 *
 * Defaults to `{ preseasonMode: false, recruiting: false, visibility:
 * 'PUBLIC_CLOSED', league: null }` if the league row is missing or
 * Prisma fails. The classic-homepage path is the default behavior
 * across the entire codebase pre-v1.63.0; a transient Prisma blip
 * should not flip an in-season league into pre-season mode for the
 * duration of the blip. `PUBLIC_CLOSED` is the safe visibility default
 * — it leaves the banner hidden (the gate is `=== 'PUBLIC_OPEN'`)
 * without 403'ing the league page itself. `league: null` mirrors the
 * pre-v1.98.0 `bundle.league` shape (which was `null` on missing-row
 * or Prisma failure).
 */
import { prisma } from '@/lib/prisma'
import { unstable_cache } from 'next/cache'

export type LeagueVisibilityFlag = 'PRIVATE' | 'PUBLIC_CLOSED' | 'PUBLIC_OPEN'

export interface LeagueFlags {
  preseasonMode: boolean
  recruiting: boolean
  visibility: LeagueVisibilityFlag
  /**
   * v1.98.0 — identity columns folded onto the cached flag read. `null`
   * when the league row is missing or the Prisma read failed, matching
   * the pre-v1.98.0 `bundle.league` contract that `getLeaguePageBundle`
   * exposed via a separate uncached `prisma.league.findUnique`.
   */
  league: {
    id: string
    name: string
    abbreviation: string | null
    ballType: 'SOCCER' | 'FUTSAL'
  } | null
}

const DEFAULT_FLAGS: LeagueFlags = {
  preseasonMode: false,
  recruiting: false,
  visibility: 'PUBLIC_CLOSED',
  league: null,
}

/**
 * v2.4.0 — deliberately does NOT catch; see the note on `getLeagueFlags`
 * below. The failure has to escape the cache wrapper so it is not the value
 * that gets stored.
 */
async function readLeagueFlags(leagueId: string): Promise<LeagueFlags> {
  const row = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      name: true,
      abbreviation: true,
      ballType: true,
      preseasonMode: true,
      recruiting: true,
      visibility: true,
    },
  })
  if (!row) return DEFAULT_FLAGS
  return {
    preseasonMode: row.preseasonMode ?? false,
    recruiting: row.recruiting ?? false,
    visibility: (row.visibility ?? 'PUBLIC_CLOSED') as LeagueVisibilityFlag,
    league: {
      id: row.id,
      name: row.name,
      abbreviation: row.abbreviation,
      ballType: row.ballType,
    },
  }
}

// v2.4.0 (Neon awake-time reduction, step 4) — TTL raised 30s → 900s.
// This reader is on every public page, and at 30s it was the reader most
// responsible for keeping the Neon branch awake: a TTL shorter than the
// 300s autosuspend window means stale-refresh reads re-wake compute before
// it can suspend. Admin writes bust the `leagues` tag immediately via
// `revalidate({ domain })`, so flag flips still propagate within seconds
// — the timer is belt-and-suspenders only.
const getLeagueFlagsCached = unstable_cache(
  readLeagueFlags,
  ['league-flags'],
  { revalidate: 900, tags: ['leagues'] },
)

/**
 * v2.4.0 — the "default OFF on failure" catch moved OUT of the reader to
 * here, outside the cache wrapper. At the old 30s TTL a swallowed error
 * cached `DEFAULT_FLAGS` for half a minute; at 900s the same blip would
 * pin the homepage to `visibility: 'PUBLIC_CLOSED'` with no league identity
 * for a full 15 minutes — banner gone, title fallen back to the hardcoded
 * default. Letting the rejection escape `unstable_cache` means nothing is
 * stored and the next request retries, while callers keep the unchanged
 * never-throws contract. `DEFAULT_FLAGS` for a genuinely missing row is
 * still cached, which is correct.
 */
export async function getLeagueFlags(leagueId: string): Promise<LeagueFlags> {
  try {
    return await getLeagueFlagsCached(leagueId)
  } catch (err) {
    console.warn('[leagueFlags] read failed; defaulting OFF:', err)
    return DEFAULT_FLAGS
  }
}

// Test seam — exposes the uncached implementation for unit tests.
// Production code goes through `getLeagueFlags`.
export const __readLeagueFlags_for_testing = readLeagueFlags
