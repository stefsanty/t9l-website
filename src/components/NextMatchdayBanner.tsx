'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Image from 'next/image';
import type { Matchday, Team, Goal } from '@/types';

function formatShortDate(dateStr: string | null): string {
  if (!dateStr) return 'TBD';
  const iso = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[parseInt(iso[2], 10) - 1]} ${parseInt(iso[3], 10)}`;
  }
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return dateStr;
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
  selectedMatchdayId: string;
  onMatchdayChange: (id: string) => void;
  teams: Team[];
  goals: Goal[];
}

const VENUE_NAME = 'Tennozu Park C';
const VENUE_MAP_URL = 'https://maps.google.com/maps?q=Tennozu+Park+C,+Shinagawa,+Tokyo,+Japan';

export default function NextMatchdayBanner({
  matchdays,
  selectedMatchdayId,
  onMatchdayChange,
  teams,
  goals,
}: NextMatchdayBannerProps) {
  const { data: session, status } = useSession();
  const [hasDefaulted, setHasDefaulted] = useState(false);

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
  const isNext = matchday.matches[0].homeGoals === null;

  const getTeam = (id: string) => teams.find((t) => t.id === id);
  const sittingOutTeam = getTeam(matchday.sittingOutTeamId);

  return (
    <section className="animate-in">
      <div className="pl-card pl-card-magenta rounded-3xl overflow-hidden relative group">
        <div className="absolute inset-0 bg-diagonal-pattern opacity-[0.03] pointer-events-none group-hover:opacity-[0.05] transition-opacity duration-500" />

        {/* Combined Header & Matchday Selector */}
        <div className="bg-white/[0.05] border-b border-white/[0.10] relative">
          <div className="px-7 pt-5 pb-3 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${isNext ? 'bg-vibrant-pink animate-pulse' : 'bg-white/10'}`} />
              <h2 className="font-display text-xl font-black uppercase tracking-tight text-white/90">
                {isNext ? 'UPCOMING' : 'RESULTS'}
              </h2>
            </div>
            <span className="text-[10px] font-black text-white/70 uppercase tracking-[0.2em] bg-white/[0.07] px-3 py-1 rounded-full border border-white/[0.10]">
              {matchday.date ? formatShortDate(matchday.date) : 'TBD'}
            </span>
          </div>

          {/* Matchday pill selector integrated into header */}
          <div className="flex gap-2 overflow-x-auto pb-4 px-6 scrollbar-hide">
            {matchdays.map((md) => {
              const isSelected = md.id === selectedMatchdayId;
              const isCompleted = md.matches[0].homeGoals !== null;
              return (
                <button
                  key={md.id}
                  onClick={() => onMatchdayChange(md.id)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-all border ${
                    isSelected
                      ? 'bg-vibrant-pink text-white border-vibrant-pink shadow-[0_0_12px_rgba(233,0,82,0.35)]'
                      : isCompleted
                      ? 'bg-white/[0.06] text-white/50 border-white/15 hover:border-white/20 hover:text-white/70'
                      : 'bg-white/[0.07] text-white/40 border-white/[0.12] hover:border-white/15 hover:text-white/60'
                  }`}
                >
                  {md.label}
                </button>
              );
            })}
          </div>
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
          <div className="space-y-5 mb-6">
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
                        <span className="font-display text-2xl font-black tracking-tighter text-white bg-white/10 px-4 py-1.5 rounded-xl border border-white/15">
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
          </div>
        </div>
      </div>
    </section>
  );
}
