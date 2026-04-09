'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { Matchday, Team, Goal, AvailabilityStatuses } from '@/types';
import MatchdayCard from './MatchdayCard';

interface NextMatchdayBannerProps {
  matchdays: Matchday[];
  selectedMatchdayId: string;
  onMatchdayChange: (id: string) => void;
  teams: Team[];
  goals: Goal[];
  availabilityStatuses: AvailabilityStatuses;
}

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
  const carouselRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    const el = itemRefs.current[selectedMatchdayId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [selectedMatchdayId]);

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

  // Find the user's actual next playing matchday
  const userNextPlayingMd = session?.teamId
    ? matchdays.find(
        (md) =>
          md.sittingOutTeamId !== session.teamId &&
          md.matches[0].homeGoals === null
      )
    : null;

  const isUserNextMatchday = userNextPlayingMd?.id === selectedMatchdayId;

  return (
    <section className="animate-in">
      <div className={`pl-card rounded-3xl overflow-hidden relative group transition-all duration-500 ${
        isSittingOut 
          ? 'bg-black/40 border-t-2 border-t-white/10 shadow-none' 
          : 'pl-card-magenta bg-card shadow-lg'
      }`}>
        <div className="absolute inset-0 bg-diagonal-pattern opacity-[0.03] pointer-events-none group-hover:opacity-[0.05] transition-opacity duration-500" />
        
        {/* Dark overlay gradient for non-playing matchdays */}
        {isSittingOut && (
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 to-black/15 pointer-events-none z-10" />
        )}

        <div className="p-7 pb-6 relative">
          <div className={`transition-opacity duration-500 ${isSittingOut ? 'opacity-40' : ''}`}>
            <div className="flex justify-between items-start mb-1">
              <span className="text-[10px] font-black uppercase tracking-[0.25em] text-fg-high">
                {eyebrow}
              </span>
            </div>

            <div className="mb-4">
              <h2 className="font-display text-4xl font-black uppercase tracking-tighter text-fg-high leading-tight">
                {matchday.label} - {matchday.date ? formatMatchDate(matchday.date) : "TBD"}
              </h2>
              <div className="mt-1 mb-1">
                <MatchdayCountdown matchday={matchday} />
              </div>
              <div className="flex items-center gap-2 mt-1">
                <a
                  href={venueUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[12px] font-bold text-vibrant-pink/80 hover:text-vibrant-pink transition-colors group/venue"
                >
                  <svg className="w-3.5 h-3.5 shrink-0 text-vibrant-pink/70 group-hover/venue:text-vibrant-pink transition-colors" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                  </svg>
                  <span className="underline underline-offset-4 decoration-vibrant-pink/30 group-hover/venue:decoration-vibrant-pink/60">
                    {venueName} ↗
                  </span>
                </a>
                {matchday.venueCourtSize && (
                  <span className="text-[11px] font-medium text-fg-low truncate">
                    {matchday.venueCourtSize}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* RSVP Button embedded directly in hero */}
          {userTeamIsPlaying && session?.playerId && !isCompleted && (
            <div className="mt-6 mb-2 relative z-20">
              <RsvpButton
                matchdayId={matchday.id}
                initialStatus={userRawStatus as 'GOING' | 'UNDECIDED' | 'Y' | 'EXPECTED' | ''}
              />
            </div>
          )}
          {session?.teamId === matchday.sittingOutTeamId && (
            <div className="relative z-20 mb-4">
              <p className="text-[10px] font-black text-vibrant-pink uppercase tracking-widest bg-vibrant-pink/10 px-3 py-2 rounded-xl border border-vibrant-pink/20 inline-block">
                {"You are not scheduled to play on this matchday"}
              </p>
            </div>
          )}

          <div className={`h-[1px] w-full bg-surface-md my-6 ${isSittingOut ? 'opacity-40' : ''}`} />

          {/* Matches */}
          <div className={`space-y-4 transition-opacity duration-500 ${isSittingOut ? 'opacity-40' : ''}`}>
            {matchday.matches.map((match, idx) => {
              const home = getTeam(match.homeTeamId);
              const away = getTeam(match.awayTeamId);
              const isPlayed = match.homeGoals !== null;
              const isUserHome = session?.teamId === match.homeTeamId;
              const isUserAway = session?.teamId === match.awayTeamId;
              const isUserMatch = isUserHome || isUserAway;

              return (
                <button
                  key={md.id}
                  onClick={() => onMatchdayChange(md.id)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-all border ${
                    isSelected
                      ? 'bg-primary text-white border-primary shadow-[var(--glow-primary-md)]'
                      : isCompletedMd
                      ? 'bg-surface text-fg-mid border-border-subtle hover:border-border-default hover:text-fg-mid'
                      : 'bg-surface text-fg-high border-border-default hover:border-border-default hover:text-fg-high'
                  }`}
                >
                  {md.label}
                </button>
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

          {/* Matchday carousel (always interactive, even when sitting out) */}
          <div className="mt-6 relative z-20">
            <div
              ref={carouselRef}
              className="flex gap-2 overflow-x-auto pb-3 scrollbar-hide snap-x"
            >
              {matchdays.map((md) => {
                const isSelected = md.id === selectedMatchdayId;
                const isPlayed = md.matches[0].homeGoals !== null;
                return (
                  <button
                    key={md.id}
                    ref={(el) => {
                      itemRefs.current[md.id] = el;
                    }}
                    onClick={() => onMatchdayChange(md.id)}
                    className={`shrink-0 snap-center flex flex-col items-start gap-0.5 px-3 py-2 rounded-xl border transition-all min-w-[104px] ${
                      isSelected
                        ? 'bg-primary text-white border-primary shadow-[var(--glow-primary-md)]'
                        : isPlayed
                        ? 'bg-surface text-fg-mid border-border-subtle hover:border-border-default'
                        : 'bg-surface text-fg-high border-border-default hover:border-border-default'
                    }`}
                  >
                    <span className="text-[10px] font-black uppercase tracking-widest">
                      {md.label}
                    </span>
                    <span className="text-[9px] font-bold opacity-80">
                      {md.date ? formatMatchDate(md.date) : 'TBD'}
                    </span>
                    <span
                      className={`text-[8px] font-black uppercase tracking-wider mt-0.5 ${
                        isSelected
                          ? 'opacity-90'
                          : isPlayed
                          ? 'text-fg-low'
                          : 'text-vibrant-pink'
                      }`}
                    >
                      {isPlayed ? 'Played' : 'Upcoming'}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 text-center">
              <Link
                href="/schedule"
                className="text-[10px] font-black uppercase tracking-[0.2em] text-fg-mid hover:text-vibrant-pink transition-colors group/link flex items-center justify-center gap-1.5"
              >
                <span>{"See full schedule"}</span>
                <svg className="w-3 h-3 transition-transform group-hover/link:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Card with browse button overlaid in top-right corner */}
      <div className="relative">
        <MatchdayCard
          matchday={matchday}
          teams={teams}
          goals={goals}
          userTeamId={session?.teamId}
          userPlayerId={session?.playerId}
          isUserNextMatchday={isUserNextMatchday}
          showCountdown
          showRsvp
          showScheduleLink
          availabilityStatuses={availabilityStatuses}
        />
        <div className="absolute top-7 right-7 z-20">
          <button
            onClick={() => setShowPills(!showPills)}
            className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg transition-all bg-surface text-fg-mid hover:bg-surface-md hover:text-fg-mid"
          >
            {showPills ? 'close ✖' : 'browse ▾'}
          </button>
        </div>
      </div>
    </section>
  );
}
