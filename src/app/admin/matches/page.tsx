import { getMatchesWithGoals } from '@/lib/admin-data'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

function formatDate(date: Date | null) {
  if (!date) return 'TBD'
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(date)
}

export default async function AdminMatchesPage() {
  const matches = await getMatchesWithGoals()

  const byMatchday = matches.reduce<Record<number, typeof matches>>((acc, m) => {
    acc[m.matchday] = acc[m.matchday] ?? []
    acc[m.matchday].push(m)
    return acc
  }, {})

  const matchdays = Object.keys(byMatchday)
    .map(Number)
    .sort((a, b) => a - b)

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-8">Matches</h1>

      <div className="space-y-8">
        {matchdays.map(md => (
          <div key={md}>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Matchday {md}
            </h2>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Match
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Score
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {byMatchday[md].map(match => {
                    const played =
                      match.homeScore !== null && match.awayScore !== null
                    const score = played
                      ? `${match.homeScore} – ${match.awayScore}`
                      : 'TBD'
                    return (
                      <tr key={match.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 text-sm text-gray-500">
                          {formatDate(match.date)}
                        </td>
                        <td className="px-6 py-4 text-sm font-medium text-gray-900">
                          {match.homeTeam.name} vs {match.awayTeam.name}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-700 font-mono">{score}</td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              played
                                ? 'bg-green-100 text-green-800'
                                : 'bg-yellow-100 text-yellow-800'
                            }`}
                          >
                            {played ? 'played' : 'scheduled'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <Link
                            href={`/admin/matches/${match.id}`}
                            className="text-sm text-blue-600 hover:underline"
                          >
                            Edit
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        {matchdays.length === 0 && (
          <p className="text-sm text-gray-400">No matches found.</p>
        )}
      </div>
    </div>
  )
}
