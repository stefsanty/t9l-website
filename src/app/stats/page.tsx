import {
  computeLeagueTable,
  computePlayerStats,
  findNextMatchday,
} from "@/lib/stats";
import StatsDashboard from "@/components/StatsDashboard";
import { getPublicLeagueData } from "@/lib/publicData";

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

export default async function StatsPage() {
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

  const leagueTable = computeLeagueTable(data.teams, data.matchdays);
  const nextMd = findNextMatchday(data.matchdays);
  const playerStats = computePlayerStats(
    data.teams,
    data.players,
    data.goals,
    data.played,
  );

  const playerPictures = await fetchPlayerPictures(data.players.map((p) => p.id));

  return (
    <StatsDashboard
      teams={data.teams}
      players={data.players}
      availability={data.availability}
      availabilityStatuses={data.availabilityStatuses}
      leagueTable={leagueTable}
      playerStats={playerStats}
      nextMatchdayId={nextMd?.matchday.id ?? "md1"}
      nextMatchdayLabel={nextMd?.matchday.label ?? "MD1"}
      playerPictures={playerPictures}
    />
  );
}
