'use client';

import { useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import type {
  Team, Player, Matchday, Goal, Availability, AvailabilityStatuses, PlayedStatus,
} from '@/types';
import GuestLoginBanner from './GuestLoginBanner';
import Header from './Header';
import UserTeamBadge from './UserTeamBadge';
import SubmitGoalForm from './matchday/SubmitGoalForm';
import ClassicLeagueHomepage from './ClassicLeagueHomepage';
import CompressedMatchdaySchedule from './CompressedMatchdaySchedule';
import RecruitingBanner from './RecruitingBanner';
import UnpaidFeeBanner from './UnpaidFeeBanner';
import type { UnpaidFeeBannerData } from '@/lib/unpaidFeeBanner';
import RsvpBar from './RsvpBar';
import type { RecruitingViewerState } from '@/lib/recruitingViewerState';
import { selfReportGateOpen } from '@/lib/playerSelfReportGate';
import { combineJstDateAndTime } from '@/lib/jst';

interface DashboardProps {
  teams: Team[];
  players: Player[];
  matchdays: Matchday[];
  goals: Goal[];
  availability: Availability;
  availabilityStatuses: AvailabilityStatuses;
  played: PlayedStatus;
  nextMd: { matchday: Matchday; isNext: boolean } | null;
  /**
   * v1.48.0 — pre-select a specific matchday on first render. When unset
   * the banner picks the user's next playing matchday (existing behavior).
   * When set, the banner pre-loads this matchday — used by `/matchday/[id]`
   * which is now a thin wrapper that renders Dashboard with the URL
   * matchday slug as the initial selection. After the initial render the
   * banner uses local state for navigation (swipes / arrows / dots), same
   * as on the homepage.
   */
  initialMatchdayId?: string | null;
  /**
   * v1.51.0 (PR 2 of the path-routing chain) — the league slug threaded
   * down to `CopyMatchdayLink` so the share URL it composes points at
   * the canonical path-based form `/league/<slug>/md/<id>`. Optional
   * because the homepage `/` and `/schedule` may not yet thread it; in
   * those cases CopyMatchdayLink falls back to the default-league slug.
   */
  leagueSlug?: string;
  /**
   * v1.63.0 — per-league pre-season toggle. When true, the homepage
   * swaps the `ClassicLeagueHomepage` (NextMatchdayBanner +
   * MatchdayAvailability + RsvpBar) for `CompressedMatchdaySchedule`,
   * AND tells `Header` to hide the STATS link. Defaults false so
   * existing leagues behave exactly as today.
   */
  preseasonMode?: boolean;
  /**
   * v1.63.0 — per-league recruiting toggle. When true, surfaces a
   * `RecruitingBanner` at the top of the homepage. Independent of
   * `preseasonMode` — both can be on simultaneously. Defaults false.
   */
  recruiting?: boolean;
  /**
   * v1.64.0 — context-aware recruiting state. When `recruiting === true`,
   * the page-level RSC computes the viewer's relationship to this league
   * via `getRecruitingViewerState(leagueId)` and threads the result
   * through. The five-way discriminated union drives the
   * `RecruitingBanner`'s rendered surface (approved / pending / no-player
   * apply / in-other-league / unauthenticated). When `recruiting === false`
   * this prop is ignored.
   */
  recruitingState?: RecruitingViewerState;
  /**
   * v1.64.0 — league identity needed by RecruitingBanner CTAs (apply
   * action passes leagueId + leagueName for display). Threaded as a
   * single prop so a future per-league rebrand only touches one site.
   */
  league?: { id: string; name: string };
  /**
   * v1.66.0 — unpaid league-fee banner data, computed server-side via
   * `getUnpaidFeeBannerData(leagueId)`. Null = banner stays hidden
   * (no auth, no PLM in this league, paid, or no fee configured).
   */
  unpaidFee?: UnpaidFeeBannerData | null;
}

/**
 * v1.48.0 — homepage IS the matchday page.
 *
 * The Dashboard component is now the single render path for both the
 * apex (`/`) and per-matchday URLs (`/matchday/<id>`). The optional
 * `initialMatchdayId` prop pre-selects a matchday; the banner handles
 * subsequent navigation via local state (URL doesn't update on swipe —
 * the URL is the entry point, not a continuous source of truth).
 *
 * v1.63.0 — per-league pre-season + recruiting toggles. Pre-season
 * swaps the `ClassicLeagueHomepage` (NextMatchdayBanner +
 * MatchdayAvailability + RsvpBar) for `CompressedMatchdaySchedule`,
 * and tells `Header` to hide the STATS link. Recruiting surfaces a
 * `RecruitingBanner` above the matchday surface. Both default false.
 */
export default function Dashboard({
  teams,
  players,
  matchdays,
  goals,
  availability,
  availabilityStatuses,
  played,
  nextMd,
  initialMatchdayId,
  leagueSlug,
  preseasonMode = false,
  recruiting = false,
  recruitingState,
  league,
  unpaidFee,
}: DashboardProps) {
  const { data: session } = useSession();
  const [selectedMatchdayId, setSelectedMatchdayId] = useState(
    initialMatchdayId ?? nextMd?.matchday.id ?? matchdays[0]?.id ?? ''
  );

  const selectedMatchday =
    matchdays.find((m) => m.id === selectedMatchdayId) ?? matchdays[0];

  const userTeamId = session?.teamId ?? null;
  const userPlayerId = session?.playerId ?? null;
  const userTeam = userTeamId ? (teams.find((t) => t.id === userTeamId) ?? null) : null;
  const userTeamIsPlaying = !!(userTeamId && selectedMatchday && selectedMatchday.sittingOutTeamId !== userTeamId);
  const isCompleted = !!(selectedMatchday && selectedMatchday.matches[0].homeGoals !== null);

  // v1.63.1 — RsvpBar must render at Dashboard's outer-wrapper level (NOT
  // inside <main>) so its `position: fixed; bottom: 0` anchors to the
  // viewport. The `.animate-in` div inside <main> sets a non-none
  // `transform: translateY(0)` (animation-fill-mode: forwards) which
  // would establish a containing block for fixed descendants and break
  // the bottom-anchor. Pre-season mode hides RsvpBar entirely.
  const userRsvpStatus: 'GOING' | 'UNDECIDED' | 'Y' | 'EXPECTED' | '' =
    (userPlayerId && userTeamId && selectedMatchday
      ? availabilityStatuses?.[selectedMatchday.id]?.[userTeamId]?.[userPlayerId] ?? ''
      : '') as 'GOING' | 'UNDECIDED' | 'Y' | 'EXPECTED' | '';

  const showRsvpBar =
    !preseasonMode && !!(session?.playerId && userTeamIsPlaying && !isCompleted);

  // v1.48.0 — Submit-goal gate (PR ζ kickoff gate, evaluated client-side
  // from selected matchday's matchday.date + match.kickoff via the
  // canonical JST helpers). The matchday's earliest kickoff is the
  // minimum across its matches.
  //
  // v1.63.0 — Submit Goal stays in both modes per design, but the
  // kickoff gate naturally suppresses it during pre-season (no kickoff
  // has passed yet); no extra suppression needed.
  const submitGateOpen = useMemo(() => {
    if (!session?.playerId || !selectedMatchday?.date) return false;
    const kickoffs: Date[] = [];
    for (const m of selectedMatchday.matches) {
      if (!m.kickoff) continue;
      try {
        kickoffs.push(combineJstDateAndTime(selectedMatchday.date, m.kickoff));
      } catch {
        // Defensive: skip malformed kickoff strings rather than crash
        // the dashboard render.
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

  // v1.48.0 — all matches in the selected matchday are submittable (open
  // attribution: any signed-in linked player can submit for any player).
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
      />
    ) : null;

  return (
    <div className="flex flex-col min-h-dvh pb-0 max-w-lg mx-auto bg-background selection:bg-vibrant-pink selection:text-white">
      <Header hideStatsLink={preseasonMode} />

      <main className={`flex-1 px-4 relative z-10 pt-12 ${showRsvpBar ? 'pb-32' : 'pb-2'}`}>
        <div className="animate-in pt-2">
          {/* v1.66.0 — unpaid-fee banner renders ABOVE the recruiting
              banner. The unpaid-fee message takes priority because it's
              actionable for an existing roster member; recruiting is
              for prospective members. */}
          <UnpaidFeeBanner data={unpaidFee ?? null} />
          {recruiting && league && recruitingState && (
            <RecruitingBanner league={league} viewer={recruitingState} />
          )}

          {nextMd ? (
            <>
              <GuestLoginBanner />
              <UserTeamBadge teams={teams} />

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
                />
              )}
            </>
          ) : (
            <div className="text-center py-24 bg-white/[0.05] rounded-3xl border border-white/10 relative overflow-hidden">
              <div className="absolute inset-0 bg-diagonal-pattern opacity-5" />
              <p className="font-display text-4xl font-black uppercase italic text-white/90 relative">{"Season Finished"}</p>
              <p className="text-xs uppercase tracking-[0.5em] mt-4 text-white/65 font-black relative">{"See you in the Autumn!"}</p>
            </div>
          )}
        </div>
      </main>

      <footer className="mt-3 mb-0 text-center px-4 pb-2">
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-fg-low">
          © 2026 Tennozu 9-Aside League • Tokyo
        </p>
      </footer>

      {/* v1.63.1 — RsvpBar at the OUTER wrapper level (sibling of <main>
          and <footer>). Cannot live inside <main> because the
          `.animate-in` ancestor sets `transform: translateY(0)` which
          establishes a containing block for `position: fixed`
          descendants, breaking RsvpBar's viewport-anchored bottom
          positioning. Hidden in pre-season mode (no scheduled matches
          to RSVP for). */}
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
