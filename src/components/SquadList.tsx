'use client';

import { useState } from 'react';
import Image from 'next/image';
import PlayerAvatar from './PlayerAvatar';
import type { Team, Player, Availability } from '@/types';

interface SquadListProps {
  teams: Team[];
  players: Player[];
  availability: Availability;
  nextMatchdayId: string;
  playerPictures: Record<string, string>;
}

const getPositionColor = (pos: string | null) => {
  switch (pos?.toUpperCase()) {
    case 'GK': return 'bg-zinc-950 text-white border-white/20';
    case 'DF': return 'bg-blue-600 text-white border-blue-400/30';
    case 'DF/MF': return 'bg-teal-600 text-white border-teal-400/30';
    case 'MF': return 'bg-emerald-600 text-white border-emerald-400/30';
    case 'MF/FWD': return 'bg-orange-600 text-white border-orange-400/30';
    case 'FWD': return 'bg-red-600 text-white border-red-400/30';
    default: return 'bg-white/5 text-white/20 border-white/5';
  }
};

export default function SquadList({
  teams,
  players,
  availability,
  nextMatchdayId,
  playerPictures,
}: SquadListProps) {
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);

  const getTeamPlayers = (teamId: string) => {
    const positionOrder: Record<string, number> = {
      'GK': 1,
      'DF': 2,
      'DF/MF': 3,
      'MF': 4,
      'MF/FWD': 5,
      'FWD': 6,
    };

    return players
      .filter((p) => p.teamId === teamId)
      .sort((a, b) => {
        const posA = positionOrder[a.position || ''] || 99;
        const posB = positionOrder[b.position || ''] || 99;

        if (posA !== posB) return posA - posB;
        return a.name.localeCompare(b.name);
      });
  };

  const mdAvail = availability[nextMatchdayId] || {};
  const hasAvailabilityData = Object.keys(mdAvail).length > 0;

  const isAvailable = (playerId: string, teamId: string) => {
    const teamAvail = mdAvail[teamId] || [];
    return teamAvail.includes(playerId);
  };

  return (
    <div className="space-y-4">
        {teams.map((team) => {
          const isExpanded = expandedTeamId === team.id;
          const teamPlayers = getTeamPlayers(team.id);

          return (
            <div
              key={team.id}
              className={`pl-card pl-card-violet rounded-2xl overflow-hidden transition-all relative ${
                isExpanded ? 'ring-1 ring-white/10' : 'hover:bg-white/[0.01]'
              }`}
            >
              <div className="absolute inset-0 bg-diagonal-pattern opacity-5 pointer-events-none" />
              <button
                onClick={() => setExpandedTeamId(isExpanded ? null : team.id)}
                className="w-full flex items-center justify-between px-5 py-5 text-left transition-colors relative"
              >
                <div className="flex items-center gap-4">
                  <div className="relative w-12 h-12 bg-white/5 rounded-xl p-2 border border-white/5">
                    {team.logo ? (
                      <Image
                        src={team.logo}
                        alt={team.name}
                        fill
                        className="object-contain p-1"
                      />
                    ) : (
                      <div className="w-full h-full rounded-lg" style={{ backgroundColor: team.color }} />
                    )}
                  </div>
                  <div>
                    <h3 className="font-display text-2xl font-black uppercase tracking-tight text-white group-hover:text-electric-violet transition-colors">
                      {team.name}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="h-[1px] w-4 bg-white/10" />
                      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30">
                        {teamPlayers.length} SQUAD MEMBERS
                      </span>
                    </div>
                  </div>
                </div>
                <div className={`p-2 rounded-full border border-white/5 bg-white/5 transition-transform duration-300 ${
                  isExpanded ? 'rotate-180 bg-electric-violet/10 border-electric-violet/20' : ''
                }`}>
                  <svg
                    className={`w-5 h-5 ${isExpanded ? 'text-electric-violet' : 'text-white/20'}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-white/5 divide-y divide-white/5 bg-white/[0.01] relative animate-in">
                  {teamPlayers.map((player) => {
                    const available = isAvailable(player.id, team.id);
                    return (
                      <div
                        key={player.id}
                        className="px-5 py-3 flex items-center justify-between group hover:bg-white/[0.02] transition-colors"
                      >
                        <div className="flex items-center gap-4">
                          <PlayerAvatar playerName={player.name} pictureUrl={playerPictures[player.id]} size="md" className="ring-2 ring-white/5 group-hover:ring-electric-violet/20 transition-all" />
                          <div className="flex flex-col items-start gap-1">
                            <span className="text-sm font-black uppercase tracking-tight text-white group-hover:text-electric-violet transition-colors">
                              {player.name}
                            </span>
                            <span className={`inline-flex items-center justify-center w-14 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border ${getPositionColor(player.position)}`}>
                              {player.position || "—"}
                            </span>
                          </div>
                        </div>
                        {hasAvailabilityData && (
                          <div className={`flex items-center gap-2 px-3 py-1 rounded-full border transition-all ${
                            available ? 'bg-electric-green/10 border-electric-green/20 text-electric-green' : 'bg-white/5 border-white/5 text-white/10'
                          }`}>
                            <span className="text-[9px] font-black uppercase tracking-widest">
                              {available ? 'CONFIRMED' : 'PENDING'}
                            </span>
                            <div className={`w-1.5 h-1.5 rounded-full ${available ? 'bg-electric-green shadow-[0_0_8px_rgba(0,255,133,0.5)]' : 'bg-white/10'}`} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
  );
}
