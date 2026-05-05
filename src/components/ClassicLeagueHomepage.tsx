'use client'

import type { ReactNode } from 'react'
import type {
  Team,
  Player,
  Matchday,
  Goal,
  Availability,
  AvailabilityStatuses,
  PlayedStatus,
} from '@/types'
import NextMatchdayBanner from './NextMatchdayBanner'
import MatchdayAvailability from './MatchdayAvailability'

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

      <MatchdayAvailability
        key={selectedMatchdayId}
        matchday={selectedMatchday}
        teams={teams}
        players={players}
        availability={availability}
        availabilityStatuses={availabilityStatuses}
        played={played}
      />
    </>
  )
}
