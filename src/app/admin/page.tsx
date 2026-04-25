import { getDashboardStats } from '@/lib/admin-data'

export const dynamic = 'force-dynamic'

export default async function AdminDashboard() {
  const { league, teamCount, playerCount, matchCount, playedCount, recentGoals } =
    await getDashboardStats()

  const stats = [
    { label: 'Teams', value: teamCount },
    { label: 'Players', value: playerCount },
    { label: 'Matches Scheduled', value: matchCount },
    { label: 'Matches Played', value: playedCount },
  ]

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        {league && (
          <p className="mt-1 text-sm text-gray-500">
            {league.name} · {league.season} · <span className="capitalize">{league.status}</span>
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-10">
        {stats.map(({ label, value }) => (
          <div key={label} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <p className="text-sm text-gray-500">{label}</p>
            <p className="mt-1 text-3xl font-bold text-gray-900">{value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Recent Goals</h2>
        {recentGoals.length === 0 ? (
          <p className="text-sm text-gray-400">No goals recorded yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {recentGoals.map(goal => (
              <li key={goal.id} className="py-3 flex items-center gap-3">
                <span className="text-sm font-medium text-gray-900">{goal.scorer.name}</span>
                {goal.assister && (
                  <span className="text-xs text-gray-400">(assist: {goal.assister.name})</span>
                )}
                <span className="ml-auto text-xs text-gray-400">
                  MD{goal.match.matchday} · {goal.match.homeTeam.name} vs {goal.match.awayTeam.name}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
