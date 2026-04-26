import { notFound } from 'next/navigation'
import { getLeagueSchedule, getAllVenues } from '@/lib/admin-data'
import ScheduleTab from '@/components/admin/ScheduleTab'

type Props = { params: Promise<{ id: string }> }

export default async function SchedulePage({ params }: Props) {
  const { id } = await params

  const [league, venues] = await Promise.all([
    getLeagueSchedule(id),
    getAllVenues(),
  ])

  if (!league) notFound()

  return (
    <ScheduleTab
      leagueId={id}
      gameWeeks={league.gameWeeks}
      leagueTeams={league.leagueTeams}
      venues={venues}
    />
  )
}
