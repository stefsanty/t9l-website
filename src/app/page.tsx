import { findNextMatchday } from "@/lib/stats";
import Dashboard from "@/components/Dashboard";
import LeaguePublicView from "@/components/LeaguePublicView";
import { getLeagueFromHost } from "@/lib/getLeagueFromHost";
import { getLeagueBySubdomain } from "@/lib/admin-data";
import { getPublicLeagueData } from "@/lib/publicData";

export default async function Home() {
  // Subdomain-based league routing — already on DB.
  const hostLeague = await getLeagueFromHost();

  if (hostLeague?.subdomain) {
    const league = await getLeagueBySubdomain(hostLeague.subdomain);
    if (league) {
      return <LeaguePublicView league={league} />;
    }
  }

  // Apex: source-of-truth dispatcher. Default reads Sheets per
  // Setting.public.dataSource (PR 4 flips this to 'db'); both paths
  // produce the same `LeagueData` shape so consumers don't change.
  let data;
  try {
    data = await getPublicLeagueData();
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
