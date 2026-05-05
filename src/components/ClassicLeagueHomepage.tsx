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
import RsvpBar from './RsvpBar'

/**
 * v1.63.0 — Classic League Homepage wrapper.
 *
 * Names the existing public-homepage experience: NextMatchdayBanner +
 * MatchdayAvailability + RsvpBar (fixed-bottom). When `League.preseasonMode`
 * is OFF (default), Dashboard renders this; when ON, it renders
 * `<CompressedMatchdaySchedule />` instead. The three components are
 * grouped here so the swap is a single conditional in Dashboard rather
 * than three parallel ones — and the name makes the swap intent obvious
 * to future readers.
 *
 * `submitGoalSlot` lets Dashboard inject the Submit-Goal CTA between the
 * banner and the availability section without coupling the gate logic
 * (kickoff time has passed) to this wrapper. The slot is positioned
 * exactly where SubmitGoalForm rendered pre-v1.63.0.
 *
 * Session-derived state (user team, RSVP status, completion check) lives
 * in this component so Dashboard doesn't have to recompute it for the
 * pre-season branch where it's irrelevant.
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
  /** Session-derived flags — Dashboard owns the session read once. */
  userTeam: Team | null
  userTeamIsPlaying: boolean
  isCompleted: boolean
  userPlayerId: string | null
  userTeamId: string | null
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
  userTeam,
  userTeamIsPlaying,
  isCompleted,
  userPlayerId,
  userTeamId,
}: ClassicLeagueHomepageProps) {
  const selectedMatchday =
    matchdays.find((m) => m.id === selectedMatchdayId) ?? matchdays[0]

  const userRsvpStatus: 'GOING' | 'UNDECIDED' | 'Y' | 'EXPECTED' | '' =
    (userPlayerId && userTeamId && selectedMatchday
      ? availabilityStatuses?.[selectedMatchday.id]?.[userTeamId]?.[userPlayerId] ?? ''
      : '') as 'GOING' | 'UNDECIDED' | 'Y' | 'EXPECTED' | ''

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

      {selectedMatchday && (
        <RsvpBar
          key={`${selectedMatchday.id}-${userPlayerId ?? 'anon'}`}
          matchday={selectedMatchday}
          initialStatus={userRsvpStatus}
          userTeam={userTeam}
          userTeamIsPlaying={userTeamIsPlaying}
          isCompleted={isCompleted}
        />
      )}
    </>
  )
}
