import { notFound } from 'next/navigation'
import Link from 'next/link'
import Header from '@/components/Header'
import { getPublicLeagueData } from '@/lib/publicData'
import { getLeagueIdFromRequest } from '@/lib/getLeagueFromHost'
import { formatJstFriendly } from '@/lib/jst'
import type { Goal, Matchday, Team } from '@/types'

export const metadata = {
  title: 'Matchday | T9L',
}

type Props = { params: Promise<{ id: string }> }

/**
 * v1.45.0 (epic match events PR ε) — per-matchday public page.
 *
 * Subdomain-aware via `getLeagueIdFromRequest()`. The `[id]` segment
 * matches the public matchday id (`md1`, `md4`, etc.) — same shape
 * `dbToPublicLeagueData` produces. 404 when the matchday isn't in the
 * resolved league.
 *
 * Page shape:
 *   - header with matchday label + JST date + venue link
 *   - per-match section ordered by kickoff
 *     * scoreline (cache integers OR scoreOverride driven)
 *     * timeline of MatchEvent rows (`47' Stefan ⚽️ Alex 🅰️` etc.)
 *   - sitting-out badge
 */
export default async function MatchdayPage({ params }: Props) {
  const { id } = await params
  const leagueId = await getLeagueIdFromRequest()
  const data = await getPublicLeagueData(leagueId ?? undefined)
  const md = data.matchdays.find((m) => m.id === id)
  if (!md) notFound()

  const teamMap = new Map(data.teams.map((t) => [t.id, t]))
  const sittingOutTeam = md.sittingOutTeamId ? teamMap.get(md.sittingOutTeamId) ?? null : null

  return (
    <div className="flex flex-col min-h-dvh bg-background">
      <Header />
      <main className="flex-1 max-w-lg mx-auto px-4 pt-12 pb-12 w-full">
        <div className="flex items-center justify-between mb-6">
          <Link
            href="/schedule"
            className="text-[11px] font-black uppercase tracking-widest text-fg-mid hover:text-fg-high transition-colors px-3 py-1.5 rounded-lg border border-border-subtle hover:border-border-default"
            data-testid="matchday-back"
          >
            ← Schedule
          </Link>
        </div>

        <header className="mb-6">
          <h1
            className="font-display text-5xl font-black uppercase tracking-tighter text-fg-high"
            data-testid="matchday-label"
          >
            {md.label}
          </h1>
          <p className="text-fg-mid text-sm font-bold uppercase tracking-widest mt-2" data-testid="matchday-date">
            {md.date ? formatJstFriendly(new Date(`${md.date}T00:00:00+09:00`), 'en') : 'TBD'}
          </p>
          {md.venueName ? (
            md.venueUrl ? (
              <a
                href={md.venueUrl}
                target="_blank"
                rel="noreferrer"
                className="text-fg-low text-xs underline mt-1 inline-block"
                data-testid="matchday-venue"
              >
                {md.venueName}
              </a>
            ) : (
              <p className="text-fg-low text-xs mt-1" data-testid="matchday-venue">
                {md.venueName}
              </p>
            )
          ) : null}
        </header>

        <div className="space-y-6" data-testid="matchday-matches">
          {md.matches.map((match) => (
            <MatchSection
              key={match.id}
              match={match}
              matchday={md}
              goals={data.goals}
              teamMap={teamMap}
            />
          ))}
        </div>

        {sittingOutTeam ? (
          <p
            className="text-fg-low text-xs uppercase tracking-widest mt-8"
            data-testid="matchday-sitting-out"
          >
            Sitting out: {sittingOutTeam.name}
          </p>
        ) : null}
      </main>
    </div>
  )
}

function MatchSection({
  match,
  matchday,
  goals,
  teamMap,
}: {
  match: Matchday['matches'][number]
  matchday: Matchday
  goals: Goal[]
  teamMap: Map<string, Team>
}) {
  const home = teamMap.get(match.homeTeamId)
  const away = teamMap.get(match.awayTeamId)
  const matchEvents = goals.filter((g) => g.matchId === match.id)
  void matchday // reserved for future use (matchday-scoped narrative)
  const isPlayed = match.homeGoals !== null && match.awayGoals !== null

  return (
    <section
      className="rounded-lg border border-border-subtle p-4 bg-bg-elevated"
      data-testid={`match-section-${match.id}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <TeamPill team={home} />
        </div>
        <div className="text-center font-mono text-fg-high font-bold tabular-nums" data-testid={`match-score-${match.id}`}>
          {isPlayed ? `${match.homeGoals} – ${match.awayGoals}` : 'vs'}
        </div>
        <div className="flex items-center gap-2 min-w-0 justify-end">
          <TeamPill team={away} align="right" />
        </div>
      </div>
      <p className="text-fg-low text-[11px] uppercase tracking-widest mt-1 text-center">
        Kickoff {match.kickoff || 'TBD'}
        {match.fullTime ? ` · FT ${match.fullTime}` : ''}
      </p>

      {matchEvents.length > 0 ? (
        <ol
          className="mt-4 space-y-1.5 text-sm border-t border-border-subtle pt-3"
          data-testid={`match-timeline-${match.id}`}
        >
          {matchEvents.map((g) => (
            <EventRow key={g.id} goal={g} home={home} />
          ))}
        </ol>
      ) : (
        <p className="text-fg-low text-xs italic mt-3">No events recorded.</p>
      )}
    </section>
  )
}

function TeamPill({ team, align = 'left' }: { team: Team | undefined; align?: 'left' | 'right' }) {
  if (!team) return null
  return (
    <div className={align === 'right' ? 'text-right' : ''}>
      <p className="text-fg-high text-sm font-bold truncate" translate="no">
        {team.shortName || team.name}
      </p>
      <p className="text-fg-low text-[10px] uppercase tracking-widest truncate">{team.name}</p>
    </div>
  )
}

function EventRow({ goal, home }: { goal: Goal; home: Team | undefined }) {
  const isHomeSide = home && goal.scoringTeamId === home.id
  const minuteTag = typeof goal.minute === 'number' ? `${goal.minute}'` : '—'
  const typeLabel = goalTypeLabel(goal.goalType)
  return (
    <li
      className={`flex items-center gap-2 ${isHomeSide ? '' : 'flex-row-reverse text-right'}`}
      data-testid={`event-${goal.id}`}
    >
      <span className="text-fg-low font-mono text-xs w-8 shrink-0 text-center">{minuteTag}</span>
      <span className="shrink-0">⚽️</span>
      <div className="flex-1 min-w-0">
        <p className="text-fg-high font-semibold truncate" translate="no">
          {goal.scorer}
          {typeLabel ? <span className="text-fg-low font-normal"> ({typeLabel})</span> : null}
        </p>
        {goal.assister ? (
          <p className="text-fg-low text-xs truncate" translate="no">
            🅰️ {goal.assister}
          </p>
        ) : null}
      </div>
    </li>
  )
}

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
