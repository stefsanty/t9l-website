import { redirect } from "next/navigation";
import {
  computeLeagueTable,
  computePlayerStats,
  findNextMatchday,
} from "@/lib/stats";
import StatsDashboard from "@/components/StatsDashboard";
import { getPublicLeagueData } from "@/lib/publicData";
import { getDefaultLeagueId } from "@/lib/leagueSlugServer";
import { getLeagueFlags } from "@/lib/leagueFlags";
import { getUnpaidFeeBannerData } from "@/lib/unpaidFeeBanner";

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
  // v1.53.0 — subdomain teardown. /stats always renders the default
  // league. Per-league stats can be added under /league/<slug>/stats
  // in a future PR.
  const leagueId = await getDefaultLeagueId();

  let data;
  let flags = null;
  // v1.66.0 — unpaid-fee banner data; null when banner stays hidden.
  let unpaidFee = null;
  // v1.80.2 — fan out flags + public data + unpaidFee in a single
  // Promise.all so the redirect-on-preseason check no longer adds a
  // sequential round-trip to the common (non-preseason) path. The
  // wasted fetch on the rare preseason hit is one warm `unstable_cache`
  // round trip (cheap); the win on every other hit is one round trip
  // saved.
  try {
    [flags, data, unpaidFee] = await Promise.all([
      leagueId ? getLeagueFlags(leagueId) : Promise.resolve(null),
      getPublicLeagueData(leagueId ?? undefined),
      leagueId ? getUnpaidFeeBannerData(leagueId) : Promise.resolve(null),
    ]);
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

  // v1.63.0 — pre-season mode hides /stats. The homepage Header link is
  // also suppressed; this server-side gate covers direct visits / shared
  // links / browser history. Redirect to home so the user lands on the
  // valid pre-season experience instead of a dead-end.
  if (flags?.preseasonMode) {
    redirect('/');
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
      unpaidFee={unpaidFee}
    />
  );
}
