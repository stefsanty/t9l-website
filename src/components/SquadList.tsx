'use client';

import { useState } from 'react';
import Image from 'next/image';
import PlayerAvatar from './PlayerAvatar';
import type { Team, Player, Availability, AvailabilityStatuses } from '@/types';
import { getPositionBucket, groupedPositionLabel } from '@/lib/positions';

interface SquadListProps {
  teams: Team[];
  players: Player[];
  availability: Availability;
  availabilityStatuses: AvailabilityStatuses;
  nextMatchdayId: string;
  nextMatchdayLabel: string;
  playerPictures: Record<string, string>;
}

// v1.82.0 — colour-by-bucket. Since `Player.position` is now a joined
// string like "CB/CM", we colour by the FIRST code's role bucket so
// every soccer/futsal code lights up consistently.
const BUCKET_COLORS: Record<'GK' | 'DF' | 'MF' | 'FW', string> = {
  GK: 'bg-zinc-950 text-white border-white/20',
  DF: 'bg-blue-600 text-white border-blue-400/30',
  MF: 'bg-emerald-600 text-white border-emerald-400/30',
  FW: 'bg-red-600 text-white border-red-400/30',
};

const getPositionColor = (pos: string | null) => {
  if (!pos) return 'bg-surface-md text-fg-mid border-border-subtle';
  const first = pos.split('/')[0]?.toUpperCase();
  if (!first) return 'bg-surface-md text-fg-mid border-border-subtle';
  return BUCKET_COLORS[getPositionBucket(first)];
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
    // v1.82.0 — sort by primary-position bucket. Players keep the
    // canonical GK → DF → MF → FW ordering even when the joined
    // position string contains multiple codes (the first code drives
    // the bucket pick).
    const bucketOrder: Record<'GK' | 'DF' | 'MF' | 'FW', number> = {
      GK: 1, DF: 2, MF: 3, FW: 4,
    };
    const sortKey = (pos: string | null) => {
      if (!pos) return 99;
      const first = pos.split('/')[0]?.toUpperCase();
      if (!first) return 99;
      return bucketOrder[getPositionBucket(first)] ?? 99;
    };
    // v1.87.0 — retired players go to the bottom of their team's list
    // (rendered greyed-out with a "RETIRED" pill). Within the active
    // group + within the retired group, the existing position-bucket +
    // name sort applies. The sort is stable on retiredAt first so all
    // retired entries cluster at the end regardless of position.
    return players
      .filter((p) => p.teamId === teamId)
      .sort((a, b) => {
        const aRetired = a.retiredAt ? 1 : 0;
        const bRetired = b.retiredAt ? 1 : 0;
        if (aRetired !== bRetired) return aRetired - bRetired;
        const posA = sortKey(a.position);
        const posB = sortKey(b.position);
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
          // v1.87.0 — header count shows ACTIVE members only; retired
          // players still render in the expanded list (greyed-out at the
          // bottom) but don't inflate the team's roster size.
          const activeMemberCount = teamPlayers.filter((p) => !p.retiredAt).length;

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
                        sizes="48px"
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
                        {activeMemberCount} {"SQUAD MEMBERS"}
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
                      if (status === 'GOING' || status === 'Y') return { label: "GOING", cls: 'bg-success/10 border-success/25 text-success', dotCls: 'bg-success' };
                      if (status === 'UNDECIDED' || status === 'EXPECTED') return { label: "UNDECIDED", cls: 'bg-warning/10 border-warning/25 text-warning', dotCls: 'bg-warning' };
                      if (status === 'PLAYED') return { label: "PLAYED", cls: 'bg-secondary/10 border-secondary/20 text-secondary', dotCls: 'bg-secondary' };
                      return { label: "NOT GOING", cls: 'bg-surface border-border-subtle text-fg-mid', dotCls: 'bg-surface-md' };
                    })();
                    const isRetired = !!player.retiredAt;
                    return (
                      <div
                        key={player.id}
                        data-testid={isRetired ? `squad-row-retired-${player.id}` : `squad-row-${player.id}`}
                        className={`px-5 py-3 flex items-center justify-between group hover:bg-surface-md transition-colors ${isRetired ? 'opacity-50' : ''}`}
                      >
                        <div className="flex items-center gap-4">
                          <PlayerAvatar playerName={player.name} pictureUrl={playerPictures[player.id]} size="md" className="ring-2 ring-border-subtle group-hover:ring-secondary/20 transition-all" />
                          <div className="flex flex-col items-start gap-1">
                            <span className="text-sm font-black uppercase tracking-tight text-fg-high group-hover:text-secondary transition-colors" translate="no">
                              {player.name}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <span className={`inline-flex items-center justify-center w-14 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border ${getPositionColor(player.position)}`} translate="no">
                                {groupedPositionLabel(player.position ? player.position.split('/') : []) || "—"}
                              </span>
                              {isRetired && (
                                <span
                                  data-testid={`retired-pill-${player.id}`}
                                  className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border border-border-subtle bg-surface-md text-fg-low"
                                >
                                  Retired
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        {hasAvailabilityData && !isRetired && (
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
