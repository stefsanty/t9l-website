/**
 * v1.50.0 (PR 1 of the path-routing chain) — pure helpers for path-based
 * league resolution.
 *
 * v1.80.7 (perf phase 4b) — the cached Prisma lookups (`getLeagueIdBySlug`,
 * `getDefaultLeagueId`) moved to `leagueSlugServer.ts`. This file now
 * contains ONLY pure, side-effect-free helpers so client components that
 * legitimately import `DEFAULT_LEAGUE_SLUG` / `validateLeagueSlug` (e.g.
 * `CopyMatchdayLink`, `RecruitingBanner`, `CreateLeagueModal`) don't drag
 * `@prisma/client` and `next/cache` into the public bundle. Server callers
 * that need the DB lookups now `import ... from '@/lib/leagueSlugServer'`.
 *
 * Pre-v1.50.0 the league context for a request came from the host header
 * (subdomain → leagueId). PR 4 (v1.53.0) of the path-routing chain
 * stripped that helper entirely. League context now flows from path
 * params (`/id/[slug]`, plus legacy `/league/[slug]` and `/[slug]` which
 * 308-redirect to `/id/<slug>` post-v1.54.0) and resolves here. The DB
 * column powering this is `League.subdomain` (column rename to `slug` is
 * deferred — keeping the name doesn't change semantics).
 *
 * v1.54.0 namespaced every tenant URL under `/id/` so league slugs can
 * never shadow top-level platform routes. The reserved-word policy
 * collapsed from a comprehensive route-name list to a single recursive
 * guard ('id' itself) — every other top-level platform route is now a
 * sibling of `/id/`, not a parent.
 *
 * Reserved-word policy is still enforced both at admin-create time
 * (PR 5) and at route-resolve time (here) as defense in depth: even if
 * a malformed row sneaks past the create-time validator, requests for
 * the reserved slug never load it.
 */

/**
 * Hard-coded fallback slug for the default league. The migration in
 * v1.50.0 backfills `League.subdomain = 't9l'` for the default league;
 * this constant is the matching client-side fallback for components
 * (CopyMatchdayLink, etc.) that need to compose a canonical URL but
 * don't have a leagueSlug threaded through their props (e.g. the
 * /schedule page). PR 4 (v1.53.0) may revisit this once subdomain
 * functionality is removed and the column is renamed to `slug`.
 */
export const DEFAULT_LEAGUE_SLUG = 't9l'

/**
 * Slugs that must NEVER resolve to a league.
 *
 * v1.54.0 — collapsed from a comprehensive route-name list to a single
 * recursive guard. Every tenant URL is now namespaced under `/id/<slug>`
 * (and `/id/<slug>/md/<id>`), so a league slug can never shadow any
 * top-level platform route. The only routing-style ambiguity left is
 * a slug equal to "id" itself, which would produce visually confusing
 * URLs like `/id/id` (alias) or `/id/id/md/md1`. We block it.
 *
 * Pre-v1.54.0 this set tracked every top-level route segment in
 * `src/app/` because `/<slug>` was a sibling catch-all that would have
 * shadowed any matching static route. Post-v1.54.0 the legacy `/<slug>`
 * route is a 308-redirect to `/id/<slug>`, but Next.js's static-wins
 * rule means `/admin` etc. never even hit the redirect — they resolve
 * to their dedicated route files. The set's job is now just the
 * recursive `/id/id` guard.
 */
export const RESERVED_LEAGUE_SLUGS = new Set<string>([
  'id',
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

