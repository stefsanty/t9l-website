import { getMatch, getAllPlayers } from '@/lib/admin-data'
import { notFound } from 'next/navigation'
import { updateMatchScore, addGoal, deleteGoal } from '@/app/admin/actions'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

function formatDate(date: Date | null) {
  if (!date) return 'TBD'
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'long' }).format(date)
}

export default async function MatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [match, allPlayers] = await Promise.all([getMatch(id), getAllPlayers()])
  if (!match) notFound()

  const played = match.homeScore !== null && match.awayScore !== null

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <Link href="/admin/matches" className="text-sm text-gray-500 hover:text-gray-700">
          ← Matches
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">
          {match.homeTeam.name} vs {match.awayTeam.name}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Matchday {match.matchday} · {formatDate(match.date)}
        </p>
      </div>

      {/* Score section */}
      <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Score</h2>
        <form action={updateMatchScore} className="flex items-end gap-4">
          <input type="hidden" name="matchId" value={match.id} />
          <div>
            <label className="block text-xs text-gray-500 mb-1">{match.homeTeam.name}</label>
            <input
              type="number"
              name="homeScore"
              min="0"
              defaultValue={match.homeScore ?? ''}
              placeholder="—"
              className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>
          <span className="pb-2 text-gray-400 font-medium">–</span>
          <div>
            <label className="block text-xs text-gray-500 mb-1">{match.awayTeam.name}</label>
            <input
              type="number"
              name="awayScore"
              min="0"
              defaultValue={match.awayScore ?? ''}
              placeholder="—"
              className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors"
          >
            Save Score
          </button>
          {played && (
            <span className="text-xs text-green-600 font-medium pb-2">✓ saved</span>
          )}
        </form>
      </section>

      {/* Goals section */}
      <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">
          Goals ({match.goals.length})
        </h2>

        {match.goals.length > 0 ? (
          <ul className="divide-y divide-gray-100 mb-6">
            {match.goals.map(goal => (
              <li key={goal.id} className="py-3 flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-gray-900">{goal.scorer.name}</span>
                  {goal.assister && (
                    <span className="ml-2 text-xs text-gray-400">
                      (assist: {goal.assister.name})
                    </span>
                  )}
                </div>
                <form action={deleteGoal}>
                  <input type="hidden" name="goalId" value={goal.id} />
                  <button
                    type="submit"
                    className="text-xs text-red-500 hover:text-red-700 transition-colors"
                  >
                    Delete
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-400 mb-6">No goals recorded.</p>
        )}

        <form action={addGoal} className="border-t border-gray-100 pt-5 space-y-3">
          <p className="text-sm font-medium text-gray-700">Add Goal</p>
          <input type="hidden" name="matchId" value={match.id} />
          <div className="flex gap-3 flex-wrap">
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs text-gray-500 mb-1">Scorer *</label>
              <select
                name="scorerId"
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
              >
                <option value="">Select player…</option>
                {allPlayers.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs text-gray-500 mb-1">Assister (optional)</label>
              <select
                name="assisterId"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
              >
                <option value="">None</option>
                {allPlayers.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors"
          >
            Add Goal
          </button>
        </form>
      </section>

      {/* Availability section */}
      <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">
          Availability ({match.availability.length})
        </h2>
        {match.availability.length === 0 ? (
          <p className="text-sm text-gray-400">No availability recorded.</p>
        ) : (
          <table className="min-w-full">
            <thead>
              <tr>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider pb-2">
                  Player
                </th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider pb-2">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {match.availability.map(av => (
                <tr key={av.id}>
                  <td className="py-2 text-sm text-gray-900">{av.player.name}</td>
                  <td className="py-2">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        av.status === 'PLAYED'
                          ? 'bg-green-100 text-green-800'
                          : av.status === 'Y' || av.status === 'GOING'
                          ? 'bg-blue-100 text-blue-800'
                          : av.status === 'EXPECTED' || av.status === 'UNDECIDED'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {av.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
