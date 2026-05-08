import { unstable_cache } from 'next/cache'
import { prisma } from './prisma'
import { normalizeLeagueSlug, validateLeagueSlug } from './leagueSlug'

/**
 * v1.80.7 (perf phase 4b) — server-only DB lookups split out of
 * `leagueSlug.ts`. Pre-v1.80.7, this file's contents lived alongside the
 * pure helpers (`DEFAULT_LEAGUE_SLUG`, `validateLeagueSlug`,
 * `normalizeLeagueSlug`, `isResolvableLeagueSlug`, `RESERVED_LEAGUE_SLUGS`).
 *
 * That co-location was a bundle-bloat trap: client components legitimately
 * import the pure helpers (e.g. `RecruitingBanner` and `CopyMatchdayLink`
 * pull in `DEFAULT_LEAGUE_SLUG` to compose canonical URLs), and Webpack's
 * module evaluation rules then drag the file's `import { prisma }` /
 * `import { unstable_cache } from 'next/cache'` side-effect imports into
 * the public client bundle. The bundle analyzer in v1.80.6 surfaced this
 * as ~47 KB of `@prisma/client/runtime/index-browser.js` shipped to every
 * route. Splitting the DB lookups into this dedicated server-only module
 * removes that leak while keeping the pure helpers untouched.
 */

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
