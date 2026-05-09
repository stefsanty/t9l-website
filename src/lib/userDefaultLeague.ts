/**
 * v1.85.0 — homepage redesign phase 1b. "Last-selected league" tracker.
 *
 * Every server-rendered league page (`/id/<slug>` and
 * `/id/<slug>/md/<id>`) calls `touchUserDefaultLeague(...)` so the next
 * visit to the persona-aware apex (`/test`, swap-target `/`) lands on
 * the league the user was most recently looking at. The write only
 * happens when:
 *
 *   1. The visitor has a resolvable session (userId or lineId).
 *   2. They have an APPROVED, current `PlayerLeagueMembership` in the
 *      league they're visiting. (No bookmarking a league you're not in.)
 *   3. The stored `User.defaultLeagueId` differs from `leagueId` (so
 *      we don't write on every page view).
 *
 * The whole thing is wrapped in `waitUntil` from `@vercel/functions`
 * (the same fire-and-forget shape `applyToLeague` uses for the
 * application-received email, v1.79.0). On Vercel that keeps the write
 * off the request critical path; outside Vercel the imported helper
 * resolves to a no-op shim from `@vercel/functions` itself, so the
 * write runs inline. Either way it never blocks the response.
 *
 * Errors are swallowed and logged — a flaky update should not crash a
 * league page render.
 */

import { waitUntil } from '@vercel/functions'
import { prisma } from '@/lib/prisma'

interface TouchInput {
  userId: string | null
  lineId: string | null
  leagueId: string
}

export function touchUserDefaultLeague(input: TouchInput): void {
  const { userId, lineId, leagueId } = input
  if (!userId && !lineId) return
  waitUntil(performTouch({ userId, lineId, leagueId }))
}

async function performTouch(input: TouchInput): Promise<void> {
  const { userId, lineId, leagueId } = input
  try {
    // Resolve the canonical User row by either identifier (mirrors the
    // gate shape in `requireSelfPlayerSession`). Pull the stored
    // defaultLeagueId AND the linked playerId in the same lookup so we
    // can short-circuit on equal-value writes and still verify
    // membership without a second round-trip.
    let user = userId
      ? await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, defaultLeagueId: true, playerId: true },
        })
      : null
    if (!user && lineId) {
      user = await prisma.user.findUnique({
        where: { lineId },
        select: { id: true, defaultLeagueId: true, playerId: true },
      })
    }
    if (!user) return
    if (user.defaultLeagueId === leagueId) return

    // Membership check — prefer User.playerId (canonical), fall back to
    // Player.lineId for grandfathered sessions.
    const playerWhere = user.playerId
      ? { id: user.playerId }
      : lineId
        ? { lineId }
        : null
    if (!playerWhere) return

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
    if (!player || player.leagueAssignments.length === 0) return

    await prisma.user.update({
      where: { id: user.id },
      data: { defaultLeagueId: leagueId },
    })
  } catch (err) {
    console.warn('[touchUserDefaultLeague] write failed; ignoring:', err)
  }
}
