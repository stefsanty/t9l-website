import { redirect } from 'next/navigation'
import { normalizeLeagueSlug } from '@/lib/leagueSlug'

export const metadata = {
  title: 'League | T9L',
}

type Props = { params: Promise<{ slug: string }> }

/**
 * v1.54.0 — legacy `/league/<slug>` route is now a 308-redirect to the
 * security-namespaced canonical form `/id/<slug>`.
 *
 * Pre-v1.54.0 (v1.50.0–v1.53.x) `/league/<slug>` was the canonical
 * per-league entry point. v1.54.0 namespaces every tenant URL under
 * `/id/` so league slugs can never shadow top-level platform routes;
 * `/league/<slug>` becomes a thin redirect so old shared links keep
 * working.
 *
 * Slug normalization runs before redirect so `/league/T9L` redirects to
 * `/id/t9l` (lowercase), keeping the canonical URL form consistent
 * regardless of how the legacy URL was typed.
 *
 * No DB lookup needed — the redirect target is computed purely from the
 * URL params. The `/id/<slug>` route is responsible for the
 * format/reserved/missing-league 404 logic.
 */
export default async function LegacyLeagueRedirect({ params }: Props) {
  const { slug } = await params
  const normalized = normalizeLeagueSlug(slug)
  redirect(`/id/${normalized}`)
}
