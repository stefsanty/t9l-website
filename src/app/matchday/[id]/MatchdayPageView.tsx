'use client'

import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import type {
  Team,
  Player,
  Matchday,
  Goal,
  Availability,
  AvailabilityStatuses,
  PlayedStatus,
} from '@/types'
import Header from '@/components/Header'
import NextMatchdayBanner from '@/components/NextMatchdayBanner'
import GuestLoginBanner from '@/components/GuestLoginBanner'
import MatchdayAvailability from '@/components/MatchdayAvailability'
import RsvpBar from '@/components/RsvpBar'
import UserTeamBadge from '@/components/UserTeamBadge'
import SubmitGoalForm from '@/components/matchday/SubmitGoalForm'

/**
 * v1.47.0 — per-matchday public page, mirrored from the homepage Dashboard.
 *
 * Pre-v1.47.0 the matchday route ([src/app/matchday/[id]/page.tsx]) had
 * its own bespoke layout: header + rich per-match scoreline + per-event
 * timeline + inline self-report form. The homepage already had a polished
 * "matchday banner + availability" composition that the user preferred.
 * v1.47.0 replaces the bespoke layout with the homepage shape — same
 * NextMatchdayBanner, same MatchdayAvailability, same RsvpBar, same
 * UserTeamBadge — locked to the URL matchday. The CTA to submit a goal
 * lives below the banner (PR ζ's gate is unchanged).
 *
 * Differences from the homepage Dashboard:
 *   1. `lockToSelected` on NextMatchdayBanner — the URL is the source of
 *      truth for which matchday is rendered. Swipe / arrow / dot navigation
 *      routes via `router.push('/matchday/<new-id>')` rather than mutating
 *      local state. Avoids the homepage's "auto-default to user's next
 *      playing matchday" useEffect from clobbering the URL selection.
 *   2. Big "Submit a goal" CTA + modal below the banner — gated server-side
 *      via PR ζ's `selfReportGateOpen`; mounted only when the gate is open
 *      AND the user has a linked Player record on a participating team.
 *   3. "← Back to schedule" link at the top — small affordance for users
 *      arriving from the schedule view.
 *
 * Per-match event timeline (the rich PEN/SP/OG-decorated rows from
 * v1.45.0's bespoke layout) is dropped — the homepage's MatchdayCard
 * already shows minute + scorer + assister + (OG) per goal in a more
 * compact form. PEN/SP markers are deferred; the underlying data is
 * preserved on MatchEvent and surfaced in the admin Stats tab CRUD.
 */

interface MatchdayPageViewProps {
  matchdayId: string
  teams: Team[]
  players: Player[]
  matchdays: Matchday[]
  goals: Goal[]
  availability: Availability
  availabilityStatuses: AvailabilityStatuses
  played: PlayedStatus
  /** Outcome of the PR ζ server-side gate; the CTA is mounted only when true. */
  selfReportGateOpen: boolean
  /** The session user's linked player (null when unauthenticated / no link). */
  myPlayer: Player | null
  /** Matches in this matchday where the user's team is playing. */
  participatingMatches: Array<{
    id: string
    homeTeamId: string
    awayTeamId: string
    homeTeamName: string
    awayTeamName: string
  }>
  /** The user's teammates in the rendered league (for the assister picker). */
  teammates: Player[]
}

export default function MatchdayPageView({
  matchdayId,
  teams,
  players,
  matchdays,
  goals,
  availability,
  availabilityStatuses,
  played,
  selfReportGateOpen,
  myPlayer,
  participatingMatches,
  teammates,
}: MatchdayPageViewProps) {
  const router = useRouter()
  const { data: session } = useSession()

  const selectedMatchday =
    matchdays.find((m) => m.id === matchdayId) ?? matchdays[0]

  const userTeamId = session?.teamId ?? null
  const userPlayerId = session?.playerId ?? null
  const userTeam = userTeamId
    ? (teams.find((t) => t.id === userTeamId) ?? null)
    : null
  const userTeamIsPlaying = !!(
    userTeamId &&
    selectedMatchday &&
    selectedMatchday.sittingOutTeamId !== userTeamId
  )
  const isCompleted = !!(
    selectedMatchday && selectedMatchday.matches[0]?.homeGoals !== null
  )
  const userRsvpStatus: 'GOING' | 'UNDECIDED' | 'Y' | 'EXPECTED' | '' = (userPlayerId &&
  userTeamId &&
  selectedMatchday
    ? availabilityStatuses?.[selectedMatchday.id]?.[userTeamId]?.[userPlayerId] ?? ''
    : '') as 'GOING' | 'UNDECIDED' | 'Y' | 'EXPECTED' | ''

  const showRsvpBar = !!(session?.playerId && userTeamIsPlaying && !isCompleted)

  // Banner navigation: the URL is canonical, so swipe/arrow/dot navigation
  // routes via Next router rather than mutating local state. The banner's
  // `lockToSelected` prop disables the homepage's auto-default useEffect.
  function navigateToMatchday(id: string) {
    router.push(`/matchday/${id}`)
  }

  return (
    <div className="flex flex-col min-h-dvh pb-0 max-w-lg mx-auto bg-background selection:bg-vibrant-pink selection:text-white">
      <Header />

      <main
        className={`flex-1 px-4 relative z-10 pt-12 ${
          showRsvpBar ? 'pb-32' : 'pb-2'
        }`}
      >
        <div className="animate-in pt-2">
          <div className="mb-3">
            <Link
              href="/schedule"
              className="text-[10px] font-black uppercase tracking-widest text-fg-mid hover:text-fg-high transition-colors inline-flex items-center gap-1"
              data-testid="matchday-back"
            >
              <span>←</span> Schedule
            </Link>
          </div>

          <GuestLoginBanner />
          <UserTeamBadge teams={teams} />
          <NextMatchdayBanner
            matchdays={matchdays}
            selectedMatchdayId={matchdayId}
            onMatchdayChange={navigateToMatchday}
            teams={teams}
            goals={goals}
            lockToSelected
          />

          {selfReportGateOpen && myPlayer ? (
            <SubmitGoalForm
              matchday={selectedMatchday}
              participatingMatches={participatingMatches}
              teammates={teammates}
              myTeamId={myPlayer.teamId}
            />
          ) : null}

          <MatchdayAvailability
            key={matchdayId}
            matchday={selectedMatchday}
            teams={teams}
            players={players}
            availability={availability}
            availabilityStatuses={availabilityStatuses}
            played={played}
          />
        </div>
      </main>

      <footer className="mt-3 mb-0 text-center px-4 pb-2">
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-fg-low">
          © 2026 Tennozu 9-Aside League • Tokyo
        </p>
      </footer>

      {selectedMatchday ? (
        <RsvpBar
          key={`${selectedMatchday.id}-${session?.playerId ?? 'anon'}`}
          matchday={selectedMatchday}
          initialStatus={userRsvpStatus}
          userTeam={userTeam}
          userTeamIsPlaying={userTeamIsPlaying}
          isCompleted={isCompleted}
        />
      ) : null}
    </div>
  )
}
