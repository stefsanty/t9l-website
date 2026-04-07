'use client';

import { useState, useMemo } from 'react';
import Image from 'next/image';
import PlayerAvatar from './PlayerAvatar';
import type { Team, PlayerStats } from '@/types';

interface TopPerformersProps {
  playerStats: PlayerStats[];
}

type SortField = 'playerName' | 'matchesPlayed' | 'goals' | 'assists' | 'avgRating' | 'gaPerGame';
type SortOrder = 'asc' | 'desc';

export default function TopPerformers({
  playerStats,
}: TopPerformersProps) {
  const [visibleCount, setVisibleCount] = useState(10);
  const [sortField, setSortField] = useState<SortField>('goals');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

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
    if (sortField !== field) return <span className="ml-1 opacity-20">↕</span>;
    return <span className="ml-1 text-electric-violet">{sortOrder === 'asc' ? '↑' : '↓'}</span>;
  };

  return (
    <div className="pl-card pl-card-violet rounded-2xl overflow-hidden mb-10 relative">
      <div className="absolute inset-0 bg-diagonal-pattern opacity-5 pointer-events-none" />
      <div className="overflow-x-auto relative">
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr className="border-b border-white/15 bg-white/[0.07] text-white/40 text-[10px] font-black uppercase tracking-[0.1em]">
              <th 
                className="py-4 pl-4 pr-2 cursor-pointer hover:bg-white/[0.10] transition-colors"
                onClick={() => handleSort('playerName')}
              >
                PLAYER <SortIcon field="playerName" />
              </th>
              <th 
                className="py-4 px-1 text-center cursor-pointer hover:bg-white/[0.10] transition-colors whitespace-nowrap"
                onClick={() => handleSort('matchesPlayed')}
                title="Matches Played"
              >
                🅿️ <SortIcon field="matchesPlayed" />
              </th>
              <th 
                className="py-4 px-1 text-center cursor-pointer hover:bg-white/[0.10] transition-colors whitespace-nowrap"
                onClick={() => handleSort('avgRating')}
                title="Rating"
              >
                ✨️ <SortIcon field="avgRating" />
              </th>
              <th 
                className="py-4 px-1 text-center cursor-pointer hover:bg-white/[0.10] transition-colors whitespace-nowrap"
                onClick={() => handleSort('goals')}
                title="Goals"
              >
                ⚽️ <SortIcon field="goals" />
              </th>
              <th 
                className="py-4 px-1 text-center cursor-pointer hover:bg-white/[0.10] transition-colors whitespace-nowrap"
                onClick={() => handleSort('assists')}
                title="Assists"
              >
                👟 <SortIcon field="assists" />
              </th>
              <th 
                className="py-4 pl-1 pr-4 text-right cursor-pointer hover:bg-white/[0.10] transition-colors whitespace-nowrap"
                onClick={() => handleSort('gaPerGame')}
              >
                G+A/G <SortIcon field="gaPerGame" />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {visibleStats.map((stat) => {
              return (
                <tr key={stat.playerId} className="hover:bg-white/[0.07] transition-colors group">
                  <td className="py-4 pl-4 pr-2">
                    <div className="flex items-center gap-3">
                      <PlayerAvatar playerName={stat.playerName} size="md" className="ring-2 ring-white/5 group-hover:ring-electric-violet/30 transition-all" />
                      <div className="flex flex-col min-w-0">
                        <span className="font-bold uppercase tracking-tight text-white group-hover:text-electric-violet transition-colors leading-tight break-words">
                          {stat.playerName}
                        </span>
                        <div className="flex items-center gap-1.5 mt-1">
                          <div className="relative w-3 h-3 shrink-0">
                            {stat.teamLogo ? (
                              <Image
                                src={stat.teamLogo}
                                alt={stat.teamName}
                                fill
                                className="object-contain"
                              />
                            ) : (
                              <div className="w-full h-full rounded-full" style={{ backgroundColor: stat.teamColor }} />
                            )}
                          </div>
                          <span className="text-[9px] font-black text-white/20 uppercase tracking-widest leading-none truncate">{stat.teamName}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-1 text-center font-display font-black text-base text-white/40 tabular-nums">
                    {stat.matchesPlayed}
                  </td>
                  <td className="py-4 px-1 text-center font-display font-black text-base text-electric-violet tabular-nums">
                    {stat.avgRating > 0 ? stat.avgRating.toFixed(1) : '—'}
                  </td>
                  <td className="py-4 px-1 text-center font-display font-black text-lg text-white tabular-nums">
                    {stat.goals}
                  </td>
                  <td className="py-4 px-1 text-center font-display font-black text-base text-white/60 tabular-nums">
                    {stat.assists}
                  </td>
                  <td className="py-4 pl-1 pr-4 text-right font-display font-black text-sm text-white/30 tabular-nums">
                    {stat.gaPerGame.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <div className="p-4 bg-white/[0.05] border-t border-white/10">
          <button
            onClick={() => setVisibleCount((prev) => prev + 10)}
            className="w-full py-3 bg-electric-violet hover:bg-electric-violet/80 text-white rounded-xl text-[11px] font-black uppercase tracking-[0.2em] transition-all hover:-translate-y-0.5 active:translate-y-0"
          >
            Load more players
          </button>
        </div>
      )}
    </div>
  );
}
