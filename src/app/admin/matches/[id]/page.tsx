import { notFound } from 'next/navigation'
import { getMatch, getAllPlayers } from '@/lib/admin-data'
import { updateMatchScore, addGoal, deleteGoal } from '@/app/admin/actions'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'

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
        <p className="text-gray-400 text-sm mt-1">Matchday {match.matchday}</p>
      </div>

      {/* Score */}
      <Card className="max-w-sm">
        <CardHeader>
          <CardTitle className="text-sm">Score</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updateMatchScore} className="flex items-end gap-3 flex-wrap">
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
            <span className="text-gray-500 pb-2.5 text-lg">–</span>
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
            <Button type="submit" className="mb-0.5">Save</Button>
          </form>
        </CardContent>
      </Card>

      {/* Goals */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-gray-300">Goals</h2>
        <Card>
          <CardContent className="p-0">
            {match.goals.length === 0 ? (
              <p className="text-gray-500 text-sm px-4 py-3">No goals recorded.</p>
            ) : (
              <div className="divide-y divide-gray-800">
                {match.goals.map((goal) => (
                  <div key={goal.id} className="flex items-center justify-between px-4 py-3 text-sm gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-white font-medium truncate">{goal.scorer.name}</span>
                      {goal.assister && (
                        <span className="text-gray-400 text-xs truncate">
                          assist: {goal.assister.name}
                        </span>
                      )}
                    </div>
                    <form action={deleteGoal}>
                      <input type="hidden" name="goalId" value={goal.id} />
                      <input type="hidden" name="matchId" value={match.id} />
                      <Button type="submit" variant="destructive" size="sm">Delete</Button>
                    </form>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Add goal */}
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="text-sm">Add Goal</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={addGoal} className="space-y-3">
              <input type="hidden" name="matchId" value={match.id} />
              <div className="space-y-1.5">
                <Label>Scorer *</Label>
                <Select name="scorerId" required>
                  <option value="">— Select scorer —</option>
                  {rosterPlayers.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Assister</Label>
                <Select name="assisterId">
                  <option value="">— No assist —</option>
                  {rosterPlayers.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              </div>
              <Button type="submit" variant="success">Add Goal</Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Availability */}
      {match.availability.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-300">Availability</h2>
          <Card>
            <CardContent className="p-0">
              <div className="divide-y divide-gray-800">
                {match.availability.map((av) => (
                  <div key={av.id} className="flex items-center justify-between px-4 py-2 text-sm">
                    <span className="text-white">{av.player.name}</span>
                    <Badge
                      variant={
                        av.status === 'GOING'
                          ? 'success'
                          : av.status === 'PLAYED'
                          ? 'default'
                          : 'secondary'
                      }
                    >
                      {av.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
