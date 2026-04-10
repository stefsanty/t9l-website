'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import type { Matchday, Team, Goal } from '@/types';
import MatchdayCard from './MatchdayCard';

function useLocale(): 'en' | 'ja' {
  const [locale, setLocale] = useState<'en' | 'ja'>('en');
  useEffect(() => {
    try {
      if (localStorage.getItem('t9l-lang') === 'ja') setLocale('ja');
    } catch { /* ignore */ }
  }, []);
  return locale;
}

interface NextMatchdayBannerProps {
  matchdays: Matchday[];
  selectedMatchdayId: string;
  onMatchdayChange: (id: string) => void;
  teams: Team[];
  goals: Goal[];
}

export default function NextMatchdayBanner({
  matchdays,
  selectedMatchdayId,
  onMatchdayChange,
  teams,
  goals,
}: NextMatchdayBannerProps) {
  const { data: session, status } = useSession();
  const locale = useLocale();
  const [hasDefaulted, setHasDefaulted] = useState(false);
  const [animDir, setAnimDir] = useState<'left' | 'right' | null>(null);
  const touchStartX = useRef<number>(0);
  const mouseStartX = useRef<number>(0);
  const isDragging = useRef(false);

  const currentIndex = matchdays.findIndex((m) => m.id === selectedMatchdayId);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < matchdays.length - 1;

  const navigate = useCallback(
    (dir: 'prev' | 'next') => {
      const nextIndex = dir === 'next' ? currentIndex + 1 : currentIndex - 1;
      if (nextIndex < 0 || nextIndex >= matchdays.length) return;
      setAnimDir(dir === 'next' ? 'left' : 'right');
      setTimeout(() => {
        onMatchdayChange(matchdays[nextIndex].id);
        setAnimDir(null);
      }, 150);
    },
    [currentIndex, matchdays, onMatchdayChange]
  );

  useEffect(() => {
    if (status === 'loading' || hasDefaulted) return;

    if (session?.teamId) {
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

  const matchday = matchdays[currentIndex] ?? matchdays[0];

  const userNextPlayingMd = session?.teamId
    ? matchdays.find(
        (md) =>
          md.sittingOutTeamId !== session.teamId &&
          md.matches[0].homeGoals === null
      )
    : null;

  const isUserNextMatchday = userNextPlayingMd?.id === selectedMatchdayId;

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 50) {
      navigate(dx < 0 ? 'next' : 'prev');
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    mouseStartX.current = e.clientX;
    isDragging.current = true;
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    const dx = e.clientX - mouseStartX.current;
    if (Math.abs(dx) > 50) {
      navigate(dx < 0 ? 'next' : 'prev');
    }
  };

  const handleMouseLeave = () => {
    isDragging.current = false;
  };

  const cardWrapperClass = `transition-all duration-150 select-none ${
    animDir === 'left'
      ? '-translate-x-2 opacity-0'
      : animDir === 'right'
      ? 'translate-x-2 opacity-0'
      : 'translate-x-0 opacity-100'
  }`;

  return (
    <section className="animate-in">
      {/* Swipeable card area */}
      <div
        className="relative cursor-grab active:cursor-grabbing"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        {/* Left chevron */}
        <button
          onClick={() => navigate('prev')}
          className={`absolute left-0 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center w-7 h-7 rounded-full bg-surface/80 border border-border-subtle text-fg-mid transition-all hover:text-fg-high hover:border-border-default -translate-x-3 ${
            hasPrev ? 'opacity-60 hover:opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          aria-label="Previous matchday"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Animated card */}
        <div className={cardWrapperClass}>
          <MatchdayCard
            matchday={matchday}
            teams={teams}
            goals={goals}
            userTeamId={session?.teamId}
            isUserNextMatchday={isUserNextMatchday}
            showCountdown
            locale={locale}
          />
        </div>

        {/* Right chevron */}
        <button
          onClick={() => navigate('next')}
          className={`absolute right-0 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center w-7 h-7 rounded-full bg-surface/80 border border-border-subtle text-fg-mid transition-all hover:text-fg-high hover:border-border-default translate-x-3 ${
            hasNext ? 'opacity-60 hover:opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          aria-label="Next matchday"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Dot indicators */}
      <div className="flex justify-center items-center gap-1.5 mt-1.5">
        {matchdays.map((md, i) => (
          <button
            key={md.id}
            onClick={() => onMatchdayChange(md.id)}
            aria-label={md.label}
            className={`rounded-full transition-all duration-200 ${
              i === currentIndex
                ? 'w-4 h-1.5 bg-primary'
                : 'w-1.5 h-1.5 bg-fg-low hover:bg-fg-mid'
            }`}
          />
        ))}
      </div>

      {/* See full schedule */}
      <div className="mt-1 text-center">
        <Link
          href="/schedule"
          className="text-[10px] font-black uppercase tracking-[0.2em] text-fg-mid hover:text-vibrant-pink transition-colors group/link inline-flex items-center justify-center gap-1.5"
        >
          <span>{locale === 'ja' ? 'スケジュール' : 'See full schedule'}</span>
          <svg className="w-3 h-3 transition-transform group-hover/link:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>
    </section>
  );
}
