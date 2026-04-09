'use client';

import type {
  Team, Player, Availability, AvailabilityStatuses,
  LeagueTableRow, PlayerStats,
} from '@/types';
import type { MatchdayVibes } from '@/lib/stats';
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
  matchdayVibes: MatchdayVibes[];
  nextMatchdayId: string;
  nextMatchdayLabel: string;
  playerPictures: Record<string, string>;
}

// ── Vibes section ─────────────────────────────────────────────────────────────

function VibesBar({ value }: { value: number }) {
  const pct = Math.round((value / 5) * 100);
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-1 bg-surface-md rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-tertiary"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] font-black tabular-nums text-fg-high w-6 text-right">
        {value.toFixed(1)}
      </span>
    </div>
  );
}

function MatchdayVibesSection({ vibes }: { vibes: MatchdayVibes[] }) {
  if (vibes.length === 0) return null;

  return (
    <div className="relative">
      <div className="flex items-center gap-4 mb-8">
        <div className="w-1.5 h-7 bg-tertiary rounded-full shadow-[0_0_12px_rgba(0,255,133,0.3)]" />
        <h2 className="font-display text-4xl font-black uppercase tracking-tight text-fg-high">{"Vibes"}</h2>
      </div>
      <div className="pl-card pl-card-tertiary rounded-2xl overflow-hidden relative">
        <div className="absolute inset-0 bg-diagonal-pattern opacity-5 pointer-events-none" />
        <div className="divide-y divide-border-subtle relative">
          {vibes.map((v) => (
            <div key={v.matchdayId} className="px-5 py-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-black uppercase tracking-[0.2em] text-fg-high">{v.label}</span>
                <span className="text-[9px] font-black uppercase tracking-widest text-fg-mid">
                  {v.responseCount} {v.responseCount === 1 ? "response" : "responses"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                <div>
                  <div className="text-[9px] font-black uppercase tracking-widest text-fg-low mb-1">{"Enjoyment"}</div>
                  <VibesBar value={v.enjoyment} />
                </div>
                <div>
                  <div className="text-[9px] font-black uppercase tracking-widest text-fg-low mb-1">{"Teamwork"}</div>
                  <VibesBar value={v.teamwork} />
                </div>
                <div>
                  <div className="text-[9px] font-black uppercase tracking-widest text-fg-low mb-1">{"Competitiveness"}</div>
                  <VibesBar value={v.gamesClose} />
                </div>
                <div>
                  <div className="text-[9px] font-black uppercase tracking-widest text-fg-low mb-1">{"Refereeing"}</div>
                  <VibesBar value={v.refereeing} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Stats Dashboard ───────────────────────────────────────────────────────────

export default function StatsDashboard({
  teams,
  players,
  availability,
  availabilityStatuses,
  leagueTable,
  playerStats,
  matchdayVibes,
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

          <MatchdayVibesSection vibes={matchdayVibes} />
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
