'use server'

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * v1.85.0 — homepage redesign phase 1c. Server action invoked by the
 * `<LeagueSwitcherTabs>` pill strip when the user picks a different
 * league from their multi-league hub at `/test`.
 *
 * Sets `User.defaultLeagueId` to the picked league IFF the caller has
 * an APPROVED, current `PlayerLeagueMembership` in that league. Returns
 * a discriminated result; the client component then `router.refresh()`es
 * so the server-rendered `<HomepageRouter>` re-evaluates the persona
 * with the new default. We don't call `revalidate(...)` here on
 * purpose: `User.defaultLeagueId` is a per-user pin that isn't
 * reachable from the cached `public-data` / `leagues` tag set, and the
 * `/test` page is dynamic (it reads the session), so `router.refresh()`
 * alone re-fetches the server component with the fresh User row.
 *
 * Auth gate mirrors `requireSelfPlayerSession` in
 * `account/player/actions.ts`: accept `userId` OR `lineId`; reject when
 * the session has neither (admin-credentials) — admin role is
 * orthogonal to this user-facing surface (admin-orthogonal-UX rule).
 *
 * Membership gate mirrors `touchUserDefaultLeague` in
 * `src/lib/userDefaultLeague.ts` — same APPROVED + current + leagueTeam
 * predicate as `homepageRouting.ts` reads, so the picker can never
 * write a value that the persona resolver would then reject as stale.
 */

export type SetDefaultLeagueResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' | 'not_a_member' | 'invalid_input' }

export async function setUserDefaultLeague(
  leagueId: string,
): Promise<SetDefaultLeagueResult> {
  if (typeof leagueId !== 'string' || leagueId.length === 0) {
    return { ok: false, error: 'invalid_input' }
  }

  const session = await getServerSession(authOptions)
  if (!session) return { ok: false, error: 'unauthenticated' }

  const userId = (session as { userId?: string | null }).userId ?? null
  const lineId = (session as { lineId?: string | null }).lineId ?? null
  if (!userId && !lineId) return { ok: false, error: 'unauthenticated' }

  let user = userId
    ? await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, playerId: true, defaultLeagueId: true },
      })
    : null
  if (!user && lineId) {
    user = await prisma.user.findUnique({
      where: { lineId },
      select: { id: true, playerId: true, defaultLeagueId: true },
    })
  }
  if (!user) return { ok: false, error: 'unauthenticated' }

  const playerWhere = user.playerId
    ? { id: user.playerId }
    : lineId
      ? { lineId }
      : null
  if (!playerWhere) return { ok: false, error: 'not_a_member' }

  const player = await prisma.player.findFirst({
    where: playerWhere,
    select: {
      leagueAssignments: {
        where: {
          applicationStatus: 'APPROVED',
          toGameWeek: null,
          leagueTeamId: { not: null },
          OR: [{ leagueId }, { leagueTeam: { leagueId } }],
        },
        select: { id: true },
        take: 1,
      },
    },
  })
  if (!player || player.leagueAssignments.length === 0) {
    return { ok: false, error: 'not_a_member' }
  }

  if (user.defaultLeagueId !== leagueId) {
    await prisma.user.update({
      where: { id: user.id },
      data: { defaultLeagueId: leagueId },
    })
  }
  return { ok: true }
}
