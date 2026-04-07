import { fetchSheetData } from "@/lib/sheets";
import { parseAllData } from "@/lib/data";
import {
  computeLeagueTable,
  computePlayerStats,
  findNextMatchday,
  computeMatchdayVibes,
} from "@/lib/stats";
import Dashboard from "@/components/Dashboard";
import { unstable_cache } from "next/cache";

const getCachedSheetData = unstable_cache(
  async () => fetchSheetData(),
  ["sheet-data"],
  { revalidate: 300, tags: ["sheet-data"] }
);

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
    const values = await redis.mget<(string | null)[]>(keys);
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

  const leagueTable = computeLeagueTable(data.teams, data.matchdays);
  const nextMd = findNextMatchday(data.matchdays);
  const playerStats = computePlayerStats(
    data.teams,
    data.players,
    data.goals,
    data.ratings,
    data.played,
  );
  const matchdayVibes = computeMatchdayVibes(data.ratings, data.matchdays);

  const playerPictures = await fetchPlayerPictures(data.players.map((p) => p.id));

  return (
    <Dashboard
      teams={data.teams}
      players={data.players}
      matchdays={data.matchdays}
      goals={data.goals}
      availability={data.availability}
      availabilityStatuses={data.availabilityStatuses}
      played={data.played}
      leagueTable={leagueTable}
      playerStats={playerStats}
      matchdayVibes={matchdayVibes}
      nextMd={nextMd}
      playerPictures={playerPictures}
    />
  );
}
