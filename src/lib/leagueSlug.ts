import { unstable_cache } from 'next/cache'
import { prisma } from './prisma'

/**
 * v1.50.0 (PR 1 of the path-routing chain) — pure helpers + cached Prisma
 * lookups for path-based league resolution.
 *
 * Pre-v1.50.0 the league context for a request came from the host header
 * (`getLeagueIdFromRequest()` in `lib/getLeagueFromHost.ts`). With path-based
 * routing, the slug is read from the URL pathname (`/league/[slug]` or the
 * `/[slug]` catch-all) and resolved here. The DB column powering this is
 * `League.subdomain` (kept under that name for legacy-compat — PR 4 may
 * rename it to `slug`).
 *
 * Reserved-word policy is enforced both at admin-create time (PR 5) and
 * at route-resolve time (here) as defense in depth: even if a malformed
 * row sneaks past the create-time validator, requests for the reserved
 * slug never load it.
 */

/**
 * Slugs that must NEVER resolve to a league. Each entry corresponds to
 * either an existing top-level route segment or a future-reserved name.
 *
 * Why both: Next.js prefers static segments over dynamic ones, so requests
 * for `/admin` always hit `app/admin/page.tsx` regardless of any league
 * with slug `admin`. But this list is the source of truth for the
 * admin-side validator (PR 5) — if a future PR adds a new top-level route
 * (e.g. `/dashboard`), we want admins to be unable to register a league
 * with that slug *before* the route lands, so older admin sessions don't
 * race the route addition.
 *
 * Keep this list in sync with the top-level segments in `src/app/`.
 */
export const RESERVED_LEAGUE_SLUGS = new Set<string>([
  'league',
  'admin',
  'auth',
  'auth-error',
  'join',
  'md',
  'matchday',
  'account',
  'api',
  'assign-player',
  'dev-login',
  'schedule',
  'stats',
])

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/

/**
 * Pure: validate a league slug against the format + reserved-word policy.
 *
 * Rules:
 *   - lowercase alphanumeric + hyphens only
 *   - 3–30 chars
 *   - cannot start or end with a hyphen
 *   - cannot be a reserved word
 *
 * Returns the validation outcome as a discriminated union so callers can
 * surface the specific failure to admins (e.g. "slug too short" vs
 * "slug is a reserved word").
 */
export type SlugValidation =
  | { ok: true }
  | { ok: false; reason: 'empty' | 'too-short' | 'too-long' | 'invalid-format' | 'reserved' }

export function validateLeagueSlug(raw: string | null | undefined): SlugValidation {
  // Strict: trim whitespace but do NOT lowercase. Uppercase input fails
  // format. Admin pipeline (PR 5) calls this directly so admins see a
  // clear error when they type "T9L" by accident — silently lowercasing
  // would hide the typo. Route resolution lowercases via
  // `normalizeLeagueSlug` first.
  const slug = (raw ?? '').trim()
  if (!slug) return { ok: false, reason: 'empty' }
  if (slug.length < 3) return { ok: false, reason: 'too-short' }
  if (slug.length > 30) return { ok: false, reason: 'too-long' }
  if (!SLUG_PATTERN.test(slug)) return { ok: false, reason: 'invalid-format' }
  if (RESERVED_LEAGUE_SLUGS.has(slug)) return { ok: false, reason: 'reserved' }
  return { ok: true }
}

/**
 * Pure: lowercase + trim a URL-supplied slug before resolution. Mirrors
 * v1.49.1's matchday-id case-insensitive routing — `/T9L`, `/Tamachi`,
 * `/T9l` all resolve to the same league as `/t9l`. Admin-facing
 * validation stays strict via `validateLeagueSlug` so typed-in input
 * with uppercase characters is flagged for correction.
 */
export function normalizeLeagueSlug(raw: string): string {
  return raw.trim().toLowerCase()
}

/**
 * Pure: cheap pre-check before hitting the DB. Returns true iff the slug
 * passes format + reserved-word validation after normalization. Use this
 * in routes to short-circuit DB lookups for obviously-invalid input.
 */
export function isResolvableLeagueSlug(slug: string): boolean {
  return validateLeagueSlug(normalizeLeagueSlug(slug)).ok
}

const getLeagueIdBySlugCached = unstable_cache(
  async (slug: string): Promise<string | null> => {
    const league = await prisma.league.findUnique({
      where: { subdomain: slug },
      select: { id: true },
    })
    return league?.id ?? null
  },
  ['league-id-by-slug'],
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
  ['default-league-id-slug'],
  { revalidate: 60, tags: ['leagues'] },
)

/**
 * Resolve a path slug to a `League.id`, with reserved-word + format
 * validation up front. Returns null when:
 *   - slug fails format validation
 *   - slug is reserved
 *   - no League row matches the slug
 *
 * Cached for 60s under the `leagues` tag so admin writes that revalidate
 * 'leagues' (`updateLeagueInfo`, `createLeague`) bust this lookup too.
 */
export async function getLeagueIdBySlug(slug: string): Promise<string | null> {
  const normalized = normalizeLeagueSlug(slug)
  if (!validateLeagueSlug(normalized).ok) return null
  return getLeagueIdBySlugCached(normalized)
}

/**
 * Resolve the default league's id (the league with `isDefault: true`).
 * Used by apex `/` and any path that semantically means "the home league".
 */
export async function getDefaultLeagueId(): Promise<string | null> {
  return getDefaultLeagueIdCached()
}
