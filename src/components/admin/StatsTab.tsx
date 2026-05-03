'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  adminCreateMatchEvent,
  adminUpdateMatchEvent,
  adminDeleteMatchEvent,
} from '@/app/admin/leagues/actions'

// ── Types ────────────────────────────────────────────────────────────────────

type GoalType = 'OPEN_PLAY' | 'SET_PIECE' | 'PENALTY' | 'OWN_GOAL'

interface GoalRow {
  id: string
  playerId: string
  scoringTeamId: string
  isOwnGoal: boolean
  matchId: string
  player: { id: string; name: string | null }
  scoringTeam: { id: string; team: { name: string } }
  match: { gameWeek: { weekNumber: number } }
  assist: { player: { id: string; name: string | null } } | null
}

function maybeName(name: string | null): string {
  return name ?? 'Unnamed'
}

interface MatchRow {
  id: string
  homeScore: number
  awayScore: number
  status: string
  homeTeamId: string
  awayTeamId: string
  gameWeek: { weekNumber: number }
}

interface LeagueTeamRef {
  id: string
  team: { name: string }
}

// New event-typed inputs (PR γ)
interface EventRow {
  id: string
  matchId: string
  goalType: GoalType | null
  minute: number | null
  scorer: { id: string; name: string | null }
  assister: { id: string; name: string | null } | null
  match: {
    id: string
    homeTeamId: string
    awayTeamId: string
    homeTeam: { team: { name: string } }
    awayTeam: { team: { name: string } }
    gameWeek: { weekNumber: number }
  }
}

interface EventMatch {
  id: string
  homeTeamId: string
  awayTeamId: string
  homeTeam: { team: { name: string } }
  awayTeam: { team: { name: string } }
  gameWeek: { weekNumber: number }
}

interface EventLeagueTeam {
  id: string
  team: { name: string }
  playerAssignments: Array<{
    leagueTeamId: string
    player: { id: string; name: string | null }
  }>
}

interface StatsTabProps {
  leagueId: string
  goals: GoalRow[]
  matches: MatchRow[]
  leagueTeams: LeagueTeamRef[]
  gameWeekCount: number
  events: EventRow[]
  eventMatches: EventMatch[]
  eventLeagueTeams: EventLeagueTeam[]
}

// ── Helpers (legacy leaderboard / table — read from `Goal`/`Assist` for now) ────

function buildScorerStats(goals: GoalRow[], matchdayFilter: number | null) {
  const filtered = matchdayFilter
    ? goals.filter((g) => g.match.gameWeek.weekNumber === matchdayFilter)
    : goals

  const map = new Map<string, { name: string; team: string; goals: number; assists: number }>()

  for (const g of filtered) {
    if (g.isOwnGoal) continue
    const key = g.player.id
    if (!map.has(key)) map.set(key, { name: maybeName(g.player.name), team: g.scoringTeam.team.name, goals: 0, assists: 0 })
    map.get(key)!.goals++
    if (g.assist) {
      const aKey = g.assist.player.id
      if (!map.has(aKey)) map.set(aKey, { name: maybeName(g.assist.player.name), team: '', goals: 0, assists: 0 })
      map.get(aKey)!.assists++
    }
  }

  return Array.from(map.values()).sort((a, b) => b.goals - a.goals || b.assists - a.assists)
}

function buildLeagueTable(
  leagueTeams: LeagueTeamRef[],
  matches: MatchRow[],
  matchdayFilter: number | null,
) {
  const filtered = matchdayFilter
    ? matches.filter((m) => m.gameWeek.weekNumber === matchdayFilter && m.status === 'COMPLETED')
    : matches.filter((m) => m.status === 'COMPLETED')

  const table = new Map<string, { name: string; P: number; W: number; D: number; L: number; GF: number; GA: number }>()

  for (const lt of leagueTeams) {
    table.set(lt.id, { name: lt.team.name, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0 })
  }

  for (const m of filtered) {
    const home = table.get(m.homeTeamId)
    const away = table.get(m.awayTeamId)
    if (!home || !away) continue
    home.P++; away.P++
    home.GF += m.homeScore; home.GA += m.awayScore
    away.GF += m.awayScore; away.GA += m.homeScore
    if (m.homeScore > m.awayScore) { home.W++; away.L++ }
    else if (m.homeScore === m.awayScore) { home.D++; away.D++ }
    else { home.L++; away.W++ }
  }

  return Array.from(table.values())
    .map((row) => ({ ...row, GD: row.GF - row.GA, Pts: row.W * 3 + row.D }))
    .sort((a, b) => b.Pts - a.Pts || b.GD - a.GD || b.GF - a.GF)
}

