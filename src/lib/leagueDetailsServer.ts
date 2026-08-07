/**
 * v1.80.7 (perf phase 4b) — server-only DB read split out of
 * `leagueDetails.ts`. Pre-v1.80.7, `readLeagueDetails` + `getLeagueDetails`
 * lived alongside the pure label maps + types. The client-side
 * `LeagueDetailsPanel` component imports the LABELS to render (and is
 * lazy-loaded via `next/dynamic`), and Webpack's module evaluation rules
 * dragged the file's `import { prisma } from '@/lib/prisma'` and
 * `import { unstable_cache } from 'next/cache'` side-effect imports into
 * the LeagueDetailsPanel chunk — shipping ~47 KB of
 * `@prisma/client/runtime/index-browser.js` in the public bundle. Splitting
 * the DB read into this dedicated server-only module removes the leak
 * while keeping the pure label/type exports untouched.
 *
 * Auth/visibility:
 *   - Returns `null` when the league row is missing OR when
 *     `showLeagueDetails === false`. The panel never renders without a
 *     non-null value here. The caller (page.tsx) gates additionally on
 *     `preseasonMode === true` to keep the panel scoped to the preseason
 *     homepage.
 *   - Defensive `null` on Prisma rejection — a transient blip should
 *     hide the panel rather than crash the homepage.
 */
import { prisma } from '@/lib/prisma'
import { unstable_cache } from 'next/cache'
import type { LeagueDetails } from '@/lib/leagueDetails'

/**
 * v2.4.0 — deliberately does NOT catch; the defensive `null` moved to the
 * `getLeagueDetails` wrapper below so a Prisma rejection escapes the cache
 * wrapper instead of being stored as a resolved value for 900s.
 */
async function readLeagueDetails(
  leagueId: string,
): Promise<LeagueDetails | null> {
  const row = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      ballType: true,
      goalSize: true,
      throwInType: true,
      goalKickType: true,
      offsideRule: true,
      backpassRule: true,
      matchDurationMinutes: true,
      playerFormat: true,
      unlimitedSubstitutions: true,
      organizerMessage: true,
      showLeagueDetails: true,
    },
  })
  if (!row) return null
  if (!row.showLeagueDetails) return null
  return {
    ballType: row.ballType,
    goalSize: row.goalSize,
    throwInType: row.throwInType,
    goalKickType: row.goalKickType,
    offsideRule: row.offsideRule,
    backpassRule: row.backpassRule,
    matchDurationMinutes: row.matchDurationMinutes,
    playerFormat: row.playerFormat,
    unlimitedSubstitutions: row.unlimitedSubstitutions,
    organizerMessage: row.organizerMessage,
  }
}

// v2.4.0 (Neon awake-time reduction, step 4) — TTL raised 30s → 900s.
// Public-path reader; a TTL below the Neon branch's 300s autosuspend window
// keeps compute permanently awake. Admin writes bust the `leagues` tag
// immediately, so the timer is belt-and-suspenders only.
const getLeagueDetailsCached = unstable_cache(
  readLeagueDetails,
  ['league-details'],
  { revalidate: 900, tags: ['leagues'] },
)

/**
 * v2.4.0 — the defensive catch lives here, outside the cache wrapper, so a
 * transient Prisma blip is not cached as `null` (which at 900s would hide
 * the details panel for 15 minutes). `null` from a missing row or
 * `showLeagueDetails === false` still caches, which is correct.
 */
export async function getLeagueDetails(
  leagueId: string,
): Promise<LeagueDetails | null> {
  try {
    return await getLeagueDetailsCached(leagueId)
  } catch (err) {
    console.warn('[leagueDetails] read failed:', err)
    return null
  }
}

export const __readLeagueDetails_for_testing = readLeagueDetails
