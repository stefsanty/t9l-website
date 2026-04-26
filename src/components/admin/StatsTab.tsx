'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────────────────

interface GoalRow {
  id: string
  playerId: string
  scoringTeamId: string
  isOwnGoal: boolean
  matchId: string
  player: { id: string; name: string }
  scoringTeam: { id: string; team: { name: string } }
  match: { gameWeek: { weekNumber: number } }
  assist: { player: { id: string; name: string } } | null
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

interface StatsTabProps {
  leagueId: string
  goals: GoalRow[]
  matches: MatchRow[]
  leagueTeams: LeagueTeamRef[]
  gameWeekCount: number
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildScorerStats(goals: GoalRow[], matchdayFilter: number | null) {
  const filtered = matchdayFilter
    ? goals.filter((g) => g.match.gameWeek.weekNumber === matchdayFilter)
    : goals

  const map = new Map<string, { name: string; team: string; goals: number; assists: number }>()

  for (const g of filtered) {
    if (g.isOwnGoal) continue
    const key = g.player.id
    if (!map.has(key)) map.set(key, { name: g.player.name, team: g.scoringTeam.team.name, goals: 0, assists: 0 })
    map.get(key)!.goals++
    if (g.assist) {
      const aKey = g.assist.player.id
      if (!map.has(aKey)) map.set(aKey, { name: g.assist.player.name, team: '', goals: 0, assists: 0 })
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

// ── Component ────────────────────────────────────────────────────────────────

export default function StatsTab({ leagueId, goals, matches, leagueTeams, gameWeekCount }: StatsTabProps) {
  const searchParams = useSearchParams()
  const matchdayParam = searchParams.get('matchday')
  const matchdayFilter = matchdayParam ? parseInt(matchdayParam, 10) : null

  const scorers = useMemo(() => buildScorerStats(goals, matchdayFilter), [goals, matchdayFilter])
  const table   = useMemo(() => buildLeagueTable(leagueTeams, matches, matchdayFilter), [leagueTeams, matches, matchdayFilter])

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

      {/* Top Scorers */}
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
