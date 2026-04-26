import { getLeagueFromHost } from '@/lib/getLeagueFromHost'
import { getPublicLeagueData } from '@/lib/admin-data'
import { dbToDashboard } from '@/lib/dbToDashboard'
import { findNextMatchday } from '@/lib/stats'
import Dashboard from '@/components/Dashboard'

export const revalidate = 60

export default async function Home() {
  // One template for every tenant. The host header resolves to a League row
  // (subdomain match, or apex → isDefault); the league's relational data is
  // adapted into Dashboard's props shape so apex and subdomain renders use
  // exactly the same component tree, only the underlying data differs.
  const leagueMeta = await getLeagueFromHost()

  if (!leagueMeta) {
    return (
      <div className="flex items-center justify-center min-h-dvh bg-background text-fg-high px-6 text-center">
        <div>
          <p className="font-display text-3xl font-black uppercase">No league configured</p>
          <p className="text-sm text-fg-low mt-2 uppercase tracking-widest">Contact the administrator</p>
        </div>
      </div>
    )
  }

  const league = await getPublicLeagueData(leagueMeta.id)

  if (!league) {
    return (
      <div className="flex items-center justify-center min-h-dvh bg-background text-fg-high px-6 text-center">
        <div>
          <p className="font-display text-3xl font-black uppercase">Data unavailable</p>
          <p className="text-sm text-fg-low mt-2 uppercase tracking-widest">Try again in a moment</p>
        </div>
      </div>
    )
  }

  const data = dbToDashboard(league)
  const nextMd = findNextMatchday(data.matchdays)

  return (
    <Dashboard
      teams={data.teams}
      players={data.players}
      matchdays={data.matchdays}
      goals={data.goals}
      availability={data.availability}
      availabilityStatuses={data.availabilityStatuses}
      played={data.played}
      nextMd={nextMd}
    />
  )
}
