import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { Plus, ArrowRight, Settings } from 'lucide-react'

function toSlug(name: string) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function formatDate(d: Date) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default async function AdminDashboard() {
  const leagues = await prisma.league.findMany({
    include: {
      gameWeeks: {
        include: { matches: true, venue: true },
        orderBy: { weekNumber: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

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
          className="inline-flex items-center gap-2 px-4 py-2 bg-admin-green text-admin-bg font-medium text-sm rounded-lg no-underline hover:opacity-90 transition-opacity"
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
            className="inline-flex items-center gap-2 px-4 py-2 bg-admin-green text-admin-bg font-medium text-sm rounded-lg no-underline hover:opacity-90"
          >
            <Plus className="w-4 h-4" /> New League
          </Link>
        </div>
      )}

      {/* League cards grid */}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {leagues.map((league) => {
          const sortedWeeks = league.gameWeeks
          const completedCount = sortedWeeks.filter(
            (gw) => gw.matches.length > 0 && gw.matches.every((m) => m.status === 'COMPLETED'),
          ).length
          const nextGW = sortedWeeks.find(
            (gw) => gw.matches.length === 0 || !gw.matches.every((m) => m.status === 'COMPLETED'),
          )
          const subdomain = toSlug(league.name)

          return (
            <div
              key={league.id}
              className="bg-admin-surface border border-admin-border rounded-xl flex flex-col overflow-hidden hover:border-admin-border2 transition-colors"
            >
              {/* Card header */}
              <div className="p-5 pb-4">
                <div className="font-condensed font-extrabold text-admin-text text-[22px] leading-tight mb-1">
                  {league.name}
                </div>
                <div className="font-mono text-admin-green text-xs">
                  {subdomain}.t9l.me
                </div>
              </div>

              <div className="h-px bg-admin-border mx-5" />

              {/* Next matchday */}
              <div className="p-5 flex-1">
                <p className="text-admin-text3 text-xs uppercase tracking-wider mb-2">Next Matchday</p>
                {nextGW ? (
                  <>
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="font-condensed font-bold text-[26px] text-admin-text leading-none">
                        MD{nextGW.weekNumber}
                      </span>
                      <span className="text-admin-text2 text-sm font-mono">
                        {formatDate(nextGW.startDate)}
                      </span>
                    </div>
                    <p className="text-admin-text3 text-xs">
                      {nextGW.venue?.name ?? 'Venue TBD'} · {nextGW.matches.length} match{nextGW.matches.length !== 1 ? 'es' : ''}
                    </p>
                  </>
                ) : (
                  <p className="text-admin-text3 text-sm">All matchdays complete</p>
                )}
              </div>

              {/* Card footer */}
              <div className="px-5 py-3 border-t border-admin-border bg-admin-surface2 flex items-center justify-between">
                <span className="text-admin-text3 text-xs font-mono">
                  MD{completedCount} completed
                </span>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/admin/leagues/${league.id}/schedule`}
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-admin-green text-admin-bg text-xs font-medium rounded no-underline hover:opacity-90 transition-opacity"
                  >
                    Configure
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
