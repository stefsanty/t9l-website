'use client'

import { useState } from 'react'

// ── Types (shaped from Prisma include) ────────────────────────────────────────

interface TeamRef {
  id: string
  team: { id: string; name: string; logoUrl: string | null }
}

interface MatchRow {
  id: string
  homeTeam: TeamRef
  awayTeam: TeamRef
  homeScore: number
  awayScore: number
  status: string
  playedAt: string // ISO string — serialized from server
}

interface GameWeekRow {
  id: string
  weekNumber: number
  startDate: string
  venue: { name: string } | null
  matches: MatchRow[]
}

interface League {
  id: string
  name: string
  description: string | null
  location: string
  startDate: string
  endDate: string | null
}

interface LeaguePublicViewProps {
  league: League
  leagueTeams: TeamRef[]
  gameWeeks: GameWeekRow[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

type Standing = {
  team: TeamRef
  p: number; w: number; d: number; l: number
  gf: number; ga: number; gd: number; pts: number
}

function computeStandings(leagueTeams: TeamRef[], gameWeeks: GameWeekRow[]): Standing[] {
  const map = new Map<string, Standing>()
  for (const lt of leagueTeams) {
    map.set(lt.id, { team: lt, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 })
  }
  for (const gw of gameWeeks) {
    for (const m of gw.matches) {
      if (m.status !== 'COMPLETED') continue
      const home = map.get(m.homeTeam.id)
      const away = map.get(m.awayTeam.id)
      if (!home || !away) continue
      home.p++; away.p++
      home.gf += m.homeScore; home.ga += m.awayScore
      away.gf += m.awayScore; away.ga += m.homeScore
      if (m.homeScore > m.awayScore) { home.w++; home.pts += 3; away.l++ }
      else if (m.homeScore < m.awayScore) { away.w++; away.pts += 3; home.l++ }
      else { home.d++; away.d++; home.pts++; away.pts++ }
    }
  }
  for (const s of map.values()) s.gd = s.gf - s.ga
  return [...map.values()].sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf)
}

// ── Main component ────────────────────────────────────────────────────────────

export default function LeaguePublicView({ league, leagueTeams, gameWeeks }: LeaguePublicViewProps) {
  const [tab, setTab] = useState<'schedule' | 'standings' | 'teams'>('schedule')
  const standings = computeStandings(leagueTeams, gameWeeks)

  const now = new Date()
  const upcoming = gameWeeks.filter(gw => new Date(gw.startDate) >= now)
  const past = [...gameWeeks].filter(gw => new Date(gw.startDate) < now).reverse()

  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border-subtle bg-card px-4 py-5 md:px-8">
        <div className="max-w-3xl mx-auto">
          <h1 className="font-display font-black uppercase text-2xl md:text-3xl tracking-tight text-fg-high">
            {league.name}
          </h1>
          <p className="text-fg-mid text-sm mt-1">{league.location}</p>
          <p className="text-fg-low text-xs mt-0.5">
            {fmtDate(league.startDate)}
            {league.endDate ? ` – ${fmtDate(league.endDate)}` : ''}
          </p>
        </div>
      </header>

      {/* Tab bar */}
      <div className="sticky top-0 z-10 bg-card border-b border-border-subtle px-4 md:px-8">
        <div className="max-w-3xl mx-auto flex gap-0">
          {(['schedule', 'standings', 'teams'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-3 text-sm font-medium capitalize border-b-2 transition-colors ${
                tab === t
                  ? 'text-primary border-primary'
                  : 'text-fg-mid border-transparent hover:text-fg-high'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-4 md:px-8 py-6">

        {/* ── Schedule tab ──────────────────────────────────────────────── */}
        {tab === 'schedule' && (
          <div className="space-y-6">
            {gameWeeks.length === 0 && (
              <p className="text-fg-low text-sm text-center py-12">No matches scheduled yet.</p>
            )}
            {upcoming.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-widest text-fg-low mb-3">Upcoming</h2>
                <div className="space-y-3">
                  {upcoming.map(gw => <GameWeekCard key={gw.id} gw={gw} />)}
                </div>
              </section>
            )}
            {past.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-widest text-fg-low mb-3">Past Results</h2>
                <div className="space-y-3">
                  {past.map(gw => <GameWeekCard key={gw.id} gw={gw} />)}
                </div>
              </section>
            )}
          </div>
        )}

        {/* ── Standings tab ─────────────────────────────────────────────── */}
        {tab === 'standings' && (
          <div className="pl-card rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-fg-low uppercase tracking-wider bg-surface">
                  <th className="text-left px-4 py-2.5">#</th>
                  <th className="text-left px-2 py-2.5">Team</th>
                  <th className="text-center px-2 py-2.5">P</th>
                  <th className="text-center px-2 py-2.5">W</th>
                  <th className="text-center px-2 py-2.5">D</th>
                  <th className="text-center px-2 py-2.5">L</th>
                  <th className="text-center px-2 py-2.5">GD</th>
                  <th className="text-center px-2 py-2.5">Pts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {standings.map((s, i) => (
                  <tr key={s.team.id} className="hover:bg-surface transition-colors">
                    <td className="px-4 py-3 text-fg-low text-xs">{i + 1}</td>
                    <td className="px-2 py-3 font-medium text-fg-high">{s.team.team.name}</td>
                    <td className="px-2 py-3 text-center text-fg-mid">{s.p}</td>
                    <td className="px-2 py-3 text-center text-fg-mid">{s.w}</td>
                    <td className="px-2 py-3 text-center text-fg-mid">{s.d}</td>
                    <td className="px-2 py-3 text-center text-fg-mid">{s.l}</td>
                    <td className="px-2 py-3 text-center text-fg-mid">{s.gd > 0 ? `+${s.gd}` : s.gd}</td>
                    <td className="px-2 py-3 text-center font-bold text-fg-high">{s.pts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {standings.every(s => s.p === 0) && (
              <p className="text-fg-low text-sm text-center py-8">No results yet.</p>
            )}
          </div>
        )}

        {/* ── Teams tab ─────────────────────────────────────────────────── */}
        {tab === 'teams' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {leagueTeams.map(lt => (
              <div key={lt.id} className="pl-card rounded-xl p-4 flex items-center gap-3">
                {lt.team.logoUrl ? (
                  <img src={lt.team.logoUrl} alt={lt.team.name} className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-surface-md flex items-center justify-center text-lg font-bold text-primary">
                    {lt.team.name.charAt(0)}
                  </div>
                )}
                <span className="font-medium text-fg-high">{lt.team.name}</span>
              </div>
            ))}
          </div>
        )}

      </main>
    </div>
  )
}

// ── GameWeek card ─────────────────────────────────────────────────────────────

function GameWeekCard({ gw }: { gw: GameWeekRow }) {
  return (
    <div className="pl-card rounded-xl overflow-hidden">
      <div className="bg-surface px-4 py-2.5 flex items-center justify-between">
        <span className="font-display font-bold uppercase text-sm text-fg-high">MD{gw.weekNumber}</span>
        <span className="text-xs text-fg-low">{fmtDate(gw.startDate)}{gw.venue ? ` · ${gw.venue.name}` : ''}</span>
      </div>
      <div className="divide-y divide-border-subtle">
        {gw.matches.map(m => (
          <div key={m.id} className="px-4 py-3 flex items-center gap-2 text-sm">
            <span className="text-xs text-fg-low font-mono w-12 shrink-0">{fmtTime(m.playedAt)}</span>
            <span className="flex-1 text-right text-fg-high truncate">{m.homeTeam.team.name}</span>
            <span className="font-mono font-bold text-fg-high shrink-0 w-14 text-center">
              {m.status === 'COMPLETED'
                ? `${m.homeScore} – ${m.awayScore}`
                : <span className="text-fg-low text-xs">vs</span>}
            </span>
            <span className="flex-1 text-fg-high truncate">{m.awayTeam.team.name}</span>
          </div>
        ))}
        {gw.matches.length === 0 && (
          <p className="px-4 py-3 text-xs text-fg-low">No matches scheduled.</p>
        )}
      </div>
    </div>
  )
}
