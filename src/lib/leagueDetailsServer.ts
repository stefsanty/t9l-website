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

async function readLeagueDetails(
  leagueId: string,
): Promise<LeagueDetails | null> {
  try {
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
  } catch (err) {
    console.warn('[leagueDetails] read failed:', err)
    return null
  }
}

export const getLeagueDetails = unstable_cache(
  readLeagueDetails,
  ['league-details'],
  { revalidate: 30, tags: ['leagues'] },
)

export const __readLeagueDetails_for_testing = readLeagueDetails
