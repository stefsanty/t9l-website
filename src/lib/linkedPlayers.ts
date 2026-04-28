import { prisma } from '@/lib/prisma'

/**
 * Public-slug ids of every Player whose `lineId` is held by another LINE
 * user, excluding the viewer's own. Consumed by `/assign-player` (PR 15 /
 * v1.4.3) to filter linked players out of the picker entirely — they never
 * render at all, so the user can only see what they can actually pick.
 *
 * DB-side `Player.id` carries a `p-` prefix inserted by the PR 6 backfill;
 * the public-side slug doesn't. Mirrors `stripPrefix` in `lib/auth.ts`.
 *
 * Returns an empty set on Prisma failure rather than throwing — a stale
 * "everyone selectable" picker is strictly less harmful than a 500 on
 * /assign-player. The legitimate-conflict case still 409s on the API write;
 * this filter is a UX hint, not a security boundary.
 */
const PLAYER_ID_PREFIX = 'p-'

export async function getLinkedPlayerIds(
  viewerLineId: string | null,
): Promise<Set<string>> {
  try {
    const rows = await prisma.player.findMany({
      where: {
        lineId: { not: null },
        ...(viewerLineId ? { NOT: { lineId: viewerLineId } } : {}),
      },
      select: { id: true },
    })
    return new Set(
      rows.map((r) =>
        r.id.startsWith(PLAYER_ID_PREFIX)
          ? r.id.slice(PLAYER_ID_PREFIX.length)
          : r.id,
      ),
    )
  } catch (err) {
    console.warn('[linkedPlayers] Prisma findMany failed; returning empty set:', err)
    return new Set()
  }
}
