import { getDashboardStats } from '@/lib/admin-data'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

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
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        {league && (
          <p className="text-gray-400 text-sm mt-1 flex items-center gap-2 flex-wrap">
            {league.name} · {league.season ?? 'Season TBD'} ·{' '}
            <Badge variant={league.status === 'active' ? 'success' : league.status === 'draft' ? 'warning' : 'default'}>
              {league.status}
            </Badge>
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(({ label, value }) => (
          <Card key={label}>
            <CardContent className="p-5">
              <p className="text-gray-400 text-xs uppercase tracking-wider mb-1">{label}</p>
              <p className="text-3xl font-bold text-white">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div>
        <h2 className="text-lg font-semibold text-white mb-3">Recent Goals</h2>
        <Card>
          <CardContent className="p-0">
            {recentGoals.length === 0 ? (
              <p className="text-gray-500 text-sm p-4">No goals recorded yet.</p>
            ) : (
              <div className="divide-y divide-gray-800">
                {recentGoals.map((goal) => (
                  <div key={goal.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <span className="text-white font-medium">{goal.scorer.name}</span>
                    <span className="text-gray-500 truncate">
                      {goal.match.homeTeam.name} vs {goal.match.awayTeam.name}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
