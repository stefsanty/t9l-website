import { notFound } from 'next/navigation'
import { getMatch, getAllPlayers } from '@/lib/admin-data'
import { updateMatchScore, addGoal, deleteGoal } from '@/app/admin/actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'

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
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {match.homeTeam.name} vs {match.awayTeam.name}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">Matchday {match.matchday}</p>
      </div>

      {/* Score */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Score</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updateMatchScore} className="flex items-end gap-3">
            <input type="hidden" name="matchId" value={match.id} />
            <div className="space-y-1.5">
              <Label>{match.homeTeam.name}</Label>
              <Input
                name="homeScore"
                type="number"
                min="0"
                defaultValue={match.homeScore ?? ''}
                className="w-20 text-center"
              />
            </div>
            <span className="text-muted-foreground pb-2 text-lg">–</span>
            <div className="space-y-1.5">
              <Label>{match.awayTeam.name}</Label>
              <Input
                name="awayScore"
                type="number"
                min="0"
                defaultValue={match.awayScore ?? ''}
                className="w-20 text-center"
              />
            </div>
            <Button type="submit" size="sm" className="mb-0.5">Save</Button>
          </form>
        </CardContent>
      </Card>

      {/* Goals */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Goals</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Existing goals list */}
          {match.goals.length === 0 ? (
            <p className="text-muted-foreground text-sm">No goals recorded.</p>
          ) : (
            <div className="divide-y divide-border rounded-md border border-border">
              {match.goals.map((goal) => (
                <div key={goal.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium">{goal.scorer.name}</span>
                    {goal.assister && (
                      <span className="text-muted-foreground text-xs">
                        assist: {goal.assister.name}
                      </span>
                    )}
                  </div>
                  <form action={deleteGoal}>
                    <input type="hidden" name="goalId" value={goal.id} />
                    <input type="hidden" name="matchId" value={match.id} />
                    <Button type="submit" variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                      Delete
                    </Button>
                  </form>
                </div>
              ))}
            </div>
          )}

          <Separator />

          {/* Add goal form */}
          <div>
            <p className="text-sm font-medium mb-3">Add Goal</p>
            <form action={addGoal} className="space-y-3">
              <input type="hidden" name="matchId" value={match.id} />
              <div className="space-y-1.5">
                <Label htmlFor="scorerId">Scorer *</Label>
                <select
                  id="scorerId"
                  name="scorerId"
                  required
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">— Select scorer —</option>
                  {rosterPlayers.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="assisterId">Assister</Label>
                <select
                  id="assisterId"
                  name="assisterId"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">— No assist —</option>
                  {rosterPlayers.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <Button type="submit" variant="secondary" size="sm">Add Goal</Button>
            </form>
          </div>
        </CardContent>
      </Card>

      {/* Availability */}
      {match.availability.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Availability</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {match.availability.map((av) => (
                <div key={av.id} className="flex items-center justify-between px-6 py-2.5 text-sm">
                  <span className="font-medium">{av.player.name}</span>
                  <Badge
                    variant={
                      av.status === 'GOING' ? 'success'
                      : av.status === 'PLAYED' ? 'info'
                      : 'outline'
                    }
                    className="text-xs"
                  >
                    {av.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
