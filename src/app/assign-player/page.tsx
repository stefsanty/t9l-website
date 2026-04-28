export const dynamic = 'force-dynamic';

import { getServerSession } from 'next-auth';
import AssignPlayerClient from '@/components/AssignPlayerClient';
import { authOptions } from '@/lib/auth';
import { getPublicLeagueData } from '@/lib/publicData';
import { getLinkedPlayerIds } from '@/lib/linkedPlayers';

export default async function AssignPlayerPage() {
  // Both reads are in the SSR critical path. They're independent so we run
  // them in parallel — the Prisma findMany is cheap (few-dozen-row scan on
  // an indexed nullable column) and `getPublicLeagueData` already pays its
  // own cold-Neon cost when the data source is `db`.
  const [data, session] = await Promise.all([
    getPublicLeagueData(),
    getServerSession(authOptions),
  ]);

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
