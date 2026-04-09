import { fetchSheetData } from "@/lib/sheets";
import { parseAllData } from "@/lib/data";
import { findNextMatchday } from "@/lib/stats";
import { unstable_cache } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Link from "next/link";
import MatchdayCard from "@/components/MatchdayCard";
import Header from "@/components/Header";

export const metadata = {
  title: "Schedule | T9L",
};

const getCachedSheetData = unstable_cache(
  async () => fetchSheetData(),
  ["sheet-data"],
  { revalidate: 300, tags: ["sheet-data"] }
);

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
              userTeamId={userTeamId}
              isUserNextMatchday={userNextPlayingMdId === md.id}
              showCountdown={nextMd?.matchday.id === md.id}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
