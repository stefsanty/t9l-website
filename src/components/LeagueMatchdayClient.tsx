'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSession } from 'next-auth/react';
import type {
  Team,
  Player,
  Matchday,
  Goal,
  Availability,
  AvailabilityStatuses,
  PlayedStatus,
  MatchdayGuests,
} from '@/types';
import GuestLoginBanner from './GuestLoginBanner';
import UserTeamBadge from './UserTeamBadge';
import ClassicLeagueHomepage from './ClassicLeagueHomepage';
import type { RecruitingViewerState } from '@/lib/recruitingViewerState';
import type { LeagueDetails as LeagueDetailsData } from '@/lib/leagueDetails';
import type { PlannedRosterStats as PlannedRosterStatsData } from '@/lib/plannedRosterStats';
import { selfReportGateOpen } from '@/lib/playerSelfReportGate';
import { resolveLeagueScopedTeamId } from '@/lib/playerTeamScope';
import { combineJstDateAndTime } from '@/lib/jst';

/**
 * v2.1.0 — client-side owner of the matchday-section state for
 * `/id/<slug>`. Splits out from `<Dashboard>` so the matchday Suspense
 * boundary on the new multi-boundary page contains exactly:
 *   - GuestLoginBanner
 *   - UserTeamBadge
 *   - ClassicLeagueHomepage (NextMatchdayBanner + MatchdayAvailability
 *     + leagueDetailsPanelSlot)
 *   - CompressedMatchdaySchedule (preseason branch)
 *   - RsvpBar (anchored to the viewport via `position: fixed`)
 *
 * Owns the `selectedMatchdayId` useState so the banner + availability +
 * RsvpBar stay in sync across user swipes / matchday-dot taps. State
 * lives here (not lifted to a context provider) because RsvpBar and the
 * matchday surface are rendered in the SAME Suspense boundary — once
 * the heavy `getPublicLeagueData` call resolves, both mount together
 * with the same matchdays array. Banners live in a sibling Suspense
 * boundary that needs none of this state.
 *
 * RsvpBar containing-block correctness: pre-v2.1.0 Dashboard placed
 * RsvpBar OUTSIDE its `.animate-in` div because that div's
 * `transform: translateY(0)` (animation-fill-mode: forwards) would
 * establish a containing block for `position: fixed` descendants and
 * break the viewport anchor. The new `/id/<slug>/page.tsx` does NOT
 * wrap this component in `.animate-in` (the Suspense fallback → resolved
 * swap is the visual transition), so RsvpBar can live inline as the
 * last sibling without breaking its bottom anchor.
 */

const LeagueDetailsPanel = dynamic(() => import('./LeagueDetailsPanel'));
const PlannedRosterStats = dynamic(() => import('./PlannedRosterStats'));
const RsvpBar = dynamic(() => import('./RsvpBar'), { loading: () => null });
const SubmitGoalForm = dynamic(() => import('./matchday/SubmitGoalForm'), {
  loading: () => (
    <div
      data-testid="submit-goal-skeleton"
      aria-hidden
      className="mt-4 mb-6 h-[60px] rounded-2xl bg-surface-md animate-pulse"
    />
  ),
});
const CompressedMatchdaySchedule = dynamic(
  () => import('./CompressedMatchdaySchedule'),
  {
    loading: () => (
      <section
        data-testid="compressed-matchday-schedule-skeleton"
        aria-hidden
        className="animate-pulse space-y-2"
      >
        <div className="px-1 mb-2">
          <div className="h-3 w-40 rounded bg-surface-md" />
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl bg-card border border-border-subtle h-[88px]"
          />
        ))}
      </section>
    ),
  },
);

interface Props {
  teams: Team[];
  players: Player[];
  matchdays: Matchday[];
  goals: Goal[];
  availability: Availability;
  availabilityStatuses: AvailabilityStatuses;
  played: PlayedStatus;
  guests?: MatchdayGuests;
  nextMd: { matchday: Matchday; isNext: boolean } | null;
  initialMatchdayId?: string | null;
  leagueSlug: string;
  preseasonMode: boolean;
  ballType: 'SOCCER' | 'FUTSAL' | null;
  recruitingState?: RecruitingViewerState;
  leagueDetails: LeagueDetailsData | null;
  plannedRosterStats: PlannedRosterStatsData | null;
}

