import type { Player, Team } from '@/types'
import { prisma } from '@/lib/prisma'

/**
 * Player row shape with a `linked` flag — set when another LINE user already
 * holds that `Player.lineId` in Prisma. Rendered greyed-out + non-clickable
 * in `AssignPlayerClient` so the user can see them on the roster but can't
 * pick them and watch the optimistic UI flip falsely (the API would 409 a
 * second later — see PR 14 / v1.4.2).
 */
export interface AnnotatedPlayer extends Player {
  linked: boolean
}

export interface AnnotatedPlayerGroup {
  team: Team
  players: AnnotatedPlayer[]
}

/**
 * DB-side `Player.id` carries a `p-` prefix inserted by the PR 6 backfill;
 * the public-side slug doesn't. Mirrors `stripPrefix` in `lib/auth.ts`.
 */
const PLAYER_ID_PREFIX = 'p-'
function dbPlayerIdToPublicSlug(dbId: string): string {
  return dbId.startsWith(PLAYER_ID_PREFIX)
    ? dbId.slice(PLAYER_ID_PREFIX.length)
    : dbId
}

/**
 * Pure annotator. Given roster groups and a set of public-slug ids that are
 * already linked to *another* LINE user, return the same shape with each
 * player flagged. The caller is expected to have already excluded the
 * viewer's own player from `linkedIds` — that decision belongs server-side
 * (where the session is read), not in this helper.
 *
 * No I/O — fully unit-testable.
 */
export function annotatePlayersWithLinkedStatus(
  groups: { team: Team; players: Player[] }[],
  linkedIds: ReadonlySet<string>,
): AnnotatedPlayerGroup[] {
  return groups.map(({ team, players }) => ({
    team,
    players: players.map((p) => ({ ...p, linked: linkedIds.has(p.id) })),
  }))
}

/**
 * I/O side: which public-slug ids currently hold a non-null `Player.lineId`,
 * minus the viewer's own. Returns an empty set on Prisma failure rather than
 * throwing — a stale "everyone selectable" picker is strictly less harmful
 * than a 500 on /assign-player. (The legitimate-conflict case still 409s on
 * the API write; this filter is a UX hint, not a security boundary.)
 */
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
    return new Set(rows.map((r) => dbPlayerIdToPublicSlug(r.id)))
  } catch (err) {
    console.warn('[linkedPlayers] Prisma findMany failed; returning empty set:', err)
    return new Set()
  }
}
