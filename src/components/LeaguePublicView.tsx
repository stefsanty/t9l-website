'use client'

import { useMemo, useState } from 'react'

// ── Types inferred from Prisma include shape ──────────────────────────────────
type TeamRow   = { id: string; name: string; logoUrl: string | null }
type PlayerRow = { id: string; name: string }

type GoalRow = {
  id: string
  scoringTeam: { id: string }
}

type MatchRow = {
  id: string
  homeTeam: { id: string; team: TeamRow }
  awayTeam: { id: string; team: TeamRow }
  homeScore: number
  awayScore: number
  status: string
  playedAt: Date | string
  goals: GoalRow[]
}

type GameWeekRow = {
  id: string
  weekNumber: number
  startDate: Date | string
  matches: MatchRow[]
}

type LeagueTeamRow = {
  id: string
  team: TeamRow
  playerAssignments: Array<{ player: PlayerRow; fromGameWeek: number; toGameWeek: number | null }>
}

type LeagueData = {
  id: string
  name: string
  location: string
  startDate: Date | string
  endDate: Date | string | null
  leagueTeams: LeagueTeamRow[]
  gameWeeks: GameWeekRow[]
}

// ── Standings calculation ─────────────────────────────────────────────────────
type StandingRow = {
  ltId: string
  name: string
  p: number; w: number; d: number; l: number
  gf: number; ga: number; gd: number; pts: number
}

