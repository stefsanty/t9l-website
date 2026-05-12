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

async function readLeagueFlags(leagueId: string): Promise<LeagueFlags> {
  try {
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
  } catch (err) {
    console.warn('[leagueFlags] read failed; defaulting OFF:', err)
    return DEFAULT_FLAGS
  }
}

export const getLeagueFlags = unstable_cache(
  readLeagueFlags,
  ['league-flags'],
  { revalidate: 30, tags: ['leagues'] },
)

// Test seam — exposes the uncached implementation for unit tests.
// Production code goes through `getLeagueFlags`.
export const __readLeagueFlags_for_testing = readLeagueFlags
