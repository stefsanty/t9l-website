export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { getServerSession } from 'next-auth';
import AssignPlayerClient from '@/components/AssignPlayerClient';
import { authOptions } from '@/lib/auth';
import { getPublicLeagueData } from '@/lib/publicData';
import { getLinkedPlayerIds } from '@/lib/linkedPlayers';
import { getDefaultLeagueId } from '@/lib/leagueSlugServer';
import { getLeagueAllowSelfLink } from '@/lib/leagueSelfLink';

export default async function AssignPlayerPage() {
  // v1.53.0 — subdomain teardown. The legacy /assign-player picker
  // operates on the default league; multi-league self-serve binding
  // belongs in /join/[code] (PR ζ).
  const leagueId = await getDefaultLeagueId();

  // Both reads are in the SSR critical path. They're independent so we run
  // them in parallel — the Prisma findMany is cheap (few-dozen-row scan on
  // an indexed nullable column) and `getPublicLeagueData` already pays its
  // own cold-Neon cost when the data source is `db`.
  const [data, session] = await Promise.all([
    getPublicLeagueData(leagueId ?? undefined),
    getServerSession(authOptions),
  ]);

  // v1.61.0 — the v1.39.2 non-LINE-user gate is gone. Any authenticated
  // session can use the picker; the per-league `allowSelfLink` toggle
  // (v1.60.0) decides whether self-linking is open. Pre-v1.61.0 Google /
  // email users were redirected to a "need invite" surface here; that
  // gate was an artifact of the API's LINE-keyed write path and is now
  // replaced by the unified allowSelfLink gate below.

  // v1.60.0 — per-league self-link toggle. When the admin has disabled
  // open self-linking for this league, surface a "self-linking disabled"
  // message instead of the picker. The DELETE path remains unconditionally
  // available so already-linked players can always unbind.
  const allowSelfLink = leagueId ? await getLeagueAllowSelfLink(leagueId) : true;
  if (!allowSelfLink) {
    return <SelfLinkDisabledSurface />;
  }

  // PR 15 / v1.4.3 (extended in v1.61.0) — hide players already linked to
  // ANY authenticated user entirely (vs PR 14's greyed-out affordance).
  // The viewer's own slug is excluded from `linkedIds` via the helper's
  // viewer-exclusion seam (lineId AND/OR userId), so the viewer can still
  // see and re-confirm / unassign their own player. Linked players never
  // reach the client.
  const linkedIds = await getLinkedPlayerIds({
    lineId: session?.lineId ?? null,
    userId: session?.userId ?? null,
  });

  const playersByTeam = data.teams.map((team) => ({
    team,
    players: data.players
      .filter((p) => p.teamId === team.id && !linkedIds.has(p.id))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));

  return (
    <div className="min-h-dvh bg-background flex flex-col items-center justify-start pt-12 px-4">
      <AssignPlayerClient playersByTeam={playersByTeam} />
    </div>
  );
}

// v1.60.0 — per-league self-link toggle. Surface for any visitor (LINE,
// Google/email, or unauthenticated) who hits `/assign-player` for a
// league where the admin has disabled open self-linking. The copy points
// users at the invite-redemption flow (`/join/[code]`) and the operator
// mailto for the case where they don't have an invite yet. Mirrors the
// visual language of `NeedInviteSurface` so the two messages feel like
// siblings.
function SelfLinkDisabledSurface() {
  return (
    <div
      data-testid="assign-player-self-link-disabled"
      className="min-h-dvh bg-background flex items-center justify-center px-5"
    >
      <div className="w-full max-w-sm bg-card border border-border-default rounded-3xl overflow-hidden shadow-2xl">
        <div className="px-7 pt-6 pb-8">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-primary mb-2">
            Self-linking disabled
          </p>
          <h1 className="font-display text-2xl font-black uppercase tracking-tight text-fg-high leading-tight mb-3">
            Ask the league admin for an invite link
          </h1>
          <p className="text-sm text-fg-mid leading-relaxed mb-6">
            Open self-linking is turned off for this league. Your league admin
            will send you a personal invite link that confirms your roster
            spot. If you don&apos;t have one yet, contact{' '}
            <a
              href="mailto:vitoriatamachi@gmail.com"
              className="text-electric-green hover:underline"
            >
              vitoriatamachi@gmail.com
            </a>
            .
          </p>
          <Link
            href="/"
            className="flex items-center justify-center w-full py-3.5 rounded-2xl bg-electric-green text-black font-display text-base font-black uppercase tracking-wider hover:bg-electric-green/90 active:scale-[0.98] transition-all"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
