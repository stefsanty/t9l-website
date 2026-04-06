'use client';

import { useState } from 'react';
import type { 
  Team, Player, Matchday, Goal, PlayerRating, Availability, 
  LeagueTableRow, PlayerStats 
} from '@/types';
import NextMatchdayBanner from './NextMatchdayBanner';
import LeagueTable from './LeagueTable';
import TopPerformers from './TopPerformers';
import MatchResults from './MatchResults';
import SquadList from './SquadList';

type Tab = 'NEXT_GAME' | 'STATS' | 'SQUADS';

interface DashboardProps {
  teams: Team[];
  players: Player[];
  matchdays: Matchday[];
  goals: Goal[];
  ratings: PlayerRating[];
  availability: Availability;
  leagueTable: LeagueTableRow[];
  playerStats: PlayerStats[];
  nextMd: { matchday: Matchday; isNext: boolean } | null;
}

export default function Dashboard({
  teams,
  players,
  matchdays,
  goals,
  ratings,
  availability,
  leagueTable,
  playerStats,
  nextMd,
}: DashboardProps) {
  const [activeTab, setActiveTab] = useState<Tab>('NEXT_GAME');

  return (
    <div className="flex flex-col min-h-screen pb-20 max-w-lg mx-auto bg-midnight selection:bg-vibrant-pink selection:text-white">
      <header className="mb-8 px-6 pt-16 pb-8 relative overflow-hidden">
        <div className="absolute inset-0 bg-diagonal-pattern opacity-10 pointer-events-none" />
        <div className="absolute -top-32 -right-32 w-80 h-80 bg-electric-violet rounded-full blur-[120px] opacity-[0.08]" />
        <div className="absolute -bottom-32 -left-32 w-80 h-80 bg-vibrant-pink rounded-full blur-[120px] opacity-[0.08]" />
        
        <h1 className="font-display text-7xl font-black uppercase tracking-tighter leading-[0.8] relative">
          <span className="block text-white/95">T9L '26</span>
          <span className="block text-vibrant-pink">SPRING</span>
        </h1>
        <div className="flex items-center gap-3 mt-5 relative">
          <div className="h-[2px] w-12 bg-electric-green" />
          <p className="text-[11px] font-black text-white/40 uppercase tracking-[0.4em]">
            Tennozu 9-Aside League
          </p>
        </div>
      </header>

      <main className="flex-1 px-4 relative z-10">
        {activeTab === 'NEXT_GAME' && (
          <div className="animate-in">
            {nextMd ? (
              <NextMatchdayBanner
                matchday={nextMd.matchday}
                isNext={nextMd.isNext}
                teams={teams}
                players={players}
                availability={availability}
              />
            ) : (
              <div className="text-center py-24 bg-white/[0.02] rounded-3xl border border-white/5 relative overflow-hidden">
                <div className="absolute inset-0 bg-diagonal-pattern opacity-5" />
                <p className="font-display text-4xl font-black uppercase italic text-white/90 relative">Season Finished</p>
                <p className="text-xs uppercase tracking-[0.5em] mt-4 text-white/20 font-black relative">See you in the Autumn!</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'STATS' && (
          <div className="space-y-16 animate-in pb-12">
            <div className="relative">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-1.5 h-7 bg-vibrant-pink rounded-full" />
                <h2 className="font-display text-4xl font-black uppercase tracking-tight text-white/95">Standings</h2>
              </div>
              <LeagueTable rows={leagueTable} />
            </div>
            
            <div className="relative">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-1.5 h-7 bg-electric-violet rounded-full" />
                <h2 className="font-display text-4xl font-black uppercase tracking-tight text-white/95">Statistics</h2>
              </div>
              <TopPerformers playerStats={playerStats} />
            </div>

            <div className="relative">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-1.5 h-7 bg-electric-green rounded-full" />
                <h2 className="font-display text-4xl font-black uppercase tracking-tight text-white/95">Results</h2>
              </div>
              <MatchResults matchdays={matchdays} teams={teams} goals={goals} />
            </div>
          </div>
        )}

        {activeTab === 'SQUADS' && (
          <div className="animate-in pb-12">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-1.5 h-7 bg-vibrant-pink rounded-full" />
              <h2 className="font-display text-4xl font-black uppercase tracking-tight text-white/95">Squads</h2>
            </div>
            <SquadList
              teams={teams}
              players={players}
              availability={availability}
              nextMatchdayId={nextMd?.matchday.id || "md1"}
            />
          </div>
        )}
      </main>

      <footer className="mt-8 mb-6 text-center px-4 pb-12">
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/10">
          © 2026 Tennozu 9-Aside League • Tokyo
        </p>
      </footer>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-midnight/90 backdrop-blur-3xl border-t border-white/[0.03] z-50">
        <div className="max-w-lg mx-auto flex justify-around items-center h-22 px-6">
          <button
            onClick={() => setActiveTab('NEXT_GAME')}
            className={`flex flex-col items-center justify-center flex-1 h-full gap-2 transition-all duration-500 relative ${
              activeTab === 'NEXT_GAME' ? 'text-vibrant-pink' : 'text-white/20 hover:text-white/40'
            }`}
          >
            <div className={`p-2 rounded-xl transition-all duration-500 ${activeTab === 'NEXT_GAME' ? 'bg-vibrant-pink/10' : ''}`}>
              <svg className="w-6 h-6" fill={activeTab === 'NEXT_GAME' ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <span className={`text-[10px] font-black uppercase tracking-[0.2em] transition-opacity duration-500 ${activeTab === 'NEXT_GAME' ? 'opacity-100' : 'opacity-40'}`}>Home</span>
            {activeTab === 'NEXT_GAME' && (
              <div className="absolute -top-[1px] left-1/2 -translate-x-1/2 w-16 h-[3px] bg-vibrant-pink rounded-b-full" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('STATS')}
            className={`flex flex-col items-center justify-center flex-1 h-full gap-2 transition-all duration-500 relative ${
              activeTab === 'STATS' ? 'text-vibrant-pink' : 'text-white/20 hover:text-white/40'
            }`}
          >
            <div className={`p-2 rounded-xl transition-all duration-500 ${activeTab === 'STATS' ? 'bg-vibrant-pink/10' : ''}`}>
              <svg className="w-6 h-6" fill={activeTab === 'STATS' ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <span className={`text-[10px] font-black uppercase tracking-[0.2em] transition-opacity duration-500 ${activeTab === 'STATS' ? 'opacity-100' : 'opacity-40'}`}>Stats</span>
            {activeTab === 'STATS' && (
              <div className="absolute -top-[1px] left-1/2 -translate-x-1/2 w-16 h-[3px] bg-vibrant-pink rounded-b-full" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('SQUADS')}
            className={`flex flex-col items-center justify-center flex-1 h-full gap-2 transition-all duration-500 relative ${
              activeTab === 'SQUADS' ? 'text-vibrant-pink' : 'text-white/20 hover:text-white/40'
            }`}
          >
            <div className={`p-2 rounded-xl transition-all duration-500 ${activeTab === 'SQUADS' ? 'bg-vibrant-pink/10' : ''}`}>
              <svg className="w-6 h-6" fill={activeTab === 'SQUADS' ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
            <span className={`text-[10px] font-black uppercase tracking-[0.2em] transition-opacity duration-500 ${activeTab === 'SQUADS' ? 'opacity-100' : 'opacity-40'}`}>Teams</span>
            {activeTab === 'SQUADS' && (
              <div className="absolute -top-[1px] left-1/2 -translate-x-1/2 w-16 h-[3px] bg-vibrant-pink rounded-b-full" />
            )}
          </button>
        </div>
      </nav>
    </div>
  );
}
