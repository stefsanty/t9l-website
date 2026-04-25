import Link from 'next/link'
import { getAllPlayers } from '@/lib/admin-data'

export default async function PlayersPage() {
  const players = await getAllPlayers()

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Players</h1>
        <Link
          href="/admin/players/new"
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded"
        >
          + New Player
        </Link>
      </div>

      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="text-left text-gray-400 font-medium px-4 py-3">Name</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">Team</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">LINE ID</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {players.map((player) => {
              const team = player.leagueAssignments[0]?.leagueTeam.team
              return (
                <tr key={player.id} className="hover:bg-gray-750">
                  <td className="px-4 py-3 text-white">{player.name}</td>
                  <td className="px-4 py-3 text-gray-400">{team?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                    {player.lineId ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/players/${player.id}`}
                      className="text-blue-400 hover:text-blue-300 text-xs"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
