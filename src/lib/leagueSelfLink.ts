/**
 * v1.60.0 — per-league self-link toggle.
 *
 * Reads `League.allowSelfLink` for a given leagueId. Cached for 30s under
 * the canonical `'leagues'` tag so admin writes (which always bust this
 * tag via the v1.16.0 `revalidate({ domain: 'admin' })` helper) propagate
 * to public reads on the next render.
 *
 * Defaults to `true` if the league row is missing or Prisma fails. The
 * route gate is the load-bearing affordance; a transient Prisma blip
 * shouldn't block users from the picker on a league that has self-link
 * enabled. The API POST has its own gate so a flipped flag still rejects
 * writes even if the read here defensively returned true under failure.
 */
import { prisma } from '@/lib/prisma'
import { unstable_cache } from 'next/cache'

async function readAllowSelfLink(leagueId: string): Promise<boolean> {
  try {
    const row = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { allowSelfLink: true },
    })
    // Default true on missing row — matches the schema default and the
    // backward-compat invariant "every existing league behaves like today".
    return row?.allowSelfLink ?? true
  } catch (err) {
    console.warn('[leagueSelfLink] read failed; defaulting ON:', err)
    return true
  }
}

export const getLeagueAllowSelfLink = unstable_cache(
  readAllowSelfLink,
  ['league-allow-self-link'],
  { revalidate: 30, tags: ['leagues'] },
)

// Test seam — exposes the uncached implementation for unit tests.
// Production code goes through `getLeagueAllowSelfLink`.
export const __readAllowSelfLink_for_testing = readAllowSelfLink
