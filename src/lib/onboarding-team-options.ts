/**
 * v2.2.9 — onboarding team-picker data source.
 *
 * Fetches every LeagueTeam in a league with its current roster, filtered
 * to qualifying members (status = ACTIVE; applicationStatus ∈
 * {APPROVED, PENDING}; toGameWeek = null). Each member's "primary
 * position" is the first preferred code (legacy single position is used
 * as fallback for PLMs that haven't been re-saved since v1.86.0).
 *
 * Members are sorted by primary position then name via the canonical
 * helper in `src/lib/positions.ts` so callers (the picker card render)
 * don't have to re-implement ordering. The current player (the one
 * filling out the form) is excluded from their own card — passing
 * `currentPlayerId` is mandatory to avoid showing yourself in the list.
 *
 * Pure read — no caching layer. Called once per onboarding render on a
 * page that already does a fan-out (`Promise.all`) so the extra query
 * is amortised. Onboarding is low-QPS by definition (one render per new
 * joiner) — adding `unstable_cache` would burn cache slots for no win.
 */
import { prisma } from '@/lib/prisma'
import { sortMembersByPrimaryPositionThenName, type BallType } from '@/lib/positions'

export interface TeamPickerMember {
  playerId: string
  name: string
  primaryPosition: string | null
}

export interface TeamPickerOption {
  leagueTeamId: string
  teamName: string
  color: string | null
  logoUrl: string | null
  members: TeamPickerMember[]
}

export async function getTeamPickerOptions(
  leagueId: string,
  currentPlayerId: string | null,
  ballType: BallType | null | undefined,
): Promise<TeamPickerOption[]> {
  // v2.2.16 — exclude teams whose `allowOnboardingJoin` flag is
  // false. Premade teams that signed up separately opt out of the
  // picker via the admin toggle on the league-teams page; the
  // server-side write paths re-validate (defence against a stale
  // client cache surfacing a since-disabled team).
  const leagueTeams = await prisma.leagueTeam.findMany({
    where: { leagueId, team: { allowOnboardingJoin: true } },
    include: {
      team: true,
      playerAssignments: {
        where: {
          toGameWeek: null,
          status: 'ACTIVE',
          applicationStatus: { in: ['APPROVED', 'PENDING'] },
        },
        include: {
          player: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { team: { name: 'asc' } },
  })

  return leagueTeams.map((lt) => {
    const rawMembers: TeamPickerMember[] = lt.playerAssignments
      .filter((plm) => plm.player.id !== currentPlayerId)
      .map((plm) => ({
        playerId: plm.player.id,
        name: plm.player.name ?? 'Unnamed player',
        primaryPosition:
          plm.preferredPositions[0] ??
          plm.positions[0] ??
          plm.position ??
          null,
      }))
    return {
      leagueTeamId: lt.id,
      teamName: lt.team.name,
      color: lt.team.color ?? null,
      logoUrl: lt.team.logoUrl ?? null,
      members: sortMembersByPrimaryPositionThenName(rawMembers, ballType),
    }
  })
}
