/**
 * v1.85.0 — homepage redesign phase 1c. Shared bundle of the read
 * calls every league-page render needs:
 *
 *   getPublicLeagueData, getLeagueFlags, getRecruitingViewerState,
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
 *
 * v1.98.0 — the standalone `prisma.league.findUnique` that populated
 * `bundle.league` is gone. Identity columns (id, name, abbreviation,
 * ballType) now ride on `getLeagueFlags` (which already cached the
 * same row under the `leagues` tag for 30 s). One fewer Prisma
 * round-trip per render — savings compound across the apex hub,
 * /id/<slug>, /id/<slug>/md/<id>, /id/<slug>/join, /stats, /schedule
 * — every league-scoped page that called this bundle.
 *
 * v2.0.0 — optional Redis-backed read-through cache keyed by
 * (viewerKey, leagueId), 60 s TTL, version-bump invalidation via
 * `bumpDashboardVersion()` chained off `revalidate({ domain })`.
 * Callers thread a `viewerKey` derived from `buildViewerKey({ userId,
 * lineId })`. When omitted (backward compat for any call site that
 * hasn't been migrated), the bundle runs the live Promise.all
 * without touching Redis. See `src/lib/dashboardCache.ts` for the
 * full architecture note. Browser-measured impact (warm /id/t9l on
 * prod): 3–6 s body-stream window → ~80 ms Redis round-trip on a hit.
 */

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
import { getCachedBundle } from '@/lib/dashboardCache'

export interface LeaguePageBundle {
  data: LeagueData
  flags: LeagueFlags
  recruitingState: RecruitingViewerState
  /**
   * v1.98.0 — pulled from `flags.league` instead of a standalone
   * `prisma.league.findUnique`. The shape on the bundle is preserved
   * so call sites that read `bundle.league` continue to compile.
   */
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

async function readLeaguePageBundle(
  leagueId: string,
): Promise<LeaguePageBundle | null> {
  try {
    const [
      data,
      flags,
      recruitingState,
      unpaidFee,
      plannedRosterStats,
      leagueDetails,
    ] = await Promise.all([
      getPublicLeagueData(leagueId),
      getLeagueFlags(leagueId),
      getRecruitingViewerState(leagueId),
      getUnpaidFeeBannerData(leagueId),
      getPlannedRosterStats(leagueId),
      getLeagueDetails(leagueId),
    ])
    return {
      data,
      flags,
      recruitingState,
      league: flags.league,
      unpaidFee,
      plannedRosterStats,
      leagueDetails,
    }
  } catch (err) {
    console.warn('[leaguePageData] bundle read failed:', err)
    return null
  }
}

export async function getLeaguePageBundle(
  leagueId: string,
  viewerKey?: string,
): Promise<LeaguePageBundle | null> {
  if (!viewerKey) {
    // Backward-compat path: callers that haven't been migrated to
    // pass a viewerKey skip the Redis cache entirely. Keeps the
    // contract narrow for the v2.0.0 cache rollout — only the two
    // hot paths (`/id/<slug>` and `<MultiLeagueHub>`) opt in.
    return readLeaguePageBundle(leagueId)
  }
  return getCachedBundle(leagueId, viewerKey, () =>
    readLeaguePageBundle(leagueId),
  )
}
