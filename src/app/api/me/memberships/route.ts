import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getMembershipsForSession } from '@/lib/memberships'

/**
 * Returns the signed-in user's league memberships.
 *
 * v1.52.0 — originally the only read path, fired by the league switcher on
 * dropdown open.
 *
 * v1.59.0 — primary read path moved to SSR via `getMembershipsForSession`
 * called from the root layout (`app/layout.tsx`). This route is preserved
 * for clients that want on-demand refresh (e.g. after admin pre-stages a
 * new assignment). Internally delegates to the same helper so both paths
 * stay in sync.
 *
 * Returns `{ memberships: [{ leagueId, name, slug, isCurrent }] }`.
 */
export async function GET() {
  const session = await getServerSession(authOptions)

  if (!session) {
    return NextResponse.json({ memberships: [] })
  }

  const memberships = await getMembershipsForSession({
    userId: session.userId ?? null,
    lineId: session.lineId || null,
    currentLeagueId: session.leagueId ?? null,
  })

  return NextResponse.json({ memberships })
}
