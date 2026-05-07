/**
 * v1.74.0 — `/admin/teams-all` route. Replaces the legacy "All Teams"
 * nav link that previously 404'd because the route was never built.
 *
 * Server component: fetches every Team across leagues + the league
 * picker list, hands both to the AllTeamsList client component.
 */
import { getAllTeamsForAdmin, getAllLeaguesForPicker } from '@/lib/admin-data'
import AllTeamsList from '@/components/admin/AllTeamsList'

export default async function TeamsAllPage() {
  const [teams, leagues] = await Promise.all([
    getAllTeamsForAdmin(),
    getAllLeaguesForPicker(),
  ])
  return <AllTeamsList teams={teams} leagues={leagues} />
}
