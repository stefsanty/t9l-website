'use client';

import { useState } from 'react';
import type {
  Team, Player, Matchday, Goal, Availability, AvailabilityStatuses,
  LeagueTableRow, PlayerStats, PlayedStatus,
} from '@/types';
import type { MatchdayVibes } from '@/lib/stats';
import NextMatchdayBanner from './NextMatchdayBanner';
import GuestLoginBanner from './GuestLoginBanner';
import MatchdayAvailability from './MatchdayAvailability';
import LeagueTable from './LeagueTable';
import TopPerformers from './TopPerformers';
import MatchResults from './MatchResults';
import SquadList from './SquadList';
import LineLoginButton from './LineLoginButton';
import LanguageToggle from './LanguageToggle';
import { useT } from '@/i18n/I18nProvider';

type Tab = 'NEXT_GAME' | 'STATS' | 'SQUADS';

interface DashboardProps {
  teams: Team[];
  players: Player[];
  matchdays: Matchday[];
  goals: Goal[];
  availability: Availability;
  availabilityStatuses: AvailabilityStatuses;
  played: PlayedStatus;
  leagueTable: LeagueTableRow[];
  playerStats: PlayerStats[];
  matchdayVibes: MatchdayVibes[];
  nextMd: { matchday: Matchday; isNext: boolean } | null;
  playerPictures: Record<string, string>;
}

// ── Vibes section ─────────────────────────────────────────────────────────────

function VibesBar({ value }: { value: number }) {
  const pct = Math.round((value / 5) * 100);
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-electric-green"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] font-black tabular-nums text-white/95 w-6 text-right">
        {value.toFixed(1)}
      </span>
    </div>
  );
}

