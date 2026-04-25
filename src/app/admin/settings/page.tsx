import { getLeague } from '@/lib/admin-data'
import { updateLeague } from '@/app/admin/actions'

export default async function SettingsPage() {
  const league = await getLeague()
  if (!league) return <p className="text-gray-400">No league found.</p>

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">League Settings</h1>
      <div className="bg-gray-800 rounded-lg p-6 max-w-lg">
        <form action={updateLeague} className="space-y-4">
          <input type="hidden" name="id" value={league.id} />

          <div>
            <label className="block text-xs text-gray-400 mb-1">Name</label>
            <input
              name="name"
              defaultValue={league.name}
              className="w-full bg-gray-700 text-white rounded px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Season</label>
            <input
              name="season"
              defaultValue={league.season ?? ''}
              className="w-full bg-gray-700 text-white rounded px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Court / Venue</label>
            <input
              name="court"
              defaultValue={league.court ?? ''}
              className="w-full bg-gray-700 text-white rounded px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Day of Week</label>
            <input
              name="dayOfWeek"
              defaultValue={league.dayOfWeek ?? ''}
              className="w-full bg-gray-700 text-white rounded px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Status</label>
            <select
              name="status"
              defaultValue={league.status}
              className="w-full bg-gray-700 text-white rounded px-3 py-2 text-sm"
            >
              <option value="active">active</option>
              <option value="completed">completed</option>
              <option value="draft">draft</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Logo URL</label>
            <input
              name="logoUrl"
              defaultValue={league.logoUrl ?? ''}
              className="w-full bg-gray-700 text-white rounded px-3 py-2 text-sm"
            />
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
