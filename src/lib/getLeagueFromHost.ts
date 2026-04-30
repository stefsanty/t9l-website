import { headers } from 'next/headers'
import { unstable_cache } from 'next/cache'
import { prisma } from './prisma'

/**
 * Pure: extract a meaningful subdomain from a host header value.
 *
 * Examples:
 *   t9l.me            → null  (apex)
 *   dev.t9l.me        → null  (dev base — "dev" is infra, not a league)
 *   www.t9l.me        → null  (www — also infra)
 *   test.t9l.me       → "test"
 *   test.dev.t9l.me   → "test"
 *   localhost          → null
 *   localhost:3000     → null  (port already stripped by caller)
 *   foo.vercel.app     → null  (Vercel preview domain, no user subdomain)
 *
 * Exported for unit testing.
 */

// Reserved labels that look like subdomains but are infrastructure-level
// (the dev base, the canonical www host, etc.). They must NOT be treated as
// league subdomains — `dev.t9l.me` should serve the default league, not 404.
const RESERVED_SUBDOMAIN_LABELS = new Set(['dev', 'www', 'staging'])

export function extractSubdomain(host: string): string | null {
  const parts = host.split('.')
  let candidate: string | null = null
  if (parts.length >= 4) {
    // test.dev.t9l.me → "test"
    candidate = parts[0]
  } else if (parts.length === 3 && !host.endsWith('vercel.app')) {
    // test.t9l.me → "test" (production subdomain)
    candidate = parts[0]
  }
  if (!candidate) return null
  if (RESERVED_SUBDOMAIN_LABELS.has(candidate)) return null
  return candidate
}

// `getLeagueFromHost` (returning the full League row) was removed in v1.25.0
// — its only caller was the apex `app/page.tsx` deciding between the
// default-league `Dashboard` and the subdomain `LeaguePublicView`. v1.25.0
// converges both paths onto `Dashboard` via `getLeagueIdFromRequest()`
// below + `getPublicLeagueData(leagueId)`, so the full-League fetch at the
// page boundary became redundant. Use `getLeagueIdFromRequest()` for any
// future "what league does this request belong to" decision.

const getLeagueIdBySubdomainCached = unstable_cache(
  async (subdomain: string): Promise<string | null> => {
    const league = await prisma.league.findUnique({
      where: { subdomain },
      select: { id: true },
    })
    return league?.id ?? null
  },
  ['league-id-by-subdomain'],
  { revalidate: 60, tags: ['leagues'] },
)

const getDefaultLeagueIdCached = unstable_cache(
  async (): Promise<string | null> => {
    const league = await prisma.league.findFirst({
      where: { isDefault: true },
      select: { id: true },
    })
    return league?.id ?? null
  },
  ['default-league-id'],
  { revalidate: 60, tags: ['leagues'] },
)

/**
 * Resolve the active League.id for the incoming request.
 *
 * Routing rules:
 *   - Subdomain present + matches a League row → that League's id
 *   - No subdomain (apex / dev base / localhost / vercel.app preview) → default league id
 *   - Subdomain present but unknown → null (caller should reject)
 *
 * Returns null only when:
 *   (a) a known-malformed subdomain was supplied (so we should not silently
 *       route writes to the default league), or
 *   (b) no default league is flagged in the database (catastrophic config).
 *
 * Used by route handlers (e.g. `/api/rsvp`, future `/api/assign-player`) that
 * need to write per-league state. Pre-v1.22.0 these handlers hardcoded the
 * default league id, which silently mis-routed any subdomain RSVP to the
 * default league's GameWeeks.
 */
export async function getLeagueIdFromRequest(): Promise<string | null> {
  const hdrs = await headers()
  const host = (hdrs.get('host') ?? '').split(':')[0]
  const subdomain = extractSubdomain(host)
  if (subdomain) {
    return getLeagueIdBySubdomainCached(subdomain)
  }
  return getDefaultLeagueIdCached()
}
