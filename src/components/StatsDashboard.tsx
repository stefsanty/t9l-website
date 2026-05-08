'use client';

import dynamic from 'next/dynamic';
import type {
  Team, Player, Availability, AvailabilityStatuses,
  LeagueTableRow, PlayerStats,
} from '@/types';
import LeagueTable from './LeagueTable';
import Header from './Header';
import UnpaidFeeBanner from './UnpaidFeeBanner';
import type { UnpaidFeeBannerData } from '@/lib/unpaidFeeBanner';

// v1.80.3 — phase 2 H4: lazy-load /stats below-fold sections. LeagueTable
// stays static (above-fold). TopPerformers ships its own avatar/sort-icon
// rendering subtree; SquadList is the largest section (an accordion of
// per-team rosters). Skeletons reserve enough vertical space to keep
// scroll position stable while the chunks arrive — the user's scroll past
// the standings shouldn't snap when content lands.
const TopPerformers = dynamic(() => import('./TopPerformers'), {
  loading: () => (
    <div
      data-testid="top-performers-skeleton"
      aria-hidden
      className="pl-card pl-card-violet rounded-2xl mb-10 h-[360px] animate-pulse"
    />
  ),
});

const SquadList = dynamic(() => import('./SquadList'), {
  loading: () => (
    <div
      data-testid="squad-list-skeleton"
      aria-hidden
      className="space-y-4 animate-pulse"
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="pl-card pl-card-violet rounded-2xl h-[88px]"
        />
      ))}
    </div>
  ),
});

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
  // v1.66.0 — unpaid-fee banner data; null when banner stays hidden.
  unpaidFee?: UnpaidFeeBannerData | null;
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
  unpaidFee,
}: StatsDashboardProps) {
  return (
    <div className="flex flex-col min-h-dvh pb-0 max-w-lg mx-auto bg-background selection:bg-vibrant-pink selection:text-white">
      <Header />

      <main className="flex-1 px-4 relative z-10 pt-16 space-y-16 pb-12">
        <UnpaidFeeBanner data={unpaidFee ?? null} />
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
