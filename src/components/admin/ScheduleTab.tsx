'use client'

import { useState, useTransition } from 'react'
import { ChevronRight, Plus, Trash2, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import StatusBadge from './StatusBadge'
import InlineEditCell from './InlineEditCell'
import ConfirmDialog from './ConfirmDialog'
import { useToast } from './ToastProvider'
import {
  createGameWeek,
  updateGameWeek,
  deleteGameWeek,
  createMatch,
  updateMatch,
  deleteMatch,
} from '@/app/admin/leagues/actions'

// ── Types ────────────────────────────────────────────────────────────────────

type MatchStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'POSTPONED'

interface TeamRef {
  id: string
  team: { name: string }
}

interface MatchRow {
  id: string
  homeTeam: TeamRef
  awayTeam: TeamRef
  homeScore: number
  awayScore: number
  status: MatchStatus
  playedAt: Date
}

interface VenueRef {
  id: string
  name: string
}

interface GameWeekRow {
  id: string
  weekNumber: number
  startDate: Date
  endDate: Date
  venue: VenueRef | null
  matches: MatchRow[]
}

interface ScheduleTabProps {
  leagueId: string
  gameWeeks: GameWeekRow[]
  leagueTeams: TeamRef[]
  venues: VenueRef[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: Date) {
  return new Date(d).toISOString().split('T')[0]
}

function fmtTime(d: Date) {
  const dt = new Date(d)
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
}

function fmtDatetime(d: Date) {
  return new Date(d).toISOString().slice(0, 16)
}

function gwStatus(gw: GameWeekRow): MatchStatus {
  if (gw.matches.length === 0) return 'SCHEDULED'
  if (gw.matches.every((m) => m.status === 'COMPLETED')) return 'COMPLETED'
  if (gw.matches.some((m) => m.status === 'IN_PROGRESS')) return 'IN_PROGRESS'
  return 'SCHEDULED'
}

// ── Main component ───────────────────────────────────────────────────────────

export default function ScheduleTab({ leagueId, gameWeeks, leagueTeams, venues }: ScheduleTabProps) {
  const { toast } = useToast()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showAddMatchday, setShowAddMatchday] = useState(false)
  const [addMatchForm, setAddMatchForm] = useState<{
    gwId: string
    homeTeamId: string
    awayTeamId: string
    playedAt: string
  } | null>(null)
  const [pending, startTransition] = useTransition()

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleAddMatchday(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const startDate = fd.get('startDate') as string
    const venueId   = (fd.get('venueId') as string) || null
    const nextNum   = (gameWeeks[gameWeeks.length - 1]?.weekNumber ?? 0) + 1

    startTransition(async () => {
      try {
        await createGameWeek(leagueId, { weekNumber: nextNum, startDate, endDate: startDate, venueId })
        toast(`MD${nextNum} created`)
        setShowAddMatchday(false)
      } catch {
        toast('Failed to create matchday', 'error')
      }
    })
  }

  async function handleDeleteGW(id: string) {
    try {
      await deleteGameWeek(id, leagueId)
      toast('Matchday deleted')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to delete', 'error')
    }
  }

  async function handleAddMatch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!addMatchForm) return
    const fd = new FormData(e.currentTarget)
    const homeTeamId = fd.get('homeTeamId') as string
    const awayTeamId = fd.get('awayTeamId') as string
    const playedAt   = fd.get('playedAt') as string

    startTransition(async () => {
      try {
        await createMatch(addMatchForm.gwId, leagueId, { homeTeamId, awayTeamId, playedAt })
        toast('Match added')
        setAddMatchForm(null)
      } catch {
        toast('Failed to add match', 'error')
      }
    })
  }

  async function handleDeleteMatch(matchId: string) {
    try {
      await deleteMatch(matchId, leagueId)
      toast('Match deleted')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to delete', 'error')
    }
  }

  const nextMDNum = (gameWeeks[gameWeeks.length - 1]?.weekNumber ?? 0) + 1

  // Shared add-matchday form (used in both mobile and desktop)
  const AddMatchdayForm = ({ mobile }: { mobile?: boolean }) =>
    showAddMatchday ? (
      <form
        onSubmit={handleAddMatchday}
        className={cn(
          mobile
            ? 'bg-admin-surface rounded-xl border border-admin-border p-4 space-y-3'
            : 'px-4 py-3 border-t border-admin-border flex items-center gap-3',
        )}
      >
        {mobile ? (
          <>
            <p className="font-condensed font-bold text-admin-text text-sm">MD{nextMDNum}</p>
            <input
              name="startDate"
              type="date"
              required
              className="w-full bg-admin-surface3 border border-admin-border text-admin-text text-sm rounded px-3 py-2.5 font-mono"
            />
            <select
              name="venueId"
              className="w-full bg-admin-surface3 border border-admin-border text-admin-text text-sm rounded px-3 py-2.5"
            >
              <option value="">Venue (optional)</option>
              {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <div className="flex gap-2">
              <button type="submit" disabled={pending} className="flex-1 px-3 py-2.5 bg-admin-green text-admin-bg text-sm font-medium rounded hover:opacity-90 disabled:opacity-50">
                Create
              </button>
              <button type="button" onClick={() => setShowAddMatchday(false)} className="px-3 py-2.5 border border-admin-border text-admin-text2 text-sm rounded hover:border-admin-border2">
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="font-condensed font-bold text-admin-text text-sm shrink-0">MD{nextMDNum}</span>
            <input name="startDate" type="date" required className="bg-admin-surface3 border border-admin-border text-admin-text text-sm rounded px-3 py-1.5 font-mono" />
            <select name="venueId" className="bg-admin-surface3 border border-admin-border text-admin-text text-sm rounded px-3 py-1.5 flex-1">
              <option value="">Venue (optional)</option>
              {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <button type="submit" disabled={pending} className="px-3 py-1.5 bg-admin-green text-admin-bg text-sm font-medium rounded hover:opacity-90 disabled:opacity-50">
              Create
            </button>
            <button type="button" onClick={() => setShowAddMatchday(false)} className="px-3 py-1.5 border border-admin-border text-admin-text2 text-sm rounded hover:border-admin-border2">
              Cancel
            </button>
          </>
        )}
      </form>
    ) : null

  return (
    <div>
      {/* ── Mobile view ───────────────────────────────────────────────────── */}
      <div className="md:hidden">
        {/* Mobile toolbar */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-condensed font-bold text-admin-text text-xl">Match Schedule</h2>
          {!showAddMatchday && (
            <button
              onClick={() => setShowAddMatchday(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-admin-green text-admin-bg text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          )}
        </div>

        <div className="space-y-2">
          {gameWeeks.length === 0 && !showAddMatchday && (
            <div className="flex items-center justify-center py-12 text-admin-text3 text-sm bg-admin-surface rounded-xl border border-admin-border">
              No matchdays yet. Tap &quot;Add&quot; to create one.
            </div>
          )}

          {gameWeeks.map((gw) => {
            const isExpanded = expanded.has(gw.id)
            const status = gwStatus(gw)

            return (
              <div key={gw.id} className="bg-admin-surface rounded-xl border border-admin-border overflow-hidden">
                {/* GW row */}
                <div
                  className="flex items-center gap-3 px-4 min-h-[52px] cursor-pointer hover:bg-admin-surface2 transition-colors"
                  onClick={() => toggleExpand(gw.id)}
                >
                  <ChevronRight
                    className={cn('w-4 h-4 text-admin-text3 transition-transform shrink-0', isExpanded && 'rotate-90')}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-condensed font-bold text-admin-text text-base">MD{gw.weekNumber}</span>
                      <span className="font-mono text-admin-text3 text-xs">{fmtDate(gw.startDate)}</span>
                      <StatusBadge status={status} />
                    </div>
                    {gw.venue && (
                      <p className="text-admin-text3 text-xs mt-0.5 truncate">{gw.venue.name}</p>
                    )}
                  </div>
                  <div
                    className="flex items-center gap-1 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="text-admin-text3 text-xs font-mono">{gw.matches.length}</span>
                    <ConfirmDialog
                      trigger={
                        <button className="p-2 rounded text-admin-text3 hover:text-admin-red hover:bg-admin-red-dim transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      }
                      title={`Delete MD${gw.weekNumber}?`}
                      description="This will permanently delete this matchday and all its matches."
                      confirmLabel={`Delete MD${gw.weekNumber}`}
                      onConfirm={() => handleDeleteGW(gw.id)}
                    />
                  </div>
                </div>

                {/* Expanded matches */}
                {isExpanded && (
                  <div className="border-t border-admin-border">
                    {gw.matches.map((match, idx) => (
                      <MobileMatchRow
                        key={match.id}
                        match={match}
                        index={idx + 1}
                        leagueId={leagueId}
                        leagueTeams={leagueTeams}
                        onDelete={() => handleDeleteMatch(match.id)}
                      />
                    ))}

                    {/* Add match */}
                    {addMatchForm?.gwId === gw.id ? (
                      <form
                        onSubmit={handleAddMatch}
                        className="p-4 space-y-3 border-t border-admin-border bg-admin-surface2/30"
                      >
                        <input type="hidden" name="gwId" value={gw.id} />
                        <select
                          name="homeTeamId"
                          required
                          className="w-full bg-admin-surface3 border border-admin-border text-admin-text text-sm rounded px-3 py-2.5"
                        >
                          <option value="">Home team…</option>
                          {leagueTeams.map((lt) => (
                            <option key={lt.id} value={lt.id}>{lt.team.name}</option>
                          ))}
                        </select>
                        <select
                          name="awayTeamId"
                          required
                          className="w-full bg-admin-surface3 border border-admin-border text-admin-text text-sm rounded px-3 py-2.5"
                        >
                          <option value="">Away team…</option>
                          {leagueTeams.map((lt) => (
                            <option key={lt.id} value={lt.id}>{lt.team.name}</option>
                          ))}
                        </select>
                        <input
                          name="playedAt"
                          type="datetime-local"
                          required
                          defaultValue={fmtDatetime(gw.startDate)}
                          className="w-full bg-admin-surface3 border border-admin-border text-admin-text text-sm rounded px-3 py-2.5 font-mono"
                        />
                        <div className="flex gap-2">
                          <button
                            type="submit"
                            disabled={pending}
                            className="flex-1 px-3 py-2.5 bg-admin-green text-admin-bg text-sm font-medium rounded hover:opacity-90 disabled:opacity-50"
                          >
                            Add
                          </button>
                          <button
                            type="button"
                            onClick={() => setAddMatchForm(null)}
                            className="px-3 py-2.5 border border-admin-border text-admin-text2 text-sm rounded hover:border-admin-border2"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className="px-4 py-3 border-t border-admin-border">
                        <button
                          onClick={() =>
                            setAddMatchForm({
                              gwId: gw.id,
                              homeTeamId: '',
                              awayTeamId: '',
                              playedAt: fmtDatetime(gw.startDate),
                            })
                          }
                          className="flex items-center gap-1.5 text-admin-text3 text-sm hover:text-admin-green transition-colors py-1"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Add Match
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          <AddMatchdayForm mobile />
        </div>
      </div>

      {/* ── Desktop view ──────────────────────────────────────────────────── */}
      <div className="hidden md:block">
        {/* Toolbar */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-condensed font-bold text-admin-text text-xl">Match Schedule</h2>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-admin-border text-admin-text2 text-sm hover:border-admin-border2 hover:text-admin-text transition-colors">
              <Upload className="w-3.5 h-3.5" />
              Import Schedule
            </button>
            <button
              onClick={() => setShowAddMatchday(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-admin-green text-admin-bg text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Matchday
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-admin-surface rounded-xl border border-admin-border overflow-hidden">
          {/* Table header */}
          <div
            className="grid text-admin-text3 text-xs uppercase tracking-wider px-4 py-2.5 border-b border-admin-border bg-admin-surface2"
            style={{ gridTemplateColumns: '32px 120px 140px 1fr 80px 110px 80px' }}
          >
            <span />
            <span>Matchday</span>
            <span>Date</span>
            <span>Venue</span>
            <span>Matches</span>
            <span>Status</span>
            <span />
          </div>

          {gameWeeks.length === 0 && !showAddMatchday && (
            <div className="flex items-center justify-center py-12 text-admin-text3 text-sm">
              No matchdays yet. Click &quot;Add Matchday&quot; to create one.
            </div>
          )}

          {gameWeeks.map((gw) => {
            const isExpanded = expanded.has(gw.id)
            const status = gwStatus(gw)

            return (
              <div key={gw.id} className="border-b border-admin-border last:border-b-0">
                <div
                  className="grid items-center px-4 py-3 hover:bg-admin-surface2 cursor-pointer transition-colors"
                  style={{ gridTemplateColumns: '32px 120px 140px 1fr 80px 110px 80px' }}
                  onClick={() => toggleExpand(gw.id)}
                >
                  <ChevronRight
                    className={cn(
                      'w-4 h-4 text-admin-text3 transition-transform',
                      isExpanded && 'rotate-90',
                    )}
                  />
                  <span className="font-condensed font-bold text-admin-text text-base">
                    MD{gw.weekNumber}
                  </span>
                  <span
                    className="font-mono text-admin-text2 text-sm"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <InlineEditCell
                      value={fmtDate(gw.startDate)}
                      type="date"
                      onSave={async (val) => {
                        await updateGameWeek(gw.id, leagueId, { startDate: val, endDate: val })
                        toast('Date updated')
                      }}
                      className="font-mono text-admin-text2"
                    />
                  </span>
                  <span className="text-admin-text2 text-sm truncate pr-4">
                    {gw.venue?.name ?? <span className="text-admin-text3">—</span>}
                  </span>
                  <span className="text-admin-text2 text-sm font-mono">{gw.matches.length}</span>
                  <span><StatusBadge status={status} /></span>
                  <div
                    className="flex items-center gap-1 justify-end"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ConfirmDialog
                      trigger={
                        <button className="p-1.5 rounded text-admin-text3 hover:text-admin-red hover:bg-admin-red-dim transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      }
                      title={`Delete MD${gw.weekNumber}?`}
                      description="This will permanently delete this matchday and all its matches."
                      confirmLabel={`Delete MD${gw.weekNumber}`}
                      onConfirm={() => handleDeleteGW(gw.id)}
                    />
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-admin-border bg-admin-surface2/50">
                    {gw.matches.length > 0 && (
                      <div
                        className="grid text-admin-text3 text-xs uppercase tracking-wider px-8 py-2 border-b border-admin-border"
                        style={{ gridTemplateColumns: '32px 120px 1fr 1fr 80px 110px 60px' }}
                      >
                        <span>#</span>
                        <span>Kickoff</span>
                        <span>Home</span>
                        <span>Away</span>
                        <span>Score</span>
                        <span>Status</span>
                        <span />
                      </div>
                    )}

                    {gw.matches.map((match, idx) => (
                      <MatchSubrow
                        key={match.id}
                        match={match}
                        index={idx + 1}
                        leagueId={leagueId}
                        leagueTeams={leagueTeams}
                        onDelete={() => handleDeleteMatch(match.id)}
                      />
                    ))}

                    {addMatchForm?.gwId === gw.id ? (
                      <form
                        onSubmit={handleAddMatch}
                        className="px-8 py-3 flex items-center gap-3 border-t border-admin-border"
                      >
                        <input type="hidden" name="gwId" value={gw.id} />
                        <select
                          name="homeTeamId"
                          required
                          className="bg-admin-surface3 border border-admin-border text-admin-text text-sm rounded px-2 py-1.5 flex-1"
                        >
                          <option value="">Home team…</option>
                          {leagueTeams.map((lt) => (
                            <option key={lt.id} value={lt.id}>{lt.team.name}</option>
                          ))}
                        </select>
                        <span className="text-admin-text3 text-sm">vs</span>
                        <select
                          name="awayTeamId"
                          required
                          className="bg-admin-surface3 border border-admin-border text-admin-text text-sm rounded px-2 py-1.5 flex-1"
                        >
                          <option value="">Away team…</option>
                          {leagueTeams.map((lt) => (
                            <option key={lt.id} value={lt.id}>{lt.team.name}</option>
                          ))}
                        </select>
                        <input
                          name="playedAt"
                          type="datetime-local"
                          required
                          defaultValue={fmtDatetime(gw.startDate)}
                          className="bg-admin-surface3 border border-admin-border text-admin-text text-sm rounded px-2 py-1.5 font-mono"
                        />
                        <button
                          type="submit"
                          disabled={pending}
                          className="px-3 py-1.5 bg-admin-green text-admin-bg text-sm font-medium rounded hover:opacity-90 disabled:opacity-50"
                        >
                          Add
                        </button>
                        <button
                          type="button"
                          onClick={() => setAddMatchForm(null)}
                          className="px-3 py-1.5 border border-admin-border text-admin-text2 text-sm rounded hover:border-admin-border2"
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <div className="px-8 py-2.5 border-t border-admin-border">
                        <button
                          onClick={() =>
                            setAddMatchForm({
                              gwId: gw.id,
                              homeTeamId: '',
                              awayTeamId: '',
                              playedAt: fmtDatetime(gw.startDate),
                            })
                          }
                          className="flex items-center gap-1.5 text-admin-text3 text-xs hover:text-admin-green transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Add Match
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          <AddMatchdayForm />
        </div>
      </div>
    </div>
  )
}

// ── Mobile match row ─────────────────────────────────────────────────────────

interface MobileMatchRowProps {
  match: MatchRow
  index: number
  leagueId: string
  leagueTeams: TeamRef[]
  onDelete: () => void
}

function MobileMatchRow({ match, index, leagueId, leagueTeams, onDelete }: MobileMatchRowProps) {
  const { toast } = useToast()
  const [editingScore, setEditingScore] = useState(false)
  const [homeScore, setHomeScore] = useState(String(match.homeScore))
  const [awayScore, setAwayScore] = useState(String(match.awayScore))
  const [pending, startTransition] = useTransition()

  function saveScore() {
    setEditingScore(false)
    const hs = parseInt(homeScore, 10)
    const as = parseInt(awayScore, 10)
    if (isNaN(hs) || isNaN(as)) return
    startTransition(async () => {
      try {
        await updateMatch(match.id, leagueId, { homeScore: hs, awayScore: as, status: 'COMPLETED' })
        toast('Score updated')
      } catch {
        toast('Failed to update score', 'error')
      }
    })
  }

  return (
    <div className="px-4 py-3 border-b border-admin-border/50 last:border-b-0">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-admin-text3 font-mono text-xs">#{index}</span>
        <span className="font-mono text-admin-text3 text-xs">{fmtTime(match.playedAt)}</span>
        <StatusBadge status={match.status} />
        <div className="ml-auto">
          <ConfirmDialog
            trigger={
              <button className="p-2 text-admin-text3 hover:text-admin-red hover:bg-admin-red-dim rounded transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            }
            title="Delete match?"
            description={`${match.homeTeam.team.name} vs ${match.awayTeam.team.name} will be permanently deleted.`}
            confirmLabel="Delete match"
            onConfirm={async () => onDelete()}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm text-admin-text truncate">{match.homeTeam.team.name}</span>
        {editingScore ? (
          <div className="flex items-center gap-1 shrink-0">
            <input
              autoFocus
              type="number"
              min={0}
              value={homeScore}
              onChange={(e) => setHomeScore(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveScore()
                if (e.key === 'Escape') setEditingScore(false)
              }}
              className="w-10 bg-admin-surface3 border border-admin-green/50 text-admin-text text-xs rounded px-1 py-1 text-center font-mono outline-none"
            />
            <span className="text-admin-text3 text-xs">–</span>
            <input
              type="number"
              min={0}
              value={awayScore}
              onChange={(e) => setAwayScore(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveScore()
                if (e.key === 'Escape') setEditingScore(false)
              }}
              onBlur={saveScore}
              className="w-10 bg-admin-surface3 border border-admin-green/50 text-admin-text text-xs rounded px-1 py-1 text-center font-mono outline-none"
            />
          </div>
        ) : (
          <span
            className="font-mono text-admin-text2 text-sm cursor-pointer px-2 py-1 rounded hover:bg-admin-surface3 transition-colors shrink-0"
            onClick={() => {
              setHomeScore(String(match.homeScore))
              setAwayScore(String(match.awayScore))
              setEditingScore(true)
            }}
          >
            {match.status === 'COMPLETED'
              ? `${match.homeScore}–${match.awayScore}`
              : <span className="text-admin-text3">vs</span>}
          </span>
        )}
        <span className="flex-1 text-sm text-admin-text truncate text-right">{match.awayTeam.team.name}</span>
      </div>
    </div>
  )
}

// ── Desktop match sub-row ────────────────────────────────────────────────────

interface MatchSubrowProps {
  match: MatchRow
  index: number
  leagueId: string
  leagueTeams: TeamRef[]
  onDelete: () => void
}

function MatchSubrow({ match, index, leagueId, leagueTeams, onDelete }: MatchSubrowProps) {
  const { toast } = useToast()
  const [editingScore, setEditingScore] = useState(false)
  const [homeScore, setHomeScore] = useState(String(match.homeScore))
  const [awayScore, setAwayScore] = useState(String(match.awayScore))
  const [pending, startTransition] = useTransition()

  function saveScore() {
    setEditingScore(false)
    const hs = parseInt(homeScore, 10)
    const as = parseInt(awayScore, 10)
    if (isNaN(hs) || isNaN(as)) return
    startTransition(async () => {
      try {
        await updateMatch(match.id, leagueId, {
          homeScore: hs,
          awayScore: as,
          status: 'COMPLETED',
        })
        toast('Score updated')
      } catch {
        toast('Failed to update score', 'error')
      }
    })
  }

  return (
    <div
      className="grid items-center px-8 py-2.5 border-b border-admin-border/50 last:border-b-0 hover:bg-admin-surface2 transition-colors text-sm"
      style={{ gridTemplateColumns: '32px 120px 1fr 1fr 80px 110px 60px' }}
    >
      <span className="text-admin-text3 font-mono text-xs">{index}</span>

      <span className="font-mono text-admin-text2">
        <InlineEditCell
          value={fmtDatetime(match.playedAt)}
          displayValue={fmtTime(match.playedAt)}
          type="datetime-local"
          onSave={async (val) => {
            await updateMatch(match.id, leagueId, { playedAt: val })
            toast('Kickoff updated')
          }}
          className="font-mono text-admin-text2 text-sm"
        />
      </span>

      <span className="text-admin-text pr-2">
        <TeamSelectCell
          value={match.homeTeam.id}
          displayValue={match.homeTeam.team.name}
          teams={leagueTeams}
          onSave={async (val) => {
            await updateMatch(match.id, leagueId, { homeTeamId: val })
            toast('Home team updated')
          }}
        />
      </span>

      <span className="text-admin-text pr-2">
        <TeamSelectCell
          value={match.awayTeam.id}
          displayValue={match.awayTeam.team.name}
          teams={leagueTeams}
          onSave={async (val) => {
            await updateMatch(match.id, leagueId, { awayTeamId: val })
            toast('Away team updated')
          }}
        />
      </span>

      <span>
        {editingScore ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              type="number"
              min={0}
              value={homeScore}
              onChange={(e) => setHomeScore(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveScore(); if (e.key === 'Escape') setEditingScore(false) }}
              className="w-10 bg-admin-surface3 border border-admin-green/50 text-admin-text text-xs rounded px-1 py-0.5 text-center font-mono outline-none"
            />
            <span className="text-admin-text3 text-xs">–</span>
            <input
              type="number"
              min={0}
              value={awayScore}
              onChange={(e) => setAwayScore(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveScore(); if (e.key === 'Escape') setEditingScore(false) }}
              onBlur={saveScore}
              className="w-10 bg-admin-surface3 border border-admin-green/50 text-admin-text text-xs rounded px-1 py-0.5 text-center font-mono outline-none"
            />
          </div>
        ) : (
          <span
            className="font-mono text-admin-text2 text-sm cursor-pointer hover:text-admin-text transition-colors"
            onClick={() => { setHomeScore(String(match.homeScore)); setAwayScore(String(match.awayScore)); setEditingScore(true) }}
          >
            {match.status === 'COMPLETED'
              ? `${match.homeScore} – ${match.awayScore}`
              : <span className="text-admin-text3">vs</span>}
          </span>
        )}
      </span>

      <span><StatusBadge status={match.status} /></span>

      <div className="flex justify-end">
        <ConfirmDialog
          trigger={
            <button className="p-1.5 rounded text-admin-text3 hover:text-admin-red hover:bg-admin-red-dim transition-colors">
              <Trash2 className="w-3 h-3" />
            </button>
          }
          title="Delete match?"
          description={`${match.homeTeam.team.name} vs ${match.awayTeam.team.name} will be permanently deleted.`}
          confirmLabel="Delete match"
          onConfirm={async () => onDelete()}
        />
      </div>
    </div>
  )
}

// ── Team select inline cell ──────────────────────────────────────────────────

function TeamSelectCell({
  value,
  displayValue,
  teams,
  onSave,
}: {
  value: string
  displayValue: string
  teams: TeamRef[]
  onSave: (id: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [pending, startTransition] = useTransition()

  if (editing) {
    return (
      <select
        autoFocus
        defaultValue={value}
        onChange={(e) => {
          const newVal = e.target.value
          setEditing(false)
          startTransition(async () => { await onSave(newVal) })
        }}
        onBlur={() => setEditing(false)}
        className="bg-admin-surface3 border border-admin-green/50 text-admin-text text-sm rounded px-2 py-0.5 outline-none"
      >
        {teams.map((lt) => (
          <option key={lt.id} value={lt.id}>{lt.team.name}</option>
        ))}
      </select>
    )
  }

  return (
    <span
      className="cursor-pointer hover:text-admin-text2 transition-colors"
      onClick={() => setEditing(true)}
    >
      {displayValue}
    </span>
  )
}
