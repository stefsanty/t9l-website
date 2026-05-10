import { getLeagueStats, getLeagueEvents } from '@/lib/admin-data'
import StatsTab from '@/components/admin/StatsTab'

type Props = { params: Promise<{ id: string }> }

export default async function StatsPage({ params }: Props) {
  const { id } = await params
  const [
    [matches, leagueTeams, gameWeeks],
    [events, eventMatches, eventLeagueTeams, gameWeekCount],
  ] = await Promise.all([getLeagueStats(id), getLeagueEvents(id)])

  // v1.89.0 — both fetches surface the gameweek max; keep the larger of the
  // two in case one side is briefly stale across a cache window.
  const legacyGameWeekCount = gameWeeks[0]?.weekNumber ?? 0

  return (
    <StatsTab
      leagueId={id}
      matches={matches}
      leagueTeams={leagueTeams}
      gameWeekCount={Math.max(legacyGameWeekCount, gameWeekCount)}
      events={events}
      eventMatches={eventMatches}
      eventLeagueTeams={eventLeagueTeams}
    />
  )
}
