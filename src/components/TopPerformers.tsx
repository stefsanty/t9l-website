'use client';

import { useState, useMemo } from 'react';
import Image from 'next/image';
import type { Team, PlayerStats } from '@/types';

interface TopPerformersProps {
  teams: Team[];
  playerStats: PlayerStats[];
}

type SortField = 'playerName' | 'matchesPlayed' | 'goals' | 'assists' | 'avgRating' | 'gaPerGame';
type SortOrder = 'asc' | 'desc';

export default function TopPerformers({
  teams,
  playerStats,
}: TopPerformersProps) {
  const [visibleCount, setVisibleCount] = useState(10);
  const [sortField, setSortField] = useState<SortField>('goals');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const getTeam = (id: string) => teams.find((t) => t.id === id);

  const sortedStats = useMemo(() => {
    return [...playerStats].sort((a, b) => {
      let comparison = 0;
      if (sortField === 'playerName') {
        comparison = a.playerName.localeCompare(b.playerName);
      } else {
        comparison = (a[sortField] as number) - (b[sortField] as number);
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [playerStats, sortField, sortOrder]);

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const visibleStats = sortedStats.slice(0, visibleCount);
  const hasMore = visibleCount < sortedStats.length;

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <span className="ml-0.5 opacity-20">↕</span>;
    return <span className="ml-0.5 text-primary">{sortOrder === 'asc' ? '↑' : '↓'}</span>;
  };

  return (
    <section className="mb-12">
      <h2 className="font-display text-2xl font-bold uppercase tracking-tight mb-4 italic">
        Player Statistics
      </h2>
      
      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse min-w-[450px]">
            <thead>
              <tr className="border-b border-border bg-white/[0.02]">
                <th 
                  className="py-3 px-3 font-black uppercase tracking-widest text-[10px] text-muted cursor-pointer hover:bg-white/[0.05] transition-colors"
                  onClick={() => handleSort('playerName')}
                >
                  Player <SortIcon field="playerName" />
                </th>
                <th 
                  className="py-3 px-2 font-black text-center cursor-pointer hover:bg-white/[0.05] transition-colors whitespace-nowrap"
                  onClick={() => handleSort('matchesPlayed')}
                  title="Matches Played"
                >
                  🅿️ <SortIcon field="matchesPlayed" />
                </th>
                <th 
                  className="py-3 px-2 font-black text-center cursor-pointer hover:bg-white/[0.05] transition-colors whitespace-nowrap"
                  onClick={() => handleSort('avgRating')}
                  title="Rating"
                >
                  ✨️ <SortIcon field="avgRating" />
                </th>
                <th 
                  className="py-3 px-2 font-black text-center cursor-pointer hover:bg-white/[0.05] transition-colors whitespace-nowrap"
                  onClick={() => handleSort('goals')}
                  title="Goals"
                >
                  ⚽️ <SortIcon field="goals" />
                </th>
                <th 
                  className="py-3 px-2 font-black text-center cursor-pointer hover:bg-white/[0.05] transition-colors whitespace-nowrap"
                  onClick={() => handleSort('assists')}
                  title="Assists"
                >
                  👟 <SortIcon field="assists" />
                </th>
                <th 
                  className="py-3 px-3 font-black uppercase tracking-widest text-[10px] text-muted text-right cursor-pointer hover:bg-white/[0.05] transition-colors whitespace-nowrap"
                  onClick={() => handleSort('gaPerGame')}
                >
                  G+A/G <SortIcon field="gaPerGame" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/10">
              {visibleStats.map((stat) => {
                const team = getTeam(stat.teamId);
                return (
                  <tr key={stat.playerId} className="hover:bg-white/[0.02] transition-colors group">
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <div className="relative w-4 h-4 shrink-0">
                          {team?.logo ? (
                            <Image
                              src={team.logo}
                              alt={team.name}
                              fill
                              className="object-contain"
                            />
                          ) : (
                            <div className="w-full h-full rounded-full bg-white/10" style={{ backgroundColor: team?.color }} />
                          )}
                        </div>
                        <span className="font-bold uppercase tracking-tight text-white group-hover:text-primary transition-colors truncate max-w-[100px]">
                          {stat.playerName}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-2 text-center font-display font-black text-base text-muted/80">
                      {stat.matchesPlayed}
                    </td>
                    <td className="py-3 px-2 text-center font-display font-black text-base text-primary">
                      {stat.avgRating > 0 ? stat.avgRating.toFixed(1) : '—'}
                    </td>
                    <td className="py-3 px-2 text-center font-display font-black text-base text-white">
                      {stat.goals}
                    </td>
                    <td className="py-3 px-2 text-center font-display font-black text-base text-white/60">
                      {stat.assists}
                    </td>
                    <td className="py-3 px-3 text-right font-display font-black text-base text-white/40">
                      {stat.gaPerGame.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {hasMore && (
          <button
            onClick={() => setVisibleCount((prev) => prev + 10)}
            className="w-full py-4 bg-white/[0.02] hover:bg-white/[0.05] border-t border-border text-[10px] font-black uppercase tracking-[0.3em] text-muted hover:text-white transition-all"
          >
            Load more players...
          </button>
        )}
      </div>
    </section>
  );
}
