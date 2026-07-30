import type { MetadataRoute } from 'next'

/**
 * v2.4.0 (Neon awake-time reduction, step 1) — crawler policy.
 *
 * Pre-v2.4.0 the site shipped no `robots.txt`, so every crawler treated
 * the whole surface as fair game — including authenticated-only and
 * mutation routes (`/api/*`, `/admin`, `/auth/*`). The Neon diagnostic
 * session traced a large share of the ~11 h/day compute-awake time to
 * bot traffic hitting DB-backed pages around the clock, which kept the
 * branch from ever reaching its 300 s autosuspend window.
 *
 * Two rules:
 *   1. `*` — allow the public surface, disallow the paths that are either
 *      useless to a crawler or actively harmful to hit (API handlers,
 *      the admin shell, NextAuth callbacks, sign-out).
 *   2. Named SEO-analytics crawlers — blanket disallow. AhrefsBot,
 *      SemrushBot, MJ12bot and DotBot crawl aggressively and provide
 *      zero value to a recreational football league's members; they were
 *      the heaviest non-search agents in the access logs.
 *
 * Search engines (Googlebot, Bingbot, etc.) fall through to rule 1 and
 * keep full access to the public pages.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/admin', '/auth/', '/sign-out'],
      },
      {
        userAgent: ['AhrefsBot', 'SemrushBot', 'MJ12bot', 'DotBot'],
        disallow: '/',
      },
    ],
    sitemap: 'https://t9l.me/sitemap.xml',
  }
}
