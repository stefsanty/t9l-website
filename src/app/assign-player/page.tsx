export const dynamic = 'force-dynamic';

import { getServerSession } from 'next-auth';
import AssignPlayerClient from '@/components/AssignPlayerClient';
import { authOptions } from '@/lib/auth';
import { getPublicLeagueData } from '@/lib/publicData';
import {
  annotatePlayersWithLinkedStatus,
  getLinkedPlayerIds,
} from '@/lib/linkedPlayers';

export default async function AssignPlayerPage() {
  // Both reads are in the SSR critical path. They're independent so we run
  // them in parallel — the Prisma findMany is cheap (few-dozen-row scan on
  // an indexed nullable column) and `getPublicLeagueData` already pays its
  // own cold-Neon cost when the data source is `db`.
  const [data, session] = await Promise.all([
    getPublicLeagueData(),
    getServerSession(authOptions),
  ]);

  const linkedIds = await getLinkedPlayerIds(session?.lineId ?? null);

  const playersByTeam = annotatePlayersWithLinkedStatus(
    data.teams.map((team) => ({
      team,
      players: data.players
        .filter((p) => p.teamId === team.id)
        .sort((a, b) => a.name.localeCompare(b.name)),
    })),
    linkedIds,
  );

  return (
    <div className="min-h-dvh bg-background flex flex-col items-center justify-start pt-12 px-4">
      <AssignPlayerClient playersByTeam={playersByTeam} />
    </div>
  );
}
