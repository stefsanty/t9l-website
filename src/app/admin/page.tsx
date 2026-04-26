import Link from 'next/link'
import { Plus, ArrowRight } from 'lucide-react'
import { getAllLeagues } from '@/lib/admin-data'
import LeagueRowSettingsLink from '@/components/admin/LeagueRowSettingsLink'

// `unstable_cache` round-trips Date objects through JSON, so cached values come
// back as ISO strings. Coerce to Date before formatting.
function formatDate(d: Date | string) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default async function AdminDashboard() {
  const leagues = await getAllLeagues()

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-condensed font-extrabold text-admin-text text-3xl tracking-tight">Leagues</h1>
          <p className="text-admin-text3 text-sm mt-1">{leagues.length} league{leagues.length !== 1 ? 's' : ''}</p>
        </div>
        <Link
          href="/admin/leagues/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-admin-green text-admin-ink font-medium text-sm rounded-lg no-underline hover:opacity-90 transition-opacity"
        >
          <Plus className="w-4 h-4" />
          New League
        </Link>
      </div>

      {/* Empty state */}
      {leagues.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-admin-text3">
          <p className="text-lg font-condensed font-semibold mb-2">No leagues yet</p>
          <p className="text-sm mb-6">Create your first league to get started.</p>
          <Link
            href="/admin/leagues/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-admin-green text-admin-ink font-medium text-sm rounded-lg no-underline hover:opacity-90"
          >
            <Plus className="w-4 h-4" />
            Create League
          </Link>
        </div>
      )}

      {/* League list */}
      <div className="space-y-3">
        {leagues.map((league) => {
          const totalMatches  = league.gameWeeks.reduce((s, gw) => s + gw.matches.length, 0)
          const played        = league.gameWeeks.reduce((s, gw) => s + gw.matches.filter(m => m.status === 'COMPLETED').length, 0)
          const venues        = [...new Set(league.gameWeeks.map(gw => gw.venue?.name).filter(Boolean))]

          return (
            <Link
              key={league.id}
              href={`/admin/leagues/${league.id}/schedule`}
              className="block bg-admin-surface rounded-xl border border-admin-border p-5 no-underline hover:border-admin-border2 transition-colors group"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="font-condensed font-bold text-admin-text text-lg leading-tight truncate group-hover:text-white transition-colors">
                    {league.name}
                  </h2>
                  <p className="text-admin-text2 text-sm mt-0.5">{league.location}</p>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-admin-text3">
                    <span>{formatDate(league.startDate)}{league.endDate ? ` – ${formatDate(league.endDate)}` : ''}</span>
                    <span>{league.gameWeeks.length} matchday{league.gameWeeks.length !== 1 ? 's' : ''}</span>
                    <span>{played}/{totalMatches} matches played</span>
                    {venues.length > 0 && <span>{venues.join(', ')}</span>}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <LeagueRowSettingsLink leagueId={league.id} />
                  <ArrowRight className="w-4 h-4 text-admin-text3 group-hover:text-admin-text transition-colors" />
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
