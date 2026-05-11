'use client';

import { useMemo, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { useSession } from 'next-auth/react';
import type {
  Team, Player, Matchday, Goal, Availability, AvailabilityStatuses, PlayedStatus,
  MatchdayGuests,
} from '@/types';
import GuestLoginBanner from './GuestLoginBanner';
import Header from './Header';
import UserTeamBadge from './UserTeamBadge';
import ClassicLeagueHomepage from './ClassicLeagueHomepage';
import RecruitingBanner from './RecruitingBanner';
import UnpaidFeeBanner from './UnpaidFeeBanner';
import RegistrationCountdown from './RegistrationCountdown';
import type { UnpaidFeeBannerData } from '@/lib/unpaidFeeBanner';
import type { RecruitingViewerState } from '@/lib/recruitingViewerState';
import type { PlannedRosterStats as PlannedRosterStatsData } from '@/lib/plannedRosterStats';
import type { LeagueDetails as LeagueDetailsData } from '@/lib/leagueDetails';
import { selfReportGateOpen } from '@/lib/playerSelfReportGate';
import { combineJstDateAndTime } from '@/lib/jst';

// v1.80.3 — phase 2 H3: split below-fold dashboard widgets out of the
// initial route bundle. Keep Header / UnpaidFeeBanner / RecruitingBanner /
// NextMatchdayBanner static (above-fold / LCP). Each `dynamic()` call below
// lazy-loads its component as a separate chunk and renders a footprint-
// matching skeleton so scroll position stays stable during chunk fetch.
// `ssr: true` (the default) preserves SSR HTML for SEO + first paint;
// only the JS chunk is deferred.
const LeagueDetailsPanel = dynamic(() => import('./LeagueDetailsPanel'), {
  loading: () => (
    <section
      data-testid="league-details-panel-skeleton"
      aria-hidden
      className="w-full mt-2 mb-3 rounded-2xl border border-border-default bg-card overflow-hidden animate-pulse"
    >
      <div className="w-full px-4 py-3 bg-surface flex items-center justify-between">
        <div className="h-3 w-28 rounded bg-surface-md" />
        <div className="h-4 w-4 rounded bg-surface-md" />
      </div>
    </section>
  ),
});

const PlannedRosterStats = dynamic(() => import('./PlannedRosterStats'), {
  loading: () => (
    <section
      data-testid="planned-roster-stats-skeleton"
      aria-hidden
      className="w-full mt-2 mb-3 rounded-2xl border border-border-default bg-card px-4 py-3 animate-pulse"
    >
      <div className="h-3 w-24 rounded bg-surface-md mb-3" />
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-4 rounded bg-surface" />
        ))}
      </div>
    </section>
  ),
});

// RsvpBar is `position: fixed` and outside the document flow, so its
// skeleton doesn't need to reserve flow space (Dashboard's pb-32 already
// budgets the viewport gap). Render `null` while the chunk loads — the
// bar appearing a frame later is preferable to flashing a placeholder.
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
  }
);

