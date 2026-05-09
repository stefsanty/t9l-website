/**
 * v1.63.0 — per-league public-facing flags (`preseasonMode`, `recruiting`).
 * v1.84.0 — also reads `visibility` so the banner gate can switch from
 * the legacy `recruiting` boolean to the three-tier enum without
 * threading a new fetch through every page consumer.
 *
 * Reads the toggles for a given leagueId. Cached for 30s under the
 * canonical `'leagues'` tag so admin writes (which always bust this tag
 * via the v1.16.0 `revalidate({ domain: 'admin' })` helper) propagate to
 * public reads on the next render.
 *
 * Defaults to `{ preseasonMode: false, recruiting: false, visibility:
 * 'PUBLIC_CLOSED' }` if the league row is missing or Prisma fails. The
 * classic-homepage path is the default behavior across the entire
 * codebase pre-v1.63.0; a transient Prisma blip should not flip an
 * in-season league into pre-season mode for the duration of the blip.
 * `PUBLIC_CLOSED` is the safe visibility default — it leaves the banner
 * hidden (the gate is `=== 'PUBLIC_OPEN'`) without 403'ing the league
 * page itself.
 */
import { prisma } from '@/lib/prisma'
import { unstable_cache } from 'next/cache'

export type LeagueVisibilityFlag = 'PRIVATE' | 'PUBLIC_CLOSED' | 'PUBLIC_OPEN'

export interface LeagueFlags {
  preseasonMode: boolean
  recruiting: boolean
  visibility: LeagueVisibilityFlag
}

const DEFAULT_FLAGS: LeagueFlags = {
  preseasonMode: false,
  recruiting: false,
  visibility: 'PUBLIC_CLOSED',
}

async function readLeagueFlags(leagueId: string): Promise<LeagueFlags> {
  try {
    const row = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { preseasonMode: true, recruiting: true, visibility: true },
    })
    if (!row) return DEFAULT_FLAGS
    return {
      preseasonMode: row.preseasonMode ?? false,
      recruiting: row.recruiting ?? false,
      visibility: (row.visibility ?? 'PUBLIC_CLOSED') as LeagueVisibilityFlag,
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
