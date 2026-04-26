import { fetchSheetData } from "@/lib/sheets";
import { parseAllData } from "@/lib/data";
import { findNextMatchday } from "@/lib/stats";
import Dashboard from "@/components/Dashboard";
import LeaguePublicView from "@/components/LeaguePublicView";
import { getLeagueFromHost } from "@/lib/getLeagueFromHost";
import { getLeagueBySubdomain, getDefaultLeague } from "@/lib/admin-data";
import { unstable_cache } from "next/cache";

const getCachedSheetData = unstable_cache(
  async () => fetchSheetData(),
  ["sheet-data"],
  { revalidate: 300, tags: ["sheet-data"] }
);

export default async function Home() {
  // Resolution order:
  //   1. Host has a known league subdomain    → unified DB-backed template
  //   2. Apex / unknown host, default league  → unified DB-backed template
  //   3. No DB league at all                  → legacy Sheets-backed Dashboard
  //
  // Step 3 is a transitional fallback for environments that haven't been
  // migrated to Postgres yet. Once a default league exists it becomes
  // unreachable.
  const hostLeague = await getLeagueFromHost();

  if (hostLeague?.subdomain) {
    const league = await getLeagueBySubdomain(hostLeague.subdomain);
    if (league) {
      return <LeaguePublicView league={league} />;
    }
  }

  const defaultLeague = await getDefaultLeague();
  if (defaultLeague) {
    return <LeaguePublicView league={defaultLeague} />;
  }

  // Legacy Google Sheets fallback (no leagues seeded yet).
  let raw;
  try {
    raw = await getCachedSheetData();
  } catch {
    return (
      <div className="flex items-center justify-center min-h-dvh bg-midnight text-white px-6 text-center">
        <div>
          <p className="font-display text-3xl font-black uppercase text-white/80 mb-2">Data unavailable</p>
          <p className="text-sm text-white/80 font-bold uppercase tracking-widest">Try again in a moment</p>
        </div>
      </div>
    );
  }

  const data = parseAllData(raw);
  const nextMd = findNextMatchday(data.matchdays);

  return (
    <Dashboard
      teams={data.teams}
      players={data.players}
      matchdays={data.matchdays}
      goals={data.goals}
      availability={data.availability}
      availabilityStatuses={data.availabilityStatuses}
      played={data.played}
      nextMd={nextMd}
    />
  );
}