// v1.81.0 — post-submit confirmation popup. Lazy-loaded because it only
// fires when the URL carries `?submitted=<descriptor>` (after a recruiting
// or onboarding redirect); the gate component reads useSearchParams and
// returns null otherwise, so the chunk only fetches on the success path.
const SuccessConfirmationGate = dynamic(
  () => import('./SuccessConfirmationGate'),
  { loading: () => null },
);

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
  league?: { id: string; name: string; abbreviation?: string | null; ballType?: 'SOCCER' | 'FUTSAL' | null };
  /**
   * v1.66.0 — unpaid league-fee banner data, computed server-side via
   * `getUnpaidFeeBannerData(leagueId)`. Null = banner stays hidden
   * (no auth, no PLM in this league, paid, or no fee configured).
   */
  unpaidFee?: UnpaidFeeBannerData | null;
  /**
   * v1.67.0 — planned-roster stats panel data. Page.tsx server-renders
   * this and only passes a non-null value when the viewer is
   * authenticated AND preseasonMode + recruiting are both on. The panel
   * sits between RecruitingBanner and CompressedMatchdaySchedule.
   */
  plannedRosterStats?: PlannedRosterStatsData | null;
  /**
   * v1.75.0 — league details panel data. Page.tsx fetches this via
   * `getLeagueDetails(leagueId)` and passes a non-null value when
   * `League.showLeagueDetails === true`.
   * v1.75.1 — no longer gated on `preseasonMode`; the panel renders
   * on both classic and preseason homepages when the flag is on.
   * When non-null, LeagueDetailsPanel also renders plannedRosterStats
   * inline (the separate PlannedRosterStats render is the fallback).
   */
  leagueDetails?: LeagueDetailsData | null;
  /**
   * v1.85.0 — optional slot rendered immediately below the fixed
   * Header and above the existing dashboard content. Used by the new
   * `<MultiLeagueHub>` to inject the league-switcher tab strip + the
   * "Also recruiting" handoff cards into the same `max-w-lg` column
   * as the rest of the dashboard, without re-mounting the Header
   * (which would double-render the brand bar). Optional + nullable so
   * existing call sites compile unchanged.
   */
  topSlot?: ReactNode;
  /**
   * v1.93.0 — Per-row typed guest entries. Threaded into ClassicLeagueHomepage
   * → MatchdayAvailability so each team's "+ Guests" trigger prefills the
   * modal with current rows. Optional; absence is treated as empty.
   * Replaces the v1.91.0 `guestCounts` count map.
   */
  guests?: MatchdayGuests;
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
  plannedRosterStats,
  leagueDetails,
  topSlot,
  guests,
}: DashboardProps) {
  const { data: session } = useSession();
  const [selectedMatchdayId, setSelectedMatchdayId] = useState(
    initialMatchdayId ?? nextMd?.matchday.id ?? matchdays[0]?.id ?? ''
  );

  const selectedMatchday =
    matchdays.find((m) => m.id === selectedMatchdayId) ?? matchdays[0];

  const userTeamId = session?.teamId ?? null;
  const userPlayerId = session?.playerId ?? null;
  // session.teamId is default-league-scoped (JWT always resolves against
  // getDefaultLeagueId). For non-default leagues, use the per-league
  // team resolved server-side by recruitingViewerState instead.
  const currentLeagueTeamId: string | null =
    recruitingState?.kind === 'approved_this'
      ? recruitingState.team.id
      : userTeamId;
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
      <Header hideStatsLink={preseasonMode} leagueTitle={league?.abbreviation ?? league?.name ?? null} />

      <main className={`flex-1 px-4 relative z-10 pt-12 ${showRsvpBar ? 'pb-32' : 'pb-2'}`}>
        {/* v1.85.0 — optional slot rendered above the existing animated
            content. Used by `<MultiLeagueHub>` to inject the league
            switcher and recruiting handoff. Sits between the fixed
            header (`pt-12` reserves space) and the animate-in column. */}
        {topSlot}
        <div className="animate-in pt-2">
          {/* v1.66.0 — unpaid-fee banner renders ABOVE the recruiting
              banner. The unpaid-fee message takes priority because it's
              actionable for an existing roster member; recruiting is
              for prospective members. */}
          <UnpaidFeeBanner data={unpaidFee ?? null} />
          {recruiting && league && recruitingState && (
            <RecruitingBanner
              league={league}
              viewer={recruitingState}
              leagueSlug={leagueSlug}
            />
          )}
          {/* v1.83.1 — Pre-season-only "League registration closes in X days"
              banner, rendered ABOVE LeagueDetailsPanel. Hides itself when
              the deadline has passed or when no `registrationDeadline` is
              configured on the league. Reads from the same plannedRosterStats
              source LeagueDetailsPanel uses, so deadline shape is consistent
              between the two surfaces. */}
          {preseasonMode && (
            <RegistrationCountdown
              registrationDeadline={plannedRosterStats?.registrationDeadline ?? null}
            />
          )}
          {/* v1.75.1 — LeagueDetailsPanel consolidates league-rule rows +
              planned-roster stats (formerly separate PlannedRosterStats).
              v1.75.4 — In preseason mode the panel renders here (before the
              schedule). In classic mode it moves inside ClassicLeagueHomepage
              between NextMatchdayBanner and MatchdayAvailability via the
              leagueDetailsPanelSlot prop. */}
          {preseasonMode && (leagueDetails ? (
            <LeagueDetailsPanel
              data={leagueDetails}
              plannedRosterStats={plannedRosterStats}
              preseasonMode={preseasonMode}
            />
          ) : (
            plannedRosterStats && <PlannedRosterStats data={plannedRosterStats} />
          ))}

          {nextMd ? (
            <>
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
                  ballType={league?.ballType ?? leagueDetails?.ballType ?? null}
                  playerFormat={leagueDetails?.playerFormat ?? null}
                  guests={guests}
                  leagueDetailsPanelSlot={leagueDetails ? (
                    <LeagueDetailsPanel
                      data={leagueDetails}
                      plannedRosterStats={plannedRosterStats}
                      preseasonMode={preseasonMode}
                    />
                  ) : (
                    plannedRosterStats && <PlannedRosterStats data={plannedRosterStats} />
                  )}
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

      {/* v1.81.0 — fires after a recruiting / onboarding submit redirect
          (e.g. `/id/<slug>?submitted=applyToLeague`). The gate stays mounted
          but only renders content when ?submitted= matches a known
          descriptor. */}
      <SuccessConfirmationGate />
    </div>
  );
}