const GOAL_TYPE_LABELS: Record<GoalType, { short: string; full: string; tone: string }> = {
  OPEN_PLAY: { short: 'OP', full: 'Open play', tone: 'bg-admin-green-dim text-admin-green' },
  SET_PIECE: { short: 'SP', full: 'Set piece', tone: 'bg-admin-blue-dim text-admin-blue' },
  PENALTY: { short: 'PEN', full: 'Penalty', tone: 'bg-admin-amber-dim text-admin-amber' },
  OWN_GOAL: { short: 'OG', full: 'Own goal', tone: 'bg-admin-red-dim text-admin-red' },
}

// Pure: filter events by an optional matchday + free-text search.
export function filterEvents(
  events: EventRow[],
  matchdayFilter: number | null,
  search: string,
): EventRow[] {
  const q = search.trim().toLowerCase()
  return events.filter((ev) => {
    if (matchdayFilter && ev.match.gameWeek.weekNumber !== matchdayFilter) return false
    if (!q) return true
    return (
      (ev.scorer.name?.toLowerCase().includes(q) ?? false) ||
      (ev.assister?.name?.toLowerCase().includes(q) ?? false) ||
      ev.match.homeTeam.team.name.toLowerCase().includes(q) ||
      ev.match.awayTeam.team.name.toLowerCase().includes(q)
    )
  })
}

