'use client';

import { useState } from 'react';
import Image from 'next/image';
import type { Matchday, Team, Goal } from '@/types';

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
            <div className="bg-surface px-5 py-3 border-b border-border-default flex justify-between items-center relative">
              <span className="font-display text-[10px] font-black uppercase tracking-[0.2em] text-fg-high">
                {md.label} — {md.date || "TBD"}
              </span>
              <div className="h-1.5 w-1.5 rounded-full bg-tertiary shadow-[0_0_8px_rgba(0,255,133,0.5)]" />
            </div>
            
            <div className="divide-y divide-border-subtle relative">
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
                        isExpanded ? 'bg-surface-md' : 'hover:bg-surface'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 flex items-center gap-3 min-w-0">
                          <span className="font-display text-sm font-black uppercase tracking-tight text-fg-high group-hover:text-primary transition-colors truncate">
                            {home?.name}
                          </span>
                          <div className="relative w-6 h-6 shrink-0 bg-surface-md rounded-md p-1 border border-border-subtle">
                            {home?.logo && (
                              <Image src={home.logo} alt={home.name} fill className="object-contain p-0.5" />
                            )}
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-3 bg-surface-md px-4 py-1.5 rounded-xl border border-border-default min-w-[90px] justify-center group-hover:border-primary/30 transition-all shrink-0">
                          <span className="font-display text-2xl font-black text-fg-high">{match.homeGoals}</span>
                          <div className="w-4 h-[1px] bg-surface-md" />
                          <span className="font-display text-2xl font-black text-fg-high">{match.awayGoals}</span>
                        </div>

                        <div className="flex-1 flex items-center justify-end gap-3 text-right min-w-0">
                          <div className="relative w-6 h-6 shrink-0 bg-surface-md rounded-md p-1 border border-border-subtle">
                            {away?.logo && (
                              <Image src={away.logo} alt={away.name} fill className="object-contain p-0.5" />
                            )}
                          </div>
                          <span className="font-display text-sm font-black uppercase tracking-tight text-fg-high group-hover:text-primary transition-colors truncate">
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
                                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-surface ${
                                  goal.scoringTeamId === match.homeTeamId ? 'border-l-2 border-l-primary border-border-subtle' : 'border-r-2 border-r-primary border-border-subtle'
                                }`}>
                                  <div className="w-1.5 h-1.5 rounded-full bg-electric-green animate-pulse" />
                                  <div className="flex flex-col">
                                    <span className="text-[11px] font-black uppercase tracking-tight text-fg-high" translate="no">
                                      {goal.scorer === "Guest" ? "Guest (non-rostered)" : goal.scorer}
                                    </span>
                                    {goal.assister && (
                                      <span className="text-[9px] font-bold text-fg-mid uppercase tracking-widest leading-none">
                                        {"asst:"} {goal.assister}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-[10px] text-fg-mid font-bold uppercase tracking-widest text-center py-4 bg-surface rounded-xl border border-dashed border-border-subtle">
                            {"No goal details recorded"}
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
