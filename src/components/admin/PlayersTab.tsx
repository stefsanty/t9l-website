'use client'

import { useState, useTransition } from 'react'
import { ArrowRight, X, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import StatusBadge from './StatusBadge'
import ConfirmDialog from './ConfirmDialog'
import AssignLineDialog from './AssignLineDialog'
import { useToast } from './ToastProvider'
import { transferPlayer, removePlayerFromLeague } from '@/app/admin/leagues/actions'

// ── Types ────────────────────────────────────────────────────────────────────

interface LeagueTeamRef {
  id: string
  team: { name: string }
}

interface Assignment {
  id: string
  fromGameWeek: number
  toGameWeek: number | null
  leagueTeam: LeagueTeamRef
}

interface PlayerRow {
  id: string
  name: string
  lineId: string | null
  assignments: Assignment[]
}

interface OrphanLineLogin {
  lineId: string
  name: string | null
  pictureUrl: string | null
  firstSeenAt: string
  lastSeenAt: string
}

interface PlayersTabProps {
  leagueId: string
  players: PlayerRow[]
  leagueTeams: LeagueTeamRef[]
  maxGameWeek: number
  orphans: OrphanLineLogin[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function currentTeam(player: PlayerRow): Assignment | null {
  return player.assignments.find((a) => a.toGameWeek === null) ?? player.assignments[0] ?? null
}

// ── Component ────────────────────────────────────────────────────────────────

export default function PlayersTab({ leagueId, players, leagueTeams, maxGameWeek, orphans }: PlayersTabProps) {
  const { toast } = useToast()
  const [transferPanelId, setTransferPanelId] = useState<string | null>(null)

  async function handleRemove(playerId: string, playerName: string) {
    try {
      await removePlayerFromLeague(playerId, leagueId)
      toast(`${playerName} removed from league`)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to remove', 'error')
    }
  }

  return (
    <>
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-condensed text-[13px] font-bold uppercase tracking-[2px] text-admin-text2">
          Players ({players.length})
        </h2>
        <AssignLineDialog
          leagueId={leagueId}
          orphans={orphans}
          players={players.map((p) => ({
            id: p.id,
            name: p.name,
            hasLineLink: !!p.lineId,
          }))}
        />
      </div>

      {players.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-admin-text3 text-sm bg-admin-surface rounded-xl border border-admin-border">
          No players assigned to this league yet.
        </div>
      ) : null}

      {players.length > 0 && (
        <>
      {/* ── Mobile: card list ────────────────────────────────────────────── */}
      <div className="md:hidden bg-admin-surface rounded-xl border border-admin-border overflow-hidden divide-y divide-admin-border">
        {players.map((player) => {
          const current = currentTeam(player)
          const isTransferOpen = transferPanelId === player.id
          const hasPrevious = player.assignments.length > 1

          return (
            <div key={player.id}>
              <div className="flex items-start gap-3 px-4 py-3.5">
                <div className="flex-1 min-w-0">
                  <p className="text-admin-text font-medium text-sm">{player.name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    {hasPrevious && (
                      <span className="text-admin-text3 line-through text-xs font-mono">
                        {player.assignments[player.assignments.length - 2]?.leagueTeam.team.name}
                      </span>
                    )}
                    {hasPrevious && <ArrowRight className="w-3 h-3 text-admin-text3 shrink-0" />}
                    <span className="text-admin-text2 text-xs">
                      {current?.leagueTeam.team.name ?? '—'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    {current && (
                      <StatusBadge status={current.toGameWeek === null ? 'ACTIVE' : 'SCHEDULED'} />
                    )}
                    <span className="text-admin-text3 text-xs font-mono">
                      {current
                        ? `GW${current.fromGameWeek}${current.toGameWeek !== null ? `–${current.toGameWeek}` : '+'}`
                        : '—'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 pt-0.5">
                  <button
                    onClick={() => setTransferPanelId(isTransferOpen ? null : player.id)}
                    className={cn(
                      'flex items-center gap-1 px-2.5 min-h-[36px] rounded text-xs border transition-colors',
                      isTransferOpen
                        ? 'bg-admin-green-dim border-admin-green/30 text-admin-green'
                        : 'border-admin-border text-admin-text2 hover:border-admin-border2 hover:text-admin-text',
                    )}
                  >
                    Transfer
                    <ChevronDown className={cn('w-3 h-3 transition-transform', isTransferOpen && 'rotate-180')} />
                  </button>
                  <ConfirmDialog
                    trigger={
                      <button className="p-2 rounded text-admin-text3 hover:text-admin-red hover:bg-admin-red-dim transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center">
                        <X className="w-4 h-4" />
                      </button>
                    }
                    title={`Remove ${player.name}?`}
                    description="This will remove all league assignments for this player."
                    confirmLabel={`Remove ${player.name}`}
                    onConfirm={() => handleRemove(player.id, player.name)}
                  />
                </div>
              </div>

              {isTransferOpen && current && (
                <div className="border-t border-admin-border">
                  <TransferPanel
                    player={player}
                    currentAssignment={current}
                    leagueId={leagueId}
                    leagueTeams={leagueTeams}
                    maxGameWeek={maxGameWeek}
                    onClose={() => setTransferPanelId(null)}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Desktop: table ───────────────────────────────────────────────── */}
      <div className="hidden md:block bg-admin-surface rounded-xl border border-admin-border overflow-hidden">
        {/* Table header */}
        <div
          className="grid text-admin-text3 text-xs uppercase tracking-wider px-5 py-2.5 border-b border-admin-border bg-admin-surface2"
          style={{ gridTemplateColumns: '1fr 160px 120px 100px 100px' }}
        >
          <span>Name</span>
          <span>Team</span>
          <span>Assignment</span>
          <span>Status</span>
          <span />
        </div>

        {players.map((player) => {
          const current = currentTeam(player)
          const isTransferOpen = transferPanelId === player.id
          const hasPrevious = player.assignments.length > 1

          return (
            <div key={player.id} className="border-b border-admin-border last:border-b-0">
              <div
                className="grid items-center px-5 py-3 hover:bg-admin-surface2/50 transition-colors"
                style={{ gridTemplateColumns: '1fr 160px 120px 100px 100px' }}
              >
                <span className="text-admin-text font-medium text-sm">{player.name}</span>

                <div className="flex items-center gap-1.5 text-sm">
                  {hasPrevious && (
                    <span className="text-admin-text3 line-through text-xs font-mono">
                      {player.assignments[player.assignments.length - 2]?.leagueTeam.team.name}
                    </span>
                  )}
                  {hasPrevious && <ArrowRight className="w-3 h-3 text-admin-text3 shrink-0" />}
                  <span className="text-admin-text2">
                    {current?.leagueTeam.team.name ?? '—'}
                  </span>
                </div>

                <span className="text-admin-text3 text-xs font-mono">
                  {current
                    ? `GW${current.fromGameWeek}${current.toGameWeek !== null ? `–${current.toGameWeek}` : '+'}`
                    : '—'}
                </span>

                <span>
                  {current ? (
                    <StatusBadge status={current.toGameWeek === null ? 'ACTIVE' : 'SCHEDULED'} />
                  ) : (
                    <span className="text-admin-text3 text-xs">—</span>
                  )}
                </span>

                <div className="flex items-center justify-end gap-1.5">
                  <button
                    onClick={() => setTransferPanelId(isTransferOpen ? null : player.id)}
                    className={cn(
                      'rounded-[6px] border px-2.5 py-1 text-xs transition-colors',
                      isTransferOpen
                        ? 'bg-admin-green-dim border-admin-green/40 text-admin-green'
                        : 'border-admin-border bg-transparent text-admin-text2 hover:border-admin-border2 hover:text-admin-text',
                    )}
                  >
                    {isTransferOpen ? 'Cancel' : 'Transfer'}
                  </button>
                  <ConfirmDialog
                    trigger={
                      <button className="rounded-[6px] border border-admin-border bg-transparent px-2.5 py-1 text-xs text-admin-text2 transition-colors hover:border-admin-border2 hover:text-admin-text">
                        Remove
                      </button>
                    }
                    title={`Remove ${player.name}?`}
                    description="This will remove all league assignments for this player."
                    confirmLabel={`Remove ${player.name}`}
                    onConfirm={() => handleRemove(player.id, player.name)}
                  />
                </div>
              </div>

              {isTransferOpen && current && (
                <TransferPanel
                  player={player}
                  currentAssignment={current}
                  leagueId={leagueId}
                  leagueTeams={leagueTeams}
                  maxGameWeek={maxGameWeek}
                  onClose={() => setTransferPanelId(null)}
                />
              )}
            </div>
          )
        })}
      </div>
        </>
      )}
    </>
  )
}

// ── Transfer panel ───────────────────────────────────────────────────────────

interface TransferPanelProps {
  player: PlayerRow
  currentAssignment: Assignment
  leagueId: string
  leagueTeams: LeagueTeamRef[]
  maxGameWeek: number
  onClose: () => void
}

function TransferPanel({
  player,
  currentAssignment,
  leagueId,
  leagueTeams,
  maxGameWeek,
  onClose,
}: TransferPanelProps) {
  const { toast } = useToast()
  const [toTeamId, setToTeamId] = useState('')
  const [fromGW, setFromGW] = useState(currentAssignment.fromGameWeek + 1)
  const [pending, startTransition] = useTransition()

  const futureGWs = Array.from(
    { length: Math.max(0, maxGameWeek - currentAssignment.fromGameWeek) },
    (_, i) => currentAssignment.fromGameWeek + i + 1,
  )

  const otherTeams = leagueTeams.filter((lt) => lt.id !== currentAssignment.leagueTeam.id)

  function handleTransfer() {
    if (!toTeamId) return
    startTransition(async () => {
      try {
        await transferPlayer(player.id, currentAssignment.leagueTeam.id, toTeamId, fromGW, leagueId)
        toast(`${player.name} transferred`)
        onClose()
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Transfer failed', 'error')
      }
    })
  }

  return (
    <div className="mx-4 md:mx-5 my-3 p-4 bg-admin-surface3 rounded-md border border-admin-border">
      <p className="font-condensed text-[15px] font-bold tracking-[0.5px] text-admin-text mb-4">
        Transfer {player.name}
      </p>
      <div className="flex flex-col md:flex-row md:items-end gap-3 md:gap-4">
        {/* From (readonly) */}
        <div className="w-full md:flex-1 flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-[1.5px] text-admin-text3">From team</label>
          <div className="text-sm text-admin-text2 py-2">
            {currentAssignment.leagueTeam.team.name} <span className="text-admin-text3">(current)</span>
          </div>
        </div>

        <ArrowRight className="hidden md:block w-4 h-4 text-admin-text3 mb-2.5 shrink-0" />

        {/* To */}
        <div className="w-full md:flex-1 flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-[1.5px] text-admin-text3">To team</label>
          <select
            value={toTeamId}
            onChange={(e) => setToTeamId(e.target.value)}
            className="w-full bg-admin-surface2 border border-admin-border2 text-admin-text text-sm rounded-md px-3 py-[9px] outline-none"
          >
            <option value="">Select team…</option>
            {otherTeams.map((lt) => (
              <option key={lt.id} value={lt.id}>{lt.team.name}</option>
            ))}
          </select>
        </div>

        {/* Effective from GW */}
        <div className="w-full md:w-auto flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-[1.5px] text-admin-text3">Effective from</label>
          <select
            value={fromGW}
            onChange={(e) => setFromGW(Number(e.target.value))}
            className="w-full md:w-auto bg-admin-surface2 border border-admin-border2 text-admin-text text-sm rounded-md px-3 py-[9px] font-mono outline-none"
          >
            {futureGWs.map((gw) => (
              <option key={gw} value={gw}>GW{gw}</option>
            ))}
          </select>
        </div>

        {/* Buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleTransfer}
            disabled={!toTeamId || pending}
            className="flex-1 md:flex-none rounded-[6px] bg-admin-green px-3.5 py-1.5 text-[13px] font-semibold tracking-[0.2px] text-admin-ink hover:opacity-90 disabled:opacity-50"
          >
            {pending ? 'Transferring…' : 'Confirm Transfer'}
          </button>
          <button
            onClick={onClose}
            className="flex-1 md:flex-none rounded-[6px] border border-admin-border bg-transparent px-3.5 py-1.5 text-[13px] font-semibold tracking-[0.2px] text-admin-text2 hover:border-admin-border2 hover:text-admin-text"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
