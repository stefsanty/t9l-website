import { fetchSheetData } from "@/lib/sheets";
import { parseAllData } from "@/lib/data";
import { findNextMatchday } from "@/lib/stats";
import { unstable_cache } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Image from "next/image";
import Link from "next/link";
import type { Matchday, Team, Goal } from "@/types";
import MatchdayCountdown from "@/components/MatchdayCountdown";
import Header from "@/components/Header";

export const metadata = {
  title: "Schedule | T9L",
};

const getCachedSheetData = unstable_cache(
  async () => fetchSheetData(),
  ["sheet-data"],
  { revalidate: 300, tags: ["sheet-data"] }
);

const DEFAULT_VENUE_NAME = "Tennozu Park C";
const DEFAULT_VENUE_MAP_URL =
  "https://maps.google.com/maps?q=Tennozu+Park+C,+Shinagawa,+Tokyo,+Japan";

function formatMatchDate(dateStr: string) {
  const d = new Date(dateStr);
  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Tokyo",
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")} ${get("day")} (${get("weekday")})`;
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
              {g.assister ? (
                <span className="text-fg-low font-normal"> ({g.assister})</span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
      <div className="space-y-0.5 text-right">
        {awayGoals.map((g, i) => (
          <div
            key={i}
            className="flex items-start justify-end gap-1 text-fg-high"
          >
            <span className="font-semibold truncate" translate="no">
              {g.scorer}
              {g.assister ? (
                <span className="text-fg-low font-normal"> ({g.assister})</span>
              ) : null}
            </span>
            <span className="shrink-0 mt-px">⚽️</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MatchdayCard({
  matchday,
  teams,
  goals,
  isNext,
  userTeamId,
  isUserNextMatchday,
}: {
  matchday: Matchday;
  teams: Team[];
  goals: Goal[];
  isNext: boolean;
  userTeamId?: string | null;
  isUserNextMatchday: boolean;
}) {
  const isCompleted = matchday.matches[0].homeGoals !== null;
  const venueName = matchday.venueName ?? DEFAULT_VENUE_NAME;
  const venueUrl = matchday.venueUrl ?? DEFAULT_VENUE_MAP_URL;

  const getTeam = (id: string) => teams.find((t) => t.id === id);
  const sittingOutTeam = getTeam(matchday.sittingOutTeamId);
  const isUserSittingOut = userTeamId && matchday.sittingOutTeamId === userTeamId;

  const eyebrow = isUserNextMatchday
    ? "YOUR NEXT MATCHDAY"
    : isCompleted
    ? "MATCHDAY RESULTS"
    : "MATCHDAY DETAILS";

  return (
    <div className={`pl-card pl-card-magenta rounded-3xl overflow-hidden relative group transition-colors ${isUserSittingOut ? 'bg-midnight/40' : ''}`}>
      <div className="absolute inset-0 bg-diagonal-pattern opacity-[0.03] pointer-events-none group-hover:opacity-[0.05] transition-opacity duration-500" />

      <div className="p-7 pb-6 relative">
        <div className="flex justify-between items-start mb-1">
          <span className="text-[10px] font-black uppercase tracking-[0.25em] text-fg-high">
            {eyebrow}
          </span>
        </div>

        <div className="mb-4">
          <h2 className="font-display text-4xl font-black uppercase tracking-tighter text-fg-high leading-tight">
            {matchday.label} - {matchday.date ? formatMatchDate(matchday.date) : "TBD"}
          </h2>
          {isNext && (
            <div className="mt-1 mb-1">
              <MatchdayCountdown matchday={matchday} />
            </div>
          )}
          <div className="flex items-center gap-2 mt-1">
            <a
              href={venueUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[12px] font-bold text-vibrant-pink/80 hover:text-vibrant-pink transition-colors group/venue"
            >
              <svg
                className="w-3.5 h-3.5 shrink-0 text-vibrant-pink/70 group-hover/venue:text-vibrant-pink transition-colors"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
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

        {isUserSittingOut && (
          <p className="text-[10px] font-bold text-vibrant-pink/90 uppercase tracking-tight mt-1">
            {"You are not scheduled to play on this matchday"}
          </p>
        )}

        <div className="h-[1px] w-full bg-surface-md my-6" />

        <div className={`space-y-4 transition-opacity duration-500 ${isUserSittingOut ? 'opacity-40' : ''}`}>
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
                      <span
                        className="font-display text-lg font-black uppercase tracking-tighter leading-none hidden sm:block"
                        translate="no"
                      >
                        {home?.name}
                      </span>
                      <span
                        className="font-display text-lg font-black uppercase tracking-tighter leading-none sm:hidden"
                        translate="no"
                      >
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
                        {idx === 0 && (
                          <span className="text-[8px] font-black uppercase tracking-widest text-fg-mid mb-1.5">
                            Kickoff Time
                          </span>
                        )}
                        <span className={`font-display text-xl font-black tracking-tighter px-3 py-1 rounded-lg border transition-all ${isUserMatch ? 'text-tertiary bg-tertiary/10 border-tertiary/30' : 'text-fg-high bg-surface border-border-subtle'}`}>
                          {match.kickoff}
                        </span>
                      </>
                    ) : (
                      <>
                        {idx === 0 && (
                          <span className="text-[8px] font-black uppercase tracking-widest text-fg-mid mb-0.5">
                            FT
                          </span>
                        )}
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
                      <span
                        className="font-display text-lg font-black uppercase tracking-tighter leading-none hidden sm:block"
                        translate="no"
                      >
                        {away?.name}
                      </span>
                      <span
                        className="font-display text-lg font-black uppercase tracking-tighter leading-none sm:hidden"
                        translate="no"
                      >
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
                  Sitting out:{" "}
                  <span className="text-fg-high">{sittingOutTeam.name}</span>
                </span>
              </div>
              <div className="h-[1px] flex-1 bg-surface" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default async function SchedulePage() {
  const session = await getServerSession(authOptions);
  const userTeamId = session?.teamId;

  let raw;
  try {
    raw = await getCachedSheetData();
  } catch {
    return (
      <div className="flex items-center justify-center min-h-dvh bg-midnight text-white px-6 text-center">
        <div>
          <p className="font-display text-3xl font-black uppercase text-white/80 mb-2">
            Data unavailable
          </p>
          <p className="text-sm text-white/80 font-bold uppercase tracking-widest">
            Try again in a moment
          </p>
        </div>
      </div>
    );
  }

  const data = parseAllData(raw);
  const nextMd = findNextMatchday(data.matchdays);

  const userNextPlayingMdId = userTeamId
    ? data.matchdays.find(
        (md) =>
          md.sittingOutTeamId !== userTeamId &&
          md.matches[0].homeGoals === null
      )?.id
    : null;

  return (
    <div className="flex flex-col min-h-dvh bg-background">
      <Header />
      
      <main className="flex-1 max-w-lg mx-auto px-4 pt-16 pb-12">
        <div className="flex items-center justify-between mb-8">
          <h1 className="font-display text-5xl font-black uppercase tracking-tighter text-fg-high">
            Schedule
          </h1>
          <Link
            href="/"
            className="text-[11px] font-black uppercase tracking-widest text-fg-mid hover:text-fg-high transition-colors px-3 py-1.5 rounded-lg border border-border-subtle hover:border-border-default"
          >
            ← Home
          </Link>
        </div>

        <div className="space-y-5">
          {data.matchdays.map((md) => (
            <MatchdayCard
              key={md.id}
              matchday={md}
              teams={data.teams}
              goals={data.goals}
              isNext={nextMd?.matchday.id === md.id}
              userTeamId={userTeamId}
              isUserNextMatchday={userNextPlayingMdId === md.id}
            />
          ))}
        </div>
      </main>
    </div>
  );
}


