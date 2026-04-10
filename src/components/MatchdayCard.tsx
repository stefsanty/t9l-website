import Image from 'next/image';
import Link from 'next/link';
import type { Matchday, Team, Goal } from '@/types';
import MatchdayCountdown from './MatchdayCountdown';

const DEFAULT_VENUE_NAME = 'Tennozu Park C';
const DEFAULT_VENUE_MAP_URL = 'https://maps.google.com/maps?q=Tennozu+Park+C,+Shinagawa,+Tokyo,+Japan';

function formatMatchDate(dateStr: string, locale: 'en' | 'ja' = 'en') {
  // dateStr is "YYYY-MM-DD" (UTC-stable from normalizeDate)
  // We treat it as UTC midnight and format it in JST.
  // UTC 00:00 = JST 09:00, which keeps the date the same.
  const d = new Date(dateStr);
  if (locale === 'ja') {
    const parts = new Intl.DateTimeFormat('ja-JP', {
      weekday: 'short',
      month: 'long',
      day: 'numeric',
      timeZone: 'Asia/Tokyo',
    }).formatToParts(d);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)?.value ?? '';
    return `${get('month')}${get('day')}（${get('weekday')}）`;
  }
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
            <span className="shrink-0 mt-px">⚽️</span>
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
            <span className="shrink-0 mt-px">⚽️</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface MatchdayCardProps {
  matchday: Matchday;
  teams: Team[];
  goals: Goal[];
  userTeamId?: string | null;
  isUserNextMatchday?: boolean;
  /** Show live countdown timer in the header. Default: false */
  showCountdown?: boolean;
  /** Show "See full schedule" link at the bottom of the card. Default: false */
  showScheduleLink?: boolean;
  /** Locale for rendering translated strings. Default: 'en' */
  locale?: 'en' | 'ja';
}

const STRINGS = {
  en: {
    yourNextMatchday: 'YOUR NEXT MATCHDAY',
    matchdayResults: 'MATCHDAY RESULTS',
    matchdayDetails: 'MATCHDAY DETAILS',
    ft: 'FT',
    kickoffTime: 'Kickoff Time',
    sittingOut: 'Sitting out',
    notScheduled: 'You are not scheduled to play on this matchday',
    yourTeam: 'your team',
    seeFullSchedule: 'See full schedule',
  },
  ja: {
    yourNextMatchday: '次の試合日',
    matchdayResults: '試合結果',
    matchdayDetails: '試合日程',
    ft: '試合終了',
    kickoffTime: 'キックオフ',
    sittingOut: '休み',
    notScheduled: 'この試合日はあなたのチームは休みです',
    yourTeam: '自チーム',
    seeFullSchedule: 'スケジュール',
  },
} as const;

