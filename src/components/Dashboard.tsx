'use client';

import { useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import type {
  Team, Player, Matchday, Goal, Availability, AvailabilityStatuses, PlayedStatus,
} from '@/types';
import NextMatchdayBanner from './NextMatchdayBanner';
import GuestLoginBanner from './GuestLoginBanner';
import MatchdayAvailability from './MatchdayAvailability';
import Header from './Header';
import RsvpBar from './RsvpBar';
import UserTeamBadge from './UserTeamBadge';
import SubmitGoalForm from './matchday/SubmitGoalForm';
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
 * The Submit-goal CTA (PR ζ / v1.46.0) now lives here — visible on the
 * homepage too, not just on the per-matchday route. Per v1.48.0's open-
 * attribution model, ANY logged-in linked player can submit a goal for
 * ANY player. The kickoff-time gate stays — button hidden if before
 * earliest kickoff or no kickoff data on the selected matchday.
 *
 * The MatchdayCard's eyebrow ("MATCHDAY RESULTS" / "YOUR NEXT MATCHDAY")
 * is now click-to-copy via `<CopyMatchdayLink>` — copies
 * `https://<host>/matchday/<id>` to the clipboard with a Sonner toast.
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
  const userRsvpStatus: 'GOING' | 'UNDECIDED' | 'Y' | 'EXPECTED' | '' =
    (userPlayerId && userTeamId && selectedMatchday
      ? availabilityStatuses?.[selectedMatchday.id]?.[userTeamId]?.[userPlayerId] ?? ''
      : '') as 'GOING' | 'UNDECIDED' | 'Y' | 'EXPECTED' | '';

  const showRsvpBar = !!(session?.playerId && userTeamIsPlaying && !isCompleted);

  // v1.48.0 — Submit-goal gate (PR ζ kickoff gate, evaluated client-side
  // from selected matchday's matchday.date + match.kickoff via the
  // canonical JST helpers). The matchday's earliest kickoff is the
  // minimum across its matches.
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

  return (
    <div className="flex flex-col min-h-dvh pb-0 max-w-lg mx-auto bg-background selection:bg-vibrant-pink selection:text-white">
      <Header />

      <main className={`flex-1 px-4 relative z-10 pt-12 ${showRsvpBar ? 'pb-32' : 'pb-2'}`}>
        <div className="animate-in pt-2">
          {nextMd ? (
            <>
              <GuestLoginBanner />
              <UserTeamBadge teams={teams} />
              <NextMatchdayBanner
                matchdays={matchdays}
                selectedMatchdayId={selectedMatchdayId}
                onMatchdayChange={setSelectedMatchdayId}
                teams={teams}
                goals={goals}
              />

              {submitGateOpen && selectedMatchday ? (
                <SubmitGoalForm
                  matchday={selectedMatchday}
                  matches={submitMatches}
                  players={players}
                  teams={teams}
                />
              ) : null}

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

      {selectedMatchday && (
        <RsvpBar
          key={`${selectedMatchday.id}-${session?.playerId ?? 'anon'}`}
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
