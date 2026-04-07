'use client';

import { useState } from 'react';
import Image from 'next/image';
import type { Matchday, Team, Goal } from '@/types';
import { useT } from '@/i18n/I18nProvider';

interface MatchResultsProps {
  matchdays: Matchday[];
  teams: Team[];
  goals: Goal[];
}

export default function MatchResults({
  matchdays,
  teams,
  goals,
}: MatchResultsProps) {
  const { t } = useT();
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);

  // Show played matchdays first, most recent first
  const playedMatchdays = matchdays
    .filter((md) => md.matches.some((m) => m.homeGoals !== null))
    .sort((a, b) => {
      const aNum = parseInt(a.id.replace('md', ''), 10);
      const bNum = parseInt(b.id.replace('md', ''), 10);
      return bNum - aNum;
    });

  const getTeam = (id: string) => teams.find((t) => t.id === id);

  if (playedMatchdays.length === 0) return null;

  return (
    <div className="space-y-6">
        {playedMatchdays.map((md) => (
          <div key={md.id} className="pl-card pl-card-tertiary rounded-2xl overflow-hidden relative">
            <div className="absolute inset-0 bg-diagonal-pattern opacity-5 pointer-events-none" />
            <div className="bg-white/[0.07] px-5 py-3 border-b border-white/15 flex justify-between items-center relative">
              <span className="font-display text-[10px] font-black uppercase tracking-[0.2em] text-white/95">
                {md.label} — {md.date || t('tbd')}
              </span>
              <div className="h-1.5 w-1.5 rounded-full bg-tertiary shadow-[0_0_8px_rgba(0,255,133,0.5)]" />
            </div>
            
            <div className="divide-y divide-white/5 relative">
              {md.matches.map((match) => {
                const home = getTeam(match.homeTeamId);
                const away = getTeam(match.awayTeamId);
                const isExpanded = expandedMatchId === match.id;
                const matchGoals = goals.filter((g) => g.matchId === match.id);

                return (
                  <div key={match.id} className="group">
                    <button
                      onClick={() => setExpandedMatchId(isExpanded ? null : match.id)}
                      className={`w-full px-5 py-4 text-left transition-all ${
                        isExpanded ? 'bg-white/[0.08]' : 'hover:bg-white/[0.05]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 flex items-center gap-3 min-w-0">
                          <span className="font-display text-sm font-black uppercase tracking-tight text-white group-hover:text-vibrant-pink transition-colors truncate">
                            {home?.name}
                          </span>
                          <div className="relative w-6 h-6 shrink-0 bg-white/10 rounded-md p-1 border border-white/10">
                            {home?.logo && (
                              <Image src={home.logo} alt={home.name} fill className="object-contain p-0.5" />
                            )}
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-3 bg-white/[0.10] px-4 py-1.5 rounded-xl border border-white/15 min-w-[90px] justify-center group-hover:border-vibrant-pink/30 transition-all shrink-0">
                          <span className="font-display text-2xl font-black text-white">{match.homeGoals}</span>
                          <div className="w-4 h-[1px] bg-white/10" />
                          <span className="font-display text-2xl font-black text-white">{match.awayGoals}</span>
                        </div>
                        
                        <div className="flex-1 flex items-center justify-end gap-3 text-right min-w-0">
                          <div className="relative w-6 h-6 shrink-0 bg-white/10 rounded-md p-1 border border-white/10">
                            {away?.logo && (
                              <Image src={away.logo} alt={away.name} fill className="object-contain p-0.5" />
                            )}
                          </div>
                          <span className="font-display text-sm font-black uppercase tracking-tight text-white group-hover:text-vibrant-pink transition-colors truncate">
                            {away?.name}
                          </span>
                        </div>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-5 pb-5 pt-1 animate-in">
                        {matchGoals.length > 0 ? (
                          <div className="space-y-2 pt-2">
                            {matchGoals.map((goal, idx) => (
                              <div key={idx} className={`flex items-center gap-3 ${goal.scoringTeamId === match.homeTeamId ? '' : 'flex-row-reverse'}`}>
                                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-white/[0.05] ${
                                  goal.scoringTeamId === match.homeTeamId ? 'border-l-2 border-l-vibrant-pink border-white/10' : 'border-r-2 border-r-vibrant-pink border-white/10'
                                }`}>
                                  <div className="w-1.5 h-1.5 rounded-full bg-electric-green animate-pulse" />
                                  <div className="flex flex-col">
                                    <span className="text-[11px] font-black uppercase tracking-tight text-white">
                                      {goal.scorer === "Guest" ? t('guestNonRostered') : goal.scorer}
                                    </span>
                                    {goal.assister && (
                                      <span className="text-[9px] font-bold text-white/80 uppercase tracking-widest leading-none">
                                        {t('asst')} {goal.assister}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-[10px] text-white/65 font-bold uppercase tracking-widest text-center py-4 bg-white/[0.03] rounded-xl border border-dashed border-white/10">
                            {t('noGoalDetails')}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
  );
}
