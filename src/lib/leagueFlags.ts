/**
 * v1.63.0 — per-league public-facing flags (`preseasonMode`, `recruiting`).
 *
 * Reads the two toggles for a given leagueId. Cached for 30s under the
 * canonical `'leagues'` tag so admin writes (which always bust this tag
 * via the v1.16.0 `revalidate({ domain: 'admin' })` helper) propagate to
 * public reads on the next render.
 *
 * Defaults to `{ preseasonMode: false, recruiting: false }` if the league
 * row is missing or Prisma fails. The classic-homepage path is the
 * default behavior across the entire codebase pre-v1.63.0; a transient
 * Prisma blip should not flip an in-season league into pre-season mode
 * for the duration of the blip.
 *
 * Why a separate helper rather than threading through `getPublicLeagueData`:
 * the league flags affect rendering at the page-level boundary (page.tsx
 * branches on them, Header reads them, RecruitingBanner conditional)
 * without affecting the LeagueData consumers (the matchday + roster shape
 * doesn't change). Keeping them in a separate cached helper keeps the
 * LeagueData type stable and lets each consumer fetch only what it needs.
 */
import { prisma } from '@/lib/prisma'
import { unstable_cache } from 'next/cache'

export interface LeagueFlags {
  preseasonMode: boolean
  recruiting: boolean
}

const DEFAULT_FLAGS: LeagueFlags = {
  preseasonMode: false,
  recruiting: false,
}

async function readLeagueFlags(leagueId: string): Promise<LeagueFlags> {
  try {
    const row = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { preseasonMode: true, recruiting: true },
    })
    if (!row) return DEFAULT_FLAGS
    return {
      preseasonMode: row.preseasonMode ?? false,
      recruiting: row.recruiting ?? false,
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
