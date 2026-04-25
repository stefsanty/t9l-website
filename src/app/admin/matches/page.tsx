import Link from 'next/link'
import { getMatchesWithGoals } from '@/lib/admin-data'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

export default async function MatchesPage() {
  const matches = await getMatchesWithGoals()

  const byMatchday = matches.reduce<Record<number, typeof matches>>((acc, m) => {
    ;(acc[m.matchday] ??= []).push(m)
    return acc
  }, {})

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-white">Matches</h1>

      {Object.entries(byMatchday).map(([md, mdMatches]) => (
        <div key={md}>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Matchday {md}
          </h2>
          <Card>
            <CardContent className="p-0">
              <div className="divide-y divide-gray-800">
                {mdMatches.map((match) => {
                  const scored = match.homeScore != null && match.awayScore != null
                  return (
                    <div key={match.id} className="flex items-center justify-between px-4 py-3 gap-2">
                      <div className="flex items-center gap-2 text-sm min-w-0">
                        <span className="text-white truncate">{match.homeTeam.name}</span>
                        <span className="text-gray-400 font-mono text-xs tabular-nums shrink-0">
                          {scored ? `${match.homeScore} – ${match.awayScore}` : 'vs'}
                        </span>
                        <span className="text-white truncate">{match.awayTeam.name}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="secondary">{match.goals.length} goals</Badge>
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
        </div>
      ))}
    </div>
  )
}