function computeStandings(league: LeagueData): StandingRow[] {
  const map = new Map<string, StandingRow>()
  for (const lt of league.leagueTeams) {
    map.set(lt.id, { ltId: lt.id, name: lt.team.name, p:0,w:0,d:0,l:0,gf:0,ga:0,gd:0,pts:0 })
  }

  for (const gw of league.gameWeeks) {
    for (const m of gw.matches) {
      if (m.status !== 'COMPLETED') continue
      const home = map.get(m.homeTeam.id)
      const away = map.get(m.awayTeam.id)
      if (!home || !away) continue

      home.p++; away.p++
      home.gf += m.homeScore; home.ga += m.awayScore
      away.gf += m.awayScore; away.ga += m.homeScore

      if (m.homeScore > m.awayScore)      { home.w++; home.pts+=3; away.l++ }
      else if (m.homeScore < m.awayScore) { away.w++; away.pts+=3; home.l++ }
      else                                { home.d++; home.pts++; away.d++; away.pts++ }

      home.gd = home.gf - home.ga
      away.gd = away.gf - away.ga
    }
  }

  return [...map.values()].sort((a,b) =>
    b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.name.localeCompare(b.name)
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(d: Date | string, opts?: Intl.DateTimeFormatOptions) {
  // All public-site date renders go through `Asia/Tokyo` — see lib/jst.ts and
  // CLAUDE.md "Time handling".
  return new Intl.DateTimeFormat(
    'en-GB',
    { ...(opts ?? { day:'numeric', month:'short', year:'numeric' }), timeZone:'Asia/Tokyo' },
  ).format(new Date(d))
}

function fmtTime(d: Date | string) {
  return new Intl.DateTimeFormat('en-GB', { hour:'2-digit', minute:'2-digit', hour12:false, timeZone:'Asia/Tokyo' }).format(new Date(d))
}

function statusBadge(status: string) {
  if (status === 'COMPLETED')  return <span className="text-xs font-bold uppercase text-emerald-400">FT</span>
  if (status === 'IN_PROGRESS') return <span className="text-xs font-bold uppercase text-amber-400">LIVE</span>
  return null
}

// ── Sub-components ────────────────────────────────────────────────────────────
function ScheduleTab({ gameWeeks }: { gameWeeks: GameWeekRow[] }) {
  return (
    <div className="space-y-6">
      {gameWeeks.map(gw => (
        <div key={gw.id}>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs font-bold uppercase tracking-widest text-white/40">GW{gw.weekNumber}</span>
            <span className="text-xs text-white/30">{fmt(gw.startDate)}</span>
          </div>

          <div className="space-y-2">
            {gw.matches.map(m => (
              <div key={m.id} className="flex items-center gap-2 bg-white/5 rounded-xl px-4 py-3">
                <span className="flex-1 text-sm font-semibold text-right truncate">{m.homeTeam.team.name}</span>

                <div className="flex items-center gap-1.5 min-w-[5rem] justify-center">
                  {m.status === 'COMPLETED' ? (
                    <>
                      <span className="text-base font-black tabular-nums">{m.homeScore}</span>
                      <span className="text-white/30">–</span>
                      <span className="text-base font-black tabular-nums">{m.awayScore}</span>
                    </>
                  ) : (
                    <span className="text-xs text-white/40">{fmtTime(m.playedAt)}</span>
                  )}
                </div>

                <span className="flex-1 text-sm font-semibold truncate">{m.awayTeam.team.name}</span>
                <div className="w-8 flex justify-end">{statusBadge(m.status)}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function StandingsTab({ standings }: { standings: StandingRow[] }) {
  if (standings.every(s => s.p === 0)) {
    return (
      <div className="text-center py-16 text-white/40">
        <p className="text-sm uppercase tracking-widest">No matches played yet</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-white/40 text-xs uppercase tracking-widest border-b border-white/10">
            <th className="text-left pb-2 pr-2">#</th>
            <th className="text-left pb-2">Team</th>
            <th className="text-center pb-2 px-1">P</th>
            <th className="text-center pb-2 px-1">W</th>
            <th className="text-center pb-2 px-1">D</th>
            <th className="text-center pb-2 px-1">L</th>
            <th className="text-center pb-2 px-1">GD</th>
            <th className="text-center pb-2 pl-1 font-black text-white/60">Pts</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((row, i) => (
            <tr key={row.ltId} className="border-b border-white/5 last:border-0">
              <td className="py-2.5 pr-2 text-white/40">{i + 1}</td>
              <td className="py-2.5 font-semibold">{row.name}</td>
              <td className="py-2.5 text-center text-white/60 px-1 tabular-nums">{row.p}</td>
              <td className="py-2.5 text-center text-white/60 px-1 tabular-nums">{row.w}</td>
              <td className="py-2.5 text-center text-white/60 px-1 tabular-nums">{row.d}</td>
              <td className="py-2.5 text-center text-white/60 px-1 tabular-nums">{row.l}</td>
              <td className="py-2.5 text-center text-white/60 px-1 tabular-nums">{row.gd > 0 ? `+${row.gd}` : row.gd}</td>
              <td className="py-2.5 text-center font-black pl-1 tabular-nums">{row.pts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TeamsTab({ leagueTeams }: { leagueTeams: LeagueTeamRow[] }) {
  return (
    <div className="space-y-6">
      {leagueTeams.map(lt => (
        <div key={lt.id}>
          <h3 className="font-bold text-base mb-2">{lt.team.name}</h3>
          {lt.playerAssignments.length === 0 ? (
            <p className="text-sm text-white/40">No players assigned</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {lt.playerAssignments.map(pa => (
                <span key={pa.player.id} className="text-xs bg-white/10 rounded-full px-3 py-1">
                  {pa.player.name}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
type Tab = 'schedule' | 'standings' | 'teams'

export default function LeaguePublicView({ league }: { league: LeagueData }) {
  const [tab, setTab] = useState<Tab>('schedule')
  const standings = useMemo(() => computeStandings(league), [league])

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'schedule',  label: 'Schedule'  },
    { id: 'standings', label: 'Standings' },
    { id: 'teams',     label: 'Teams'     },
  ]

  return (
    <div className="min-h-dvh bg-midnight text-white">
      {/* Header */}
      <div className="px-4 pt-8 pb-6 border-b border-white/10">
        <p className="text-xs font-bold uppercase tracking-widest text-white/40 mb-1">{league.location}</p>
        <h1 className="font-display text-2xl font-black uppercase">{league.name}</h1>
        <p className="text-xs text-white/40 mt-1">
          From {fmt(league.startDate)}
          {league.endDate ? ` · Until ${fmt(league.endDate)}` : ''}
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-white/10 px-4">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={[
              'py-3 px-4 text-sm font-semibold uppercase tracking-widest border-b-2 -mb-px transition-colors',
              tab === t.id
                ? 'border-white text-white'
                : 'border-transparent text-white/40 hover:text-white/60',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="px-4 py-6 max-w-2xl mx-auto">
        {tab === 'schedule'  && <ScheduleTab  gameWeeks={league.gameWeeks} />}
        {tab === 'standings' && <StandingsTab standings={standings} />}
        {tab === 'teams'     && <TeamsTab     leagueTeams={league.leagueTeams} />}
      </div>
    </div>
  )
}
