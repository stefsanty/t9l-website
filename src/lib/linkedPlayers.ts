import { prisma } from '@/lib/prisma'
import { playerIdToSlug } from '@/lib/ids'

/**
 * Public-slug ids of every Player linked to ANY authenticated user
 * (via `Player.lineId` for LINE users OR `Player.userId` for non-LINE
 * users), excluding the viewer's own player. Consumed by
 * `/assign-player` (PR 15 / v1.4.3, extended in v1.61.0) to filter
 * linked players out of the picker entirely — they never render at
 * all, so the user can only see what they can actually pick.
 *
 * v1.61.0 — extended to consider `Player.userId` so non-LINE flows
 * (Google / email magic-link) see linked players filtered too. Pre-
 * v1.61.0 the picker was LINE-keyed end-to-end; v1.61.0 drops that
 * restriction, so the filter must also be aware of userId-keyed
 * bindings.
 *
 * DB-side `Player.id` carries a `p-` prefix inserted by the PR 6
 * backfill; the public-side slug doesn't. v1.12 routes through the
 * canonical `playerIdToSlug` helper in `lib/ids.ts`.
 *
 * Viewer exclusion: the viewer is allowed to see their OWN player
 * (so the existing "you're already linked, click to confirm/unassign"
 * UX continues to work). For LINE viewers, exclude rows where
 * `lineId === viewerLineId`. For non-LINE viewers, exclude rows where
 * `userId === viewerUserId`. Both can be passed; both filters apply.
 *
 * Returns an empty set on Prisma failure rather than throwing — a
 * stale "everyone selectable" picker is strictly less harmful than a
 * 500 on /assign-player. The legitimate-conflict case still rejects
 * on the API write; this filter is a UX hint, not a security boundary.
 */
export async function getLinkedPlayerIds(
  viewer: { lineId: string | null; userId: string | null } | null = null,
): Promise<Set<string>> {
  const viewerLineId = viewer?.lineId ?? null
  const viewerUserId = viewer?.userId ?? null
  try {
    const rows = await prisma.player.findMany({
      where: {
        // OR — link is established via either column
        OR: [{ lineId: { not: null } }, { userId: { not: null } }],
        // AND-NOT viewer's own bindings (whichever apply)
        ...(viewerLineId || viewerUserId
          ? {
              NOT: [
                ...(viewerLineId ? [{ lineId: viewerLineId }] : []),
                ...(viewerUserId ? [{ userId: viewerUserId }] : []),
              ],
            }
          : {}),
      },
      select: { id: true },
    })
    return new Set(rows.map((r) => playerIdToSlug(r.id)))
  } catch (err) {
    console.warn('[linkedPlayers] Prisma findMany failed; returning empty set:', err)
    return new Set()
  }
}
