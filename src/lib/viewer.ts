/**
 * v1.98.0 — Request-scoped viewer resolution.
 *
 * Pre-v1.98.0 the same `getServerSession + user.findUnique +
 * player.findUnique` sequence ran THREE separate times on every
 * league-scoped page render:
 *
 *   1. `<HomepageRouter>` / page.tsx route handlers — session +
 *      `homepageRouting.getApprovedMembershipsAndDefault` (its own
 *      user.findUnique + player.findUnique).
 *   2. `getRecruitingViewerState(leagueId)` — session + user.findUnique
 *      + player.findUnique (with per-league leagueAssignments filter).
 *   3. `getUnpaidFeeBannerData(leagueId)` — session + user.findUnique
 *      (with playerId), then a per-league PLM query.
 *
 * Each of those flows is independent (different filters, different
 * downstream needs) so they don't share Prisma query results, but the
 * BASE work — JWT verify + user row + (optionally) player row — is
 * identical and was being repeated. On a typical multi-league hub
 * render that meant ~3 `getServerSession()` invocations + ~3 sequential
 * `prisma.user.findUnique` round-trips + ~2 `prisma.player.findUnique`
 * round-trips that were redundant after the first.
 *
 * `getViewer()` collapses that into a single resolution per request,
 * wrapped in React's `cache()` so every call site inside the same RSC
 * render boundary shares the same Promise. Consumers still run their
 * own per-league follow-up queries (recruiting viewer state, unpaid
 * fee banner, memberships list) — only the base session+user+player
 * dedup is centralised here.
 *
 * Resolution strategy mirrors the existing fallback patterns used in
 * `account/player/actions.ts:requireSelfPlayerSession` and the v1.80.10
 * admin-orthogonal fix: try `userId` first (canonical post-α.5), fall
 * back to `lineId` for grandfathered LINE sessions whose JWT predates
 * v1.28.0 stage α.5 (lineId set, userId never populated). Player
 * lookup also uses the back-FK `Player.userId` since it's @unique;
 * falls back to `Player.lineId` for any drift where User.playerId was
 * never backfilled.
 *
 * All Prisma failures degrade gracefully — returns nulls so callers
 * see the same "unauthenticated / no_player" surface they would on a
 * Prisma blip pre-refactor. Better to under-render the banner than
 * crash the page.
 */
import { cache } from 'react'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export interface Viewer {
  /**
   * True iff `getServerSession()` returned a non-null session. Used by
   * callers (e.g. `getRecruitingViewerState`) to distinguish "no
   * visitor session at all" (banner shows sign-in CTA) from
   * "authenticated session that lacks a public-side identifier" (e.g.
   * admin-credentials login — banner shows the apply CTA).
   */
  hasSession: boolean
  userId: string | null
  lineId: string | null
  user: {
    id: string
    playerId: string | null
    defaultLeagueId: string | null
  } | null
  player: { id: string } | null
}

const NO_SESSION_VIEWER: Viewer = {
  hasSession: false,
  userId: null,
  lineId: null,
  user: null,
  player: null,
}

export const getViewer = cache(async (): Promise<Viewer> => {
  const session = await getServerSession(authOptions)
  if (!session) return NO_SESSION_VIEWER

  const userId = (session as { userId?: string | null }).userId ?? null
  const lineId = (session as { lineId?: string | null }).lineId ?? null

  if (!userId && !lineId) {
    // Admin-credentials session (or grandfathered LINE without lineId
    // claim — shouldn't happen but the gate is defensive). Session
    // exists; just no public-side identifier to resolve.
    return { hasSession: true, userId: null, lineId: null, user: null, player: null }
  }

  let user: Viewer['user'] = null
  try {
    if (userId) {
      user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, playerId: true, defaultLeagueId: true },
      })
    }
    if (!user && lineId) {
      user = await prisma.user.findUnique({
        where: { lineId },
        select: { id: true, playerId: true, defaultLeagueId: true },
      })
    }
  } catch (err) {
    console.warn('[viewer] user lookup failed:', err)
    return { hasSession: true, userId, lineId, user: null, player: null }
  }

  if (!user) {
    return { hasSession: true, userId, lineId, user: null, player: null }
  }

  let player: Viewer['player'] = null
  try {
    // Prefer Player.userId back-FK (the same lookup
    // `getRecruitingViewerState` used pre-v1.98.0). Falls back to
    // Player.lineId for any drift where User.playerId was never
    // backfilled by the join callback.
    player = await prisma.player.findUnique({
      where: { userId: user.id },
      select: { id: true },
    })
    if (!player && lineId) {
      player = await prisma.player.findFirst({
        where: { lineId },
        select: { id: true },
      })
    }
  } catch (err) {
    console.warn('[viewer] player lookup failed:', err)
    // User resolved, player did not. Callers can still resolve
    // user-only data (e.g. recruiting state's `no_player` surface).
    return { hasSession: true, userId, lineId, user, player: null }
  }

  return { hasSession: true, userId, lineId, user, player }
})
