import { fetchSheetData } from "@/lib/sheets";
import { parseAllData } from "@/lib/data";
import {
  computeLeagueTable,
  computePlayerStats,
  findNextMatchday,
} from "@/lib/stats";
import Dashboard from "@/components/Dashboard";

export const revalidate = 300; // ISR: 5 minutes

async function fetchPlayerPictures(
  playerIds: string[],
): Promise<Record<string, string>> {
  if (
    !process.env.KV_REST_API_URL ||
    !process.env.KV_REST_API_TOKEN ||
    playerIds.length === 0
  ) {
    return {};
  }
  try {
    const { Redis } = await import("@upstash/redis");
    const redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
    const keys = playerIds.map((id) => `player-pic:${id}`);
    const values = await redis.mget<(string | null)[]>(...keys);
    const result: Record<string, string> = {};
    playerIds.forEach((id, i) => {
      if (values[i]) result[id] = values[i] as string;
    });
    return result;
  } catch {
    return {};
  }
}

export default async function Home() {
  const raw = await fetchSheetData();
  const data = parseAllData(raw);

  const leagueTable = computeLeagueTable(data.teams, data.matchdays);
  const nextMd = findNextMatchday(data.matchdays);
  const playerStats = computePlayerStats(
    data.teams,
    data.players,
    data.goals,
    data.ratings,
    data.played,
  );

  const playerPictures = await fetchPlayerPictures(data.players.map((p) => p.id));

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
      playerPictures={playerPictures}
    />
  );
}