export default function LeagueMatchdayClient({
  teams,
  players,
  matchdays,
  goals,
  availability,
  availabilityStatuses,
  played,
  guests,
  nextMd,
  initialMatchdayId,
  leagueSlug,
  preseasonMode,
  ballType,
  recruitingState,
  leagueDetails,
  plannedRosterStats,
}: Props) {
  const { data: session } = useSession();
  const [selectedMatchdayId, setSelectedMatchdayId] = useState(
    initialMatchdayId ?? nextMd?.matchday.id ?? matchdays[0]?.id ?? '',
  );

  const selectedMatchday =
    matchdays.find((m) => m.id === selectedMatchdayId) ?? matchdays[0];

  const userPlayerId = session?.playerId ?? null;
  // v2.2.16 — session.teamId is JWT-resolved against the default league
  // (see auth.ts JWT callback). For non-default leagues, derive the
  // user's team from the rendered `players` array so the RSVP-status
  // lookup (`availabilityStatuses[mdId][teamId][playerId]`) and the
  // "is my team playing" check both key off the league-scoped team.
  // Falls back to session.teamId when the player isn't in this league.
  const userTeamId = resolveLeagueScopedTeamId({
    players,
    userPlayerId,
    sessionTeamId: session?.teamId ?? null,
  });
  const currentLeagueTeamId: string | null =
    recruitingState?.kind === 'approved_this'
      ? recruitingState.team.id
      : userTeamId;
  const userTeam = userTeamId
    ? (teams.find((t) => t.id === userTeamId) ?? null)
    : null;
  const userTeamIsPlaying = !!(
    userTeamId &&
    selectedMatchday &&
    selectedMatchday.sittingOutTeamId !== userTeamId
  );
  const isCompleted = !!(
    selectedMatchday && selectedMatchday.matches[0].homeGoals !== null
  );

  const userRsvpStatus: 'GOING' | 'UNDECIDED' | 'Y' | 'EXPECTED' | '' =
    (userPlayerId && userTeamId && selectedMatchday
      ? (availabilityStatuses?.[selectedMatchday.id]?.[userTeamId]?.[
          userPlayerId
        ] ?? '')
      : '') as 'GOING' | 'UNDECIDED' | 'Y' | 'EXPECTED' | '';

  const showRsvpBar =
    !preseasonMode && !!(session?.playerId && userTeamIsPlaying && !isCompleted);

  const submitGateOpen = useMemo(() => {
    if (!session?.playerId || !selectedMatchday?.date) return false;
    const kickoffs: Date[] = [];
    for (const m of selectedMatchday.matches) {
      if (!m.kickoff) continue;
      try {
        kickoffs.push(combineJstDateAndTime(selectedMatchday.date, m.kickoff));
      } catch {
        // Defensive — skip malformed kickoff rather than crash render.
      }
    }
    return selfReportGateOpen({
      hasSession: true,
      hasLinkedPlayer: true,
      matchKickoffs: kickoffs,
      now: new Date(),
    });
  }, [session?.playerId, selectedMatchday]);

  const teamLookup = useMemo(() => {
    const map = new Map<string, Team>();
    for (const t of teams) map.set(t.id, t);
    return map;
  }, [teams]);

  const submitMatches = useMemo(() => {
    if (!selectedMatchday) return [];
    return selectedMatchday.matches.map((m) => ({
      id: m.id,
      homeTeamId: m.homeTeamId,
      awayTeamId: m.awayTeamId,
      homeTeamName: teamLookup.get(m.homeTeamId)?.name ?? m.homeTeamId,
      awayTeamName: teamLookup.get(m.awayTeamId)?.name ?? m.awayTeamId,
    }));
  }, [selectedMatchday, teamLookup]);

  const submitGoalSlot =
    submitGateOpen && selectedMatchday ? (
      <SubmitGoalForm
        matchday={selectedMatchday}
        matches={submitMatches}
        players={players}
        teams={teams}
        leagueSlug={leagueSlug}
      />
    ) : null;

  if (!nextMd) {
    return (
      <div
        data-testid="matchday-empty"
        className="text-center py-24 bg-white/[0.05] rounded-3xl border border-white/10 relative overflow-hidden"
      >
        <div className="absolute inset-0 bg-diagonal-pattern opacity-5" />
        <p className="font-display text-4xl font-black uppercase italic text-white/90 relative">
          {'Season Finished'}
        </p>
        <p className="text-xs uppercase tracking-[0.5em] mt-4 text-white/65 font-black relative">
          {'See you in the Autumn!'}
        </p>
      </div>
    );
  }

  return (
    <div data-testid="league-matchday-client" className={showRsvpBar ? 'pb-32' : 'pb-2'}>
      <GuestLoginBanner />
      <UserTeamBadge teams={teams} teamId={currentLeagueTeamId} />

      {preseasonMode ? (
        <CompressedMatchdaySchedule matchdays={matchdays} teams={teams} />
      ) : (
        <ClassicLeagueHomepage
          selectedMatchdayId={selectedMatchdayId}
          setSelectedMatchdayId={setSelectedMatchdayId}
          matchdays={matchdays}
          teams={teams}
          players={players}
          goals={goals}
          availability={availability}
          availabilityStatuses={availabilityStatuses}
          played={played}
          initialMatchdayId={initialMatchdayId}
          leagueSlug={leagueSlug}
          submitGoalSlot={submitGoalSlot}
          ballType={ballType}
          playerFormat={leagueDetails?.playerFormat ?? null}
          guests={guests}
          leagueDetailsPanelSlot={
            leagueDetails ? (
              <LeagueDetailsPanel
                data={leagueDetails}
                plannedRosterStats={plannedRosterStats}
                preseasonMode={preseasonMode}
              />
            ) : (
              plannedRosterStats && <PlannedRosterStats data={plannedRosterStats} />
            )
          }
        />
      )}

      {!preseasonMode && selectedMatchday && (
        <RsvpBar
          key={`${selectedMatchday.id}-${userPlayerId ?? 'anon'}`}
          matchday={selectedMatchday}
          initialStatus={userRsvpStatus}
          userTeam={userTeam}
          userTeamIsPlaying={userTeamIsPlaying}
          isCompleted={isCompleted}
        />
      )}
    </div>
  );
}
