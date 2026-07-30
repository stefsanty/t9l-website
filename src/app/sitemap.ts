import type { MetadataRoute } from 'next'
import { getDirectoryLeagues } from '@/lib/leagueDirectoryData'

/**
 * v2.4.0 (Neon awake-time reduction, step 1) — public sitemap.
 *
 * Paired with `src/app/robots.ts`: giving well-behaved search crawlers an
 * explicit route list means they stop discovering pages by brute-force
 * link-walking, which was part of the round-the-clock DB traffic keeping
 * the Neon branch awake.
 *
 * Only genuinely public, DB-backed, indexable routes are listed. Omitted
 * on purpose:
 *   - `/id/<slug>/md/<id>` — one entry per matchday would balloon the
 *     sitemap and each is a per-matchday DB read; the league page links
 *     them for crawlers that want them.
 *   - `/league/<slug>` and `/<slug>` — 308-redirects to `/id/<slug>`.
 *   - anything under `/admin`, `/api`, `/auth`, `/account`, `/join`,
 *     `/recruit` — gated, single-use, or mutation surfaces.
 *
 * `revalidate = 3600` keeps the generated XML warm for an hour, so the
 * single `getDirectoryLeagues` read (itself `unstable_cache`d under the
 * `leagues` tag) costs at most one Neon round-trip per hour even under
 * heavy crawler load.
 */
export const revalidate = 3600

const BASE_URL = 'https://t9l.me'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date()

  const staticEntries: MetadataRoute.Sitemap = [
    { url: BASE_URL, lastModified, changeFrequency: 'daily', priority: 1 },
    { url: `${BASE_URL}/stats`, lastModified, changeFrequency: 'daily', priority: 0.8 },
    { url: `${BASE_URL}/schedule`, lastModified, changeFrequency: 'daily', priority: 0.8 },
  ]

  // A sitemap is a nice-to-have; a Prisma blip must not 500 the route.
  // `getDirectoryLeagues` already swallows its own errors and returns [],
  // but the guard keeps the contract explicit at this boundary.
  let leagues: Awaited<ReturnType<typeof getDirectoryLeagues>> = []
  try {
    leagues = await getDirectoryLeagues()
  } catch (err) {
    console.warn('[sitemap] directory read failed; serving static entries only:', err)
  }

  const leagueEntries: MetadataRoute.Sitemap = leagues.flatMap((league) => [
    {
      url: `${BASE_URL}/id/${league.slug}`,
      lastModified,
      changeFrequency: 'daily' as const,
      priority: 0.9,
    },
    // The join page is the recruiting funnel entry point — worth indexing
    // only while the league is actually open.
    ...(league.status === 'recruiting'
      ? [
          {
            url: `${BASE_URL}/id/${league.slug}/join`,
            lastModified,
            changeFrequency: 'weekly' as const,
            priority: 0.7,
          },
        ]
      : []),
  ])

  return [...staticEntries, ...leagueEntries]
}
