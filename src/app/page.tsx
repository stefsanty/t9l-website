import { headers } from 'next/headers'
import { fetchSheetData } from "@/lib/sheets";
import { parseAllData } from "@/lib/data";
import { findNextMatchday } from "@/lib/stats";
import Dashboard from "@/components/Dashboard";
import LeaguePublicView from "@/components/LeaguePublicView";
import { getLeagueBySubdomain } from "@/lib/admin-data";
import { unstable_cache } from "next/cache";

const getCachedSheetData = unstable_cache(
  async () => fetchSheetData(),
  ["sheet-data"],
  { revalidate: 300, tags: ["sheet-data"] }
);

export default async function Home() {
  // Detect league subdomain from host header.
  // e.g. test.dev.t9l.me → subdomain = "test"
  const headersList = await headers()
  const host = headersList.get('host') ?? ''
  const subdomain = host.split(':')[0].split('.')[0] // strip port, take first segment

  // Known non-league hostnames
  const SKIP = new Set(['www', 'dev', 'localhost', 't9l', '127', ''])

  if (!SKIP.has(subdomain)) {
    const league = await getLeagueBySubdomain(subdomain)
    if (league) {
      return <LeaguePublicView league={league} />
    }
  }

  // Default: Google Sheets dashboard
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
