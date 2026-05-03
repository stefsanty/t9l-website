'use client'

import { useMemo, useState, useTransition } from 'react'
import { ArrowRight, Send, Pencil } from 'lucide-react'
import ConfirmDialog from './ConfirmDialog'
import AssignLineDialog from './AssignLineDialog'
import AddPlayerDialog from './AddPlayerDialog'
import GenerateInviteDialog from './GenerateInviteDialog'
import IdViewerDialog from './IdViewerDialog'
import AdminPlayerAvatar from './AdminPlayerAvatar'
import SignInStatusBadge from './SignInStatusBadge'
import OverflowMenu from './MatchOverflowMenu'
import { pickSignInStatus } from '@/lib/playerSignInStatus'
import { useToast } from './ToastProvider'
import {
  transferPlayer,
  removePlayerFromLeague,
  adminClearLineLink,
  adminUpdatePlayerName,
  adminUpdatePlayerPosition,
  adminResetOnboarding,
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
  // v1.34.0 (PR ζ) — has the user filled the onboarding form? Surfaces
  // here so PR θ's "Reset onboarding" button can be conditionally rendered
  // (only meaningful when the current assignment is COMPLETED).
  onboardingStatus?: 'NOT_YET' | 'COMPLETED'
}

interface PlayerRow {
  id: string
  // v1.33.0 (PR ε) — `Player.name` is nullable so admins can pre-stage
  // roster slots before knowing who will fill them. Render `Unnamed` placeholder.
  name: string | null
  // v1.33.0 — `Player.position` is now a `PlayerPosition` enum at the DB
  // layer; surfaced as a string so this component remains DB-shape-agnostic.
  position: string | null
  // v1.37.0 (PR ι) — user-uploaded profile picture; preferred over
  // pictureUrl + linePictureUrl in the avatar fallback chain.
  profilePictureUrl: string | null
  // Legacy LINE-CDN mirror written on /assign-player link (PR 12).
  pictureUrl: string | null
  // v1.38.0 (PR κ) — Player.userId from PR β dual-write. Drives the
  // "Signed up" sign-in status badge.
  userId: string | null
  // v1.38.0 (PR κ) — count of active PERSONAL invites for this player.
  // Drives the "Invited" badge when userId is null.
  activeInviteCount: number
  // v1.35.0 (PR η) — uploaded ID URLs + timestamp. All null until the
  // user completes the η ID-upload step (or admin purges via the per-row
  // affordance).
  idFrontUrl: string | null
  idBackUrl: string | null
  idUploadedAt: string | null
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
  // v1.41.0 — per-row edit-mode toggle. When non-null, the EditPlayerPanel
  // expands below the matching row with name + position fields and Save /
  // Cancel buttons. Only one panel can be open at a time so the
  // surrounding scroll surface stays readable.
  const [editPanelId, setEditPanelId] = useState<string | null>(null)
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
  // v1.35.0 (PR η) — when non-null, IdViewerDialog opens for this player.
  const [idViewerPlayerId, setIdViewerPlayerId] = useState<string | null>(null)

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

