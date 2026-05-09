import { findNextMatchday } from '@/lib/stats'
import { getLeaguePageBundle } from '@/lib/leaguePageData'
import type { ApprovedMembership } from '@/lib/homepageRouting'
import Dashboard from '@/components/Dashboard'
import LeagueSwitcherTabs from './LeagueSwitcherTabs'
import RecruitingHandoff from './RecruitingHandoff'

/**
 * v1.85.0 — homepage redesign phase 1c. Server component rendered by
 * `<HomepageRouter>` for users with ≥ 2 APPROVED memberships.
 *
 * Renders the FULL classic Dashboard for the active league
 * (`activeLeagueId`, derived in `homepageRouting.classifyPersona` from
 * `User.defaultLeagueId` ∩ memberships, falling back to the
 * alphabetical-first APPROVED membership) and injects two new surfaces
 * into Dashboard's `topSlot`:
 *
 *   1. `<LeagueSwitcherTabs>` — pill-strip tab UI for switching the
 *      active league. Calls the `setUserDefaultLeague` server action
 *      and `router.refresh()`es so the page re-renders for the picked
 *      league. Hidden when memberships < 2 (defense; the persona
 *      resolver shouldn't hand us a multi shape with one tab).
 *
 *   2. `<RecruitingHandoff>` — capped (≤ 2) cards for PUBLIC_OPEN
 *      leagues the viewer is NOT in. Renders nothing when no
 *      candidates remain.
 *
 * Both surfaces flow inline with the rest of the dashboard content
 * (same `max-w-lg` column, below the fixed Header) so the page layout
 * stays as a single uniform stack.
 */
export default async function MultiLeagueHub({
  memberships,
  activeLeagueId,
}: {
  memberships: ReadonlyArray<ApprovedMembership>
  activeLeagueId: string
}) {
  const active = memberships.find((m) => m.leagueId === activeLeagueId)
  if (!active) {
    // Defensive: classifyPersona guarantees activeLeagueId ∈ memberships,
    // but if a stale render slips through we surface the same "data
    // unavailable" message as the page-level catch in /id/[slug].
    return <DataUnavailable />
  }

  const bundle = await getLeaguePageBundle(activeLeagueId)
  if (!bundle) return <DataUnavailable />

  const nextMd = findNextMatchday(bundle.data.matchdays)
  const excludeIds = memberships.map((m) => m.leagueId)

  const topSlot = (
    <div data-testid="multi-league-hub-top">
      <LeagueSwitcherTabs
        memberships={memberships}
        activeLeagueId={activeLeagueId}
      />
      <RecruitingHandoff excludeLeagueIds={excludeIds} />
    </div>
  )

  return (
    <Dashboard
      teams={bundle.data.teams}
      players={bundle.data.players}
      matchdays={bundle.data.matchdays}
      goals={bundle.data.goals}
      availability={bundle.data.availability}
      availabilityStatuses={bundle.data.availabilityStatuses}
      played={bundle.data.played}
      nextMd={nextMd}
      leagueSlug={active.slug}
      preseasonMode={bundle.flags.preseasonMode}
      recruiting={bundle.flags.visibility === 'PUBLIC_OPEN'}
      recruitingState={bundle.recruitingState}
      league={bundle.league ?? undefined}
      unpaidFee={bundle.unpaidFee ?? null}
      plannedRosterStats={bundle.plannedRosterStats ?? null}
      leagueDetails={bundle.leagueDetails ?? null}
      topSlot={topSlot}
    />
  )
}

function DataUnavailable() {
  return (
    <div className="flex items-center justify-center min-h-dvh bg-midnight text-white px-6 text-center">
      <div>
        <p className="font-display text-3xl font-black uppercase text-white/80 mb-2">
          Data unavailable
        </p>
        <p className="text-sm text-white/80 font-bold uppercase tracking-widest">
          Try again in a moment
        </p>
      </div>
    </div>
  )
}
