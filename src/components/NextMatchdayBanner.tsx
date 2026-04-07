'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useSession } from 'next-auth/react';
import type { Matchday, Team, Player, Availability, Goal } from '@/types';
import RsvpButton from './RsvpButton';

// ── Formation helpers ─────────────────────────────────────────────────────────

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

function categorizePosition(position: string | null | undefined): 'gk' | 'def' | 'mid' | 'fwd' {
  if (position === 'GK') return 'gk';
  if (position === 'DF' || position === 'DF/MF') return 'def';
  if (position === 'FWD') return 'fwd';
  return 'mid'; // MF, MF/FWD, null → midfield
}

function pickFormation(defCount: number, midCount: number, fwdCount: number): Formation {
  let best = FORMATIONS[0]; // default 3-4-1
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

function formatShortDate(dateStr: string | null): string {
  if (!dateStr) return 'TBD';
  // Fast path: ISO YYYY-MM-DD (what we normalize to in data.ts)
  const iso = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[parseInt(iso[2], 10) - 1]} ${parseInt(iso[3], 10)}`;
  }
  // Fallback: let the browser parse other formats
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return dateStr;
}

// ── TeamFormation sub-component ───────────────────────────────────────────────

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
      <span className="text-[11px] text-white/20 italic py-2 px-1 block">
        No confirmations yet
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
    { label: 'FWD', slots: fwdSlots },
    { label: 'MID', slots: midSlots },
    { label: 'DEF', slots: defSlots },
    { label: 'GK',  slots: gkSlots  },
  ];

  return (
    <div className="mt-3">
      <div className="flex justify-between items-center mb-2">
        <span className="text-[9px] font-black uppercase tracking-widest text-white/25">LINEUP</span>
        <div className="flex gap-1">
          {FORMATIONS.map((f) => {
            const isActive = formation.label === f.label;
            return (
              <button
                key={f.label}
                onClick={() => setFormation(f)}
                className="text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded transition-all"
                style={
                  isActive
                    ? { backgroundColor: teamColor + '55', color: '#fff' }
                    : { backgroundColor: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.3)' }
                }
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
                          className="text-[8px] font-black text-white text-center px-1.5 py-[2px] rounded whitespace-nowrap leading-tight"
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

// ── Scorers list for a completed match ───────────────────────────────────────

function MatchScorers({
  matchId,
  homeTeamId,
  awayTeamId,
  goals,
  teams,
}: {
  matchId: string;
  homeTeamId: string;
  awayTeamId: string;
  goals: Goal[];
  teams: Team[];
}) {
  const matchGoals = goals.filter((g) => g.matchId === matchId);
  if (matchGoals.length === 0) return null;

  const homeGoals = matchGoals.filter((g) => g.scoringTeamId === homeTeamId);
  const awayGoals = matchGoals.filter((g) => g.scoringTeamId === awayTeamId);
  const maxRows = Math.max(homeGoals.length, awayGoals.length);

  return (
    <div className="mt-2 grid grid-cols-2 gap-x-3 text-[11px]">
      <div className="space-y-0.5">
        {homeGoals.map((g, i) => (
          <div key={i} className="flex items-start gap-1 text-white/60">
            <span className="shrink-0 mt-px">⚽</span>
            <span className="font-semibold truncate">
              {g.scorer}
              {g.assister ? <span className="text-white/35 font-normal"> ({g.assister})</span> : null}
            </span>
          </div>
        ))}
      </div>
      <div className="space-y-0.5 text-right">
        {awayGoals.map((g, i) => (
          <div key={i} className="flex items-start justify-end gap-1 text-white/60">
            <span className="font-semibold truncate">
              {g.scorer}
              {g.assister ? <span className="text-white/35 font-normal"> ({g.assister})</span> : null}
            </span>
            <span className="shrink-0 mt-px">⚽</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface NextMatchdayBannerProps {
  matchdays: Matchday[];
  defaultMatchdayId: string;
  teams: Team[];
  players: Player[];
  availability: Availability;
  goals: Goal[];
}

const VENUE_NAME = 'Tennozu Park C';
const VENUE_MAP_URL = 'https://www.google.com/maps/search/Tennozu+Isle+Park+Tokyo';

export default function NextMatchdayBanner({
  matchdays,
  defaultMatchdayId,
  teams,
  players,
  availability,
  goals,
}: NextMatchdayBannerProps) {
  const [selectedId, setSelectedId] = useState(defaultMatchdayId);
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const { data: session } = useSession();

  const matchday = matchdays.find((m) => m.id === selectedId) ?? matchdays[0];
  const isNext = matchday.matches[0].homeGoals === null;

  // Determine if the logged-in user's team is playing this matchday (not sitting out)
  const userTeamIsPlaying =
    session?.teamId != null &&
    session.teamId !== matchday.sittingOutTeamId;

  // Initial RSVP state from sheet availability
  const userInitialGoing =
    session?.playerId != null &&
    session?.teamId != null &&
    (availability[matchday.id]?.[session.teamId] ?? []).includes(session.playerId);

  const getTeam = (id: string) => teams.find((t) => t.id === id);

  const sittingOutTeam = getTeam(matchday.sittingOutTeamId);
  const mdAvailability = availability[matchday.id] || {};

  function handleSelectMatchday(id: string) {
    setSelectedId(id);
    setExpandedTeamId(null);
  }

  return (
    <section className="mb-12 animate-in">
      {/* Matchday pill selector */}
      <div className="flex gap-2 overflow-x-auto pb-3 mb-4 scrollbar-hide -mx-1 px-1">
        {matchdays.map((md) => {
          const isSelected = md.id === selectedId;
          const isCompleted = md.matches[0].homeGoals !== null;
          return (
            <button
              key={md.id}
              onClick={() => handleSelectMatchday(md.id)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-black uppercase tracking-wider transition-all border ${
                isSelected
                  ? 'bg-vibrant-pink text-white border-vibrant-pink shadow-[0_0_12px_rgba(233,0,82,0.35)]'
                  : isCompleted
                  ? 'bg-white/[0.06] text-white/50 border-white/15 hover:border-white/20 hover:text-white/70'
                  : 'bg-white/[0.07] text-white/40 border-white/[0.12] hover:border-white/15 hover:text-white/60'
              }`}
            >
              {md.label}
              {md.date && (
                <span className={`ml-1.5 font-normal tracking-normal normal-case ${isSelected ? 'text-white/80' : 'text-white/30'}`}>
                  {formatShortDate(md.date)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="pl-card pl-card-magenta rounded-3xl overflow-hidden relative group">
        <div className="absolute inset-0 bg-diagonal-pattern opacity-[0.03] pointer-events-none group-hover:opacity-[0.05] transition-opacity duration-500" />

        {/* Card header */}
        <div className="bg-white/[0.05] px-7 py-5 border-b border-white/[0.10] flex justify-between items-center relative">
          <div className="flex items-center gap-4">
            <div className={`w-2.5 h-2.5 rounded-full ${isNext ? 'bg-vibrant-pink animate-pulse' : 'bg-white/10'}`} />
            <h2 className="font-display text-2xl font-black uppercase tracking-tight text-white/90">
              {isNext ? 'UPCOMING' : 'RESULTS'} — {matchday.label}
            </h2>
          </div>
          <span className="text-[12px] font-black text-white/30 uppercase tracking-[0.2em] bg-white/[0.07] px-4 py-1.5 rounded-full border border-white/[0.10]">
            {matchday.date ? formatShortDate(matchday.date) : 'TBD'}
          </span>
        </div>

        <div className="p-6 relative">
          {/* Venue */}
          <a
            href={VENUE_MAP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[11px] font-bold text-white/40 hover:text-white/70 transition-colors mb-5 group/venue"
          >
            <svg className="w-3 h-3 shrink-0 text-vibrant-pink/70 group-hover/venue:text-vibrant-pink transition-colors" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
            </svg>
            <span className="underline underline-offset-2 decoration-white/20 group-hover/venue:decoration-white/50">
              {VENUE_NAME}
            </span>
          </a>

          {/* Matches */}
          <div className="space-y-5 mb-8">
            {matchday.matches.map((match) => {
              const home = getTeam(match.homeTeamId);
              const away = getTeam(match.awayTeamId);
              const isPlayed = match.homeGoals !== null;

              return (
                <div key={match.id}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 flex items-center gap-3">
                      <div className="relative w-10 h-10 shrink-0 bg-white/10 rounded-lg p-1.5 border border-white/10">
                        {home?.logo && (
                          <Image
                            src={home.logo}
                            alt={home.name}
                            fill
                            className="object-contain p-1"
                          />
                        )}
                      </div>
                      <span className="font-display text-xl font-black uppercase tracking-tighter leading-none hidden sm:block">
                        {home?.name}
                      </span>
                      <span className="font-display text-xl font-black uppercase tracking-tighter leading-none sm:hidden">
                        {home?.shortName || home?.name.slice(0, 3)}
                      </span>
                    </div>

                    <div className="flex flex-col items-center px-4">
                      {!isPlayed ? (
                        <span className="font-display text-2xl font-black tracking-tighter text-vibrant-pink bg-vibrant-pink/10 px-4 py-1.5 rounded-xl border border-vibrant-pink/20">
                          {match.kickoff}
                        </span>
                      ) : (
                        <div className="flex items-center gap-4">
                          <span className="font-display text-4xl font-black text-white">
                            {match.homeGoals}
                          </span>
                          <div className="w-6 h-[2px] bg-white/10" />
                          <span className="font-display text-4xl font-black text-white">
                            {match.awayGoals}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex-1 flex items-center justify-end gap-3 text-right">
                      <span className="font-display text-xl font-black uppercase tracking-tighter leading-none hidden sm:block">
                        {away?.name}
                      </span>
                      <span className="font-display text-xl font-black uppercase tracking-tighter leading-none sm:hidden">
                        {away?.shortName || away?.name.slice(0, 3)}
                      </span>
                      <div className="relative w-10 h-10 shrink-0 bg-white/10 rounded-lg p-1.5 border border-white/10">
                        {away?.logo && (
                          <Image
                            src={away.logo}
                            alt={away.name}
                            fill
                            className="object-contain p-1"
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Goalscorers (elapsed matchdays only) */}
                  {isPlayed && (
                    <MatchScorers
                      matchId={match.id}
                      homeTeamId={match.homeTeamId}
                      awayTeamId={match.awayTeamId}
                      goals={goals}
                      teams={teams}
                    />
                  )}
                </div>
              );
            })}
          </div>

          <div className="pt-6 border-t border-white/10 relative">
            <div className="flex items-center gap-3 mb-6 bg-electric-violet/5 p-3 rounded-xl border border-electric-violet/10">
              <div className="px-2 py-1 bg-electric-violet text-[10px] font-black uppercase tracking-widest rounded-md text-white">
                RESTING
              </div>
              <span className="text-sm font-bold text-white/80">
                {sittingOutTeam?.name}
              </span>
            </div>

            {isNext && (
              <div className="space-y-3">
                {userTeamIsPlaying && (
                  <RsvpButton
                    matchdayId={matchday.id}
                    initialGoing={userInitialGoing}
                  />
                )}

                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-white/30">
                    PLAYER AVAILABILITY
                  </h3>
                  <div className="h-[1px] flex-1 bg-white/10 ml-4" />
                </div>

                <div className="grid gap-3">
                  {teams
                    .filter((t) => t.id !== matchday.sittingOutTeamId)
                    .map((team) => {
                      const confirmedIds = mdAvailability[team.id] || [];
                      const isExpanded = expandedTeamId === team.id;

                      return (
                        <div
                          key={team.id}
                          className={`rounded-xl overflow-hidden transition-all duration-300 border ${
                            isExpanded ? 'bg-white/10 border-white/15' : 'bg-white/[0.05] border-white/10 hover:border-white/15'
                          }`}
                        >
                          <button
                            onClick={() =>
                              setExpandedTeamId(isExpanded ? null : team.id)
                            }
                            className="w-full flex items-center justify-between px-4 py-3 text-left transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <div
                                className="w-3 h-3 rounded-full"
                                style={{ backgroundColor: team.color }}
                              />
                              <span className="text-[15px] font-black tracking-tight uppercase">
                                {team.name}
                              </span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className={`text-[11px] font-black px-2 py-0.5 rounded ${
                                confirmedIds.length > 0 ? 'bg-electric-green/10 text-electric-green' : 'bg-white/10 text-white/30'
                              }`}>
                                {confirmedIds.length} CONFIRMED
                              </span>
                              <svg
                                className={`w-4 h-4 text-white/20 transition-transform duration-300 ${
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
                            <div className="px-4 pb-4 pt-0 border-t border-white/10 animate-in">
                              <TeamFormation
                                confirmedIds={confirmedIds}
                                players={players}
                                teamColor={team.color}
                              />
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
