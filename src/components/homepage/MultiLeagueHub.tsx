import { findNextMatchday } from '@/lib/stats'
import { getLeaguePageBundle } from '@/lib/leaguePageData'
import { touchUserDefaultLeague } from '@/lib/userDefaultLeague'
import type { ApprovedMembership } from '@/lib/homepageRouting'
import Dashboard from '@/components/Dashboard'
import RecruitingHandoff from './RecruitingHandoff'
import HubTransitionShell from './HubTransitionShell'

/**
 * v1.85.0 — homepage redesign phase 1c. Server component rendered by
 * `<HomepageRouter>` for users with ≥ 2 APPROVED memberships.
 *
 * Renders the FULL classic Dashboard for the active league
 * (`activeLeagueId`, derived in `homepageRouting.classifyPersona` from
 * `searchParams.league` ∩ `User.defaultLeagueId` ∩ memberships, falling
 * back to the alphabetical-first APPROVED membership) and injects a
 * recruiting handoff into Dashboard's `topSlot`:
 *
 *   - `<RecruitingHandoff>` — capped (≤ 2) cards for PUBLIC_OPEN
 *     leagues the viewer is NOT in. Renders nothing when no
 *     candidates remain.
 *
 * v1.97.1 — the in-page `<LeagueSwitcherTabs>` is removed; the canonical
 * league-picker UI is now the Header chevron (`<LeagueSwitcher>`),
 * which on this route opens a 1-line horizontal scrollable pill bar
 * directly under the Header. The Header chevron reads the same
 * `useHubTransition()` context this shell provides, so its in-place
 * `?league=<id>` navigation still drives Dashboard's body-skeleton dim.
 *
 * v1.93.0 changes:
 *   - Accepts a `viewer` prop carrying the resolved session identifiers
 *     so `touchUserDefaultLeague` can pin the active league as the
 *     "last selection" without the switcher running a separate server
 *     action. Mirrors the existing `/id/<slug>/page.tsx` call site —
 *     same helper, same `waitUntil` shape, never blocks render.
 *   - Wraps the Dashboard in `<HubTransitionShell>` so the switcher's
 *     `useTransition` and the page-level "loading" affordance share
 *     the same pending signal.
 */
export default async function MultiLeagueHub({
  memberships,
  activeLeagueId,
  viewer,
}: {
  memberships: ReadonlyArray<ApprovedMembership>
  activeLeagueId: string
  viewer: { userId: string | null; lineId: string | null }
}) {
  const active = memberships.find((m) => m.leagueId === activeLeagueId)
  if (!active) {
    // Defensive: classifyPersona guarantees activeLeagueId ∈ memberships,
    // but if a stale render slips through we surface the same "data
    // unavailable" message as the page-level catch in /id/[slug].
    return <DataUnavailable />
  }

  // v1.93.0 — fire-and-forget pin. Mirrors the `/id/<slug>` call shape:
  // the helper short-circuits when `defaultLeagueId === activeLeagueId`
  // so this is a no-op on the dominant "user revisits their default
  // league" path, and `waitUntil` keeps the write off the request
  // critical path on the divergent path.
  touchUserDefaultLeague({
    userId: viewer.userId,
    lineId: viewer.lineId,
    leagueId: activeLeagueId,
  })

  const bundle = await getLeaguePageBundle(activeLeagueId)
  if (!bundle) return <DataUnavailable />

  const nextMd = findNextMatchday(bundle.data.matchdays)
  const excludeIds = memberships.map((m) => m.leagueId)

  const topSlot = (
    <div data-testid="multi-league-hub-top">
      <RecruitingHandoff excludeLeagueIds={excludeIds} />
    </div>
  )

  return (
    <HubTransitionShell>
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
        guests={bundle.data.guests}
      />
    </HubTransitionShell>
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
