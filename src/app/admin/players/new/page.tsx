import { getAllTeams } from '@/lib/admin-data'
import { createPlayer } from '@/app/admin/actions'

export default async function NewPlayerPage() {
  const teams = await getAllTeams()

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">New Player</h1>
      <div className="bg-gray-800 rounded-lg p-6 max-w-lg">
        <form action={createPlayer} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Name *</label>
            <input
              name="name"
              required
              className="w-full bg-gray-700 text-white rounded px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">LINE ID</label>
            <input
              name="lineId"
              className="w-full bg-gray-700 text-white rounded px-3 py-2 text-sm font-mono"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Role</label>
            <select
              name="role"
              defaultValue="player"
              className="w-full bg-gray-700 text-white rounded px-3 py-2 text-sm"
            >
              <option value="player">player</option>
              <option value="admin">admin</option>
              <option value="guest">guest</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Team</label>
            <select
              name="teamId"
              className="w-full bg-gray-700 text-white rounded px-3 py-2 text-sm"
            >
              <option value="">— No team —</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>{team.name}</option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded"
          >
            Create Player
          </button>
        </form>
      </div>
    </div>
  )
}
