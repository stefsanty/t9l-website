import { getDashboardStats } from '@/lib/admin-data'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        {league && (
          <p className="text-muted-foreground text-sm mt-1">
            {league.name} · {league.season ?? 'Season TBD'} ·{' '}
            <Badge variant="outline" className="text-xs ml-1">{league.status}</Badge>
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(({ label, value }) => (
          <Card key={label}>
            <CardHeader className="pb-2 pt-4 px-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <p className="text-3xl font-bold">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Goals</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {recentGoals.length === 0 ? (
            <p className="text-muted-foreground text-sm px-6 pb-6">No goals recorded yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {recentGoals.map((goal) => (
                <div key={goal.id} className="flex items-center gap-3 px-6 py-3 text-sm">
                  <span className="font-medium">{goal.scorer.name}</span>
                  <span className="text-muted-foreground">
                    {goal.match.homeTeam.name} vs {goal.match.awayTeam.name}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
