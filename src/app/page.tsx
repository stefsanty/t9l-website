import { fetchSheetData } from "@/lib/sheets";
import { parseAllData } from "@/lib/data";
import {
  computeLeagueTable,
  computePlayerStats,
  findNextMatchday,
} from "@/lib/stats";
import Dashboard from "@/components/Dashboard";

export const revalidate = 300; // ISR: 5 minutes

export default async function Home() {
  const raw = await fetchSheetData();
  const data = parseAllData(raw);

  const leagueTable = computeLeagueTable(data.teams, data.matchdays);
  const nextMd = findNextMatchday(data.matchdays);
  const playerStats = computePlayerStats(data.teams, data.players, data.goals, data.ratings, data.played);

  return (
    <Dashboard
      teams={data.teams}
      players={data.players}
      matchdays={data.matchdays}
      goals={data.goals}
      ratings={data.ratings}
      availability={data.availability}
      leagueTable={leagueTable}
      playerStats={playerStats}
      nextMd={nextMd}
    />
  );
}
