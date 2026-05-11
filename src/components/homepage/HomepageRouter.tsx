import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  resolveHomepagePersona,
  type HomepagePersona,
} from '@/lib/homepageRouting'
import { getDirectoryLeagues } from '@/lib/leagueDirectoryData'
import LeagueDirectory from './LeagueDirectory'
import MultiLeagueHub from './MultiLeagueHub'

/**
 * v1.85.0 — homepage redesign phase 1b/1c. Persona-aware apex router.
 *
 * Mounted at `/test/page.tsx` for the preview window; the eventual swap
 * replaces `/page.tsx`'s body with a single `<HomepageRouter />`. This
 * component owns all the routing decisions for the apex:
 *
 *   - `directory` persona — render the public `<LeagueDirectory>`. Hits
 *     unauthenticated visitors AND authenticated users with zero
 *     APPROVED memberships (so a brand-new sign-in doesn't dead-end).
 *
 *   - `single` persona — exactly one APPROVED membership. Issues a
 *     server-side `redirect()` to `/id/<slug>`. The redirect throws
 *     internally (NEXT_REDIRECT), so nothing else in this function
 *     executes after the call.
 *
 *   - `multi` persona — two or more APPROVED memberships. Mounts
 *     `<MultiLeagueHub>`, which renders the FULL classic Dashboard for
 *     the user's `defaultLeagueId` (or the deterministic fallback) plus
 *     the new switcher + recruiting-handoff surfaces.
 *
 * v1.93.0 — accepts `preferredLeagueId` from the page-level
 * `searchParams.league` query so the switcher can navigate via
 * `<Link prefetch>` instead of awaiting a server action then
 * `router.refresh()`. The persona resolver still validates the id
 * against the viewer's memberships before honouring it; an unknown id
 * silently falls through to `User.defaultLeagueId` then to the
 * alphabetical-first membership. Pinning the choice to the URL also
 * makes the switcher result shareable/bookmarkable.
 *
 * This is a server component. The persona resolver reads the session
 * once via `getServerSession`; calling that establishes the route as
 * dynamic per-request, which is what we want — every visitor has a
 * different persona and the page output cannot be statically cached.
 */
export default async function HomepageRouter({
  preferredLeagueId,
}: {
  preferredLeagueId?: string | null
} = {}) {
  const session = await getServerSession(authOptions)
  const userId = (session as { userId?: string | null } | null)?.userId ?? null
  const lineId = (session as { lineId?: string | null } | null)?.lineId ?? null

  const persona: HomepagePersona = await resolveHomepagePersona({
    userId,
    lineId,
    preferredLeagueId: preferredLeagueId ?? null,
  })

  if (persona.kind === 'single') {
    // Throws NEXT_REDIRECT — nothing below this line runs. Keeps the
    // single-membership path as a single 307 with no client flash.
    redirect(`/id/${persona.membership.slug}`)
  }

  if (persona.kind === 'multi') {
    return (
      <MultiLeagueHub
        memberships={persona.memberships}
        activeLeagueId={persona.activeLeagueId}
        viewer={{ userId, lineId }}
      />
    )
  }

  // 'directory' — both unauthenticated and authenticated-without-
  // memberships fall through here. The directory listing itself is
  // identical for both audiences; future phases may introduce a
  // sign-in-aware variant if signals emerge.
  const leagues = await getDirectoryLeagues()
  return <LeagueDirectory leagues={leagues} />
}
