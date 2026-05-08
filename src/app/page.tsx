import type { Metadata } from "next";
import { findNextMatchday } from "@/lib/stats";
import Dashboard from "@/components/Dashboard";
import { getPublicLeagueData } from "@/lib/publicData";
import { DEFAULT_LEAGUE_SLUG } from "@/lib/leagueSlug";
import { getDefaultLeagueId } from "@/lib/leagueSlugServer";
import { getLeagueFlags } from "@/lib/leagueFlags";
import { getRecruitingViewerState } from "@/lib/recruitingViewerState";
import { getUnpaidFeeBannerData } from "@/lib/unpaidFeeBanner";
import { getPlannedRosterStats } from "@/lib/plannedRosterStats";
import { getLeagueDetails } from "@/lib/leagueDetailsServer";
import { prisma } from "@/lib/prisma";

export async function generateMetadata(): Promise<Metadata> {
  const leagueId = await getDefaultLeagueId();
  if (!leagueId) return { title: "T9L | Tennozu 9-Aside League" };
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { name: true, abbreviation: true },
  });
  if (!league) return { title: "T9L | Tennozu 9-Aside League" };
  const short = league.abbreviation ?? league.name;
  return { title: `${short} | ${league.name}` };
}

/**
 * Public landing page — apex `/` always renders the default league.
 *
 * v1.53.0 (PR 4 of the path-routing chain) — subdomain teardown.
 * Pre-v1.53.0 this page resolved the league via the host header
 * (`getLeagueIdFromRequest()`); subdomain support was wired in
 * v1.22.0–v1.26.0 but never actually used in production (only the apex
 * `t9l.me` was deployed). v1.53.0 strips the host-header path and
 * always serves the default league here. v1.54.0 — multi-league access
 * lives exclusively under `/id/<slug>` (legacy `/league/<slug>` and
 * `/<slug>` 308-redirect there). The "League not found" branch goes
 * away because the only fail mode now is "no default league flagged in
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
  let flags;
  let recruitingState;
  let leagueRow;
  let unpaidFee;
  let plannedRosterStats;
  let leagueDetails;
  try {
    // v1.63.0 — fetch LeagueData + per-league flags in parallel. Flags
    // are cached separately under the same `leagues` tag so admin writes
    // bust both. Defaults to `{ preseasonMode: false, recruiting: false }`
    // on Prisma failure so a transient blip doesn't flip the homepage UX.
    //
    // v1.64.0 — also fetch the recruiting viewer state and league name
    // in the same Promise.all. The viewer state read is uncached
    // (per-session) but cheap (a single User → Player join). The league
    // name fetch is bounded by the cached LeagueData but we need the
    // canonical row for the banner (LeagueData carries teams + matches,
    // not the League's own fields).
    // v1.67.0 — auth-gate the planned-roster stats panel. Compute
    // session in parallel; the panel data fetch always runs (cheap, two
    // small queries) but we only thread it into Dashboard when the
    // viewer is authenticated AND both flags are on.
    const [
      _data,
      _flags,
      _recruitingState,
      _leagueRow,
      _unpaidFee,
      _plannedRosterStats,
      _leagueDetails,
    ] = await Promise.all([
      getPublicLeagueData(leagueId),
      getLeagueFlags(leagueId),
      getRecruitingViewerState(leagueId),
      prisma.league.findUnique({
        where: { id: leagueId },
        // v1.82.0 — `ballType` flows into RecruitingBanner so the State D
        // ApplyToLeagueModal renders the right position vocabulary.
        select: { id: true, name: true, abbreviation: true, ballType: true },
      }),
      // v1.66.0 — unpaid-fee banner data; null when banner stays hidden.
      getUnpaidFeeBannerData(leagueId),
      // v1.67.0 — planned-roster panel data. v1.75.5 — threaded
      // unconditionally so the public details panel can render the
      // fee + planned teams + per-team + spots-left mini-section.
      // The panel hides individual rows when value is unset/zero.
      getPlannedRosterStats(leagueId),
      // v1.75.0 — league details panel data; helper returns null when
      // `League.showLeagueDetails === false`. v1.75.1 — preseasonMode
      // gate removed; renders on both classic and preseason homepages.
      getLeagueDetails(leagueId),
    ]);
    data = _data;
    flags = _flags;
    recruitingState = _recruitingState;
    leagueRow = _leagueRow;
    unpaidFee = _unpaidFee;
    plannedRosterStats = _plannedRosterStats;
    leagueDetails = _leagueDetails;
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
      preseasonMode={flags.preseasonMode}
      recruiting={flags.recruiting}
      recruitingState={recruitingState}
      league={leagueRow ?? undefined}
      unpaidFee={unpaidFee ?? null}
      plannedRosterStats={plannedRosterStats ?? null}
      leagueDetails={leagueDetails ?? null}
    />
  );
}
