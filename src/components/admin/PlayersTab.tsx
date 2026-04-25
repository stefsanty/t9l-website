'use client'

import { useState, useTransition } from 'react'
import { ArrowRight, X, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import StatusBadge from './StatusBadge'
import ConfirmDialog from './ConfirmDialog'
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
  assignments: Assignment[]
}

interface PlayersTabProps {
  leagueId: string
  players: PlayerRow[]
  leagueTeams: LeagueTeamRef[]
  maxGameWeek: number
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function currentTeam(player: PlayerRow): Assignment | null {
  return player.assignments.find((a) => a.toGameWeek === null) ?? player.assignments[0] ?? null
}

// ── Component ────────────────────────────────────────────────────────────────

export default function PlayersTab({ leagueId, players, leagueTeams, maxGameWeek }: PlayersTabProps) {
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
    <div className="bg-admin-surface rounded-xl border border-admin-border overflow-hidden">
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

      {players.length === 0 && (
        <div className="flex items-center justify-center py-12 text-admin-text3 text-sm">
          No players assigned to this league yet.
        </div>
      )}

      {players.map((player) => {
        const current = currentTeam(player)
        const isTransferOpen = transferPanelId === player.id
        const latestTeam = player.assignments[player.assignments.length - 1]
        const hasPrevious = player.assignments.length > 1

        return (
          <div key={player.id} className="border-b border-admin-border last:border-b-0">
            {/* Player row */}
            <div
              className="grid items-center px-5 py-3 hover:bg-admin-surface2/50 transition-colors"
              style={{ gridTemplateColumns: '1fr 160px 120px 100px 100px' }}
            >
              {/* Name */}
              <span className="text-admin-text font-medium text-sm">{player.name}</span>

              {/* Team */}
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

              {/* Assignment GW range */}
              <span className="text-admin-text3 text-xs font-mono">
                {current ? `GW${current.fromGameWeek}${current.toGameWeek !== null ? `–${current.toGameWeek}` : '+'}` : '—'}
              </span>

              {/* Status */}
              <span>
                {current ? (
                  <StatusBadge status={current.toGameWeek === null ? 'ACTIVE' : 'SCHEDULED'} />
                ) : (
                  <span className="text-admin-text3 text-xs">—</span>
                )}
              </span>

              {/* Actions */}
              <div className="flex items-center gap-1 justify-end">
                <button
                  onClick={() => setTransferPanelId(isTransferOpen ? null : player.id)}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1 rounded text-xs border transition-colors',
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
                    <button className="p-1.5 rounded text-admin-text3 hover:text-admin-red hover:bg-admin-red-dim transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  }
                  title={`Remove ${player.name}?`}
                  description="This will remove all league assignments for this player."
                  confirmLabel={`Remove ${player.name}`}
                  onConfirm={() => handleRemove(player.id, player.name)}
                />
              </div>
            </div>

            {/* Inline transfer panel */}
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
    <div className="mx-5 mb-3 p-4 bg-admin-surface3 rounded-lg border border-admin-border">
      <p className="text-admin-text3 text-xs uppercase tracking-wider mb-3">Transfer {player.name}</p>
      <div className="flex items-end gap-4">
        {/* From (readonly) */}
        <div className="flex-1">
          <label className="block text-admin-text3 text-xs mb-1.5">From</label>
          <div className="bg-admin-surface2 border border-admin-border rounded px-3 py-2 text-admin-text2 text-sm">
            {currentAssignment.leagueTeam.team.name}
          </div>
        </div>

        <ArrowRight className="w-4 h-4 text-admin-text3 mb-2.5 shrink-0" />

        {/* To */}
        <div className="flex-1">
          <label className="block text-admin-text3 text-xs mb-1.5">To</label>
          <select
            value={toTeamId}
            onChange={(e) => setToTeamId(e.target.value)}
            className="w-full bg-admin-surface2 border border-admin-border text-admin-text text-sm rounded px-3 py-2"
          >
            <option value="">Select team…</option>
            {otherTeams.map((lt) => (
              <option key={lt.id} value={lt.id}>{lt.team.name}</option>
            ))}
          </select>
        </div>

        {/* Effective from GW */}
        <div>
          <label className="block text-admin-text3 text-xs mb-1.5">Effective from GW</label>
          <select
            value={fromGW}
            onChange={(e) => setFromGW(Number(e.target.value))}
            className="bg-admin-surface2 border border-admin-border text-admin-text text-sm rounded px-3 py-2 font-mono"
          >
            {futureGWs.map((gw) => (
              <option key={gw} value={gw}>GW{gw}</option>
            ))}
          </select>
        </div>

        {/* Buttons */}
        <div className="flex gap-2 mb-0.5">
          <button
            onClick={handleTransfer}
            disabled={!toTeamId || pending}
            className="px-4 py-2 bg-admin-green text-admin-bg text-sm font-medium rounded hover:opacity-90 disabled:opacity-50"
          >
            {pending ? 'Transferring…' : 'Confirm'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 border border-admin-border text-admin-text2 text-sm rounded hover:border-admin-border2"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
