'use client';

import { useState } from 'react';
import Image from 'next/image';
import type { Team, Player, Availability } from '@/types';

interface SquadListProps {
  teams: Team[];
  players: Player[];
  availability: Availability;
  nextMatchdayId: string;
}

export default function SquadList({
  teams,
  players,
  availability,
  nextMatchdayId,
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
    <section className="mb-8">
      <h2 className="font-display text-2xl font-bold uppercase tracking-wide mb-4">
        Squads
      </h2>
      <div className="space-y-3">
        {teams.map((team) => {
          const isExpanded = expandedTeamId === team.id;
          const teamPlayers = getTeamPlayers(team.id);

          return (
            <div
              key={team.id}
              className="bg-card border border-border rounded-xl overflow-hidden shadow-sm transition-all"
            >
              <button
                onClick={() => setExpandedTeamId(isExpanded ? null : team.id)}
                className="w-full flex items-center justify-between px-4 py-4 text-left hover:bg-white/[0.02] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="relative w-10 h-10">
                    {team.logo ? (
                      <Image
                        src={team.logo}
                        alt={team.name}
                        fill
                        className="object-contain"
                      />
                    ) : (
                      <div className="w-full h-full rounded-full" style={{ backgroundColor: team.color }} />
                    )}
                  </div>
                  <div>
                    <h3 className="font-display text-xl font-bold uppercase tracking-tight">
                      {team.name}
                    </h3>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
                      {teamPlayers.length} Players
                    </span>
                  </div>
                </div>
                <svg
                  className={`w-5 h-5 text-muted transition-transform duration-300 ${
                    isExpanded ? 'rotate-180' : ''
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isExpanded && (
                <div className="border-t border-border divide-y divide-border/20 bg-white/[0.01]">
                  {teamPlayers.map((player) => {
                    const available = isAvailable(player.id, team.id);
                    return (
                      <div
                        key={player.id}
                        className="px-4 py-2.5 flex items-center justify-between"
                      >
                        <div className="flex flex-col">
                          <span className="text-sm font-bold tracking-tight text-white/90 uppercase">
                            {player.name}
                          </span>
                          <span className="text-[10px] font-medium text-muted/60 uppercase tracking-tighter">
                            {player.position || "—"}
                          </span>
                        </div>
                        {hasAvailabilityData && (
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-black uppercase tracking-tighter text-muted/40">
                              Available?
                            </span>
                            <span className={`text-sm ${available ? 'opacity-100' : 'opacity-20'}`}>
                              {available ? '✅' : '❓'}
                            </span>
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
    </section>
  );
}
