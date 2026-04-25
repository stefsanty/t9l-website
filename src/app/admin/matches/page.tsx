import Link from 'next/link'
import { getMatchesWithGoals } from '@/lib/admin-data'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export default async function MatchesPage() {
  const matches = await getMatchesWithGoals()

  const byMatchday = matches.reduce<Record<number, typeof matches>>((acc, m) => {
    ;(acc[m.matchday] ??= []).push(m)
    return acc
  }, {})

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Matches</h1>

      {Object.entries(byMatchday).map(([md, mdMatches]) => (
        <Card key={md}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Matchday {md}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {mdMatches.map((match) => {
                const scored = match.homeScore != null && match.awayScore != null
                return (
                  <div key={match.id} className="flex items-center justify-between px-6 py-3 gap-3">
                    <div className="flex items-center gap-2 text-sm min-w-0 flex-1">
                      <span className="font-medium truncate">{match.homeTeam.name}</span>
                      <span className="text-muted-foreground font-mono text-xs tabular-nums shrink-0">
                        {scored ? `${match.homeScore} – ${match.awayScore}` : 'vs'}
                      </span>
                      <span className="font-medium truncate">{match.awayTeam.name}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {match.goals.length > 0 && (
                        <Badge variant="secondary" className="text-xs">
                          {match.goals.length}g
                        </Badge>
                      )}
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/admin/matches/${match.id}`}>Edit</Link>
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
