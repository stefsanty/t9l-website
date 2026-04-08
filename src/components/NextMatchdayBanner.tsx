'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Image from 'next/image';
import type { Matchday, Team, Goal, AvailabilityStatuses } from '@/types';
import RsvpButton from './RsvpButton';
import MatchdayCountdown from './MatchdayCountdown';
function formatMatchDate(dateStr: string) {
  const d = new Date(dateStr);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
}

function MatchScorers({
  matchId,
  homeTeamId,
  awayTeamId,
  goals,
}: {
  matchId: string;
  homeTeamId: string;
  awayTeamId: string;
  goals: Goal[];
}) {
  const matchGoals = goals.filter((g) => g.matchId === matchId);
  if (matchGoals.length === 0) return null;

  const homeGoals = matchGoals.filter((g) => g.scoringTeamId === homeTeamId);
  const awayGoals = matchGoals.filter((g) => g.scoringTeamId === awayTeamId);

  return (
    <div className="mt-2 grid grid-cols-2 gap-x-3 text-[11px]">
      <div className="space-y-0.5">
        {homeGoals.map((g, i) => (
          <div key={i} className="flex items-start gap-1 text-fg-high">
            <span className="shrink-0 mt-px">⚽</span>
            <span className="font-semibold truncate" translate="no">
              {g.scorer}
              {g.assister ? <span className="text-fg-low font-normal"> ({g.assister})</span> : null}
            </span>
          </div>
        ))}
      </div>
      <div className="space-y-0.5 text-right">
        {awayGoals.map((g, i) => (
          <div key={i} className="flex items-start justify-end gap-1 text-fg-high">
            <span className="font-semibold truncate" translate="no">
              {g.scorer}
              {g.assister ? <span className="text-fg-low font-normal"> ({g.assister})</span> : null}
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
  selectedMatchdayId: string;
  onMatchdayChange: (id: string) => void;
  teams: Team[];
  goals: Goal[];
  availabilityStatuses: AvailabilityStatuses;
}

const VENUE_NAME = 'Tennozu Park C';
const VENUE_MAP_URL = 'https://maps.google.com/maps?q=Tennozu+Park+C,+Shinagawa,+Tokyo,+Japan';

export default function NextMatchdayBanner({
  matchdays,
  selectedMatchdayId,
  onMatchdayChange,
  teams,
  goals,
  availabilityStatuses,
}: NextMatchdayBannerProps) {
    const { data: session, status } = useSession();
  const [hasDefaulted, setHasDefaulted] = useState(false);
  const [showPills, setShowPills] = useState(false);

  useEffect(() => {
    if (status === 'loading' || hasDefaulted) return;

    if (session?.teamId) {
      // Find the first upcoming matchday where the user's team is NOT sitting out
      const playerNextMd = matchdays.find(
        (md) =>
          md.sittingOutTeamId !== session.teamId &&
          md.matches[0].homeGoals === null
      );

      if (playerNextMd && playerNextMd.id !== selectedMatchdayId) {
        onMatchdayChange(playerNextMd.id);
      }
    }
    setHasDefaulted(true);
  }, [status, session, matchdays, onMatchdayChange, selectedMatchdayId, hasDefaulted]);

  const matchday = matchdays.find((m) => m.id === selectedMatchdayId) ?? matchdays[0];
  const isCompleted = matchday.matches[0].homeGoals !== null;

  // Find the user's actual next playing matchday
  const userNextPlayingMd = session?.teamId
    ? matchdays.find(
        (md) =>
          md.sittingOutTeamId !== session.teamId &&
          md.matches[0].homeGoals === null
      )
    : null;

  const isUserNextMatchday = userNextPlayingMd?.id === selectedMatchdayId;
  const userTeamIsPlaying = session?.teamId && matchday.sittingOutTeamId !== session.teamId;

  const eyebrow = isUserNextMatchday
    ? "YOUR NEXT MATCHDAY"
    : isCompleted
    ? "MATCHDAY RESULTS"
    : "MATCHDAY DETAILS";

  const getTeam = (id: string) => teams.find((t) => t.id === id);
  const sittingOutTeam = getTeam(matchday.sittingOutTeamId);

  // User's current RSVP status for this matchday
  const userRawStatus =
    session?.playerId && session?.teamId
      ? availabilityStatuses[matchday.id]?.[session.teamId]?.[session.playerId] ?? ''
      : '';

  return (
    <section className="animate-in">
      <div className="pl-card pl-card-magenta rounded-3xl overflow-hidden relative group">
        <div className="absolute inset-0 bg-diagonal-pattern opacity-[0.03] pointer-events-none group-hover:opacity-[0.05] transition-opacity duration-500" />

        <div className="p-7 pb-6 relative">
          <div className="flex justify-between items-start mb-1">
            <span className="text-[10px] font-black uppercase tracking-[0.25em] text-fg-high">
              {eyebrow}
            </span>
            <button
              onClick={() => setShowPills(!showPills)}
              className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg transition-all ${
                showPills
                  ? 'bg-primary text-white'
                  : 'bg-surface text-fg-mid hover:bg-surface-md hover:text-fg-mid'
              }`}
            >
              {showPills ? "close" : "browse ▾"}
            </button>
          </div>

          <div className="mb-4">
            <h2 className="font-display text-4xl font-black uppercase tracking-tighter text-fg-high leading-tight">
              {matchday.label} · {matchday.date ? formatMatchDate(matchday.date) : "TBD"}
            </h2>
            <div className="mt-1 mb-1">
              <MatchdayCountdown matchday={matchday} />
            </div>
            <a
              href={VENUE_MAP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[12px] font-bold text-vibrant-pink/80 hover:text-vibrant-pink transition-colors mt-1 group/venue"
            >
              <svg className="w-3.5 h-3.5 shrink-0 text-vibrant-pink/70 group-hover/venue:text-vibrant-pink transition-colors" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
              </svg>
              <span className="underline underline-offset-4 decoration-vibrant-pink/30 group-hover/venue:decoration-vibrant-pink/60">
                {VENUE_NAME} ↗
              </span>
            </a>
          </div>

          {/* Matchday Selector (collapsible) */}
          {showPills && (
            <div className="animate-in">
              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                {matchdays.map((md) => {
                  const isSelected = md.id === selectedMatchdayId;
                  const isCompletedMd = md.matches[0].homeGoals !== null;
                  return (
                    <button
                      key={md.id}
                      onClick={() => onMatchdayChange(md.id)}
                      className={`shrink-0 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-all border ${
                        isSelected
                          ? 'bg-primary text-white border-primary shadow-[0_0_12px_rgba(224,0,90,0.35)]'
                          : isCompletedMd
                          ? 'bg-surface text-fg-mid border-border-subtle hover:border-border-default hover:text-fg-mid'
                          : 'bg-surface text-fg-high border-border-default hover:border-border-default hover:text-fg-high'
                      }`}
                    >
                      {md.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* RSVP Button embedded directly in hero */}
          {userTeamIsPlaying && session?.playerId && !isCompleted && (
            <div className="mt-6 mb-2">
              <RsvpButton
                matchdayId={matchday.id}
                initialStatus={userRawStatus as 'GOING' | 'UNDECIDED' | 'Y' | 'EXPECTED' | ''}
              />
            </div>
          )}
          {session?.teamId === matchday.sittingOutTeamId && (
                    <p className="text-[10px] font-bold text-vibrant-pink/90 uppercase tracking-tight mt-1">
                      {"You are not scheduled to play on this matchday"}
                    </p>
                  )}

          <div className="h-[1px] w-full bg-surface-md my-6" />

          {/* Matches */}
          <div className="space-y-4">
            {matchday.matches.map((match) => {
              const home = getTeam(match.homeTeamId);
              const away = getTeam(match.awayTeamId);
              const isPlayed = match.homeGoals !== null;
              const isUserHome = session?.teamId === match.homeTeamId;
              const isUserAway = session?.teamId === match.awayTeamId;
              const isUserMatch = isUserHome || isUserAway;

              return (
                <div key={match.id}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 flex items-center gap-3">
                      <div className={`relative w-9 h-9 shrink-0 rounded-lg p-1.5 border transition-all ${isUserHome ? 'bg-tertiary/10 border-tertiary/50 shadow-[0_0_10px_rgba(0,255,133,0.25)]' : 'bg-surface border-border-subtle'}`}>
                        {home?.logo && (
                          <Image
                            src={home.logo}
                            alt={home.name}
                            fill
                            className="object-contain p-1"
                          />
                        )}
                      </div>
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className={`font-display text-lg font-black uppercase tracking-tighter leading-none hidden sm:block ${isUserHome ? 'text-tertiary' : ''}`} translate="no">
                          {home?.name}
                        </span>
                        <span className={`font-display text-lg font-black uppercase tracking-tighter leading-none sm:hidden ${isUserHome ? 'text-tertiary' : ''}`} translate="no">
                          {home?.shortName || home?.name.slice(0, 3)}
                        </span>
                        {isUserHome && (
                          <span className="text-[9px] font-black uppercase tracking-widest text-tertiary/70 leading-none">your team</span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col items-center px-4">
                      {!isPlayed ? (
                        <>
                          <span className="text-[8px] font-black uppercase tracking-widest text-fg-mid mb-1.5">{"Kickoff Time"}</span>
                          <span className={`font-display text-xl font-black tracking-tighter px-3 py-1 rounded-lg border transition-all ${isUserMatch ? 'text-tertiary bg-tertiary/10 border-tertiary/30' : 'text-fg-high bg-surface border-border-subtle'}`}>
                            {match.kickoff}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="text-[8px] font-black uppercase tracking-widest text-fg-mid mb-0.5">{"FT"}</span>
                          <div className="flex items-center gap-3">
                            <span className={`font-display text-3xl font-black ${isUserHome ? 'text-tertiary' : 'text-fg-high'}`}>
                              {match.homeGoals}
                            </span>
                            <div className="w-4 h-[2px] bg-surface-md" />
                            <span className={`font-display text-3xl font-black ${isUserAway ? 'text-tertiary' : 'text-fg-high'}`}>
                              {match.awayGoals}
                            </span>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="flex-1 flex items-center justify-end gap-3 text-right">
                      <div className="flex flex-col gap-0.5 items-end min-w-0">
                        <span className={`font-display text-lg font-black uppercase tracking-tighter leading-none hidden sm:block ${isUserAway ? 'text-tertiary' : ''}`} translate="no">
                          {away?.name}
                        </span>
                        <span className={`font-display text-lg font-black uppercase tracking-tighter leading-none sm:hidden ${isUserAway ? 'text-tertiary' : ''}`} translate="no">
                          {away?.shortName || away?.name.slice(0, 3)}
                        </span>
                        {isUserAway && (
                          <span className="text-[9px] font-black uppercase tracking-widest text-tertiary/70 leading-none">your team</span>
                        )}
                      </div>
                      <div className={`relative w-9 h-9 shrink-0 rounded-lg p-1.5 border transition-all ${isUserAway ? 'bg-tertiary/10 border-tertiary/50 shadow-[0_0_10px_rgba(0,255,133,0.25)]' : 'bg-surface border-border-subtle'}`}>
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

                  {isPlayed && (
                    <MatchScorers
                      matchId={match.id}
                      homeTeamId={match.homeTeamId}
                      awayTeamId={match.awayTeamId}
                      goals={goals}
                    />
                  )}
                </div>
              );
            })}

            {sittingOutTeam && (
              <div className="pt-2 flex items-center gap-2">
                <div className="h-[1px] flex-1 bg-surface" />
                <div className="text-center">
                  <span className="text-[10px] font-black uppercase tracking-widest text-fg-mid">
                    {"Sitting out"}: <span className="text-fg-high">{sittingOutTeam.name}</span>
                  </span>
              
                </div>
                <div className="h-[1px] flex-1 bg-surface" />
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
