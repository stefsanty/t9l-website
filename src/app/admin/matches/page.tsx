import Link from 'next/link'
import { getMatchesWithGoals } from '@/lib/admin-data'

export default async function MatchesPage() {
  const matches = await getMatchesWithGoals()

  const byMatchday = matches.reduce<Record<number, typeof matches>>((acc, m) => {
    ;(acc[m.matchday] ??= []).push(m)
    return acc
  }, {})

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">Matches</h1>

      {Object.entries(byMatchday).map(([md, mdMatches]) => (
        <div key={md} className="mb-8">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Matchday {md}
          </h2>
          <div className="bg-gray-800 rounded-lg divide-y divide-gray-700">
            {mdMatches.map((match) => {
              const scored = match.homeScore != null && match.awayScore != null
              return (
                <div key={match.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-white">{match.homeTeam.name}</span>
                    <span className="text-gray-400 font-mono text-xs tabular-nums">
                      {scored ? `${match.homeScore} – ${match.awayScore}` : 'vs'}
                    </span>
                    <span className="text-white">{match.awayTeam.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-gray-500 text-xs">{match.goals.length} goals</span>
                    <Link
                      href={`/admin/matches/${match.id}`}
                      className="text-blue-400 hover:text-blue-300 text-xs"
                    >
                      Edit
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
