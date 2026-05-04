import { findNextMatchday } from "@/lib/stats";
import Dashboard from "@/components/Dashboard";
import { getLeagueIdFromRequest } from "@/lib/getLeagueFromHost";
import { getPublicLeagueData } from "@/lib/publicData";
import { DEFAULT_LEAGUE_SLUG } from "@/lib/leagueSlug";

/**
 * Public landing page — apex AND subdomain both render through here.
 *
 * v1.25.0 — renderer convergence: pre-v1.25.0 apex (`t9l.me`) rendered
 * `Dashboard` (RSVP / NextMatchdayBanner / UserTeamBadge / MatchdayAvailability)
 * while subdomains (`tamachi.t9l.me` etc.) rendered `LeaguePublicView` —
 * a stripped-down 3-tab schedule/standings/teams view with no RSVP, no next-
 * matchday banner, no logged-in-user affordances. Two parallel renderers were
 * drifting; subdomains were second-class. v1.25.0 deletes `LeaguePublicView`
 * and routes both apex and subdomain through `Dashboard`, fed by the v1.23.0
 * parameterized `getPublicLeagueData(leagueId?)` so the league context is
 * established once at the page boundary and threaded through as data.
 *
 * Routing rules (delegated to `getLeagueIdFromRequest`):
 *   - apex / dev base / localhost / Vercel preview → default league id
 *   - known subdomain → that league's id
 *   - unknown subdomain → null → renders the "league not found" surface
 *     instead of silently falling back to the default league
 *
 * Subdomain users now get the full Dashboard feature set: NextMatchdayBanner,
 * MatchdayAvailability, RsvpBar, UserTeamBadge, GuestLoginBanner. Their
 * /schedule and /stats sub-routes were already subdomain-aware as of v1.23.0
 * — v1.25.0 closes the remaining home-tab gap.
 */
export default async function Home() {
  const leagueId = await getLeagueIdFromRequest();

  if (leagueId === null) {
    // Subdomain present in the host header but no matching League row.
    // Pre-v1.25.0 the `getLeagueBySubdomain` lookup also returned null in
    // this case and `app/page.tsx` would silently fall through to the apex
    // path — same default-league bleed-through as the pre-v1.22.0 RSVP
    // route. v1.25.0 surfaces the unknown subdomain explicitly so admins
    // (and operators provisioning new leagues) get a clear "this subdomain
    // is not attached to a league yet" signal instead of a wrong-league render.
    return (
      <div className="flex items-center justify-center min-h-dvh bg-midnight text-white px-6 text-center">
        <div>
          <p className="font-display text-3xl font-black uppercase text-white/80 mb-2">
            League not found
          </p>
          <p className="text-sm text-white/80 font-bold uppercase tracking-widest">
            This subdomain is not attached to a league.
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
