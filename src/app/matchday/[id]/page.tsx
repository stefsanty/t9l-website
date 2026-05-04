import { notFound } from 'next/navigation'
import { getPublicLeagueData } from '@/lib/publicData'
import { getLeagueIdFromRequest } from '@/lib/getLeagueFromHost'
import { findNextMatchday } from '@/lib/stats'
import Dashboard from '@/components/Dashboard'
import type { Goal } from '@/types'

export const metadata = {
  title: 'Matchday | T9L',
}

type Props = { params: Promise<{ id: string }> }

/**
 * v1.45.0 (PR ε) — per-matchday public route. Subdomain-aware via
 * `getLeagueIdFromRequest()`. The `[id]` segment matches the public matchday
 * id (`md1`, `md4`, etc. — same shape `dbToPublicLeagueData` produces).
 * 404s when the matchday isn't in the resolved league.
 *
 * v1.47.0 — page delegated to a `MatchdayPageView` client component that
 * mirrored the homepage Dashboard layout.
 *
 * v1.48.0 — homepage IS the matchday page. The route is now a thin server
 * component that resolves the league + verifies the matchday exists, then
 * hands data to the same `Dashboard` the apex renders, with
 * `initialMatchdayId` pre-selecting the URL matchday. The user can swipe /
 * arrow / dot between matchdays from there as on homepage; the URL is
 * the entry point, not a continuous source of truth, so subsequent
 * navigation is local state (no per-swipe URL push).
 *
 * `MatchdayPageView` is gone — it was a thin shim and is no longer needed.
 * The Submit-goal CTA + modal that lived inside it now live inside the
 * Dashboard (homepage gets the CTA too, per v1.48.0's open-attribution
 * model).
 */
export default async function MatchdayPage({ params }: Props) {
  const { id } = await params
  const leagueId = await getLeagueIdFromRequest()

  if (leagueId === null) {
    return (
      <div className="flex items-center justify-center min-h-dvh bg-midnight text-white px-6 text-center">
        <div>
          <p className="font-display text-3xl font-black uppercase text-white/80 mb-2">
            League not found
          </p>
          <p className="text-sm text-white/80 font-bold uppercase tracking-widest">
            This subdomain is not attached to a league.
          </p>
        </div>
      </div>
    )
  }

  const data = await getPublicLeagueData(leagueId)
  const md = data.matchdays.find((m) => m.id === id)
  if (!md) notFound()

  const nextMd = findNextMatchday(data.matchdays)

  return (
    <Dashboard
      teams={data.teams}
      players={data.players}
      matchdays={data.matchdays}
      goals={data.goals}
      availability={data.availability}
      availabilityStatuses={data.availabilityStatuses}
      played={data.played}
      nextMd={nextMd}
      initialMatchdayId={md.id}
    />
  )
}

/**
 * Pure helper retained for backward compat — used by tests + the homepage
 * MatchdayCard's per-goal decoration. Returns the short label for a goalType
 * enum value (or null when no decoration applies).
 */
export function goalTypeLabel(t: Goal['goalType']): string | null {
  switch (t) {
    case 'OPEN_PLAY':
      return null
    case 'SET_PIECE':
      return 'set piece'
    case 'PENALTY':
      return 'pen'
    case 'OWN_GOAL':
      return 'OG'
    default:
      return null
  }
}
