import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'
import { updatePlayer } from '@/app/admin/actions'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function EditPlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const player = await prisma.player.findUnique({
    where: { id },
    include: {
      playerTeams: {
        include: { team: true },
      },
    },
  })
  if (!player) notFound()

  return (
    <div className="max-w-lg">
      <div className="mb-8">
        <Link href="/admin/players" className="text-sm text-gray-500 hover:text-gray-700">
          ← Players
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Edit Player</h1>
      </div>

      <form action={updatePlayer} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
        <input type="hidden" name="id" value={player.id} />

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
          <input
            type="text"
            name="name"
            defaultValue={player.name}
            required
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">LINE ID</label>
          <input
            type="text"
            name="lineId"
            defaultValue={player.lineId ?? ''}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
          <select
            name="role"
            defaultValue={player.role}
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
            defaultValue={player.pictureUrl ?? ''}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
        </div>

        {player.playerTeams.length > 0 && (
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Teams</p>
            <ul className="space-y-1">
              {player.playerTeams.map(pt => (
                <li key={pt.id} className="text-sm text-gray-600">
                  {pt.team.name}
                  {pt.position ? <span className="ml-2 text-gray-400">({pt.position})</span> : null}
                  {!pt.isActive && <span className="ml-2 text-gray-300">[inactive]</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="pt-2">
          <button
            type="submit"
            className="w-full bg-gray-900 text-white text-sm font-medium py-2 rounded-lg hover:bg-gray-700 transition-colors"
          >
            Save Changes
          </button>
        </div>
      </form>
    </div>
  )
}
