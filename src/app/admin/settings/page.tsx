import { getLeague } from '@/lib/admin-data'
import { updateLeague } from '@/app/admin/actions'

export const dynamic = 'force-dynamic'

export default async function AdminSettingsPage() {
  const league = await getLeague()

  if (!league) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-4">League Settings</h1>
        <p className="text-sm text-gray-500">No active league found in the database.</p>
      </div>
    )
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold text-gray-900 mb-8">League Settings</h1>

      <form action={updateLeague} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
        <input type="hidden" name="id" value={league.id} />

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">League Name *</label>
          <input
            type="text"
            name="name"
            defaultValue={league.name}
            required
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Court / Venue</label>
          <input
            type="text"
            name="court"
            defaultValue={league.court ?? ''}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Day of Week</label>
          <input
            type="text"
            name="dayOfWeek"
            defaultValue={league.dayOfWeek ?? ''}
            placeholder="e.g. Sunday"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Season</label>
          <input
            type="text"
            name="season"
            defaultValue={league.season ?? ''}
            placeholder="e.g. 2025"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
          <select
            name="status"
            defaultValue={league.status}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            <option value="active">active</option>
            <option value="archived">archived</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Logo URL</label>
          <input
            type="url"
            name="logoUrl"
            defaultValue={league.logoUrl ?? ''}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
        </div>

        <div className="pt-2">
          <button
            type="submit"
            className="w-full bg-gray-900 text-white text-sm font-medium py-2 rounded-lg hover:bg-gray-700 transition-colors"
          >
            Save Settings
          </button>
        </div>
      </form>
    </div>
  )
}
