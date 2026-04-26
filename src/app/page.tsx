import { getLeagueFromHost } from '@/lib/getLeagueFromHost'
import { getPublicLeagueData } from '@/lib/admin-data'
import LeaguePublicView from '@/components/LeaguePublicView'

export const revalidate = 60

export default async function Home() {
  // Single resolution path: getLeagueFromHost() returns the matching League by
  // subdomain, falling back to the league flagged isDefault. No Sheets fallback —
  // the DB is the only source of truth now.
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

  return <LeaguePublicView league={league} />
}