export default function MatchdayCard({
  matchday,
  teams,
  goals,
  userTeamId,
  isUserNextMatchday = false,
  showCountdown = false,
  showScheduleLink = false,
  locale = 'en',
}: MatchdayCardProps) {
  const s = STRINGS[locale];
  const isCompleted = matchday.matches[0].homeGoals !== null;
  const venueName = matchday.venueName ?? DEFAULT_VENUE_NAME;
  const venueUrl = matchday.venueUrl ?? DEFAULT_VENUE_MAP_URL;

  const getTeam = (id: string) => teams.find((t) => t.id === id);
  const sittingOutTeam = getTeam(matchday.sittingOutTeamId);
  const isSittingOut = userTeamId && userTeamId === matchday.sittingOutTeamId;

  const eyebrow = isUserNextMatchday
    ? s.yourNextMatchday
    : isCompleted
    ? s.matchdayResults
    : s.matchdayDetails;

  return (
    <div className={`pl-card rounded-3xl overflow-hidden relative group transition-all duration-500 ${
      isSittingOut
        ? 'bg-black/40 border-t-2 border-t-white/10 shadow-none'
        : 'pl-card-magenta bg-card'
    }`}>
      <div className="absolute inset-0 bg-diagonal-pattern opacity-[0.03] pointer-events-none group-hover:opacity-[0.05] transition-opacity duration-500" />

      {/* Dark overlay gradient for non-playing matchdays */}
      {isSittingOut && (
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 to-black/15 pointer-events-none z-10" />
      )}

      <div className="p-5 pb-4 relative">
        <div className={`transition-opacity duration-500 ${isSittingOut ? 'opacity-40' : ''}`}>
          <div className="flex justify-between items-start mb-1">
            <span className="text-[10px] font-black uppercase tracking-[0.25em] text-fg-high">
              {eyebrow}
            </span>
          </div>

          <div className="mb-2">
            <h2 className="font-display text-4xl font-black uppercase tracking-tighter text-fg-high leading-tight">
              {matchday.label} - {matchday.date ? formatMatchDate(matchday.date, locale) : 'TBD'}
            </h2>
            {showCountdown && (
              <div className="mt-0.5">
                <MatchdayCountdown matchday={matchday} />
              </div>
            )}
            <div className="flex items-center gap-2 mt-0.5">
              <a
                href={venueUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[12px] font-bold text-vibrant-pink/80 hover:text-vibrant-pink transition-colors group/venue"
              >
                <svg className="w-3.5 h-3.5 shrink-0 text-vibrant-pink/70 group-hover/venue:text-vibrant-pink transition-colors" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
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

        {/* Sitting out notice badge */}
        {isSittingOut && (
          <div className="relative z-20 mb-4">
            <p className="text-[10px] font-black text-primary uppercase tracking-widest bg-vibrant-pink/10 px-3 py-2 rounded-xl border border-vibrant-pink/20 inline-block">
              {s.notScheduled}
            </p>
          </div>
        )}

        <div className={`h-[1px] w-full bg-surface-md my-3 ${isSittingOut ? 'opacity-40' : ''}`} />

        {/* Matches */}
        <div className={`transition-opacity duration-500 ${isSittingOut ? 'opacity-40' : ''}`}>
          {/* Column header */}
          <div className="flex justify-center mb-1.5">
            <span className="text-[8px] font-black uppercase tracking-widest text-fg-mid">
              {isCompleted ? s.ft : s.kickoffTime}
            </span>
          </div>

          <div className="space-y-2">
          {matchday.matches.map((match, idx) => {
            const home = getTeam(match.homeTeamId);
            const away = getTeam(match.awayTeamId);
            const isPlayed = match.homeGoals !== null;
            const isUserHome = userTeamId === match.homeTeamId;
            const isUserAway = userTeamId === match.awayTeamId;
            const isUserMatch = isUserHome || isUserAway;

            return (
              <div key={match.id}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 flex items-center gap-3">
                    <div className={`relative w-9 h-9 shrink-0 rounded-lg p-1.5 border transition-all ${isUserHome ? 'bg-tertiary/10 border-tertiary/50 ' : 'bg-surface border-border-subtle'}`}>
                      {home?.logo && (
                        <Image src={home.logo} alt={home.name} fill className="object-contain p-1" />
                      )}
                    </div>
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="font-display text-lg font-black uppercase tracking-tighter leading-none hidden sm:block" translate="no">
                        {home?.name}
                      </span>
                      <span className="font-display text-lg font-black uppercase tracking-tighter leading-none sm:hidden" translate="no">
                        {home?.shortName || home?.name.slice(0, 3)}
                      </span>
                      {isUserHome && (
                        <span className="text-[9px] font-black uppercase tracking-widest text-tertiary/70 leading-none">{s.yourTeam}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center px-4">
                    {!isPlayed ? (
                      <span className={`font-display text-xl font-black tracking-tighter px-3 py-1 rounded-lg border transition-all ${isUserMatch ? 'text-tertiary bg-tertiary/10 border-tertiary/30' : 'text-fg-high bg-surface border-border-subtle'}`}>
                        {match.kickoff}
                      </span>
                    ) : (
                      <div className="flex items-center gap-3">
                        <span className={`font-display text-3xl font-black ${isUserHome ? 'text-tertiary' : 'text-fg-high'}`}>
                          {match.homeGoals}
                        </span>
                        <div className="w-4 h-[2px] bg-surface-md" />
                        <span className={`font-display text-3xl font-black ${isUserAway ? 'text-tertiary' : 'text-fg-high'}`}>
                          {match.awayGoals}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 flex items-center justify-end gap-3 text-right">
                    <div className="flex flex-col gap-0.5 items-end min-w-0">
                      <span className="font-display text-lg font-black uppercase tracking-tighter leading-none hidden sm:block" translate="no">
                        {away?.name}
                      </span>
                      <span className="font-display text-lg font-black uppercase tracking-tighter leading-none sm:hidden" translate="no">
                        {away?.shortName || away?.name.slice(0, 3)}
                      </span>
                      {isUserAway && (
                        <span className="text-[9px] font-black uppercase tracking-widest text-tertiary/70 leading-none">{s.yourTeam}</span>
                      )}
                    </div>
                    <div className={`relative w-9 h-9 shrink-0 rounded-lg p-1.5 border transition-all ${isUserAway ? 'bg-tertiary/10 border-tertiary/50 ' : 'bg-surface border-border-subtle'}`}>
                      {away?.logo && (
                        <Image src={away.logo} alt={away.name} fill className="object-contain p-1" />
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

          {sittingOutTeam && (
            <div className="pt-2 flex items-center gap-2">
              <div className="h-[1px] flex-1 bg-surface" />
              <div className="text-center">
                <span className="text-[10px] font-black uppercase tracking-widest text-fg-mid">
                  {s.sittingOut}: <span className="text-fg-high" translate="no">{sittingOutTeam.name}</span>
                </span>
              </div>
              <div className="h-[1px] flex-1 bg-surface" />
            </div>
          )}

          {showScheduleLink && (
            <div className="mt-4 text-center">
              <Link
                href="/schedule"
                className="text-[10px] font-black uppercase tracking-[0.2em] text-fg-mid hover:text-vibrant-pink transition-colors group/link flex items-center justify-center gap-1.5"
              >
                <span>{s.seeFullSchedule}</span>
                <svg className="w-3 h-3 transition-transform group-hover/link:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
