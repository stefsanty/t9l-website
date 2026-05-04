import { findNextMatchday } from "@/lib/stats";
import Dashboard from "@/components/Dashboard";
import { getPublicLeagueData } from "@/lib/publicData";
import { DEFAULT_LEAGUE_SLUG, getDefaultLeagueId } from "@/lib/leagueSlug";

/**
 * Public landing page — apex `/` always renders the default league.
 *
 * v1.53.0 (PR 4 of the path-routing chain) — subdomain teardown.
 * Pre-v1.53.0 this page resolved the league via the host header
 * (`getLeagueIdFromRequest()`); subdomain support was wired in
 * v1.22.0–v1.26.0 but never actually used in production (only the apex
 * `t9l.me` was deployed). v1.53.0 strips the host-header path and
 * always serves the default league here. Multi-league access lives
 * exclusively under `/league/<slug>` and the `/<slug>` short alias
 * (PR 1 of this chain). The "League not found" branch goes away
 * because the only fail mode now is "no default league flagged in
 * config" — a catastrophic-config scenario, not a routing one — and
 * we surface that as the same Data unavailable state the catch block
 * uses below.
 */
export default async function Home() {
  const leagueId = await getDefaultLeagueId();

  if (leagueId === null) {
    // Catastrophic config — no default league row exists. Render the
    // generic "Data unavailable" surface; operator should flag a
    // default league via admin Settings or the seed migration.
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

  let data;
  try {
    data = await getPublicLeagueData(leagueId);
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
      leagueSlug={DEFAULT_LEAGUE_SLUG}
    />
  );
}
