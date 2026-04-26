import { headers } from 'next/headers'
import { fetchSheetData } from "@/lib/sheets";
import { parseAllData } from "@/lib/data";
import { findNextMatchday } from "@/lib/stats";
import Dashboard from "@/components/Dashboard";
import DbLeaguePage from "@/components/DbLeaguePage";
import { getLeagueBySubdomain } from "@/lib/admin-data";
import { unstable_cache } from "next/cache";

const getCachedSheetData = unstable_cache(
  async () => fetchSheetData(),
  ["sheet-data"],
  { revalidate: 300, tags: ["sheet-data"] }
);

// Subdomains that belong to the main T9L site (not league-specific)
const MAIN_SUBDOMAINS = new Set(['www', 't9l', 'dev', 'localhost', ''])

function extractSubdomain(host: string): string {
  const hostname = host.split(':')[0] // strip port
  const parts = hostname.split('.')
  // e.g. "test.dev.t9l.me" → ["test","dev","t9l","me"] → first part is "test"
  // e.g. "dev.t9l.me" → ["dev","t9l","me"] → "dev"
  // e.g. "t9l.me" → ["t9l","me"] → "t9l"
  // e.g. "localhost" → ["localhost"] → "localhost"
  return parts[0] ?? ''
}

export default async function Home() {
  const headersList = await headers()
  const host = headersList.get('host') ?? ''
  const subdomain = extractSubdomain(host)

  if (!MAIN_SUBDOMAINS.has(subdomain)) {
    const league = await getLeagueBySubdomain(subdomain)
    if (league) {
      return <DbLeaguePage league={league} />
    }
  }

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
