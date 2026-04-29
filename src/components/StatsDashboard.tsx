'use client';

import type {
  Team, Player, Availability, AvailabilityStatuses,
  LeagueTableRow, PlayerStats,
} from '@/types';
import LeagueTable from './LeagueTable';
import TopPerformers from './TopPerformers';
import SquadList from './SquadList';
import Header from './Header';

interface StatsDashboardProps {
  teams: Team[];
  players: Player[];
  availability: Availability;
  availabilityStatuses: AvailabilityStatuses;
  leagueTable: LeagueTableRow[];
  playerStats: PlayerStats[];
  nextMatchdayId: string;
  nextMatchdayLabel: string;
  playerPictures: Record<string, string>;
}

// ── Stats Dashboard ───────────────────────────────────────────────────────────

export default function StatsDashboard({
  teams,
  players,
  availability,
  availabilityStatuses,
  leagueTable,
  playerStats,
  nextMatchdayId,
  nextMatchdayLabel,
  playerPictures,
}: StatsDashboardProps) {
  return (
    <div className="flex flex-col min-h-dvh pb-0 max-w-lg mx-auto bg-background selection:bg-vibrant-pink selection:text-white">
      <Header />

      <main className="flex-1 px-4 relative z-10 pt-16 space-y-16 pb-12">
        <div className="space-y-16 animate-in pt-4">
          <div className="relative">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-1.5 h-7 bg-vibrant-pink rounded-full" />
              <h2 className="font-display text-4xl font-black uppercase tracking-tight text-fg-high">{"Standings"}</h2>
            </div>
            <LeagueTable rows={leagueTable} />
          </div>

          <div className="relative">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-1.5 h-7 bg-electric-violet rounded-full" />
              <h2 className="font-display text-4xl font-black uppercase tracking-tight text-fg-high">{"Statistics"}</h2>
            </div>
            <TopPerformers playerStats={playerStats} playerPictures={playerPictures} />
          </div>
        </div>

        <div className="animate-in">
          <div className="flex items-center gap-4 mb-8">
            <div className="w-1.5 h-7 bg-vibrant-pink rounded-full" />
            <h2 className="font-display text-4xl font-black uppercase tracking-tight text-fg-high">{"Squads"}</h2>
          </div>
          <SquadList
            teams={teams}
            players={players}
            availability={availability}
            availabilityStatuses={availabilityStatuses}
            nextMatchdayId={nextMatchdayId}
            nextMatchdayLabel={nextMatchdayLabel}
            playerPictures={playerPictures}
          />
        </div>
      </main>

      <footer className="mt-8 mb-6 text-center px-4 pb-8">
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-fg-low">
          © 2026 Tennozu 9-Aside League • Tokyo
        </p>
      </footer>
    </div>
  );
}