// Pure: pick the roster (sorted) for a given LeagueTeam id.
export function rosterFor(leagueTeams: EventLeagueTeam[], leagueTeamId: string) {
  const lt = leagueTeams.find((l) => l.id === leagueTeamId)
  if (!lt) return [] as Array<{ id: string; name: string }>
  return lt.playerAssignments
    .filter((a) => a.player.name)
    .map((a) => ({ id: a.player.id, name: a.player.name as string }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// ── Component ────────────────────────────────────────────────────────────────

export default function StatsTab({
  leagueId,
  goals,
  matches,
  leagueTeams,
  gameWeekCount,
  events,
  eventMatches,
  eventLeagueTeams,
}: StatsTabProps) {
  const searchParams = useSearchParams()
  const matchdayParam = searchParams.get('matchday')
  const matchdayFilter = matchdayParam ? parseInt(matchdayParam, 10) : null

  const [search, setSearch] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const scorers = useMemo(() => buildScorerStats(goals, matchdayFilter), [goals, matchdayFilter])
  const table = useMemo(() => buildLeagueTable(leagueTeams, matches, matchdayFilter), [leagueTeams, matches, matchdayFilter])
  const filteredEvents = useMemo(() => filterEvents(events, matchdayFilter, search), [events, matchdayFilter, search])
  const editingEvent = editingId ? events.find((e) => e.id === editingId) ?? null : null

  const gameWeeks = Array.from({ length: gameWeekCount }, (_, i) => i + 1)

  return (
    <div className="space-y-8">
      {/* Filter toggle */}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/admin/leagues/${leagueId}/stats`}
          className={cn(
            'px-3 py-1.5 rounded-lg text-sm no-underline transition-colors',
            !matchdayFilter
              ? 'bg-admin-green-dim text-admin-green border border-admin-green/30'
              : 'text-admin-text2 border border-admin-border hover:border-admin-border2',
          )}
        >
          All Matchdays
        </Link>
        {gameWeeks.map((gw) => (
          <Link
            key={gw}
            href={`/admin/leagues/${leagueId}/stats?matchday=${gw}`}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm font-mono no-underline transition-colors',
              matchdayFilter === gw
                ? 'bg-admin-green-dim text-admin-green border border-admin-green/30'
                : 'text-admin-text2 border border-admin-border hover:border-admin-border2',
            )}
          >
            MD{gw}
          </Link>
        ))}
      </div>

      {/* Events list (PR γ — events-first surface) */}
      <section data-testid="events-section">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="font-condensed text-[13px] font-bold uppercase tracking-[2px] text-admin-text2">
            Events
          </h2>
          <div className="flex items-center gap-2">
            <input
              type="search"
              data-testid="events-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search player or team…"
              className="bg-admin-surface2 border border-admin-border rounded px-3 py-1.5 text-sm text-admin-text"
            />
            <button
              type="button"
              data-testid="event-new-button"
              onClick={() => {
                setEditingId(null)
                setEditorOpen(true)
              }}
              className="bg-admin-green text-white text-sm font-medium px-3 py-1.5 rounded"
            >
              + New event
            </button>
          </div>
        </div>

        <div className="bg-admin-surface rounded-lg border border-admin-border overflow-hidden">
          <div
            className="grid text-admin-text3 text-[11px] uppercase tracking-[1.5px] px-5 py-2.5 border-b border-admin-border bg-admin-surface2"
            style={{ gridTemplateColumns: '60px 60px 1fr 1fr 200px 80px' }}
          >
            <span>Min</span>
            <span>Type</span>
            <span>Scorer</span>
            <span>Assister</span>
            <span>Match</span>
            <span></span>
          </div>

          {filteredEvents.length === 0 && (
            <div className="text-admin-text3 text-sm text-center py-8" data-testid="events-empty">
              No events recorded yet.
            </div>
          )}

          {filteredEvents.map((ev) => (
            <EventRowDisplay
              key={ev.id}
              ev={ev}
              onEdit={() => {
                setEditingId(ev.id)
                setEditorOpen(true)
              }}
              leagueId={leagueId}
            />
          ))}
        </div>
      </section>

      {/* Editor (modal-style) */}
      {editorOpen && (
        <EventEditor
          leagueId={leagueId}
          existing={editingEvent}
          eventMatches={eventMatches}
          eventLeagueTeams={eventLeagueTeams}
          onClose={() => {
            setEditorOpen(false)
            setEditingId(null)
          }}
        />
      )}

      {/* Top Scorers (legacy — reads `Goal`/`Assist` until PR δ flips this too) */}
      <section>
        <h2 className="font-condensed text-[13px] font-bold uppercase tracking-[2px] text-admin-text2 mb-3">
          Top Scorers
        </h2>
        <div className="overflow-x-auto">
          <div className="min-w-[480px] bg-admin-surface rounded-lg border border-admin-border overflow-hidden">
            <div
              className="grid text-admin-text3 text-[11px] uppercase tracking-[1.5px] px-5 py-2.5 border-b border-admin-border bg-admin-surface2"
              style={{ gridTemplateColumns: '48px 1fr 160px 80px 80px 80px' }}
            >
              <span>Rank</span>
              <span>Player</span>
              <span>Team</span>
              <span className="text-center">Goals</span>
              <span className="text-center">Assists</span>
              <span className="text-center">G+A</span>
            </div>

            {scorers.length === 0 && (
              <div className="text-admin-text3 text-sm text-center py-8">No goals recorded yet.</div>
            )}

            {scorers.map((row, idx) => (
              <div
                key={row.name}
                className="grid items-center px-5 py-3 border-b border-admin-border last:border-b-0 hover:bg-admin-surface2/50 transition-colors text-sm"
                style={{ gridTemplateColumns: '48px 1fr 160px 80px 80px 80px' }}
              >
                <span className="text-admin-text3 font-mono text-xs">#{idx + 1}</span>
                <span className="text-admin-text font-semibold">{row.name}</span>
                <span className="text-admin-text2">{row.team || '—'}</span>
                <span className="text-center font-condensed font-bold text-admin-green text-[20px] leading-none">{row.goals}</span>
                <span className="text-center font-mono text-admin-text">{row.assists}</span>
                <span className="text-center font-mono font-bold text-admin-text">{row.goals + row.assists}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* League Table */}
      <section>
        <h2 className="font-condensed text-[13px] font-bold uppercase tracking-[2px] text-admin-text2 mb-3">
          League Table
        </h2>
        <div className="overflow-x-auto">
          <div className="min-w-[600px] bg-admin-surface rounded-lg border border-admin-border overflow-hidden">
            <div
              className="grid text-admin-text3 text-[11px] uppercase tracking-[1.5px] px-5 py-2.5 border-b border-admin-border bg-admin-surface2"
              style={{ gridTemplateColumns: '40px 1fr 60px 60px 60px 60px 60px 60px 80px 80px' }}
            >
              <span className="text-center">Pos</span>
              <span>Team</span>
              <span className="text-center">P</span>
              <span className="text-center">W</span>
              <span className="text-center">D</span>
              <span className="text-center">L</span>
              <span className="text-center">GF</span>
              <span className="text-center">GA</span>
              <span className="text-center">GD</span>
              <span className="text-center">Pts</span>
            </div>

            {table.map((row, idx) => (
              <div
                key={row.name}
                className="grid items-center px-5 py-3 border-b border-admin-border last:border-b-0 hover:bg-admin-surface2/50 transition-colors text-sm"
                style={{ gridTemplateColumns: '40px 1fr 60px 60px 60px 60px 60px 60px 80px 80px' }}
              >
                <span className="text-center text-admin-text3 font-mono text-xs">{idx + 1}</span>
                <span className="text-admin-text font-semibold">{row.name}</span>
                {(['P', 'W', 'D', 'L', 'GF', 'GA'] as const).map((col) => (
                  <span key={col} className="text-center font-mono text-admin-text">{row[col]}</span>
                ))}
                <span className={cn(
                  'text-center font-mono',
                  row.GD > 0 ? 'text-admin-green' : row.GD < 0 ? 'text-admin-red' : 'text-admin-text3',
                )}>
                  {row.GD > 0 ? `+${row.GD}` : row.GD}
                </span>
                <span className="text-center font-condensed font-bold text-admin-green text-[20px] leading-none">{row.Pts}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-admin-text3 text-xs mt-2">* Own goals are excluded from individual goal totals.</p>
      </section>
    </div>
  )
}

// ── Event row + editor sub-components ────────────────────────────────────────

function EventRowDisplay({
  ev,
  leagueId,
  onEdit,
}: {
  ev: EventRow
  leagueId: string
  onEdit: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const tone = ev.goalType ? GOAL_TYPE_LABELS[ev.goalType] : { short: '?', full: 'Unknown', tone: 'bg-admin-surface2 text-admin-text3' }
  const matchLabel = `MD${ev.match.gameWeek.weekNumber} · ${ev.match.homeTeam.team.name} vs ${ev.match.awayTeam.team.name}`

  return (
    <div
      className="grid items-center px-5 py-3 border-b border-admin-border last:border-b-0 hover:bg-admin-surface2/50 transition-colors text-sm"
      style={{ gridTemplateColumns: '60px 60px 1fr 1fr 200px 80px' }}
      data-testid={`event-row-${ev.id}`}
    >
      <span className="text-admin-text2 font-mono text-xs">{ev.minute != null ? `${ev.minute}'` : '—'}</span>
      <span
        className={cn('inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider', tone.tone)}
        title={tone.full}
      >
        {tone.short}
      </span>
      <span className="text-admin-text font-semibold truncate">{maybeName(ev.scorer.name)}</span>
      <span className="text-admin-text2 truncate">{ev.assister ? maybeName(ev.assister.name) : '—'}</span>
      <span className="text-admin-text3 text-xs truncate">{matchLabel}</span>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onEdit}
          data-testid={`event-edit-${ev.id}`}
          className="text-admin-text2 hover:text-admin-text text-xs"
        >
          Edit
        </button>
        <button
          type="button"
          data-testid={`event-delete-${ev.id}`}
          disabled={pending}
          onClick={() => {
            if (!window.confirm('Delete this event? Match score will recompute.')) return
            startTransition(async () => {
              await adminDeleteMatchEvent({ eventId: ev.id, leagueId })
              router.refresh()
            })
          }}
          className="text-admin-red hover:opacity-80 text-xs disabled:opacity-50"
        >
          Delete
        </button>
      </div>
    </div>
  )
}

function EventEditor({
  leagueId,
  existing,
  eventMatches,
  eventLeagueTeams,
  onClose,
}: {
  leagueId: string
  existing: EventRow | null
  eventMatches: EventMatch[]
  eventLeagueTeams: EventLeagueTeam[]
  onClose: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Initial state: when editing, pre-fill from `existing`. When creating,
  // pick the most recent match as a sane default.
  const initialMatchId = existing?.matchId ?? eventMatches[0]?.id ?? ''
  const [matchId, setMatchId] = useState(initialMatchId)

  const match = eventMatches.find((m) => m.id === matchId) ?? null

  // Beneficiary defaults: when editing, derive from existing event's
  // scorer/goalType. When creating, default to home team.
  function deriveBeneficiary(): string {
    if (!match) return ''
    if (existing) {
      // Look up scorer's team via the assignment lookup.
      const scorerLT = eventLeagueTeams.find((lt) =>
        lt.playerAssignments.some((a) => a.player.id === existing.scorer.id),
      )
      if (scorerLT) {
        if (existing.goalType === 'OWN_GOAL') {
          // OG benefits the OPPOSITE team.
          return scorerLT.id === match.homeTeamId ? match.awayTeamId : match.homeTeamId
        }
        return scorerLT.id
      }
    }
    return match.homeTeamId
  }

  const [beneficiaryTeamId, setBeneficiaryTeamId] = useState(() => deriveBeneficiary())
  const [goalType, setGoalType] = useState<GoalType>(existing?.goalType ?? 'OPEN_PLAY')
  const [scorerId, setScorerId] = useState(existing?.scorer.id ?? '')
  const [assisterId, setAssisterId] = useState(existing?.assister?.id ?? '')
  const [minute, setMinute] = useState<string>(existing?.minute != null ? String(existing.minute) : '')

  // Reset beneficiary + scorer when match changes (different team rosters apply).
  function onMatchChange(next: string) {
    setMatchId(next)
    const nextMatch = eventMatches.find((m) => m.id === next)
    if (nextMatch) {
      setBeneficiaryTeamId(nextMatch.homeTeamId)
      setScorerId('')
      setAssisterId('')
    }
  }

  if (!match) return null

  const opposingTeamId = beneficiaryTeamId === match.homeTeamId ? match.awayTeamId : match.homeTeamId
  // OG: scorer picker shows OPPOSING team's roster; non-OG: beneficiary roster.
  const scorerRosterTeamId = goalType === 'OWN_GOAL' ? opposingTeamId : beneficiaryTeamId
  const scorerRoster = rosterFor(eventLeagueTeams, scorerRosterTeamId)
  const assisterRoster = rosterFor(eventLeagueTeams, beneficiaryTeamId).filter((p) => p.id !== scorerId)

  function submit() {
    setError(null)
    const minuteValue = minute.trim() === '' ? null : parseInt(minute, 10)
    if (minuteValue !== null && (Number.isNaN(minuteValue) || minuteValue < 0 || minuteValue > 200)) {
      setError('Minute must be between 0 and 200, or empty.')
      return
    }
    if (!scorerId) {
      setError('Pick a scorer.')
      return
    }
    startTransition(async () => {
      try {
        if (existing) {
          await adminUpdateMatchEvent({
            eventId: existing.id,
            leagueId,
            goalType,
            beneficiaryTeamId,
            scorerId,
            assisterId: assisterId || null,
            minute: minuteValue,
          })
        } else {
          await adminCreateMatchEvent({
            matchId,
            leagueId,
            goalType,
            beneficiaryTeamId,
            scorerId,
            assisterId: assisterId || null,
            minute: minuteValue,
          })
        }
        router.refresh()
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Save failed')
      }
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      data-testid="event-editor"
    >
      <div
        className="bg-admin-surface border border-admin-border rounded-lg p-6 max-w-lg w-full mx-4 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-admin-text font-bold text-lg">{existing ? 'Edit event' : 'New event'}</h3>

        <label className="block">
          <span className="text-admin-text3 text-xs uppercase tracking-wider">Match</span>
          <select
            data-testid="event-editor-match"
            value={matchId}
            onChange={(e) => onMatchChange(e.target.value)}
            className="mt-1 w-full bg-admin-surface2 border border-admin-border rounded px-3 py-2 text-sm text-admin-text"
            disabled={!!existing}
          >
            {eventMatches.map((m) => (
              <option key={m.id} value={m.id}>
                MD{m.gameWeek.weekNumber} · {m.homeTeam.team.name} vs {m.awayTeam.team.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-admin-text3 text-xs uppercase tracking-wider">Beneficiary team (counts toward)</span>
          <select
            data-testid="event-editor-beneficiary"
            value={beneficiaryTeamId}
            onChange={(e) => {
              setBeneficiaryTeamId(e.target.value)
              setScorerId('')
              setAssisterId('')
            }}
            className="mt-1 w-full bg-admin-surface2 border border-admin-border rounded px-3 py-2 text-sm text-admin-text"
          >
            <option value={match.homeTeamId}>{match.homeTeam.team.name} (home)</option>
            <option value={match.awayTeamId}>{match.awayTeam.team.name} (away)</option>
          </select>
        </label>

        <label className="block">
          <span className="text-admin-text3 text-xs uppercase tracking-wider">Goal type</span>
          <select
            data-testid="event-editor-goaltype"
            value={goalType}
            onChange={(e) => {
              setGoalType(e.target.value as GoalType)
              setScorerId('')
            }}
            className="mt-1 w-full bg-admin-surface2 border border-admin-border rounded px-3 py-2 text-sm text-admin-text"
          >
            <option value="OPEN_PLAY">Open play</option>
            <option value="SET_PIECE">Set piece</option>
            <option value="PENALTY">Penalty</option>
            <option value="OWN_GOAL">Own goal (scored by opposing player)</option>
          </select>
        </label>

        <label className="block">
          <span className="text-admin-text3 text-xs uppercase tracking-wider">
            Scorer
            {goalType === 'OWN_GOAL' && (
              <span className="text-admin-amber ml-2 normal-case">— OG: pick from the OPPOSING team</span>
            )}
          </span>
          <select
            data-testid="event-editor-scorer"
            value={scorerId}
            onChange={(e) => setScorerId(e.target.value)}
            className="mt-1 w-full bg-admin-surface2 border border-admin-border rounded px-3 py-2 text-sm text-admin-text"
          >
            <option value="">— select —</option>
            {scorerRoster.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-admin-text3 text-xs uppercase tracking-wider">Assister (optional)</span>
          <select
            data-testid="event-editor-assister"
            value={assisterId}
            onChange={(e) => setAssisterId(e.target.value)}
            className="mt-1 w-full bg-admin-surface2 border border-admin-border rounded px-3 py-2 text-sm text-admin-text"
          >
            <option value="">— no assist —</option>
            {assisterRoster.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-admin-text3 text-xs uppercase tracking-wider">Minute (optional)</span>
          <input
            data-testid="event-editor-minute"
            type="number"
            min="0"
            max="200"
            value={minute}
            onChange={(e) => setMinute(e.target.value)}
            className="mt-1 w-full bg-admin-surface2 border border-admin-border rounded px-3 py-2 text-sm text-admin-text"
          />
        </label>

        {error && (
          <p data-testid="event-editor-error" className="text-admin-red text-sm">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-admin-text2 hover:text-admin-text text-sm px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="event-editor-submit"
            disabled={pending}
            onClick={submit}
            className="bg-admin-green text-white text-sm font-medium px-4 py-1.5 rounded disabled:opacity-50"
          >
            {pending ? 'Saving…' : existing ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
