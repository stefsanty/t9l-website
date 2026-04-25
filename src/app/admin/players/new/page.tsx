import { getAllTeams } from '@/lib/admin-data'
import { createPlayer } from '@/app/admin/actions'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function NewPlayerPage() {
  const teams = await getAllTeams()

  return (
    <div className="max-w-lg">
      <div className="mb-8">
        <Link href="/admin/players" className="text-sm text-gray-500 hover:text-gray-700">
          ← Players
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">New Player</h1>
      </div>

      <form action={createPlayer} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
          <input
            type="text"
            name="name"
            required
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Team</label>
          <select
            name="teamId"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            <option value="">— No team —</option>
            {teams.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Position</label>
          <input
            type="text"
            name="position"
            placeholder="GK / CB / FW…"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">LINE ID</label>
          <input
            type="text"
            name="lineId"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
          <select
            name="role"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            <option value="player">player</option>
            <option value="admin">admin</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Picture URL</label>
          <input
            type="url"
            name="pictureUrl"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
        </div>

        <div className="pt-2">
          <button
            type="submit"
            className="w-full bg-gray-900 text-white text-sm font-medium py-2 rounded-lg hover:bg-gray-700 transition-colors"
          >
            Create Player
          </button>
        </div>
      </form>
    </div>
  )
}
