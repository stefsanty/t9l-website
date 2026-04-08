'use client';

import { useState } from 'react';
import Image from 'next/image';
import PlayerAvatar from './PlayerAvatar';
import type { Team, Player, Availability, AvailabilityStatuses } from '@/types';

interface SquadListProps {
  teams: Team[];
  players: Player[];
  availability: Availability;
  availabilityStatuses: AvailabilityStatuses;
  nextMatchdayId: string;
  nextMatchdayLabel: string;
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
    default: return 'bg-surface-md text-fg-mid border-border-subtle';
  }
};

export default function SquadList({
  teams,
  players,
  availability,
  availabilityStatuses,
  nextMatchdayId,
  nextMatchdayLabel,
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
  const mdStatuses = availabilityStatuses[nextMatchdayId] || {};
  const hasAvailabilityData = Object.keys(mdAvail).length > 0;

  const getAvailabilityStatus = (playerId: string, teamId: string) =>
    mdStatuses[teamId]?.[playerId] ?? null;

  return (
    <div className="space-y-4">
        {teams.map((team) => {
          const isExpanded = expandedTeamId === team.id;
          const teamPlayers = getTeamPlayers(team.id);

          return (
            <div
              key={team.id}
              className={`pl-card pl-card-violet rounded-2xl overflow-hidden transition-all relative ${
                isExpanded ? 'ring-1 ring-border-subtle' : 'hover:bg-surface'
              }`}
            >
              <div className="absolute inset-0 bg-diagonal-pattern opacity-5 pointer-events-none" />
              <button
                onClick={() => setExpandedTeamId(isExpanded ? null : team.id)}
                className="w-full flex items-center justify-between px-5 py-5 text-left transition-colors relative"
              >
                <div className="flex items-center gap-4">
                  <div className="relative w-12 h-12 bg-surface-md rounded-xl p-2 border border-border-subtle">
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
                    <h3 className="font-display text-2xl font-black uppercase tracking-tight text-fg-high group-hover:text-secondary transition-colors">
                      {team.name}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="h-[1px] w-4 bg-surface-md" />
                      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-fg-mid">
                        {teamPlayers.length} {"SQUAD MEMBERS"}
                      </span>
                      {hasAvailabilityData && (
                        <>
                          <div className="h-[1px] w-2 bg-surface-md" />
                          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-fg-mid">
                            {nextMatchdayLabel} {"AVAILABILITY"}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className={`p-2 rounded-full border border-border-subtle bg-surface-md transition-transform duration-300 ${
                  isExpanded ? 'rotate-180 bg-secondary/10 border-secondary/20' : ''
                }`}>
                  <svg
                    className={`w-5 h-5 ${isExpanded ? 'text-secondary' : 'text-fg-mid'}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-border-subtle divide-y divide-border-subtle bg-surface relative animate-in">
                  {teamPlayers.map((player) => {
                    const status = getAvailabilityStatus(player.id, team.id);
                    const badgeProps = (() => {
                      if (status === 'GOING' || status === 'Y') return { label: "GOING", cls: 'bg-electric-green/10 border-electric-green/20 text-electric-green', dotCls: 'bg-electric-green shadow-[0_0_8px_rgba(0,255,133,0.5)]' };
                      if (status === 'UNDECIDED' || status === 'EXPECTED') return { label: "UNDECIDED", cls: 'bg-yellow-400/10 border-yellow-400/20 text-yellow-400', dotCls: 'bg-yellow-400' };
                      if (status === 'PLAYED') return { label: "PLAYED", cls: 'bg-secondary/10 border-secondary/20 text-secondary', dotCls: 'bg-secondary' };
                      return { label: "NOT GOING", cls: 'bg-surface border-border-subtle text-fg-mid', dotCls: 'bg-surface-md' };
                    })();
                    return (
                      <div
                        key={player.id}
                        className="px-5 py-3 flex items-center justify-between group hover:bg-surface-md transition-colors"
                      >
                        <div className="flex items-center gap-4">
                          <PlayerAvatar playerName={player.name} pictureUrl={playerPictures[player.id]} size="md" className="ring-2 ring-border-subtle group-hover:ring-secondary/20 transition-all" />
                          <div className="flex flex-col items-start gap-1">
                            <span className="text-sm font-black uppercase tracking-tight text-fg-high group-hover:text-secondary transition-colors" translate="no">
                              {player.name}
                            </span>
                            <span className={`inline-flex items-center justify-center w-14 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border ${getPositionColor(player.position)}`} translate="no">
                              {player.position || "—"}
                            </span>
                          </div>
                        </div>
                        {hasAvailabilityData && (
                          <div className={`flex items-center gap-2 px-3 py-1 rounded-full border transition-all ${badgeProps.cls}`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${badgeProps.dotCls}`} />
                            <span className="text-[9px] font-black uppercase tracking-widest">{badgeProps.label}</span>
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
