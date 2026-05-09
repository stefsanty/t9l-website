/**
 * v1.85.0 — homepage redesign phase 1c. Shared bundle of the seven
 * read calls that every league-page render needs:
 *
 *   getPublicLeagueData, getLeagueFlags, getRecruitingViewerState,
 *   prisma.league.findUnique({ id, name, abbreviation, ballType }),
 *   getUnpaidFeeBannerData, getPlannedRosterStats, getLeagueDetails.
 *
 * Pre-v1.85.0 the same `Promise.all` block was duplicated across
 * `/page.tsx`, `/id/<slug>/page.tsx`, `/id/<slug>/md/<id>/page.tsx`
 * (added incrementally between v1.49.0 and v1.83.0). The new
 * `<MultiLeagueHub>` server component would have been a fourth copy;
 * instead the read is centralised here and every consumer threads the
 * resulting bundle into the existing `<Dashboard>` props.
 *
 * Returns `null` from the catch branch so callers can render their own
 * fallback surface (every existing call site already does — they each
 * render the `<div>Data unavailable</div>` block).
 */

import { prisma } from '@/lib/prisma'
import type { LeagueData } from '@/types'
import { getPublicLeagueData } from '@/lib/publicData'
import { getLeagueFlags, type LeagueFlags } from '@/lib/leagueFlags'
import {
  getRecruitingViewerState,
  type RecruitingViewerState,
} from '@/lib/recruitingViewerState'
import { getUnpaidFeeBannerData, type UnpaidFeeBannerData } from '@/lib/unpaidFeeBanner'
import {
  getPlannedRosterStats,
  type PlannedRosterStats,
} from '@/lib/plannedRosterStats'
import { getLeagueDetails } from '@/lib/leagueDetailsServer'
import type { LeagueDetails } from '@/lib/leagueDetails'

export interface LeaguePageBundle {
  data: LeagueData
  flags: LeagueFlags
  recruitingState: RecruitingViewerState
  league: {
    id: string
    name: string
    abbreviation: string | null
    ballType: 'SOCCER' | 'FUTSAL'
  } | null
  unpaidFee: UnpaidFeeBannerData | null
  plannedRosterStats: PlannedRosterStats | null
  leagueDetails: LeagueDetails | null
}

export async function getLeaguePageBundle(
  leagueId: string,
): Promise<LeaguePageBundle | null> {
  try {
    const [
      data,
      flags,
      recruitingState,
      league,
      unpaidFee,
      plannedRosterStats,
      leagueDetails,
    ] = await Promise.all([
      getPublicLeagueData(leagueId),
      getLeagueFlags(leagueId),
      getRecruitingViewerState(leagueId),
      prisma.league.findUnique({
        where: { id: leagueId },
        select: { id: true, name: true, abbreviation: true, ballType: true },
      }),
      getUnpaidFeeBannerData(leagueId),
      getPlannedRosterStats(leagueId),
      getLeagueDetails(leagueId),
    ])
    return {
      data,
      flags,
      recruitingState,
      league,
      unpaidFee,
      plannedRosterStats,
      leagueDetails,
    }
  } catch (err) {
    console.warn('[leaguePageData] bundle read failed:', err)
    return null
  }
}
