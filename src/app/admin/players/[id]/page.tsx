import { notFound } from 'next/navigation'
import { getAllPlayers } from '@/lib/admin-data'
import { updatePlayer } from '@/app/admin/actions'

type Props = { params: Promise<{ id: string }> }

export default async function EditPlayerPage({ params }: Props) {
  const { id } = await params
  const players = await getAllPlayers()
  const player = players.find((p) => p.id === id)
  if (!player) notFound()

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">Edit Player</h1>
      <div className="bg-gray-800 rounded-lg p-6 max-w-lg">
        <form action={updatePlayer} className="space-y-4">
          <input type="hidden" name="id" value={player.id} />

          <div>
            <label className="block text-xs text-gray-400 mb-1">Name *</label>
            <input
              name="name"
              required
              defaultValue={player.name}
              className="w-full bg-gray-700 text-white rounded px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">LINE ID</label>
            <input
              name="lineId"
              defaultValue={player.lineId ?? ''}
              className="w-full bg-gray-700 text-white rounded px-3 py-2 text-sm font-mono"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Role</label>
            <select
              name="role"
              defaultValue={player.role}
              className="w-full bg-gray-700 text-white rounded px-3 py-2 text-sm"
            >
              <option value="player">player</option>
              <option value="admin">admin</option>
              <option value="guest">guest</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Picture URL</label>
            <input
              name="pictureUrl"
              defaultValue={player.pictureUrl ?? ''}
              className="w-full bg-gray-700 text-white rounded px-3 py-2 text-sm"
            />
          </div>

          <div className="text-xs text-gray-500">
            Team: {player.playerTeams[0]?.team?.name ?? '—'}
          </div>

          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded"
          >
            Save Changes
          </button>
        </form>
      </div>
    </div>
  )
}
