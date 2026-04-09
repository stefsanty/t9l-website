'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import type { Matchday, Team, Goal, AvailabilityStatuses } from '@/types';
import MatchdayCard from './MatchdayCard';

function formatMatchDate(dateStr: string) {
  // dateStr is "YYYY-MM-DD" (UTC-stable from normalizeDate)
  // We treat it as UTC midnight and format it in JST.
  // UTC 00:00 = JST 09:00, which keeps the date the same.
  const d = new Date(dateStr);
  const parts = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Tokyo',
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('month')} ${get('day')} (${get('weekday')})`;
}

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
      <MatchdayCard
        matchday={matchday}
        teams={teams}
        goals={goals}
        userTeamId={session?.teamId}
        userPlayerId={session?.playerId}
        isUserNextMatchday={isUserNextMatchday}
        showCountdown
        showRsvp
        availabilityStatuses={availabilityStatuses}
      />

      {/* Matchday carousel (always interactive, even when sitting out) */}
      <div className="mt-4 relative z-20">
        <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-hide snap-x">
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

        <div className="mt-2 text-center">
          <Link
            href="/schedule"
            className="text-[10px] font-black uppercase tracking-[0.2em] text-fg-mid hover:text-vibrant-pink transition-colors group/link inline-flex items-center justify-center gap-1.5"
          >
            <span>{'See full schedule'}</span>
            <svg className="w-3 h-3 transition-transform group-hover/link:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  );
}
