import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { getAllLeagues } from '@/lib/admin-data'
import NewLeagueButton from '@/components/admin/NewLeagueButton'

// `unstable_cache` round-trips Date objects through JSON, so cached values come
// back as ISO strings. Coerce to Date before formatting.
function formatShortDate(d: Date | string) {
  return new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

function toSlug(name: string) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export default async function AdminDashboard() {
  const leagues = await getAllLeagues()
  const now = Date.now()
  const activeCount = leagues.filter(
    (l) => !(l.endDate && new Date(l.endDate).getTime() < now),
  ).length

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-7 flex items-center justify-between">
        <h1 className="font-condensed font-bold text-[11px] uppercase tracking-[3px] text-admin-text3">
          Active Leagues ({activeCount})
        </h1>
        <NewLeagueButton />
      </div>

      {/* Empty state */}
      {leagues.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-24 text-admin-text3">
          <p className="font-condensed text-base font-semibold text-admin-text2">No leagues yet</p>
          <p className="text-sm">Create your first league to get started.</p>
        </div>
      )}

      {/* Card grid */}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {leagues.map((league) => {
          const completedCount = league.gameWeeks.filter(
            (gw) => gw.matches.length > 0 && gw.matches.every((m) => m.status === 'COMPLETED'),
          ).length

          const nextGW = league.gameWeeks.find(
            (gw) => gw.matches.length === 0 || !gw.matches.every((m) => m.status === 'COMPLETED'),
          )

          const isEnded = league.endDate ? new Date(league.endDate).getTime() < now : !nextGW
          const subdomain = league.subdomain ?? toSlug(league.name)
          const venueName = nextGW?.venue?.name ?? null

          return (
            <Link
              key={league.id}
              href={`/admin/leagues/${league.id}/schedule`}
              className="group flex flex-col gap-4 rounded-lg border border-admin-border bg-admin-surface p-5 no-underline transition-colors hover:border-admin-border2"
            >
              {/* Name + subdomain */}
              <div>
                <h2 className="font-condensed font-bold text-[22px] leading-none tracking-[0.5px] text-admin-text">
                  {league.name}
                </h2>
                <p className="mt-1 font-mono text-xs text-admin-green">
                  {subdomain}.t9l.me ↗
                </p>
              </div>

              {/* Divider */}
              <div className="h-px bg-admin-border" />

              {/* Body */}
              {!isEnded && nextGW ? (
                <div>
                  <p className="font-condensed text-[11px] font-semibold uppercase tracking-[2px] text-admin-text3">
                    Next Matchday
                  </p>
                  <p className="font-condensed text-[26px] font-bold leading-tight text-admin-text">
                    MD{nextGW.weekNumber} · {formatShortDate(nextGW.startDate)}
                  </p>
                  <div className="mt-1.5 flex flex-col gap-0.5 text-xs text-admin-text2">
                    {venueName && <span>{venueName}</span>}
                    <span>{nextGW.matches.length} matches scheduled</span>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="font-condensed text-[11px] font-semibold uppercase tracking-[2px] text-admin-text3">
                    Season Status
                  </p>
                  <p className="mt-1 text-[13px] text-admin-text3">
                    Season ended · Final MD{completedCount} complete
                  </p>
                </div>
              )}

              {/* Footer */}
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] text-admin-text3">
                  MD{completedCount} completed
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-[6px] border border-admin-border px-2.5 py-1 text-xs text-admin-text2 transition-colors group-hover:border-admin-border2 group-hover:text-admin-text">
                  {isEnded ? 'View' : 'Configure'}
                  <ArrowRight className="w-3 h-3" />
                </span>
              </div>

            </Link>
          )
        })}
      </div>
    </div>
  )
}
