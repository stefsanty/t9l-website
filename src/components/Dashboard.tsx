'use client';

import { useState } from 'react';
import type {
  Team, Player, Matchday, Goal, Availability, AvailabilityStatuses, PlayedStatus,
} from '@/types';
import NextMatchdayBanner from './NextMatchdayBanner';
import GuestLoginBanner from './GuestLoginBanner';
import MatchdayAvailability from './MatchdayAvailability';
import Header from './Header';

interface DashboardProps {
  teams: Team[];
  players: Player[];
  matchdays: Matchday[];
  goals: Goal[];
  availability: Availability;
  availabilityStatuses: AvailabilityStatuses;
  played: PlayedStatus;
  nextMd: { matchday: Matchday; isNext: boolean } | null;
}

export default function Dashboard({
  teams,
  players,
  matchdays,
  goals,
  availability,
  availabilityStatuses,
  played,
  nextMd,
}: DashboardProps) {
  const [selectedMatchdayId, setSelectedMatchdayId] = useState(
    nextMd?.matchday.id ?? matchdays[0]?.id ?? ''
  );

  const selectedMatchday =
    matchdays.find((m) => m.id === selectedMatchdayId) ?? matchdays[0];

  return (
    <div className="flex flex-col min-h-dvh pb-0 max-w-lg mx-auto bg-background selection:bg-vibrant-pink selection:text-white">
      <Header />

      <main className="flex-1 px-4 relative z-10 pt-12 pb-2">
        <div className="animate-in pt-2">
          {nextMd ? (
            <>
              <GuestLoginBanner />
              <NextMatchdayBanner
                matchdays={matchdays}
                selectedMatchdayId={selectedMatchdayId}
                onMatchdayChange={setSelectedMatchdayId}
                teams={teams}
                goals={goals}
                availabilityStatuses={availabilityStatuses}
              />
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
    </div>
  );
}
