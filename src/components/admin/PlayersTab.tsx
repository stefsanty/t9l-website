'use client'

import { useMemo, useState, useTransition } from 'react'
import { ArrowRight, X, ChevronDown, Link2Off, RefreshCw, Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import StatusBadge from './StatusBadge'
import ConfirmDialog from './ConfirmDialog'
import AssignLineDialog from './AssignLineDialog'
import AddPlayerDialog from './AddPlayerDialog'
import GenerateInviteDialog from './GenerateInviteDialog'
import PillEditor from './PillEditor'
import { useToast } from './ToastProvider'
import {
  transferPlayer,
  removePlayerFromLeague,
  adminClearLineLink,
  adminUpdatePlayerName,
} from '@/app/admin/leagues/actions'

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
  // v1.33.0 (PR ε) — `Player.name` is nullable so admins can pre-stage
  // roster slots before knowing who will fill them. Render `Unnamed` placeholder.
  name: string | null
  // v1.33.0 — `Player.position` is now a `PlayerPosition` enum at the DB
  // layer; surfaced as a string so this component remains DB-shape-agnostic.
  position: string | null
  lineId: string | null
  lineDisplayName: string | null
  linePictureUrl: string | null
  lineLastSeenAt: string | null
  assignments: Assignment[]
}

interface OrphanLineLogin {
  lineId: string
  name: string | null
  pictureUrl: string | null
  firstSeenAt: string
  lastSeenAt: string
}

interface AllLineLogin extends OrphanLineLogin {
  // v1.33.0 (PR ε) — Player.name is nullable; mirror in the linked-player ref.
  linkedPlayer: { id: string; name: string | null } | null
}

