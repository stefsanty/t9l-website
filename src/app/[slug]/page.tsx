import { redirect } from 'next/navigation'
import { normalizeLeagueSlug } from '@/lib/leagueSlug'

export const metadata = {
  title: 'League | T9L',
}

type Props = { params: Promise<{ slug: string }> }

/**
 * v1.54.0 — legacy short-alias `/<slug>` route is now a 308-redirect to
 * the security-namespaced canonical form `/id/<slug>`.
 *
 * Pre-v1.54.0 (v1.50.0–v1.53.x) `/<slug>` was the canonical short alias
 * for the per-league dashboard. v1.54.0 inverts the design: every tenant
 * URL is namespaced under `/id/` so league slugs can never shadow
 * top-level platform routes (e.g. a league called "admin" lives at
 * `/id/admin`, not `/admin`). Old `/<slug>` links keep working via this
 * redirect.
 *
 * Slug normalization runs before redirect so `/T9L` redirects to
 * `/id/t9l` (lowercase), keeping the canonical URL form consistent.
 *
 * No DB lookup needed — the redirect target is computed purely from the
 * URL params. The `/id/<slug>` route is responsible for the
 * format/reserved/missing-league 404 logic.
 *
 * Next.js's static-segments-win-over-dynamic rule means this catch-all
 * never fires for `/admin`, `/auth`, `/join`, `/matchday`, `/api`,
 * `/account`, `/league`, `/schedule`, `/stats`, `/assign-player`,
 * `/auth-error`, `/dev-login`, or `/id` — those have their own route
 * files and resolve directly.
 */
export default async function LegacyShortAliasRedirect({ params }: Props) {
  const { slug } = await params
  const normalized = normalizeLeagueSlug(slug)
  redirect(`/id/${normalized}`)
}
