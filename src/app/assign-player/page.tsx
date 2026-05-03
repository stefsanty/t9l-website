export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { getServerSession } from 'next-auth';
import AssignPlayerClient from '@/components/AssignPlayerClient';
import { authOptions } from '@/lib/auth';
import { getPublicLeagueData } from '@/lib/publicData';
import { getLinkedPlayerIds } from '@/lib/linkedPlayers';
import { getLeagueIdFromRequest } from '@/lib/getLeagueFromHost';

export default async function AssignPlayerPage() {
  // v1.23.0 — resolve the active league from the request Host so subdomain
  // viewers pick from their league's roster, not the default league's.
  const leagueId = await getLeagueIdFromRequest();

  // Both reads are in the SSR critical path. They're independent so we run
  // them in parallel — the Prisma findMany is cheap (few-dozen-row scan on
  // an indexed nullable column) and `getPublicLeagueData` already pays its
  // own cold-Neon cost when the data source is `db`.
  const [data, session] = await Promise.all([
    getPublicLeagueData(leagueId ?? undefined),
    getServerSession(authOptions),
  ]);

  // v1.39.2 — the legacy `/assign-player` open picker is LINE-keyed end-to-end:
  // `/api/assign-player` POST/DELETE gate on `session.lineId`. Google/email
  // users (signed in via the v1.28.0 multi-provider auth foundation, no LINE
  // identity) used to reach the picker, click Confirm, and get a 401 "Not
  // authenticated" — visible to the user as a broken link flow.
  //
  // Per the post-onboarding-chain architecture: existing LINE users are
  // grandfathered onto the legacy picker; non-LINE users redeem invites via
  // PR ζ's `/join/[code]` flow. This server-side gate routes Google/email
  // users to a clear "need invite" surface instead of the broken picker.
  if (session && !session.lineId) {
    return <NeedInviteSurface />;
  }

  // PR 15 / v1.4.3 — hide players already linked to OTHER LINE users entirely
  // (vs PR 14's greyed-out affordance). The viewer's own slug is excluded
  // from `linkedIds` server-side via `NOT { lineId: viewerLineId }` in
  // `getLinkedPlayerIds`, so the viewer can still see and re-confirm /
  // unassign their own player. Linked players never reach the client.
  const linkedIds = await getLinkedPlayerIds(session?.lineId ?? null);

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

// v1.39.2 — server-rendered surface for Google/email users who signed in but
// can't use the LINE-keyed legacy picker. They join via `/join/[code]` invite
// redemption (PR ζ). The mailto contact mirrors the operator address surfaced
// on `/account/player` (PR ι) when the binding is missing.
function NeedInviteSurface() {
  return (
    <div
      data-testid="assign-player-need-invite"
      className="min-h-dvh bg-background flex items-center justify-center px-5"
    >
      <div className="w-full max-w-sm bg-card border border-border-default rounded-3xl overflow-hidden shadow-2xl">
        <div className="px-7 pt-6 pb-8">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-primary mb-2">
            Almost there
          </p>
          <h1 className="font-display text-2xl font-black uppercase tracking-tight text-fg-high leading-tight mb-3">
            You need an invite to join a league
          </h1>
          <p className="text-sm text-fg-mid leading-relaxed mb-6">
            Ask your league admin for an invite link to claim your roster spot,
            or contact{' '}
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
