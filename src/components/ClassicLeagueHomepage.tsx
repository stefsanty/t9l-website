'use client'

import type { ReactNode } from 'react'
import dynamic from 'next/dynamic'
import type {
  Team,
  Player,
  Matchday,
  Goal,
  Availability,
  AvailabilityStatuses,
  PlayedStatus,
  MatchdayGuests,
} from '@/types'
import NextMatchdayBanner from './NextMatchdayBanner'

// v1.80.3 — phase 2 H3: lazy-load the below-fold "Who else is coming?"
// availability section. NextMatchdayBanner stays in the initial bundle as
// the LCP candidate; MatchdayAvailability (522 lines, the largest single
// below-fold widget on the homepage) ships as a separate chunk and only
// hydrates after the banner. The skeleton reserves vertical space to
// approximate the typical 4-team collapsed view (~52px per row + header)
// so scroll position stays stable while the chunk arrives.
const MatchdayAvailability = dynamic(() => import('./MatchdayAvailability'), {
  loading: () => (
    <section
      data-testid="matchday-availability-skeleton"
      aria-hidden
      className="mt-4 mb-12 animate-pulse"
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="h-3 w-32 rounded bg-surface-md" />
        <div className="h-[1px] flex-1 bg-border-subtle" />
      </div>
      <div className="grid gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-[52px] rounded-xl bg-surface border border-border-subtle"
          />
        ))}
      </div>
    </section>
  ),
})

/**
 * v1.63.0 — Classic League Homepage wrapper.
 *
 * Names the existing public-homepage experience: NextMatchdayBanner +
 * MatchdayAvailability. When `League.preseasonMode` is OFF (default),
 * Dashboard renders this; when ON, it renders `<CompressedMatchdaySchedule />`
 * instead. The components are grouped here so the swap is a single
 * conditional in Dashboard rather than parallel ones — and the name makes
 * the swap intent obvious to future readers.
 *
 * `submitGoalSlot` lets Dashboard inject the Submit-Goal CTA between the
 * banner and the availability section without coupling the gate logic
 * (kickoff time has passed) to this wrapper. The slot is positioned
 * exactly where SubmitGoalForm rendered pre-v1.63.0.
 *
 * v1.63.1 — RsvpBar removed from this wrapper. The `.animate-in` ancestor
 * div in Dashboard sets `animation-fill-mode: forwards` on a `translateY`
 * keyframe; the resulting non-none `transform` establishes a containing
 * block for `position: fixed` descendants, breaking RsvpBar's viewport-
 * anchored bottom positioning. RsvpBar moves back to Dashboard's outer
 * level (sibling of `<main>` and `<footer>`) where it was pre-v1.63.0.
 */

interface ClassicLeagueHomepageProps {
  selectedMatchdayId: string
  setSelectedMatchdayId: (id: string) => void
  matchdays: Matchday[]
  teams: Team[]
  players: Player[]
  goals: Goal[]
  availability: Availability
  availabilityStatuses: AvailabilityStatuses
  played: PlayedStatus
  /**
   * Pre-select a specific matchday on first render. When the parent is
   * `/id/<slug>/md/<matchdayId>`, the URL is the source of truth and
   * `lockToSelected` flips on so the banner doesn't auto-jump.
   */
  initialMatchdayId?: string | null
  leagueSlug?: string
  /** Submit-Goal CTA — gated on kickoff in Dashboard. Slot kept neutral here. */
  submitGoalSlot?: ReactNode
  /** v1.75.4 — LeagueDetailsPanel slot, positioned between NextMatchdayBanner and MatchdayAvailability. */
  leagueDetailsPanelSlot?: ReactNode
  /**
   * v1.83.0 — league context for the formation visualization (catalog
   * selection + slot-position vocabulary). Both optional; when absent
   * MatchdayAvailability falls back to SOCCER + 9-aside.
   */
  ballType?: 'SOCCER' | 'FUTSAL' | null
  playerFormat?: number | null
  /**
   * v1.93.0 — per-row typed guest entries threaded into MatchdayAvailability
   * so each team's "+ Guests" trigger prefills the modal table. Replaces
   * the v1.91.0 `guestCounts` count map.
   */
  guests?: MatchdayGuests
}

export default function ClassicLeagueHomepage({
  selectedMatchdayId,
  setSelectedMatchdayId,
  matchdays,
  teams,
  players,
  goals,
  availability,
  availabilityStatuses,
  played,
  initialMatchdayId,
  leagueSlug,
  submitGoalSlot,
  leagueDetailsPanelSlot,
  ballType,
  playerFormat,
  guests,
}: ClassicLeagueHomepageProps) {
  const selectedMatchday =
    matchdays.find((m) => m.id === selectedMatchdayId) ?? matchdays[0]

  return (
    <>
      <NextMatchdayBanner
        matchdays={matchdays}
        selectedMatchdayId={selectedMatchdayId}
        onMatchdayChange={setSelectedMatchdayId}
        teams={teams}
        goals={goals}
        lockToSelected={initialMatchdayId != null}
        leagueSlug={leagueSlug}
      />

      {submitGoalSlot}

      {leagueDetailsPanelSlot}

      <MatchdayAvailability
        key={selectedMatchdayId}
        matchday={selectedMatchday}
        teams={teams}
        players={players}
        availability={availability}
        availabilityStatuses={availabilityStatuses}
        played={played}
        ballType={ballType}
        playerFormat={playerFormat}
        guests={guests}
        leagueSlug={leagueSlug}
      />
    </>
  )
}
