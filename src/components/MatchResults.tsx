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
    <section className="mb-8">
      <h2 className="font-display text-2xl font-bold uppercase tracking-wide mb-4">
        Results
      </h2>
      <div className="space-y-4">
        {playedMatchdays.map((md) => (
          <div key={md.id} className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
            <div className="bg-white/[0.02] px-4 py-2 border-b border-border flex justify-between items-center">
              <span className="font-display text-xs font-bold uppercase tracking-widest text-muted">
                {md.label} — {md.date || "TBD"}
              </span>
            </div>
            
            <div className="divide-y divide-border/30">
              {md.matches.map((match) => {
                const home = getTeam(match.homeTeamId);
                const away = getTeam(match.awayTeamId);
                const isExpanded = expandedMatchId === match.id;
                const matchGoals = goals.filter((g) => g.matchId === match.id);

                return (
                  <div key={match.id}>
                    <button
                      onClick={() => setExpandedMatchId(isExpanded ? null : match.id)}
                      className="w-full px-4 py-3 text-left hover:bg-white/[0.01] transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 flex items-center gap-2">
                          <span className="font-display text-sm font-bold uppercase">
                            {home?.shortName}
                          </span>
                          {home?.logo && (
                            <Image src={home.logo} alt={home.name} width={16} height={16} className="object-contain" />
                          )}
                        </div>
                        
                        <div className="flex items-center gap-2 bg-white/[0.05] px-3 py-1 rounded-md border border-white/5 min-w-[70px] justify-center">
                          <span className="font-display text-lg font-black">{match.homeGoals}</span>
                          <span className="text-muted/30 font-bold">—</span>
                          <span className="font-display text-lg font-black">{match.awayGoals}</span>
                        </div>
                        
                        <div className="flex-1 flex items-center justify-end gap-2 text-right">
                          {away?.logo && (
                            <Image src={away.logo} alt={away.name} width={16} height={16} className="object-contain" />
                          )}
                          <span className="font-display text-sm font-bold uppercase">
                            {away?.shortName}
                          </span>
                        </div>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 pt-1 bg-white/[0.01]">
                        {matchGoals.length > 0 ? (
                          <div className="space-y-1">
                            {matchGoals.map((goal, idx) => (
                              <div key={idx} className={`flex items-center gap-2 text-[10px] ${goal.scoringTeamId === match.homeTeamId ? '' : 'flex-row-reverse'}`}>
                                <div className="flex items-center gap-1.5 font-bold uppercase tracking-tight text-white/90">
                                  <div className="w-1.5 h-1.5 rounded-full bg-white/40" />
                                  <span>{goal.scorer === "Guest" ? "Guest (non-rostered)" : goal.scorer}</span>
                                  {goal.assister && (
                                    <span className="text-muted/60 lowercase italic font-medium">
                                      (asst: {goal.assister})
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-[10px] text-muted/40 italic text-center">
                            No goal details available
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
    </section>
  );
}
