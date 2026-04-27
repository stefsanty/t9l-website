export const dynamic = 'force-dynamic';

import AssignPlayerClient from '@/components/AssignPlayerClient';
import { getPublicLeagueData } from '@/lib/publicData';

export default async function AssignPlayerPage() {
  const data = await getPublicLeagueData();

  const playersByTeam = data.teams.map((team) => ({
    team,
    players: data.players
      .filter((p) => p.teamId === team.id)
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));

  return (
    <div className="min-h-dvh bg-background flex flex-col items-center justify-start pt-12 px-4">
      <AssignPlayerClient playersByTeam={playersByTeam} />
    </div>
  );
}
