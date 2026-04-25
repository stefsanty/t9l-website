import { getDashboardStats } from '@/lib/admin-data'

export default async function AdminDashboard() {
  const { league, teamCount, playerCount, matchCount, goalCount, recentGoals } =
    await getDashboardStats()

  const stats = [
    { label: 'Teams',   value: teamCount },
    { label: 'Players', value: playerCount },
    { label: 'Matches', value: matchCount },
    { label: 'Goals',   value: goalCount },
  ]

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-1">Dashboard</h1>
      {league && (
        <p className="text-gray-400 text-sm mb-6">
          {league.name} · {league.location}
        </p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        {stats.map(({ label, value }) => (
          <div key={label} className="bg-gray-800 rounded-lg p-5">
            <p className="text-gray-400 text-xs uppercase tracking-wider mb-1">{label}</p>
            <p className="text-3xl font-bold text-white">{value}</p>
          </div>
        ))}
      </div>

      <h2 className="text-lg font-semibold text-white mb-3">Recent Goals</h2>
      <div className="bg-gray-800 rounded-lg divide-y divide-gray-700">
        {recentGoals.length === 0 && (
          <p className="text-gray-500 text-sm p-4">No goals recorded yet.</p>
        )}
        {recentGoals.map((goal) => (
          <div key={goal.id} className="flex items-center gap-3 px-4 py-3 text-sm">
            <span className="text-white font-medium">{goal.player.name}</span>
            <span className="text-gray-500">
              {goal.match.homeTeam.team.name} vs {goal.match.awayTeam.team.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
