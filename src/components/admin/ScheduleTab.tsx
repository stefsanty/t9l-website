'use client'

import { useState, useTransition } from 'react'
import { Plus, Upload, Calendar, MapPin, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import StatusBadge from './StatusBadge'
import MatchScoreEditor from './MatchScoreEditor'
import MatchOverflowMenu from './MatchOverflowMenu'
import PillEditor from './PillEditor'
import { useToast } from './ToastProvider'
import {
  createGameWeek,
  updateGameWeek,
  deleteGameWeek,
  createMatch,
  updateMatch,
  deleteMatch,
} from '@/app/admin/leagues/actions'
// All admin-schedule date/time goes through the canonical JST helpers in
// `lib/jst.ts`. The previous local fmtTime used `Date#getHours/getMinutes`
// (browser-local TZ) and fmtDatetime used `toISOString().slice(0,16)`
// (UTC) — under the V8/Vercel TZ=UTC trap that meant a JST admin who typed
// "14:30" had it stored as 14:30 UTC = 23:30 JST (a 9-hour skew). All
// inputs and displays here represent JST clock time regardless of the
// admin's local timezone. See CLAUDE.md "Time handling".
import {
  formatJstDate as fmtDate,
  formatJstTime as fmtTime,
  formatJstFriendly,
} from '@/lib/jst'
import { defaultMatchKickoffTime } from '@/lib/scheduleStagger'

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
  endedAt: Date | null
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

// v1.21.0 status taxonomy: Empty / Pending / Live / Done.
//   - EMPTY   → no matches scheduled yet
//   - PENDING → matches scheduled, none played
//   - LIVE    → at least one match in progress
//   - DONE    → every match completed (or cancelled/postponed terminally)
type GwBadgeStatus = 'EMPTY' | 'PENDING' | 'LIVE' | 'DONE'

export function gwStatus(gw: GameWeekRow): GwBadgeStatus {
  if (gw.matches.length === 0) return 'EMPTY'
  if (gw.matches.some((m) => m.status === 'IN_PROGRESS')) return 'LIVE'
  if (gw.matches.every((m) => m.status === 'COMPLETED' || m.status === 'CANCELLED' || m.status === 'POSTPONED')) {
    return 'DONE'
  }
  return 'PENDING'
}

// ── Main component ───────────────────────────────────────────────────────────

export default function ScheduleTab({ leagueId, gameWeeks, leagueTeams, venues }: ScheduleTabProps) {
  const { toast } = useToast()
  const [showAddMatchday, setShowAddMatchday] = useState(false)
  const [addMatchForm, setAddMatchForm] = useState<{
    gwId: string
    homeTeamId: string
    awayTeamId: string
    playedAt: string
  } | null>(null)
  const [pending, startTransition] = useTransition()

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

  async function handleUpdateMatchStatus(matchId: string, newStatus: MatchStatus) {
    try {
      await updateMatch(matchId, leagueId, { status: newStatus })
      toast(`Match ${newStatus.toLowerCase()}`)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to update status', 'error')
    }
  }

  const nextMDNum = (gameWeeks[gameWeeks.length - 1]?.weekNumber ?? 0) + 1

  // Add-matchday form (rendered at the top of the list, per the v1.20 audit
  // — pre-fix the form was rendered at the BOTTOM on mobile so tapping
  // "+ Add" appeared to do nothing without a scroll).
  const addMatchdayForm = showAddMatchday ? (
    <form
      onSubmit={handleAddMatchday}
      className="bg-admin-surface rounded-xl border border-admin-border p-4 space-y-3"
    >
      <p className="font-condensed font-bold text-admin-text text-base">MD{nextMDNum}</p>
      <input
        name="startDate"
        type="date"
        required
        className="w-full bg-admin-surface2 border border-admin-border2 text-admin-text text-sm rounded-md px-3 py-[9px] font-mono"
      />
      <select
        name="venueId"
        className="w-full bg-admin-surface2 border border-admin-border2 text-admin-text text-sm rounded-md px-3 py-[9px]"
      >
        <option value="">Venue (optional)</option>
        {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="flex-1 px-3 min-h-[40px] bg-admin-green text-admin-ink text-sm font-medium rounded hover:opacity-90 disabled:opacity-50"
        >
          Create
        </button>
        <button
          type="button"
          onClick={() => setShowAddMatchday(false)}
          className="px-3 min-h-[40px] border border-admin-border text-admin-text2 text-sm rounded hover:border-admin-border2"
        >
          Cancel
        </button>
      </div>
    </form>
  ) : null

  return (
    <div>
      {/* Toolbar — mirrors the mockup top row */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-condensed font-bold text-[13px] uppercase tracking-[2px] text-admin-text2">
            Match Schedule
          </h2>
        </div>
        <span className="font-condensed text-[11px] uppercase tracking-[1px] text-admin-text3">
          {gameWeeks.length} {gameWeeks.length === 1 ? 'matchday' : 'matchdays'}
        </span>
      </div>

      <div className="flex items-center gap-2 mb-4">
        {!showAddMatchday && (
          <button
            onClick={() => setShowAddMatchday(true)}
            className="flex items-center gap-1.5 rounded-lg bg-admin-green px-3 min-h-[40px] text-sm font-semibold text-admin-ink hover:opacity-90 transition-opacity"
          >
            <Plus className="w-3.5 h-3.5" />
            Add matchday
          </button>
        )}
        <button
          type="button"
          disabled
          aria-disabled
          title="Import is not yet wired up"
          className="flex items-center gap-1.5 rounded-lg border border-admin-border bg-transparent px-3 min-h-[40px] text-sm text-admin-text3 cursor-not-allowed opacity-60"
        >
          <Upload className="w-3.5 h-3.5" />
          Import
        </button>
      </div>

      {addMatchdayForm}

      <div className="space-y-3 mt-3">
        {gameWeeks.length === 0 && !showAddMatchday && (
          <div className="flex items-center justify-center py-12 text-admin-text3 text-sm bg-admin-surface rounded-xl border border-admin-border">
            No matchdays yet. Tap &quot;Add matchday&quot; to create one.
          </div>
        )}

        {gameWeeks.map((gw) => {
          const status = gwStatus(gw)

          return (
            <div key={gw.id} className="bg-admin-surface rounded-xl border border-admin-border overflow-hidden">
              {/* MD header row */}
              <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
                <div className="flex items-center gap-2">
                  <span className="font-condensed font-bold text-admin-text text-xl">MD{gw.weekNumber}</span>
                  <StatusBadge status={status} />
                </div>
                {status !== 'DONE' && (
                  <MatchOverflowMenu
                    ariaLabel={`MD${gw.weekNumber} actions`}
                    items={[
                      {
                        label: 'Delete matchday',
                        tone: 'danger',
                        onSelect: () => {
                          // ConfirmDialog wraps the delete; surface it via a
                          // window confirm fallback if the user doesn't have
                          // a destructive-action policy. Keep it consistent
                          // with the existing per-match delete affordance:
                          // we use the same ConfirmDialog there.
                          if (typeof window !== 'undefined' && window.confirm(`Delete MD${gw.weekNumber}? This will permanently delete this matchday and all its matches.`)) {
                            handleDeleteGW(gw.id)
                          }
                        },
                      },
                    ]}
                  />
                )}
              </div>

              {/* Header pills: date + venue */}
              <div className="px-4 pb-3 flex items-center gap-2 flex-wrap">
                <PillEditor
                  variant="date"
                  value={fmtDate(gw.startDate)}
                  display={formatJstFriendly(gw.startDate, 'en')}
                  icon={<Calendar className="w-3 h-3" />}
                  ariaLabel={`MD${gw.weekNumber} date`}
                  className="min-h-[30px] text-[12px] px-3"
                  onSave={async (val) => {
                    await updateGameWeek(gw.id, leagueId, { startDate: val, endDate: val })
                    toast('Date updated')
                  }}
                />
                <PillEditor
                  variant="venue"
                  value={gw.venue?.id ?? ''}
                  display={gw.venue?.name ?? ''}
                  placeholder="Set venue"
                  icon={<MapPin className="w-3 h-3" />}
                  options={venues}
                  ariaLabel={`MD${gw.weekNumber} venue`}
                  className="min-h-[30px] text-[12px] px-3"
                  onSave={async (venueId) => {
                    await updateGameWeek(gw.id, leagueId, { venueId })
                    toast('Venue updated')
                  }}
                />
              </div>

              {/* Matches divider */}
              <div className="px-4 flex items-center gap-2">
                <div className="flex-1 h-px bg-admin-border" />
                <span className="font-condensed text-[10px] uppercase tracking-[2px] text-admin-text3">Matches</span>
                <div className="flex-1 h-px bg-admin-border" />
              </div>

              {/* Match rows */}
              <div className="px-4 py-3 space-y-2">
                {gw.matches.map((match) => (
                  <MatchCardRow
                    key={match.id}
                    match={match}
                    leagueId={leagueId}
                    leagueTeams={leagueTeams}
                    gwStartDate={gw.startDate}
                    onDelete={() => handleDeleteMatch(match.id)}
                    onSetStatus={(s) => handleUpdateMatchStatus(match.id, s)}
                  />
                ))}

                {/* Empty + add affordance */}
                {gw.matches.length === 0 && addMatchForm?.gwId !== gw.id && (
                  <button
                    type="button"
                    onClick={() =>
                      setAddMatchForm({
                        gwId: gw.id,
                        homeTeamId: '',
                        awayTeamId: '',
                        // v1.21.1 — pre-stagger the kickoff per match index;
                        // first match defaults to 19:05 JST.
                        playedAt: `${fmtDate(gw.startDate)}T${defaultMatchKickoffTime(0)}`,
                      })
                    }
                    className="w-full flex items-center justify-center gap-1.5 min-h-[36px] rounded-lg border border-admin-green bg-transparent px-3 text-sm font-medium text-admin-green hover:bg-admin-green-dim transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add match
                  </button>
                )}

                {/* Add match (inline, when toggled) */}
                {addMatchForm?.gwId === gw.id ? (
                  <form
                    onSubmit={handleAddMatch}
                    className="space-y-2 p-3 rounded-lg bg-admin-surface2 border border-admin-border"
                  >
                    <input type="hidden" name="gwId" value={gw.id} />
                    <div className="flex flex-col sm:flex-row gap-2">
                      <select
                        name="homeTeamId"
                        required
                        className="flex-1 bg-admin-surface3 border border-admin-border2 text-admin-text text-sm rounded-md px-3 py-[9px]"
                      >
                        <option value="">Home team…</option>
                        {leagueTeams.map((lt) => (
                          <option key={lt.id} value={lt.id}>{lt.team.name}</option>
                        ))}
                      </select>
                      <select
                        name="awayTeamId"
                        required
                        className="flex-1 bg-admin-surface3 border border-admin-border2 text-admin-text text-sm rounded-md px-3 py-[9px]"
                      >
                        <option value="">Away team…</option>
                        {leagueTeams.map((lt) => (
                          <option key={lt.id} value={lt.id}>{lt.team.name}</option>
                        ))}
                      </select>
                    </div>
                    <input
                      name="playedAt"
                      type="datetime-local"
                      required
                      // v1.21.1 — read from addMatchForm.playedAt so the
                      // staggered default (19:05 / 19:40 / 20:15…) lands
                      // in the input. Pre-fix this was hardcoded to
                      // `${gw.startDate}T00:00` (midnight) and admins had
                      // to fix the time on every add.
                      defaultValue={addMatchForm.playedAt}
                      className="w-full bg-admin-surface3 border border-admin-border2 text-admin-text text-sm rounded-md px-3 py-[9px] font-mono"
                    />
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={pending}
                        className="flex-1 px-3 min-h-[36px] bg-admin-green text-admin-ink text-sm font-medium rounded hover:opacity-90 disabled:opacity-50"
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        onClick={() => setAddMatchForm(null)}
                        className="px-3 min-h-[36px] border border-admin-border text-admin-text2 text-sm rounded hover:border-admin-border2"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  gw.matches.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setAddMatchForm({
                          gwId: gw.id,
                          homeTeamId: '',
                          awayTeamId: '',
                          // v1.21.1 — stagger by current match count: 2nd
                          // match → 19:40, 3rd → 20:15.
                          playedAt: `${fmtDate(gw.startDate)}T${defaultMatchKickoffTime(gw.matches.length)}`,
                        })
                      }
                      className="w-full flex items-center justify-center gap-1.5 min-h-[30px] rounded-lg border border-admin-green/60 bg-transparent px-3 text-xs font-medium text-admin-green hover:bg-admin-green-dim transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      Add match
                    </button>
                  )
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Match card row ───────────────────────────────────────────────────────────

interface MatchCardRowProps {
  match: MatchRow
  leagueId: string
  leagueTeams: TeamRef[]
  /**
   * Matchday's startDate. The match's date is implicit — it's the parent
   * matchday's date — so the time pill needs the GW date to construct the
   * full datetime when the user picks a new time.
   */
  gwStartDate: Date
  onDelete: () => void
  onSetStatus: (status: MatchStatus) => void
}

function MatchCardRow({ match, leagueId, leagueTeams, gwStartDate, onDelete, onSetStatus }: MatchCardRowProps) {
  const { toast } = useToast()

  const teamOptions = leagueTeams.map((lt) => ({ id: lt.id, name: lt.team.name }))

  return (
    <div
      className={cn(
        'flex items-center gap-2 py-1.5',
        (match.status === 'CANCELLED' || match.status === 'POSTPONED') && 'opacity-60',
      )}
    >
      <PillEditor
        variant="time"
        value={fmtTime(match.playedAt)}
        display={`${fmtTime(match.playedAt)} JST`}
        icon={<Clock className="w-3 h-3" />}
        ariaLabel="Kickoff"
        className="shrink-0"
        onSave={async (val) => {
          // v1.21.1 — combine the new HH:MM with the matchday's date.
          // updateMatch parses `playedAt` via parseJstDateTimeLocal on the
          // server, so we send the canonical "YYYY-MM-DDTHH:MM" shape.
          await updateMatch(match.id, leagueId, { playedAt: `${fmtDate(gwStartDate)}T${val}` })
          toast('Kickoff updated')
        }}
      />
      <PillEditor
        variant="team"
        value={match.homeTeam.id}
        display={match.homeTeam.team.name}
        options={teamOptions}
        ariaLabel="Home team"
        className="flex-1 min-w-0 truncate"
        onSave={async (teamId) => {
          await updateMatch(match.id, leagueId, { homeTeamId: teamId })
          toast('Home team updated')
        }}
      />
      <MatchScoreEditor key={match.id} match={match} leagueId={leagueId} variant="desktop" />
      <PillEditor
        variant="team"
        value={match.awayTeam.id}
        display={match.awayTeam.team.name}
        options={teamOptions}
        ariaLabel="Away team"
        className="flex-1 min-w-0 truncate text-right justify-end"
        onSave={async (teamId) => {
          await updateMatch(match.id, leagueId, { awayTeamId: teamId })
          toast('Away team updated')
        }}
      />
      <MatchOverflowMenu
        ariaLabel="Match actions"
        items={[
          {
            label: 'Mark complete',
            disabled: match.status === 'COMPLETED',
            onSelect: () => onSetStatus('COMPLETED'),
          },
          {
            label: 'Cancel match',
            disabled: match.status === 'CANCELLED',
            onSelect: () => onSetStatus('CANCELLED'),
          },
          {
            label: 'Postpone match',
            disabled: match.status === 'POSTPONED',
            onSelect: () => onSetStatus('POSTPONED'),
          },
          {
            label: 'Delete match',
            tone: 'danger',
            onSelect: () => {
              if (typeof window !== 'undefined' && window.confirm(`Delete match? ${match.homeTeam.team.name} vs ${match.awayTeam.team.name} will be permanently deleted.`)) {
                onDelete()
              }
            },
          },
        ]}
      />
    </div>
  )
}
