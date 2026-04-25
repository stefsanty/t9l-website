import { createPlayer } from '@/app/admin/actions'

export default async function NewPlayerPage() {
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

          {/* TODO: team assignment requires selecting a LeagueTeam, not a bare Team */}

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