function MatchdayVibesSection({ vibes }: { vibes: MatchdayVibes[] }) {
  const { t } = useT();
  if (vibes.length === 0) return null;

  return (
    <div className="relative">
      <div className="flex items-center gap-4 mb-8">
        <div className="w-1.5 h-7 bg-tertiary rounded-full shadow-[0_0_12px_rgba(0,255,133,0.3)]" />
        <h2 className="font-display text-4xl font-black uppercase tracking-tight text-white/95">{t('vibes')}</h2>
      </div>
      <div className="pl-card pl-card-tertiary rounded-2xl overflow-hidden relative">
        <div className="absolute inset-0 bg-diagonal-pattern opacity-5 pointer-events-none" />
        <div className="divide-y divide-white/5 relative">
          {vibes.map((v) => (
            <div key={v.matchdayId} className="px-5 py-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-black uppercase tracking-[0.2em] text-white/95">{v.label}</span>
                <span className="text-[9px] font-black uppercase tracking-widest text-white/65">
                  {v.responseCount} {v.responseCount === 1 ? t('response') : t('responses')}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                <div>
                  <div className="text-[9px] font-black uppercase tracking-widest text-white/50 mb-1">{t('vibesEnjoyment')}</div>
                  <VibesBar value={v.enjoyment} />
                </div>
                <div>
                  <div className="text-[9px] font-black uppercase tracking-widest text-white/50 mb-1">{t('vibesTeamwork')}</div>
                  <VibesBar value={v.teamwork} />
                </div>
                <div>
                  <div className="text-[9px] font-black uppercase tracking-widest text-white/50 mb-1">{t('vibesCompetitiveness')}</div>
                  <VibesBar value={v.gamesClose} />
                </div>
                <div>
                  <div className="text-[9px] font-black uppercase tracking-widest text-white/50 mb-1">{t('vibesRefereeing')}</div>
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

// ── Main Dashboard ────────────────────────────────────────────────────────────

export default function Dashboard({
  teams,
  players,
  matchdays,
  goals,
  availability,
  availabilityStatuses,
  played,
  leagueTable,
  playerStats,
  matchdayVibes,
  nextMd,
  playerPictures,
}: DashboardProps) {
  const { t } = useT();
  const [activeTab, setActiveTab] = useState<Tab>('NEXT_GAME');
  const [selectedMatchdayId, setSelectedMatchdayId] = useState(
    nextMd?.matchday.id ?? matchdays[0]?.id ?? ''
  );

  const selectedMatchday =
    matchdays.find((m) => m.id === selectedMatchdayId) ?? matchdays[0];

  return (
    <div className="flex flex-col min-h-dvh pb-[88px] max-w-lg mx-auto bg-midnight selection:bg-vibrant-pink selection:text-white">
      <header className="fixed top-0 left-1/2 -translate-x-1/2 w-full max-w-lg z-50 bg-midnight/95 backdrop-blur-md border-b border-white/[0.12] shadow-[0_4px_20px_rgba(0,0,0,0.6)]">
        <div className="flex items-center gap-3 px-4 h-12">
          <h1 className="font-display font-black uppercase tracking-tight leading-none flex items-baseline gap-1.5 shrink-0">
            <span className="text-xl text-white/95">T9L &apos;26</span>
            <span className="text-xl text-vibrant-pink">SPRING</span>
          </h1>
          
          <div className="hidden sm:block h-[1px] w-4 bg-white/10" />
          
          <p className="text-[9px] font-black text-white/45 uppercase tracking-[0.3em] flex-1 truncate hidden min-[400px]:block">
            Tennozu 9-Aside League
          </p>

          <div className="flex-1 min-[400px]:flex-none flex justify-end">
            <LanguageToggle />
          </div>

          <LineLoginButton />
        </div>
      </header>

      <main className="flex-1 px-4 relative z-10 pt-16">
        {activeTab === 'NEXT_GAME' && (
          <div className="animate-in pt-4">
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
                <p className="font-display text-4xl font-black uppercase italic text-white/90 relative">{t('seasonFinished')}</p>
                <p className="text-xs uppercase tracking-[0.5em] mt-4 text-white/65 font-black relative">{t('seeYouAutumn')}</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'STATS' && (
          <div className="space-y-16 animate-in pb-12">
            <div className="relative">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-1.5 h-7 bg-vibrant-pink rounded-full" />
                <h2 className="font-display text-4xl font-black uppercase tracking-tight text-white/95">{t('standings')}</h2>
              </div>
              <LeagueTable rows={leagueTable} />
            </div>

            <div className="relative">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-1.5 h-7 bg-electric-violet rounded-full" />
                <h2 className="font-display text-4xl font-black uppercase tracking-tight text-white/95">{t('statistics')}</h2>
              </div>
              <TopPerformers playerStats={playerStats} />
            </div>

            <div className="relative">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-1.5 h-7 bg-tertiary rounded-full shadow-[0_0_12px_rgba(0,255,133,0.3)]" />
                <h2 className="font-display text-4xl font-black uppercase tracking-tight text-white/95">{t('results')}</h2>
              </div>
              <MatchResults matchdays={matchdays} teams={teams} goals={goals} />
            </div>

            <MatchdayVibesSection vibes={matchdayVibes} />
          </div>
        )}

        {activeTab === 'SQUADS' && (
          <div className="animate-in pb-12">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-1.5 h-7 bg-vibrant-pink rounded-full" />
              <h2 className="font-display text-4xl font-black uppercase tracking-tight text-white/95">{t('squads')}</h2>
            </div>
            <SquadList
              teams={teams}
              players={players}
              availability={availability}
              availabilityStatuses={availabilityStatuses}
              nextMatchdayId={nextMd?.matchday.id || "md1"}
              nextMatchdayLabel={nextMd?.matchday.label || "MD1"}
              playerPictures={playerPictures}
            />
          </div>
        )}
      </main>

      <footer className="mt-8 mb-6 text-center px-4 pb-24">
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/10">
          © 2026 Tennozu 9-Aside League • Tokyo
        </p>
      </footer>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg bg-midnight/98 border-t border-white/10 z-[100] shadow-[0_-10px_40px_rgba(0,0,0,0.9)] pb-[env(safe-area-inset-bottom)]">
        <div className="flex justify-around items-center h-[72px] px-6">
          <button
            onClick={() => setActiveTab('NEXT_GAME')}
            className={`flex flex-col items-center justify-center flex-1 h-full gap-1.5 transition-all duration-300 relative ${
              activeTab === 'NEXT_GAME' ? 'text-vibrant-pink' : 'text-white/95 hover:text-white/95'
            }`}
          >
            <div className={`p-1.5 rounded-xl transition-all duration-300 ${activeTab === 'NEXT_GAME' ? 'bg-vibrant-pink/10' : ''}`}>
              <svg className="w-6 h-6" fill={activeTab === 'NEXT_GAME' ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <span className={`text-[10px] font-black uppercase tracking-[0.15em] transition-opacity duration-300 ${activeTab === 'NEXT_GAME' ? 'opacity-100' : 'opacity-70'}`}>{t('tabHome')}</span>
            {activeTab === 'NEXT_GAME' && (
              <div className="absolute -top-[1px] left-1/2 -translate-x-1/2 w-12 h-[3px] bg-vibrant-pink rounded-b-full shadow-[0_2px_10px_rgba(233,0,82,0.4)]" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('STATS')}
            className={`flex flex-col items-center justify-center flex-1 h-full gap-1.5 transition-all duration-300 relative ${
              activeTab === 'STATS' ? 'text-vibrant-pink' : 'text-white/95 hover:text-white/95'
            }`}
          >
            <div className={`p-1.5 rounded-xl transition-all duration-300 ${activeTab === 'STATS' ? 'bg-vibrant-pink/10' : ''}`}>
              <svg className="w-6 h-6" fill={activeTab === 'STATS' ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <span className={`text-[10px] font-black uppercase tracking-[0.15em] transition-opacity duration-300 ${activeTab === 'STATS' ? 'opacity-100' : 'opacity-70'}`}>{t('tabStats')}</span>
            {activeTab === 'STATS' && (
              <div className="absolute -top-[1px] left-1/2 -translate-x-1/2 w-12 h-[3px] bg-vibrant-pink rounded-b-full shadow-[0_2px_10px_rgba(233,0,82,0.4)]" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('SQUADS')}
            className={`flex flex-col items-center justify-center flex-1 h-full gap-1.5 transition-all duration-300 relative ${
              activeTab === 'SQUADS' ? 'text-vibrant-pink' : 'text-white/95 hover:text-white/95'
            }`}
          >
            <div className={`p-1.5 rounded-xl transition-all duration-300 ${activeTab === 'SQUADS' ? 'bg-vibrant-pink/10' : ''}`}>
              <svg className="w-6 h-6" fill={activeTab === 'SQUADS' ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
            <span className={`text-[10px] font-black uppercase tracking-[0.15em] transition-opacity duration-300 ${activeTab === 'SQUADS' ? 'opacity-100' : 'opacity-70'}`}>{t('tabTeams')}</span>
            {activeTab === 'SQUADS' && (
              <div className="absolute -top-[1px] left-1/2 -translate-x-1/2 w-12 h-[3px] bg-vibrant-pink rounded-b-full shadow-[0_2px_10px_rgba(233,0,82,0.4)]" />
            )}
          </button>
        </div>
      </nav>
    </div>
  );
}