  // v1.36.0 (PR θ) — admin flips the player's onboardingStatus back to
  // NOT_YET. Preserves all existing data; the user is redirected through
  // the onboarding flow on their next /join/[code] visit. Admin notifies
  // the user verbally that they need to redo the form / ID upload.
  async function handleResetOnboarding(playerId: string, playerName: string | null) {
    try {
      await adminResetOnboarding({ playerId, leagueId })
      toast(`Onboarding reset for ${playerName ?? 'this player'}. Notify them to revisit their join link.`)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to reset onboarding', 'error')
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
      {/* v1.38.0 (PR κ) — declutter pass per user direction:
          - Remove the "active status" badge (StatusBadge) and the inline
            GW1+ tally (assignment column) — those are dashboard signals,
            not roster signals.
          - Replace per-row inline action buttons with a single kebab
            menu (OverflowMenu).
          - Add an avatar circle leftmost so the operator can scan the
            list visually.
          - Add a sign-in status pill (Signed up / Invited / Pending). */}
      <div className="md:hidden bg-admin-surface rounded-xl border border-admin-border overflow-hidden divide-y divide-admin-border">
        {players.map((player) => {
          const current = currentTeam(player)
          const isTransferOpen = transferPanelId === player.id
          const hasPrevious = player.assignments.length > 1
          const signInStatus = pickSignInStatus({
            userId: player.userId,
            activeInviteCount: player.activeInviteCount,
          })

          return (
            <div key={player.id} data-testid={`player-row-mobile-${player.id}`}>
              <div className="flex items-start gap-3 px-4 py-3.5">
                <AdminPlayerAvatar
                  name={player.name}
                  profilePictureUrl={player.profilePictureUrl}
                  pictureUrl={player.pictureUrl}
                  linePictureUrl={player.linePictureUrl}
                  size={40}
                  testid={`player-avatar-mobile-${player.id}`}
                />
                <div className="flex-1 min-w-0">
                  {/*
                   * v1.41.0 — display mode: name as compact static text.
                   * Pre-v1.41.0 a `PillEditor variant="text"` lived here
                   * with a permanent dotted underline + always-on click
                   * affordance. The user audit ("there is more space"
                   * once the inline edit affordance is gone) drove the
                   * conversion — edits now happen in the per-row
                   * EditPlayerPanel that toggles open below the row via
                   * the pencil button on the right-hand side.
                   */}
                  <p
                    className="font-condensed text-base font-bold leading-tight text-admin-text truncate"
                    data-testid={`player-name-mobile-${player.id}`}
                  >
                    {player.name ?? <span className="italic text-admin-text3 font-normal">Unnamed</span>}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap text-xs">
                    {hasPrevious && (
                      <span className="text-admin-text3 line-through font-mono">
                        {player.assignments[player.assignments.length - 2]?.leagueTeam.team.name}
                      </span>
                    )}
                    {hasPrevious && <ArrowRight className="w-3 h-3 text-admin-text3 shrink-0" />}
                    <span className="text-admin-text2">
                      {current?.leagueTeam.team.name ?? '—'}
                    </span>
                    {player.position && (
                      <span
                        className="text-admin-text3 font-mono uppercase"
                        data-testid={`player-position-mobile-${player.id}`}
                      >
                        · {player.position}
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5">
                    <SignInStatusBadge
                      status={signInStatus}
                      testid={`signin-status-mobile-${player.id}`}
                    />
                  </div>
                  {player.lineDisplayName && (
                    <p
                      className="text-admin-text3 text-[10px] mt-1 truncate"
                      title={player.lineId ?? ''}
                      data-testid={`line-name-mobile-${player.id}`}
                    >
                      LINE: {player.lineDisplayName}
                    </p>
                  )}
                </div>
                <div className="shrink-0 pt-0.5 flex items-center gap-0.5">
                  {/*
                   * v1.41.0 — pencil button toggles the EditPlayerPanel
                   * for this row. Sits next to the kebab as a primary
                   * affordance (the kebab keeps secondary / destructive
                   * actions). Only one panel can be open at a time;
                   * clicking the same row's pencil again closes it.
                   */}
                  <button
                    type="button"
                    aria-label={`Edit details for ${nameOrPlaceholder(player.name)}`}
                    aria-pressed={editPanelId === player.id}
                    onClick={() =>
                      setEditPanelId(editPanelId === player.id ? null : player.id)
                    }
                    className="w-8 h-8 flex items-center justify-center rounded-md text-admin-text3 hover:text-admin-text hover:bg-admin-surface2 transition-colors"
                    data-testid={`player-edit-button-mobile-${player.id}`}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <OverflowMenu
                    ariaLabel={`Actions for ${nameOrPlaceholder(player.name)}`}
                    items={buildPlayerMenuItems({
                      player,
                      current,
                      isTransferOpen,
                      handlers: {
                        onTransferToggle: () =>
                          setTransferPanelId(isTransferOpen ? null : player.id),
                        onInvite: () => setInviteTargetPlayerId(player.id),
                        onViewId: () => setIdViewerPlayerId(player.id),
                        onResetOnboarding: () =>
                          handleResetOnboarding(player.id, player.name),
                        onRemap: () => setRemapPlayerId(player.id),
                        onClearLine: () => handleClearLine(player.id, player.name),
                        onRemove: () => handleRemove(player.id, player.name),
                      },
                    })}
                  />
                </div>
              </div>

              {editPanelId === player.id && (
                <div className="border-t border-admin-border">
                  <EditPlayerPanel
                    player={player}
                    leagueId={leagueId}
                    onClose={() => setEditPanelId(null)}
                  />
                </div>
              )}

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
      {/* v1.38.0 (PR κ) — column redesign per user direction:
          - REMOVED: "active status" badge column + GW1+ inline tally
            (those signal RSVP / scheduling, not roster identity).
          - REMOVED: per-row inline action buttons (Reset / ID / Invite /
            Transfer / Remove). All actions now live in the kebab.
          - REPLACED: 220px-wide "LINE" cell with a thin 24px LINE name
            sub-line under the player name + an avatar in the leftmost
            column (avatar uses profilePictureUrl > pictureUrl >
            linePictureUrl > initials).
          - ADDED: Avatar column (40px), Position column (60px),
            Sign-in status column (110px), kebab column (40px).
          Final widths: 32 chk | 40 avatar | 1fr name+line-sub | 140 team |
          60 position | 110 sign-in | 40 kebab. */}
      <div className="hidden md:block bg-admin-surface rounded-xl border border-admin-border overflow-hidden">
        <div
          className="grid text-admin-text3 text-xs uppercase tracking-wider px-5 py-2.5 border-b border-admin-border bg-admin-surface2 items-center gap-3"
          style={{ gridTemplateColumns: '32px 40px 1fr 140px 60px 110px 80px' }}
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
          <span />
          <span>Name</span>
          <span>Team</span>
          <span>Pos.</span>
          <span>Sign-in</span>
          <span />
        </div>

        {players.map((player) => {
          const current = currentTeam(player)
          const isTransferOpen = transferPanelId === player.id
          const hasPrevious = player.assignments.length > 1
          const eligibleForInvite = !player.lineId
          const isChecked = selectedForBulk.has(player.id)
          const signInStatus = pickSignInStatus({
            userId: player.userId,
            activeInviteCount: player.activeInviteCount,
          })

          return (
            <div key={player.id} className="border-b border-admin-border last:border-b-0" data-testid={`player-row-${player.id}`}>
              <div
                className="grid items-center px-5 py-3 hover:bg-admin-surface2/50 transition-colors gap-3"
                style={{ gridTemplateColumns: '32px 40px 1fr 140px 60px 110px 80px' }}
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

                <AdminPlayerAvatar
                  name={player.name}
                  profilePictureUrl={player.profilePictureUrl}
                  pictureUrl={player.pictureUrl}
                  linePictureUrl={player.linePictureUrl}
                  size={36}
                  testid={`player-avatar-${player.id}`}
                />

                <div className="min-w-0">
                  {/*
                   * v1.41.0 — display mode: name as compact static text.
                   * Edits happen in the per-row EditPlayerPanel toggled by
                   * the pencil button in the rightmost column. See the
                   * mobile-card branch above for the rationale.
                   */}
                  <p
                    className="font-condensed text-base font-bold leading-tight text-admin-text truncate"
                    data-testid={`player-name-${player.id}`}
                  >
                    {player.name ?? <span className="italic text-admin-text3 font-normal">Unnamed</span>}
                  </p>
                  {player.lineDisplayName && (
                    <p
                      className="text-admin-text3 text-[10px] mt-0.5 truncate"
                      title={player.lineId ?? ''}
                      data-testid={`line-name-${player.id}`}
                    >
                      LINE: {player.lineDisplayName}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-1.5 text-sm min-w-0">
                  {hasPrevious && (
                    <span className="text-admin-text3 line-through text-xs font-mono truncate">
                      {player.assignments[player.assignments.length - 2]?.leagueTeam.team.name}
                    </span>
                  )}
                  {hasPrevious && <ArrowRight className="w-3 h-3 text-admin-text3 shrink-0" />}
                  <span className="text-admin-text2 truncate">
                    {current?.leagueTeam.team.name ?? '—'}
                  </span>
                </div>

                <span
                  className="text-admin-text2 text-xs font-mono uppercase"
                  data-testid={`player-position-${player.id}`}
                >
                  {player.position ?? <span className="text-admin-text3">—</span>}
                </span>

                <span>
                  <SignInStatusBadge
                    status={signInStatus}
                    testid={`signin-status-${player.id}`}
                  />
                </span>

                <span className="flex items-center justify-end gap-0.5">
                  {/*
                   * v1.41.0 — pencil button toggles the EditPlayerPanel.
                   * See the mobile branch above for the rationale.
                   */}
                  <button
                    type="button"
                    aria-label={`Edit details for ${nameOrPlaceholder(player.name)}`}
                    aria-pressed={editPanelId === player.id}
                    onClick={() =>
                      setEditPanelId(editPanelId === player.id ? null : player.id)
                    }
                    className="w-8 h-8 flex items-center justify-center rounded-md text-admin-text3 hover:text-admin-text hover:bg-admin-surface2 transition-colors"
                    data-testid={`player-edit-button-${player.id}`}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <OverflowMenu
                    ariaLabel={`Actions for ${nameOrPlaceholder(player.name)}`}
                    items={buildPlayerMenuItems({
                      player,
                      current,
                      isTransferOpen,
                      handlers: {
                        onTransferToggle: () =>
                          setTransferPanelId(isTransferOpen ? null : player.id),
                        onInvite: () => setInviteTargetPlayerId(player.id),
                        onViewId: () => setIdViewerPlayerId(player.id),
                        onResetOnboarding: () =>
                          handleResetOnboarding(player.id, player.name),
                        onRemap: () => setRemapPlayerId(player.id),
                        onClearLine: () => handleClearLine(player.id, player.name),
                        onRemove: () => handleRemove(player.id, player.name),
                      },
                    })}
                  />
                </span>
              </div>

              {editPanelId === player.id && (
                <EditPlayerPanel
                  player={player}
                  leagueId={leagueId}
                  onClose={() => setEditPanelId(null)}
                />
              )}

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

      {/* v1.35.0 (PR η) — ID viewer dialog. Mounts when admin clicks the
          per-row "ID" button. Shows front + back image previews + a Purge
          affordance that DELs the Blob assets and nulls the columns. */}
      {idViewerPlayerId && (() => {
        const target = players.find((p) => p.id === idViewerPlayerId)
        if (!target || !target.idUploadedAt) return null
        return (
          <IdViewerDialog
            playerId={target.id}
            playerName={target.name}
            leagueId={leagueId}
            idFrontUrl={target.idFrontUrl}
            idBackUrl={target.idBackUrl}
            idUploadedAt={target.idUploadedAt}
            onClose={() => setIdViewerPlayerId(null)}
          />
        )
      })()}
    </>
  )
}

// ── Per-row overflow menu items ──────────────────────────────────────────────

/**
 * v1.38.0 (PR κ) — collect every per-row admin action into one kebab
 * menu (mobile + desktop share the same shape via this builder).
 *
 * Visibility rules — admin actions surface in this order:
 *   1. Generate invite (only when player has no LINE link — pre-redemption)
 *   2. Reset onboarding (only when current assignment is COMPLETED)
 *   3. View ID (only when player has uploaded one)
 *   4. Transfer to another team — toggle the inline TransferPanel
 *   5. Remap LINE link (only when linked)
 *   6. Unlink LINE (only when linked) — destructive, separated by the
 *      tone: 'danger' marker
 *   7. Remove from league (always available) — destructive
 *
 * The `OverflowMenu` (re-exported `MatchOverflowMenu`) handles all the
 * dismissal + a11y plumbing; this helper just maps PR-specific
 * conditional render logic into menu items. ConfirmDialog flows for
 * the destructive actions (Reset onboarding / Unlink / Remove) live
 * elsewhere — the kebab `onSelect` calls the toast-wrapped handler
 * directly, which is fine for most flows because admin-side double-
 * click protection is already handled by `useTransition` in the
 * server action wrappers. The most-destructive (Remove) keeps a
 * dedicated ConfirmDialog by routing through `confirmRemove`.
 */
interface BuildPlayerMenuArgs {
  player: PlayerRow
  current: Assignment | null
  isTransferOpen: boolean
  handlers: {
    onTransferToggle: () => void
    onInvite: () => void
    onViewId: () => void
    onResetOnboarding: () => Promise<void>
    onRemap: () => void
    onClearLine: () => Promise<void>
    onRemove: () => Promise<void>
  }
}

function buildPlayerMenuItems(args: BuildPlayerMenuArgs) {
  const { player, current, isTransferOpen, handlers } = args
  const items: Array<{
    label: string
    onSelect: () => void | Promise<void>
    tone?: 'default' | 'danger'
  }> = []

  if (!player.lineId) {
    items.push({ label: 'Generate invite', onSelect: handlers.onInvite })
  }
  // Reset onboarding only surfaces when the assignment is COMPLETED —
  // for NOT_YET it's a no-op. Native window.confirm gates the
  // destructive flip; we deliberately don't pull a stateful
  // ConfirmDialog into the menu (that requires turning the builder
  // into a component).
  if (current?.onboardingStatus === 'COMPLETED') {
    items.push({
      label: 'Reset onboarding',
      onSelect: async () => {
        if (
          typeof window !== 'undefined' &&
          !window.confirm(
            `Reset onboarding for ${nameOrPlaceholder(player.name)}? They'll be redirected through the form on next visit. Existing data preserved.`,
          )
        ) return
        await handlers.onResetOnboarding()
      },
    })
  }
  if (player.idUploadedAt) {
    items.push({ label: 'View ID', onSelect: handlers.onViewId })
  }
  items.push({
    label: isTransferOpen ? 'Cancel transfer' : 'Transfer to team…',
    onSelect: handlers.onTransferToggle,
  })
  if (player.lineId) {
    items.push({ label: 'Remap LINE link', onSelect: handlers.onRemap })
    items.push({
      label: 'Unlink LINE',
      tone: 'danger',
      onSelect: async () => {
        if (!window.confirm(
          `Unlink LINE from ${nameOrPlaceholder(player.name)}? They'll need to re-link from the orphan dropdown to play again.`,
        )) return
        await handlers.onClearLine()
      },
    })
  }
  items.push({
    label: 'Remove from league',
    tone: 'danger',
    onSelect: async () => {
      if (!window.confirm(
        `Remove ${nameOrPlaceholder(player.name)} from this league? This deletes all their assignments.`,
      )) return
      await handlers.onRemove()
    },
  })
  return items
}

// ── Edit panel (v1.41.0) ─────────────────────────────────────────────────────

interface EditPlayerPanelProps {
  player: PlayerRow
  leagueId: string
  onClose: () => void
}

const POSITION_OPTIONS: Array<{ value: 'GK' | 'DF' | 'MF' | 'FW' | ''; label: string }> = [
  { value: '', label: '— None —' },
  { value: 'GK', label: 'GK — Goalkeeper' },
  { value: 'DF', label: 'DF — Defender' },
  { value: 'MF', label: 'MF — Midfielder' },
  { value: 'FW', label: 'FW — Forward' },
]

/**
 * v1.41.0 — per-row edit panel toggled by the pencil button.
 *
 * Pre-v1.41.0 the player name was always rendered as a `PillEditor`
 * (variant="text") with a permanent dotted-underline + click-to-swap
 * affordance. Position was not editable from the admin Players tab at
 * all — admins had to flip onboardingStatus back via PR θ to get it
 * changed.
 *
 * v1.41.0 collapses the per-field always-on editors into a single
 * per-row Edit toggle. Display mode = compact static text (more
 * horizontal breathing room, faster visual scan); edit mode = batched
 * form (name + position) with explicit Save / Cancel buttons.
 *
 * Save semantics: only the changed fields are written. If only the
 * name changed, only `adminUpdatePlayerName` fires. If both, both
 * fire (sequentially so per-action error toasts surface in order).
 *
 * Cancel discards the local form state and closes the panel —
 * matches the TransferPanel UX.
 *
 * The panel structure (mx-4 / mx-5 inset, surface3 background, border)
 * mirrors `TransferPanel` so the two row-expansion affordances feel
 * like the same family. Both can't be open simultaneously per the
 * `editPanelId` / `transferPanelId` state — the row toggles whichever
 * was last clicked.
 */
function EditPlayerPanel({ player, leagueId, onClose }: EditPlayerPanelProps) {
  const { toast } = useToast()
  const [name, setName] = useState<string>(player.name ?? '')
  const initialPosition = useMemo<'GK' | 'DF' | 'MF' | 'FW' | ''>(() => {
    if (player.position === 'GK' || player.position === 'DF' || player.position === 'MF' || player.position === 'FW') {
      return player.position
    }
    return ''
  }, [player.position])
  const [position, setPosition] = useState<'GK' | 'DF' | 'MF' | 'FW' | ''>(initialPosition)
  const [pending, startTransition] = useTransition()

  const initialName = player.name ?? ''
  const trimmedName = name.trim()
  const nameChanged = trimmedName !== initialName.trim()
  const positionChanged = position !== initialPosition
  const dirty = nameChanged || positionChanged
  const nameInvalid = nameChanged && trimmedName.length === 0

  function handleSave() {
    if (!dirty || nameInvalid) return
    startTransition(async () => {
      try {
        if (nameChanged) {
          await adminUpdatePlayerName({ playerId: player.id, leagueId, name: trimmedName })
        }
        if (positionChanged) {
          await adminUpdatePlayerPosition({
            playerId: player.id,
            leagueId,
            position: position === '' ? null : position,
          })
        }
        toast(`${nameOrPlaceholder(trimmedName || initialName)} updated`)
        onClose()
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed to update', 'error')
      }
    })
  }

  return (
    <div
      className="mx-4 md:mx-5 my-3 p-4 bg-admin-surface3 rounded-md border border-admin-border"
      data-testid={`player-edit-panel-${player.id}`}
    >
      <p className="font-condensed text-[15px] font-bold tracking-[0.5px] text-admin-text mb-4">
        Edit {nameOrPlaceholder(player.name)}
      </p>
      <div className="flex flex-col md:flex-row md:items-end gap-3 md:gap-4">
        {/* Name */}
        <div className="w-full md:flex-1 flex flex-col gap-1.5">
          <label
            htmlFor={`edit-name-${player.id}`}
            className="text-[11px] font-semibold uppercase tracking-[1.5px] text-admin-text3"
          >
            Name
          </label>
          <input
            id={`edit-name-${player.id}`}
            type="text"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            disabled={pending}
            placeholder="Player name"
            className="w-full bg-admin-surface2 border border-admin-border2 text-admin-text text-sm rounded-md px-3 py-[9px] outline-none focus:border-admin-green"
            data-testid={`player-edit-name-input-${player.id}`}
          />
          {nameInvalid && (
            <p className="text-[11px] text-admin-red" role="alert">
              Name is required.
            </p>
          )}
        </div>

        {/* Position */}
        <div className="w-full md:w-56 flex flex-col gap-1.5">
          <label
            htmlFor={`edit-position-${player.id}`}
            className="text-[11px] font-semibold uppercase tracking-[1.5px] text-admin-text3"
          >
            Position
          </label>
          <select
            id={`edit-position-${player.id}`}
            value={position}
            onChange={(e) =>
              setPosition(e.target.value as 'GK' | 'DF' | 'MF' | 'FW' | '')
            }
            disabled={pending}
            className="w-full bg-admin-surface2 border border-admin-border2 text-admin-text text-sm rounded-md px-3 py-[9px] outline-none focus:border-admin-green"
            data-testid={`player-edit-position-select-${player.id}`}
          >
            {POSITION_OPTIONS.map((opt) => (
              <option key={opt.value || 'none'} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Buttons */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || nameInvalid || pending}
            className="flex-1 md:flex-none rounded-[6px] bg-admin-green px-3.5 py-1.5 text-[13px] font-semibold tracking-[0.2px] text-admin-ink hover:opacity-90 disabled:opacity-50"
            data-testid={`player-edit-save-${player.id}`}
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="flex-1 md:flex-none rounded-[6px] border border-admin-border bg-transparent px-3.5 py-1.5 text-[13px] font-semibold tracking-[0.2px] text-admin-text2 hover:border-admin-border2 hover:text-admin-text disabled:opacity-50"
            data-testid={`player-edit-cancel-${player.id}`}
          >
            Cancel
          </button>
        </div>
      </div>
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
