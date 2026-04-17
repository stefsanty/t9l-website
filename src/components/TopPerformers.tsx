'use client';

import { useState, useMemo } from 'react';
import Image from 'next/image';
import { useSession } from 'next-auth/react';
import PlayerAvatar from './PlayerAvatar';
import type { PlayerStats } from '@/types';

interface TopPerformersProps {
  playerStats: PlayerStats[];
  playerPictures: Record<string, string>;
}

type SortField = 'playerName' | 'matchesPlayed' | 'goals' | 'assists' | 'gaPerGame';
type SortOrder = 'asc' | 'desc';

function SortIcon({ 
  field, 
  sortField, 
  sortOrder 
}: { 
  field: SortField; 
  sortField: SortField; 
  sortOrder: SortOrder 
}) {
  if (sortField !== field) return <span className="ml-1 opacity-20">↕</span>;
  return <span className="ml-1 text-electric-violet">{sortOrder === 'asc' ? '↑' : '↓'}</span>;
}

export default function TopPerformers({
  playerStats,
  playerPictures,
}: TopPerformersProps) {
  const { data: session } = useSession();
  const [visibleCount, setVisibleCount] = useState(10);
  const [sortField, setSortField] = useState<SortField>('goals');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const sortedStats = useMemo(() => {
    const activeStats = playerStats.filter(
      (s) => s.matchesPlayed > 0 || s.goals > 0 || s.assists > 0,
    );
    return [...activeStats].sort((a, b) => {
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

  return (
    <div className="pl-card pl-card-violet rounded-2xl overflow-hidden mb-10 relative">
      <div className="absolute inset-0 bg-diagonal-pattern opacity-5 pointer-events-none" />
      <div className="overflow-x-auto relative">
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr className="border-b border-border-default bg-surface text-fg-high text-[10px] font-black uppercase tracking-[0.1em]">
              <th
                className="py-4 pl-4 pr-2 cursor-pointer hover:bg-surface-md transition-colors"
                onClick={() => handleSort('playerName')}
              >
                {"PLAYER"} <SortIcon field="playerName" sortField={sortField} sortOrder={sortOrder} />
              </th>
              <th 
                className="py-4 px-1 text-center cursor-pointer hover:bg-surface-md transition-colors whitespace-nowrap"
                onClick={() => handleSort('matchesPlayed')}
                title={"Matches Played"}
              >
                🅿️ <SortIcon field="matchesPlayed" sortField={sortField} sortOrder={sortOrder} />
              </th>
              <th
                className="py-4 px-1 text-center cursor-pointer hover:bg-surface-md transition-colors whitespace-nowrap"
                onClick={() => handleSort('goals')}
                title={"Goals"}
              >
                ⚽️ <SortIcon field="goals" sortField={sortField} sortOrder={sortOrder} />
              </th>
              <th 
                className="py-4 px-1 text-center cursor-pointer hover:bg-surface-md transition-colors whitespace-nowrap"
                onClick={() => handleSort('assists')}
                title={"Assists"}
              >
                👟 <SortIcon field="assists" sortField={sortField} sortOrder={sortOrder} />
              </th>
              <th 
                className="py-4 pl-1 pr-4 text-right cursor-pointer hover:bg-surface-md transition-colors whitespace-nowrap"
                onClick={() => handleSort('gaPerGame')}
              >
                G+A/G <SortIcon field="gaPerGame" sortField={sortField} sortOrder={sortOrder} />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {visibleStats.map((stat) => {
              const isUser = session?.playerId === stat.playerId;
              return (
                <tr key={stat.playerId} className={`hover:bg-surface transition-colors group ${isUser ? 'bg-success/10' : ''}`}>
                  <td className="py-4 pl-4 pr-2">
                    <div className="flex items-center gap-3">
                      <PlayerAvatar 
                        playerName={stat.playerName} 
                        pictureUrl={playerPictures[stat.playerId]} 
                        size="md" 
                        className={`ring-2 ring-border-subtle transition-all ${isUser ? 'ring-success/50' : 'group-hover:ring-secondary/30'}`} 
                      />
                      <div className="flex flex-col min-w-0">
                        <span className={`font-bold uppercase tracking-tight transition-colors leading-tight break-words ${isUser ? '' : 'text-fg-high group-hover:text-secondary'}`} translate="no">
                          {stat.playerName}
                        </span>
                        {isUser && (
                          <span className="text-[9px] font-black text-tertiary text-fg-mid tracking-widest uppercase mt-0.5">
                            {"You"}
                          </span>
                        )}
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
                          <span className="text-[9px] font-black text-fg-mid uppercase tracking-widest leading-none truncate" translate="no">{stat.teamName}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-1 text-center font-display font-black text-base text-fg-high tabular-nums">
                    {stat.matchesPlayed}
                  </td>
                  <td className="py-4 px-1 text-center font-display font-black text-lg text-fg-high tabular-nums">
                    {stat.goals}
                  </td>
                  <td className="py-4 px-1 text-center font-display font-black text-base text-fg-high tabular-nums">
                    {stat.assists}
                  </td>
                  <td className="py-4 pl-1 pr-4 text-right font-display font-black text-sm text-fg-mid tabular-nums">
                    {stat.gaPerGame.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <div className="p-4 bg-surface border-t border-border-subtle">
          <button
            onClick={() => setVisibleCount((prev) => prev + 10)}
            className="w-full py-3 bg-electric-violet hover:bg-electric-violet/80 text-white rounded-xl text-[11px] font-black uppercase tracking-[0.2em] transition-all hover:-translate-y-0.5 active:translate-y-0"
          >
            {"Load more players"}
          </button>
        </div>
      )}
    </div>
  );
}
