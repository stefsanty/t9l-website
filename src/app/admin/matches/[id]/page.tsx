import { notFound } from 'next/navigation'
import { getMatch, getAllPlayers } from '@/lib/admin-data'
import { updateMatchScore, addGoal, deleteGoal } from '@/app/admin/actions'

type Props = { params: Promise<{ id: string }> }

export default async function EditMatchPage({ params }: Props) {
  const { id } = await params
  const [match, players] = await Promise.all([getMatch(id), getAllPlayers()])
  if (!match) notFound()

  const rosterPlayers = players.filter((p) =>
    p.playerTeams.some(
      (pt) => pt.teamId === match.homeTeamId || pt.teamId === match.awayTeamId
    )
  )

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">
          {match.homeTeam.name} vs {match.awayTeam.name}
        </h1>
        <p className="text-gray-400 text-sm">Matchday {match.matchday}</p>
      </div>

      {/* Score */}
      <section className="bg-gray-800 rounded-lg p-6 max-w-sm">
        <h2 className="text-sm font-semibold text-gray-300 mb-4">Score</h2>
        <form action={updateMatchScore} className="flex items-end gap-3">
          <input type="hidden" name="matchId" value={match.id} />
          <div>
            <label className="block text-xs text-gray-400 mb-1">{match.homeTeam.name}</label>
            <input
              name="homeScore"
              type="number"
              min="0"
              defaultValue={match.homeScore ?? ''}
              className="w-20 bg-gray-700 text-white text-center rounded px-3 py-2 text-sm"
            />
          </div>
          <span className="text-gray-500 pb-2">–</span>
          <div>
            <label className="block text-xs text-gray-400 mb-1">{match.awayTeam.name}</label>
            <input
              name="awayScore"
              type="number"
              min="0"
              defaultValue={match.awayScore ?? ''}
              className="w-20 bg-gray-700 text-white text-center rounded px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-2 rounded"
          >
            Save
          </button>
        </form>
      </section>

      {/* Goals */}
      <section>
        <h2 className="text-sm font-semibold text-gray-300 mb-3">Goals</h2>
        <div className="bg-gray-800 rounded-lg divide-y divide-gray-700 mb-4">
          {match.goals.length === 0 && (
            <p className="text-gray-500 text-sm px-4 py-3">No goals recorded.</p>
          )}
          {match.goals.map((goal) => (
            <div key={goal.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <span className="text-white">{goal.scorer.name}</span>
              {goal.assister && (
                <span className="text-gray-400 text-xs">assist: {goal.assister.name}</span>
              )}
              <form action={deleteGoal}>
                <input type="hidden" name="goalId" value={goal.id} />
                <input type="hidden" name="matchId" value={match.id} />
                <button
                  type="submit"
                  className="text-red-500 hover:text-red-400 text-xs ml-4"
                >
                  Delete
                </button>
              </form>
            </div>
          ))}
        </div>

        {/* Add goal */}
        <div className="bg-gray-800 rounded-lg p-4 max-w-md">
          <p className="text-xs text-gray-400 font-medium mb-3">Add Goal</p>
          <form action={addGoal} className="space-y-3">
            <input type="hidden" name="matchId" value={match.id} />
            <div>
              <label className="block text-xs text-gray-400 mb-1">Scorer *</label>
              <select
                name="scorerId"
                required
                className="w-full bg-gray-700 text-white rounded px-3 py-2 text-sm"
              >
                <option value="">— Select scorer —</option>
                {rosterPlayers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Assister</label>
              <select
                name="assisterId"
                className="w-full bg-gray-700 text-white rounded px-3 py-2 text-sm"
              >
                <option value="">— No assist —</option>
                {rosterPlayers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-3 py-2 rounded"
            >
              Add Goal
            </button>
          </form>
        </div>
      </section>

      {/* Availability */}
      {match.availability.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-300 mb-3">Availability</h2>
          <div className="bg-gray-800 rounded-lg divide-y divide-gray-700">
            {match.availability.map((av) => (
              <div key={av.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-white">{av.player.name}</span>
                <span
                  className={`text-xs ${
                    av.status === 'GOING'
                      ? 'text-green-400'
                      : av.status === 'PLAYED'
                      ? 'text-blue-400'
                      : 'text-gray-400'
                  }`}
                >
                  {av.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
