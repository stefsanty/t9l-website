'use client';

import { useEffect, useState } from 'react';
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
      {/* Matchday pill selector (collapsible, renders above the card) */}
      {showPills && (
        <div className="animate-in mb-4">
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
