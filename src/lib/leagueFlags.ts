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
 *
 * v1.84.0 — recruiting banner gate now derives from `League.visibility`
 * (`PUBLIC_OPEN` only). The legacy `recruiting` boolean stays in the DB
 * as a one-cycle dual-write; reads no longer go through it. The
 * `LeagueFlags.recruiting` field name is preserved so callers
 * (Dashboard, page.tsx) don't churn — it just means "show the banner".
 */
import { prisma } from '@/lib/prisma'
import { unstable_cache } from 'next/cache'

export interface LeagueFlags {
  preseasonMode: boolean
  /** v1.84.0 — true when `League.visibility === 'PUBLIC_OPEN'`. */
  recruiting: boolean
  /** v1.84.0 — raw visibility for callers that need the three-tier value. */
  visibility: 'PRIVATE' | 'PUBLIC_CLOSED' | 'PUBLIC_OPEN'
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
      select: { preseasonMode: true, visibility: true },
    })
    if (!row) return DEFAULT_FLAGS
    const visibility = row.visibility ?? 'PUBLIC_CLOSED'
    return {
      preseasonMode: row.preseasonMode ?? false,
      recruiting: visibility === 'PUBLIC_OPEN',
      visibility,
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