interface PlayersTabProps {
  leagueId: string
  players: PlayerRow[]
  leagueTeams: LeagueTeamRef[]
  maxGameWeek: number
  orphans: OrphanLineLogin[]
  allLineLogins: AllLineLogin[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function currentTeam(player: PlayerRow): Assignment | null {
  return player.assignments.find((a) => a.toGameWeek === null) ?? player.assignments[0] ?? null
}

/**
 * Truncate a LINE user ID to its first 8 chars + ellipsis. Full ID
 * appears on the surrounding element's `title=` attribute for hover.
 */
function shortLineId(lineId: string): string {
  return lineId.length > 10 ? `${lineId.slice(0, 8)}…` : lineId
}

/**
 * One-letter avatar fallback when the LINE picture URL is missing or
 * fails to load. First letter of the LINE display name, or `?` if the
 * display name is also missing.
 */
function avatarInitial(name: string | null): string {
  return (name?.trim()?.[0] ?? '?').toUpperCase()
}

/**
 * v1.33.0 (PR ε) — coerce a nullable Player.name into a non-null string
 * suitable for template interpolation (toasts, dialog titles, button
 * labels). The italic placeholder is rendered separately for UI surfaces
 * that can take a ReactNode (PillEditor.display); plain strings get
 * "Unnamed player" so the operator can still tell which row they
 * clicked on even before the user has filled their name via PR ζ.
 */
function nameOrPlaceholder(name: string | null): string {
  return name && name.trim() !== '' ? name : 'Unnamed player'
}

// ── Component ────────────────────────────────────────────────────────────────

export default function PlayersTab({
  leagueId,
  players,
  leagueTeams,
  maxGameWeek,
  orphans,
  allLineLogins,
}: PlayersTabProps) {
  const { toast } = useToast()
  const [transferPanelId, setTransferPanelId] = useState<string | null>(null)
  // v1.10.0 / PR B — when remapPlayerId is non-null, the AssignLineDialog
  // opens in "remap" mode locked to this player and lets the operator
  // pick from the FULL list of LINE logins (orphan + already-linked).
  const [remapPlayerId, setRemapPlayerId] = useState<string | null>(null)
  // v1.33.0 (PR ε) — invite-generation surfaces.
  // - `inviteTargetPlayerId`: per-row "Invite" button → opens GenerateInviteDialog locked to this target.
  // - `selectedForBulk`: set of playerIds toggled via desktop checkbox column.
  // - `bulkInviteOpen`: when true, the bulk dialog is mounted with `selectedForBulk` as targets.
  const [inviteTargetPlayerId, setInviteTargetPlayerId] = useState<string | null>(null)
  const [selectedForBulk, setSelectedForBulk] = useState<Set<string>>(new Set())
  const [bulkInviteOpen, setBulkInviteOpen] = useState(false)

  function toggleBulkSelected(playerId: string) {
    setSelectedForBulk((prev) => {
      const next = new Set(prev)
      if (next.has(playerId)) next.delete(playerId)
      else next.add(playerId)
      return next
    })
  }

  function clearBulkSelection() {
    setSelectedForBulk(new Set())
  }

  // Eligible bulk targets — only unlinked players (no LINE binding) can
  // receive a personal invite. The toolbar count + the bulk dialog use
  // this filter consistently.
  const bulkSelectableIds = useMemo(
    () => new Set(players.filter((p) => !p.lineId).map((p) => p.id)),
    [players],
  )
  const selectedBulkTargets = useMemo(
    () =>
      players
        .filter((p) => selectedForBulk.has(p.id) && !p.lineId)
        .map((p) => ({ id: p.id, name: p.name })),
    [players, selectedForBulk],
  )

  // v1.33.0 (PR ε) — `playerName` widens to `string | null` to accommodate
  // pre-staged Player rows. Toast text falls back to "Unnamed player" so the
  // operator gets a recognizable confirmation even when the slot has no name.
  async function handleRemove(playerId: string, playerName: string | null) {
    try {
      await removePlayerFromLeague(playerId, leagueId)
      toast(`${playerName ?? 'Unnamed player'} removed from league`)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to remove', 'error')
    }
  }

  async function handleClearLine(playerId: string, playerName: string | null) {
    try {
      await adminClearLineLink({ playerId, leagueId })
      toast(`Cleared LINE link from ${playerName ?? 'Unnamed player'}`)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to clear', 'error')
    }
  }

  async function handleRenamePlayer(playerId: string, name: string) {
    try {
      await adminUpdatePlayerName({ playerId, leagueId, name })
      toast('Player name updated')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to rename', 'error')
      throw err // surface to PillEditor so it rolls back the draft
    }
  }

  const remapTarget = remapPlayerId ? players.find((p) => p.id === remapPlayerId) ?? null : null

  return (
    <>
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="mb-4 flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-condensed text-[13px] font-bold uppercase tracking-[2px] text-admin-text2">
          Players ({players.length})
        </h2>
        <div className="flex items-center gap-2">
          {/* v1.33.0 (PR ε) — bulk-invite affordance, only visible when ≥1
              unlinked player is checked. Renders the count and clears
              selection on cancel. */}
          {selectedForBulk.size > 0 && (
            <>
              <button
                type="button"
                onClick={clearBulkSelection}
                className="text-xs text-admin-text3 hover:text-admin-text underline"
                data-testid="bulk-clear"
              >
                Clear ({selectedForBulk.size})
              </button>
              <button
                type="button"
                onClick={() => setBulkInviteOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-[6px] bg-admin-green px-2.5 py-1 text-xs font-semibold text-admin-ink hover:opacity-90"
                data-testid="bulk-generate-invites"
              >
                <Send className="w-3 h-3" />
                Generate {selectedBulkTargets.length} invite{selectedBulkTargets.length === 1 ? '' : 's'}
              </button>
            </>
          )}
          <AddPlayerDialog leagueId={leagueId} leagueTeams={leagueTeams} />
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
                  <PillEditor
                    variant="text"
                    value={player.name ?? ''}
                    display={player.name ?? <span className="italic text-admin-text3">Unnamed</span>}
                    ariaLabel={`Edit name for ${player.name ?? 'unnamed player'}`}
                    placeholder="Player name"
                    maxLength={100}
                    onSave={(next) => handleRenamePlayer(player.id, next)}
                  />
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
                  <LineInfoMobile
                    player={player}
                    onClearLine={() => handleClearLine(player.id, player.name)}
                    onRemap={() => setRemapPlayerId(player.id)}
                  />
                </div>
                <div className="flex items-center gap-1 shrink-0 pt-0.5">
                  {/* v1.33.0 (PR ε) — mobile per-row Invite button. Only
                      visible for unlinked players (linked players don't
                      need a personal invite). */}
                  {!player.lineId && (
                    <button
                      type="button"
                      onClick={() => setInviteTargetPlayerId(player.id)}
                      title="Generate invite"
                      className="p-2 rounded text-admin-text3 hover:text-admin-green hover:bg-admin-green-dim/30 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
                      data-testid={`invite-button-mobile-${player.id}`}
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  )}
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
                    title={`Remove ${nameOrPlaceholder(player.name)}?`}
                    description="This will remove all league assignments for this player."
                    confirmLabel={`Remove ${nameOrPlaceholder(player.name)}`}
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
      {/* v1.33.0 (PR ε) — added a leading 32px checkbox column for bulk-invite
          selection. Header checkbox toggles all eligible (unlinked) players;
          per-row checkbox is disabled for already-linked players (those don't
          need a personal invite). */}
      <div className="hidden md:block bg-admin-surface rounded-xl border border-admin-border overflow-hidden">
        <div
          className="grid text-admin-text3 text-xs uppercase tracking-wider px-5 py-2.5 border-b border-admin-border bg-admin-surface2"
          style={{ gridTemplateColumns: '32px 1fr 140px 220px 100px 80px 180px' }}
        >
          <span>
            <input
              type="checkbox"
              aria-label="Select all unlinked players for bulk invite"
              data-testid="bulk-select-all"
              checked={
                bulkSelectableIds.size > 0 &&
                Array.from(bulkSelectableIds).every((id) => selectedForBulk.has(id))
              }
              onChange={(e) => {
                if (e.target.checked) setSelectedForBulk(new Set(bulkSelectableIds))
                else clearBulkSelection()
              }}
              disabled={bulkSelectableIds.size === 0}
            />
          </span>
          <span>Name</span>
          <span>Team</span>
          <span>LINE</span>
          <span>Assignment</span>
          <span>Status</span>
          <span />
        </div>

        {players.map((player) => {
          const current = currentTeam(player)
          const isTransferOpen = transferPanelId === player.id
          const hasPrevious = player.assignments.length > 1
          const eligibleForInvite = !player.lineId
          const isChecked = selectedForBulk.has(player.id)

          return (
            <div key={player.id} className="border-b border-admin-border last:border-b-0" data-testid={`player-row-${player.id}`}>
              <div
                className="grid items-center px-5 py-3 hover:bg-admin-surface2/50 transition-colors"
                style={{ gridTemplateColumns: '32px 1fr 140px 220px 100px 80px 180px' }}
              >
                <span>
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleBulkSelected(player.id)}
                    disabled={!eligibleForInvite}
                    aria-label={
                      eligibleForInvite
                        ? `Select ${nameOrPlaceholder(player.name)} for bulk invite`
                        : `${nameOrPlaceholder(player.name)} already linked — invite not needed`
                    }
                    data-testid={`bulk-select-${player.id}`}
                    title={eligibleForInvite ? '' : 'Already linked to LINE'}
                  />
                </span>

                <span>
                  <PillEditor
                    variant="text"
                    value={player.name ?? ''}
                    display={player.name ?? <span className="italic text-admin-text3">Unnamed</span>}
                    ariaLabel={`Edit name for ${player.name ?? 'unnamed player'}`}
                    placeholder="Player name"
                    maxLength={100}
                    onSave={(next) => handleRenamePlayer(player.id, next)}
                  />
                </span>

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

                <LineInfoCell
                  player={player}
                  onClearLine={() => handleClearLine(player.id, player.name)}
                  onRemap={() => setRemapPlayerId(player.id)}
                />

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
                  {/* v1.33.0 (PR ε) — per-row Invite button. Visible only for
                      unlinked players (linked players don't need a personal
                      invite — they already have LINE-side identity). */}
                  {eligibleForInvite && (
                    <button
                      type="button"
                      onClick={() => setInviteTargetPlayerId(player.id)}
                      title="Generate a personal invite for this player"
                      className="inline-flex items-center gap-1 rounded-[6px] border border-admin-border bg-transparent px-2.5 py-1 text-xs text-admin-text2 transition-colors hover:border-admin-green/40 hover:text-admin-green"
                      data-testid={`invite-button-${player.id}`}
                    >
                      <Send className="w-3 h-3" />
                      Invite
                    </button>
                  )}
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
                    title={`Remove ${nameOrPlaceholder(player.name)}?`}
                    description="This will remove all league assignments for this player."
                    confirmLabel={`Remove ${nameOrPlaceholder(player.name)}`}
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

      {/* v1.10.0 / PR B — remap dialog. Mounts when an admin clicks the
          per-row "Remap" button. Surfaces the FULL LINE-login list
          (orphan + linked-elsewhere) and reuses adminLinkLineToPlayer
          to do the atomic clear-then-set. */}
      {remapTarget && (
        <AssignLineDialog
          mode="remap"
          leagueId={leagueId}
          orphans={orphans}
          allLineLogins={allLineLogins}
          players={players.map((p) => ({
            id: p.id,
            name: p.name,
            hasLineLink: !!p.lineId,
          }))}
          remapTarget={{
            id: remapTarget.id,
            name: remapTarget.name,
            currentLineId: remapTarget.lineId,
            currentLineName: remapTarget.lineDisplayName,
          }}
          onClose={() => setRemapPlayerId(null)}
        />
      )}

      {/* v1.33.0 (PR ε) — single-target invite dialog. Mounts when admin
          clicks the per-row Invite button (desktop or mobile). */}
      {inviteTargetPlayerId && (() => {
        const target = players.find((p) => p.id === inviteTargetPlayerId)
        if (!target) return null
        return (
          <GenerateInviteDialog
            mode="single"
            leagueId={leagueId}
            target={{ id: target.id, name: target.name }}
            onClose={() => setInviteTargetPlayerId(null)}
          />
        )
      })()}

      {/* v1.33.0 (PR ε) — bulk invite dialog. Mounts when admin clicks the
          toolbar "Generate N invites" button after selecting one or more
          unlinked players via the desktop checkbox column. Clears the
          selection on close so the next bulk batch starts clean. */}
      {bulkInviteOpen && selectedBulkTargets.length > 0 && (
        <GenerateInviteDialog
          mode="bulk"
          leagueId={leagueId}
          targets={selectedBulkTargets}
          onClose={() => {
            setBulkInviteOpen(false)
            clearBulkSelection()
          }}
        />
      )}
    </>
  )
}

// ── LINE info cell (desktop) ─────────────────────────────────────────────────

interface LineInfoCellProps {
  player: PlayerRow
  onClearLine: () => Promise<void>
  onRemap: () => void
}

function LineInfoCell({ player, onClearLine, onRemap }: LineInfoCellProps) {
  if (!player.lineId) {
    return (
      <div className="flex items-center gap-2 text-admin-text3 text-xs">
        <Link2Off className="w-3.5 h-3.5 opacity-60" />
        <span>Not linked</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 min-w-0" data-testid="line-info">
      <LineAvatar
        pictureUrl={player.linePictureUrl}
        displayName={player.lineDisplayName}
      />
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-admin-text text-xs font-medium truncate" data-testid="line-display-name">
          {player.lineDisplayName ?? <span className="text-admin-text3 italic">no name</span>}
        </span>
        <span
          className="text-admin-text3 text-[10px] font-mono truncate"
          title={player.lineId}
          data-testid="line-id"
        >
          {shortLineId(player.lineId)}
        </span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onRemap}
          title="Remap to a different LINE user"
          className="p-1.5 rounded text-admin-text3 hover:text-admin-text hover:bg-admin-surface3 transition-colors"
          data-testid="remap-button"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        <ConfirmDialog
          trigger={
            <button
              type="button"
              title="Unlink LINE user from this player"
              className="p-1.5 rounded text-admin-text3 hover:text-admin-red hover:bg-admin-red-dim transition-colors"
              data-testid="unlink-button"
            >
              <Link2Off className="w-3.5 h-3.5" />
            </button>
          }
          title={`Unlink LINE from ${nameOrPlaceholder(player.name)}?`}
          description={
            player.lineDisplayName
              ? `${player.lineDisplayName} (${shortLineId(player.lineId)}) will need to be re-linked from the orphan dropdown to play again.`
              : `LINE user ${shortLineId(player.lineId)} will need to be re-linked from the orphan dropdown to play again.`
          }
          confirmLabel="Unlink"
          onConfirm={onClearLine}
        />
      </div>
    </div>
  )
}

// ── LINE info row (mobile) ───────────────────────────────────────────────────

interface LineInfoMobileProps {
  player: PlayerRow
  onClearLine: () => Promise<void>
  onRemap: () => void
}

function LineInfoMobile({ player, onClearLine, onRemap }: LineInfoMobileProps) {
  if (!player.lineId) {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-admin-text3 text-[10px]">
        <Link2Off className="w-3 h-3 opacity-60" />
        <span>Not linked to LINE</span>
      </div>
    )
  }
  return (
    <div className="mt-2 flex items-center gap-2" data-testid="line-info-mobile">
      <LineAvatar
        pictureUrl={player.linePictureUrl}
        displayName={player.lineDisplayName}
      />
      <div className="flex-1 min-w-0">
        <p className="text-admin-text2 text-[11px] font-medium truncate">
          {player.lineDisplayName ?? <span className="italic text-admin-text3">no LINE name</span>}
        </p>
        <p
          className="text-admin-text3 text-[10px] font-mono truncate"
          title={player.lineId}
        >
          {shortLineId(player.lineId)}
        </p>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          type="button"
          onClick={onRemap}
          title="Remap"
          className="p-1.5 rounded text-admin-text3 hover:text-admin-text hover:bg-admin-surface3 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        <ConfirmDialog
          trigger={
            <button
              type="button"
              title="Unlink"
              className="p-1.5 rounded text-admin-text3 hover:text-admin-red hover:bg-admin-red-dim transition-colors"
            >
              <Link2Off className="w-3.5 h-3.5" />
            </button>
          }
          title={`Unlink LINE from ${nameOrPlaceholder(player.name)}?`}
          description={
            player.lineDisplayName
              ? `${player.lineDisplayName} (${shortLineId(player.lineId)}) will need to be re-linked.`
              : `LINE user ${shortLineId(player.lineId)} will need to be re-linked.`
          }
          confirmLabel="Unlink"
          onConfirm={onClearLine}
        />
      </div>
    </div>
  )
}

// ── Avatar component ─────────────────────────────────────────────────────────

interface LineAvatarProps {
  pictureUrl: string | null
  displayName: string | null
}

function LineAvatar({ pictureUrl, displayName }: LineAvatarProps) {
  // <img> rather than next/image because LINE CDN URLs are stored without
  // configuration in next.config and we don't want to crash the row on a
  // hostname not allowed by the loader. Fallback to initial-letter on
  // load error via onError handler.
  const [errored, setErrored] = useState(false)
  if (!pictureUrl || errored) {
    return (
      <div className="w-7 h-7 shrink-0 rounded-full bg-admin-surface3 border border-admin-border flex items-center justify-center text-admin-text2 text-[11px] font-bold">
        {avatarInitial(displayName)}
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={pictureUrl}
      alt={displayName ?? 'LINE avatar'}
      onError={() => setErrored(true)}
      className="w-7 h-7 shrink-0 rounded-full bg-admin-surface3 border border-admin-border object-cover"
      data-testid="line-avatar-img"
    />
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
        toast(`${nameOrPlaceholder(player.name)} transferred`)
        onClose()
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Transfer failed', 'error')
      }
    })
  }

  return (
    <div className="mx-4 md:mx-5 my-3 p-4 bg-admin-surface3 rounded-md border border-admin-border">
      <p className="font-condensed text-[15px] font-bold tracking-[0.5px] text-admin-text mb-4">
        Transfer {nameOrPlaceholder(player.name)}
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
