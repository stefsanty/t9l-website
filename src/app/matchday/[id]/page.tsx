import { notFound } from 'next/navigation'
import { getPublicLeagueData } from '@/lib/publicData'
import { getLeagueIdFromRequest } from '@/lib/getLeagueFromHost'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { getServerSession } from 'next-auth'
import { selfReportGateOpen } from '@/lib/playerSelfReportGate'
import MatchdayPageView from './MatchdayPageView'
import type { Goal, Player } from '@/types'

export const metadata = {
  title: 'Matchday | T9L',
}

type Props = { params: Promise<{ id: string }> }

/**
 * v1.45.0 (PR ε) — per-matchday public route. Subdomain-aware via
 * `getLeagueIdFromRequest()`. The `[id]` segment matches the public matchday
 * id (`md1`, `md4`, etc. — same shape `dbToPublicLeagueData` produces).
 * 404s when the matchday isn't in the resolved league.
 *
 * v1.47.0 — page is now a thin server component that resolves the data
 * + the PR ζ self-report gate, and hands the whole bundle to
 * `MatchdayPageView` (client component) which renders the homepage-mirrored
 * layout (NextMatchdayBanner + UserTeamBadge + Submit-goal CTA + modal +
 * MatchdayAvailability + RsvpBar). The bespoke per-match scoreline +
 * timeline that lived here pre-v1.47.0 is gone — the homepage's
 * MatchdayCard already shows minute + scorer + assister + (OG) decoration
 * inside the banner. Per-event PEN/SP detail is preserved on MatchEvent
 * + admin Stats CRUD; surfacing it in a public-facing detail view can
 * land in a future PR if needed.
 */
export default async function MatchdayPage({ params }: Props) {
  const { id } = await params
  const leagueId = await getLeagueIdFromRequest()
  const data = await getPublicLeagueData(leagueId ?? undefined)
  const md = data.matchdays.find((m) => m.id === id)
  if (!md) notFound()

  // PR ζ — gate the Submit-goal CTA on session + linked player + the
  // matchday's earliest kickoff time. We need the actual playedAt instants
  // (not the JST "HH:MM" formatted strings on the public Match shape) so we
  // read them from the DB by gameWeek number.
  const session = await getServerSession(authOptions)
  const myPlayerSlug = session?.playerId ?? null
  const myPlayer: Player | null = myPlayerSlug
    ? data.players.find((p) => p.id === myPlayerSlug) ?? null
    : null

  const weekNumber = parseInt(md.id.replace('md', ''), 10)
  const dbGameWeek = await prisma.gameWeek.findFirst({
    where: { weekNumber, leagueId: leagueId ?? undefined },
    select: {
      matches: {
        select: { id: true, playedAt: true, homeTeamId: true, awayTeamId: true },
        orderBy: { playedAt: 'asc' },
      },
    },
  })
  const kickoffInstants = (dbGameWeek?.matches ?? []).map((m) => m.playedAt)

  const submitGateOpen = selfReportGateOpen({
    hasSession: !!session,
    hasLinkedPlayer: !!myPlayerSlug,
    matchKickoffs: kickoffInstants,
    now: new Date(),
  })

  // Build the participating-matches list for the form: only matches in
  // this matchday where the user's team plays. The form posts the public
  // matchPublicId (`md3-m2`) — already on `md.matches[idx].id`.
  const teamMap = new Map(data.teams.map((t) => [t.id, t]))
  const participatingMatches = myPlayer
    ? md.matches
        .filter(
          (m) =>
            m.homeTeamId === myPlayer.teamId || m.awayTeamId === myPlayer.teamId,
        )
        .map((m) => {
          const home = teamMap.get(m.homeTeamId)
          const away = teamMap.get(m.awayTeamId)
          return {
            id: m.id,
            homeTeamId: m.homeTeamId,
            awayTeamId: m.awayTeamId,
            homeTeamName: home?.name ?? m.homeTeamId,
            awayTeamName: away?.name ?? m.awayTeamId,
          }
        })
    : []

  // Teammates: same team, exclude self.
  const teammates: Player[] = myPlayer
    ? data.players.filter(
        (p) => p.teamId === myPlayer.teamId && p.id !== myPlayer.id,
      )
    : []

  return (
    <MatchdayPageView
      matchdayId={md.id}
      teams={data.teams}
      players={data.players}
      matchdays={data.matchdays}
      goals={data.goals}
      availability={data.availability}
      availabilityStatuses={data.availabilityStatuses}
      played={data.played}
      selfReportGateOpen={submitGateOpen}
      myPlayer={myPlayer}
      participatingMatches={participatingMatches}
      teammates={teammates}
    />
  )
}

/**
 * Pure helper retained for backward compat — used by tests + the homepage
 * MatchdayCard's per-goal decoration. Returns the short label for a goalType
 * enum value (or null when no decoration applies).
 */
export function goalTypeLabel(t: Goal['goalType']): string | null {
  switch (t) {
    case 'OPEN_PLAY':
      return null
    case 'SET_PIECE':
      return 'set piece'
    case 'PENALTY':
      return 'pen'
    case 'OWN_GOAL':
      return 'OG'
    default:
      return null
  }
}
