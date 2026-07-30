/**
 * v1.60.0 — per-league self-link toggle.
 *
 * Reads `League.allowSelfLink` for a given leagueId. Cached for 900s
 * (v2.4.0; was 30s) under
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

/**
 * v2.4.0 — deliberately does NOT catch; the default-ON-on-failure branch
 * moved to the `getLeagueAllowSelfLink` wrapper below so a Prisma rejection
 * escapes the cache wrapper instead of being stored for 900s.
 */
async function readAllowSelfLink(leagueId: string): Promise<boolean> {
  const row = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { allowSelfLink: true },
  })
  // Default true on missing row — matches the schema default and the
  // backward-compat invariant "every existing league behaves like today".
  return row?.allowSelfLink ?? true
}

// v2.4.0 (Neon awake-time reduction, step 4) — TTL raised 30s → 900s.
// v2.4.0 also puts this reader on the `/id/<slug>` header path, so it is
// now a public-path reader and must stay above the Neon branch's 300s
// autosuspend window. The `leagues` tag still busts it on admin writes,
// and the API POST keeps its own independent gate, so a flipped flag
// rejects writes even if a read served a stale `true`.
const getLeagueAllowSelfLinkCached = unstable_cache(
  readAllowSelfLink,
  ['league-allow-self-link'],
  { revalidate: 900, tags: ['leagues'] },
)

/**
 * v2.4.0 — the default-ON catch lives here, outside the cache wrapper, so a
 * transient Prisma blip isn't stored as a resolved `true` for 900s. Callers
 * keep the unchanged never-throws contract.
 */
export async function getLeagueAllowSelfLink(leagueId: string): Promise<boolean> {
  try {
    return await getLeagueAllowSelfLinkCached(leagueId)
  } catch (err) {
    console.warn('[leagueSelfLink] read failed; defaulting ON:', err)
    return true
  }
}

// Test seam — exposes the uncached implementation for unit tests.
// Production code goes through `getLeagueAllowSelfLink`.
export const __readAllowSelfLink_for_testing = readAllowSelfLink
