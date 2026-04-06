'use client';

import { useState } from 'react';
import Image from 'next/image';
import type { Matchday, Team, Player, Availability } from '@/types';

interface NextMatchdayBannerProps {
  matchday: Matchday;
  isNext: boolean;
  teams: Team[];
  players: Player[];
  availability: Availability;
}

export default function NextMatchdayBanner({
  matchday,
  isNext,
  teams,
  players,
  availability,
}: NextMatchdayBannerProps) {
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);

  const getTeam = (id: string) => teams.find((t) => t.id === id);
  const getPlayer = (id: string) => players.find((p) => p.id === id);

  const sittingOutTeam = getTeam(matchday.sittingOutTeamId);
  const mdAvailability = availability[matchday.id] || {};

  return (
    <section className="mb-8">
      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-2xl">
        <div className="bg-white/[0.03] px-5 py-3 border-b border-border flex justify-between items-center">
          <h2 className="font-display text-lg font-bold uppercase tracking-widest text-white/90">
            {isNext ? "Next Matchday" : "Latest Results"} — {matchday.label}
          </h2>
          <span className="text-xs font-medium text-muted uppercase tracking-tighter bg-border/50 px-2 py-0.5 rounded">
            {matchday.date || "TBD"}
          </span>
        </div>

        <div className="p-5">
          <div className="space-y-4 mb-6">
            {matchday.matches.map((match) => {
              const home = getTeam(match.homeTeamId);
              const away = getTeam(match.awayTeamId);

              return (
                <div key={match.id} className="flex items-center justify-between gap-4">
                  <div className="flex-1 flex items-center gap-3">
                    {home?.logo && (
                      <div className="relative w-8 h-8 shrink-0">
                        <Image
                          src={home.logo}
                          alt={home.name}
                          fill
                          className="object-contain"
                        />
                      </div>
                    )}
                    <span className="font-display text-lg font-bold uppercase tracking-tight">
                      {home?.name}
                    </span>
                  </div>

                  <div className="flex flex-col items-center min-w-[100px]">
                    {isNext ? (
                      <span className="font-display text-xl font-black tracking-tighter bg-white/[0.05] px-3 py-1 rounded-md border border-white/10">
                        {match.kickoff}
                      </span>
                    ) : (
                      <div className="flex items-center gap-3">
                        <span className="font-display text-3xl font-black text-white">
                          {match.homeGoals}
                        </span>
                        <span className="text-muted/40 font-bold text-xl">—</span>
                        <span className="font-display text-3xl font-black text-white">
                          {match.awayGoals}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 flex items-center justify-end gap-3 text-right">
                    <span className="font-display text-lg font-bold uppercase tracking-tight">
                      {away?.name}
                    </span>
                    {away?.logo && (
                      <div className="relative w-8 h-8 shrink-0">
                        <Image
                          src={away.logo}
                          alt={away.name}
                          fill
                          className="object-contain"
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pt-4 border-t border-border/50">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/60 bg-white/[0.05] px-2 py-0.5 rounded border border-white/10">
                Resting
              </span>
              <span className="text-sm font-medium text-muted">
                {sittingOutTeam?.name} resting
              </span>
            </div>

            {isNext && (
              <div className="space-y-2">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted/60 mb-2">
                  Player Availability
                </h3>
                <div className="grid gap-2">
                  {teams
                    .filter((t) => t.id !== matchday.sittingOutTeamId)
                    .map((team) => {
                      const confirmedIds = mdAvailability[team.id] || [];
                      const isExpanded = expandedTeamId === team.id;

                      return (
                        <div
                          key={team.id}
                          className="bg-white/[0.02] border border-border/40 rounded-lg overflow-hidden transition-all duration-200"
                        >
                          <button
                            onClick={() =>
                              setExpandedTeamId(isExpanded ? null : team.id)
                            }
                            className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-white/[0.04] transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              <div
                                className="w-1.5 h-1.5 rounded-full shadow-[0_0_8px_rgba(255,255,255,0.2)]"
                                style={{ backgroundColor: team.color }}
                              />
                              <span className="text-sm font-bold tracking-tight">
                                {team.name}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-black text-white/80 tabular-nums">
                                {confirmedIds.length} CONFIRMED
                              </span>
                              <svg
                                className={`w-3 h-3 text-muted transition-transform duration-200 ${
                                  isExpanded ? "rotate-180" : ""
                                }`}
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={3}
                                  d="M19 9l-7 7-7-7"
                                />
                              </svg>
                            </div>
                          </button>

                          {isExpanded && (
                            <div className="px-3 pb-3 pt-1 border-t border-border/20 bg-white/[0.01]">
                              <div className="flex flex-wrap gap-1.5 mt-1">
                                {confirmedIds.length > 0 ? (
                                  confirmedIds.map((pid) => {
                                    const p = getPlayer(pid);
                                    return (
                                      <span
                                        key={pid}
                                        className="text-[10px] font-medium bg-white/[0.05] border border-white/5 px-2 py-0.5 rounded text-muted uppercase tracking-tight"
                                      >
                                        {p?.name || pid}
                                      </span>
                                    );
                                  })
                                ) : (
                                  <span className="text-[10px] text-muted/40 italic py-1">
                                    No confirmations yet
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
