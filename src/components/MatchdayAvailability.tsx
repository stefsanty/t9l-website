'use client';

import { useState } from 'react';
import type { Matchday, Team, Player, Availability, AvailabilityStatuses, PlayedStatus } from '@/types';

// -- Formation helpers --

interface Formation {
  label: string;
  def: number;
  mid: number;
  fwd: number;
}

const FORMATIONS: Formation[] = [
  { label: '3-4-1', def: 3, mid: 4, fwd: 1 },
  { label: '3-2-3', def: 3, mid: 2, fwd: 3 },
  { label: '4-3-1', def: 4, mid: 3, fwd: 1 },
  { label: '4-2-2', def: 4, mid: 2, fwd: 2 },
];

function pickFormation(defCount: number, midCount: number, fwdCount: number): Formation {
  let best = FORMATIONS[0];
  let bestScore = Infinity;
  for (const f of FORMATIONS) {
    const score =
      Math.abs(defCount - f.def) +
      Math.abs(midCount - f.mid) +
      Math.abs(fwdCount - f.fwd);
    if (score < bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return best;
}

function distributeToSlots<T>(items: T[], slots: number): T[][] {
  const result: T[][] = Array.from({ length: slots }, () => []);
  items.forEach((item, i) => result[i % slots].push(item));
  return result;
}

// -- TeamFormation sub-component --

function TeamFormation({
  confirmedIds,
  players,
  teamColor,
}: {
  confirmedIds: string[];
  players: Player[];
  teamColor: string;
}) {
    const getPlayer = (id: string) => players.find((p) => p.id === id);

  const gks: Player[] = [];
  const pureDefs: Player[] = [];
  const defMidHybrids: Player[] = [];
  const pureMids: Player[] = [];
  const midFwdHybrids: Player[] = [];
  const pureFwds: Player[] = [];

  for (const pid of confirmedIds) {
    const p = getPlayer(pid);
    if (!p) continue;
    switch (p.position) {
      case 'GK':     gks.push(p);            break;
      case 'DF':     pureDefs.push(p);       break;
      case 'DF/MF':  defMidHybrids.push(p);  break;
      case 'MF':     pureMids.push(p);       break;
      case 'MF/FWD': midFwdHybrids.push(p);  break;
      case 'FWD':    pureFwds.push(p);       break;
      default:       pureMids.push(p);       break;
    }
  }

  const autoFormation = pickFormation(
    pureDefs.length + defMidHybrids.length,
    pureMids.length + midFwdHybrids.length,
    pureFwds.length,
  );

  const [formation, setFormation] = useState<Formation>(autoFormation);

  if (confirmedIds.length === 0) {
    return (
      <span className="text-[11px] text-fg-mid italic py-2 px-1 block">
        {"No confirmations yet"}
      </span>
    );
  }

  const defSlotsLeft = Math.max(0, formation.def - pureDefs.length);
  const defMidToDef  = defMidHybrids.slice(0, defSlotsLeft);
  const defMidToMid  = defMidHybrids.slice(defSlotsLeft);

  const midSlotsLeft = Math.max(0, formation.mid - pureMids.length - defMidToMid.length);
  const midFwdToMid  = midFwdHybrids.slice(0, midSlotsLeft);
  const midFwdToFwd  = midFwdHybrids.slice(midSlotsLeft);

  const defs = [...pureDefs, ...defMidToDef];
  const mids = [...pureMids, ...defMidToMid, ...midFwdToMid];
  const fwds = [...pureFwds, ...midFwdToFwd];

  const fwdSlots = distributeToSlots(fwds, formation.fwd);
  const midSlots = distributeToSlots(mids, formation.mid);
  const defSlots = distributeToSlots(defs, formation.def);
  const gkSlots  = distributeToSlots(gks, 1);

  const rows = [
    { label: "FWD", slots: fwdSlots },
    { label: "MID", slots: midSlots },
    { label: "DEF", slots: defSlots },
    { label: "GK",  slots: gkSlots  },
  ];

  return (
    <div className="mt-2">
      <div className="flex justify-between items-center mb-1">
        <span className="text-[9px] font-black uppercase tracking-widest text-fg-low">{"LINEUP"}</span>
        <div className="flex gap-1">
          {FORMATIONS.map((f) => {
            const isActive = formation.label === f.label;
            return (
              <button
                key={f.label}
                onClick={() => setFormation(f)}
                className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded transition-all ${isActive ? 'text-foreground' : 'text-fg-low bg-surface'}`}
                style={isActive ? { backgroundColor: teamColor + '55' } : undefined}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        className="relative w-full rounded-xl overflow-hidden"
        style={{
          aspectRatio: '3 / 4',
          background: 'repeating-linear-gradient(180deg,#1d6b2b 0%,#1d6b2b 12.5%,#196126 12.5%,#196126 25%)',
        }}
      >
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 100 133"
          preserveAspectRatio="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect x="4" y="4" width="92" height="125" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.9"/>
          <line x1="4" y1="66.5" x2="96" y2="66.5" stroke="rgba(255,255,255,0.3)" strokeWidth="0.9"/>
          <circle cx="50" cy="66.5" r="14" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.9"/>
          <rect x="23" y="4" width="54" height="22" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.9"/>
          <rect x="37" y="4" width="26" height="9" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.9"/>
          <rect x="23" y="107" width="54" height="22" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.9"/>
          <rect x="37" y="120" width="26" height="9" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.9"/>
        </svg>

        <div className="absolute inset-0 flex flex-col justify-evenly py-[9%] px-[5%]">
          {rows.map(({ label, slots }) => (
            <div key={label} className="flex justify-around items-start">
              {slots.map((slotPlayers, i) => (
                <div key={i} className="flex flex-col items-center gap-[3px]">
                  {slotPlayers.length > 0 ? (
                    <>
                      <div
                        className="w-5 h-5 rounded-full shrink-0"
                        style={{
                          background: teamColor,
                          boxShadow: '0 0 0 2px rgba(255,255,255,0.85), 0 2px 6px rgba(0,0,0,0.5)',
                        }}
                      />
                      {slotPlayers.map((p) => (
                        <div
                          key={p.id}
                          className="text-[8px] font-black text-white text-center px-1.5 py-[2px] rounded whitespace-nowrap leading-tight" translate="no"
                          style={{ backgroundColor: 'rgba(0,0,0,0.62)' }}
                        >
                          {p.name}
                        </div>
                      ))}
                    </>
                  ) : (
                    <div className="w-5 h-5 rounded-full border-2 border-dashed border-white/40" />
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// -- Main component --

interface MatchdayAvailabilityProps {
  matchday: Matchday;
  teams: Team[];
  players: Player[];
  availability: Availability;
  availabilityStatuses: AvailabilityStatuses;
  played: PlayedStatus;
}

export default function MatchdayAvailability({
  matchday,
  teams,
  players,
  availability,
  availabilityStatuses,
  played,
}: MatchdayAvailabilityProps) {
    const isNext = matchday.matches[0].homeGoals === null;
  const playingTeams = teams.filter((t) => t.id !== matchday.sittingOutTeamId);

  // All playing teams collapsed by default
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(
    () => new Set()
  );

  function toggleTeam(teamId: string) {
    setExpandedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  }

  const mdAvailability = availability[matchday.id] || {};
  const mdPlayed = played[matchday.id] || {};

  if (!isNext) {
    // Past matchday — show who played
    const anyPlayed = playingTeams.some((t) => (mdPlayed[t.id] || []).length > 0);
    if (!anyPlayed) return null;

    return (
      <section className="mt-3 mb-3 animate-in">
        <div className="flex items-center gap-3 mb-2">
          <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-fg-mid">
            {"Who Played"}
          </h3>
          <div className="h-[1px] flex-1 bg-surface-md" />
        </div>

        <div className="grid gap-2">
          {playingTeams.map((team) => {
            const playedIds = mdPlayed[team.id] || [];
            const isExpanded = expandedTeams.has(team.id);

            return (
              <div
                key={team.id}
                className={`rounded-xl overflow-hidden transition-all duration-300 border ${
                  isExpanded ? 'bg-surface-md border-border-default' : 'bg-surface border-border-subtle hover:border-border-default'
                }`}
              >
                <button
                  onClick={() => toggleTeam(team.id)}
                  className="w-full flex items-center justify-between px-4 py-2 text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: team.color }} />
                    <span className="text-[15px] font-black tracking-tight uppercase" translate="no">{team.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-[11px] font-black px-2 py-0.5 rounded ${
                      playedIds.length > 0 ? 'bg-electric-violet/10 text-electric-violet' : 'bg-surface-md text-fg-mid'
                    }`}>
                      {playedIds.length} {"played"}
                    </span>
                    <svg
                      className={`w-4 h-4 text-fg-mid transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>
                {isExpanded && (
                  <div className="px-4 pb-4 pt-0 border-t border-border-subtle animate-in">
                    <TeamFormation confirmedIds={playedIds} players={players} teamColor={team.color} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  // Upcoming matchday — show availability
  return (
    <section className="mt-4 mb-12 animate-in">
      {/* Player availability */}
      <div className="flex items-center gap-3 mb-3">
        <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-fg-mid">
          {"Who else is coming?"}
        </h3>
        <div className="h-[1px] flex-1 bg-border-subtle" />
      </div>

      <div className="grid gap-3">
        {playingTeams.map((team) => {
          const allAvailIds = mdAvailability[team.id] || [];
          const teamStatuses = availabilityStatuses[matchday.id]?.[team.id] || {};

          const goingIds = allAvailIds.filter((id) => {
            const s = teamStatuses[id];
            return s === 'GOING' || s === 'Y';
          });
          const isExpanded = expandedTeams.has(team.id);

          return (
            <div
              key={team.id}
              className={`rounded-xl overflow-hidden transition-all duration-300 border ${
                isExpanded ? 'bg-surface-md border-border-default' : 'bg-surface border-border-subtle hover:border-border-default'
              }`}
            >
              <button
                onClick={() => toggleTeam(team.id)}
                className="w-full flex items-center justify-between px-4 py-3 text-left"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: team.color }}
                  />
                  <span className="text-[15px] font-black tracking-tight uppercase" translate="no">
                    {team.name}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-semibold text-fg-mid">
                    {goingIds.length} {"going"}
                  </span>
                  <svg
                    className={`w-4 h-4 text-fg-mid transition-transform duration-300 ${
                      isExpanded ? 'rotate-180' : ''
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
                <div className="px-4 pb-4 pt-0 border-t border-border-subtle animate-in">
                  <TeamFormation
                    confirmedIds={goingIds}
                    players={players}
                    teamColor={team.color}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
