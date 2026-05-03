import { getLeagueStats, getLeagueEvents } from '@/lib/admin-data'
import StatsTab from '@/components/admin/StatsTab'

type Props = { params: Promise<{ id: string }> }

export default async function StatsPage({ params }: Props) {
  const { id } = await params
  const [
    [goals, matches, leagueTeams, gameWeeks],
    [events, eventMatches, eventLeagueTeams, gameWeekCount],
  ] = await Promise.all([getLeagueStats(id), getLeagueEvents(id)])

  // gameWeekCount from getLeagueStats is just the highest week number (used
  // by the legacy filter), but getLeagueEvents already returns the same.
  const _legacyGameWeekCount = gameWeeks[0]?.weekNumber ?? 0

  // Reshape to the StatsTab props. Static data feeds the leaderboard +
  // table (still derived from `Goal` rows pre-PR-δ); dynamic data is the
  // event list + match list + roster the editor needs.
  return (
    <StatsTab
      leagueId={id}
      goals={goals}
      matches={matches}
      leagueTeams={leagueTeams}
      gameWeekCount={Math.max(_legacyGameWeekCount, gameWeekCount)}
      events={events}
      eventMatches={eventMatches}
      eventLeagueTeams={eventLeagueTeams}
    />
  )
}
