import { getAllPlayers } from '@/lib/admin-data'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function AdminPlayersPage() {
  const players = await getAllPlayers()

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Players</h1>
        <Link
          href="/admin/players/new"
          className="inline-flex items-center px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors"
        >
          + New Player
        </Link>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Team
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                LINE ID
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Role
              </th>
              <th className="px-6 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {players.map(player => {
              const team = player.playerTeams[0]?.team
              const maskedLineId = player.lineId
                ? player.lineId.slice(0, 6) + '...'
                : '—'
              return (
                <tr key={player.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{player.name}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{team?.name ?? '—'}</td>
                  <td className="px-6 py-4 text-sm text-gray-400 font-mono">{maskedLineId}</td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        player.role === 'admin'
                          ? 'bg-purple-100 text-purple-800'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {player.role}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link
                      href={`/admin/players/${player.id}`}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {players.length === 0 && (
          <p className="px-6 py-8 text-center text-sm text-gray-400">No players found.</p>
        )}
      </div>
    </div>
  )
}
