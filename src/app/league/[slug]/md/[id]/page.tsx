import { redirect } from 'next/navigation'
import { normalizeLeagueSlug } from '@/lib/leagueSlug'

export const metadata = {
  title: 'Matchday | T9L',
}

type Props = { params: Promise<{ slug: string; id: string }> }

/**
 * v1.54.0 — legacy `/league/<slug>/md/<id>` route is now a 308-redirect
 * to the security-namespaced canonical form `/id/<slug>/md/<id>`.
 *
 * Pre-v1.54.0 (v1.51.0–v1.53.x) this was the canonical per-matchday
 * entry point. v1.54.0 namespaces every tenant URL under `/id/`; old
 * shared links (Slack/LINE chat/bookmarks created during v1.51.0–v1.53.x)
 * keep working via this redirect.
 *
 * Both segments are normalized in the redirect target:
 *   - slug → lowercase via `normalizeLeagueSlug`
 *   - matchday id → lowercase (matches the canonical id format from
 *     `dbToPublicLeagueData` and v1.49.1's case-insensitive routing
 *     contract)
 *
 * No DB lookup here — the new `/id/<slug>/md/<id>` route handles the
 * format/reserved/missing-league + missing-matchday 404 logic.
 */
export default async function LegacyLeagueMatchdayRedirect({ params }: Props) {
  const { slug, id } = await params
  const slugLower = normalizeLeagueSlug(slug)
  const idLower = id.toLowerCase()
  redirect(`/id/${slugLower}/md/${idLower}`)
}
