'use client'

import { useEffect, useState, useTransition } from 'react'
import { Plus, X } from 'lucide-react'
import { adminLinkLineToPlayer } from '@/app/admin/leagues/actions'
import { useToast } from './ToastProvider'

interface OrphanLineLogin {
  lineId: string
  name: string | null
  pictureUrl: string | null
  firstSeenAt: string  // serialized from server component
  lastSeenAt: string
}

interface AllLineLogin extends OrphanLineLogin {
  // v1.33.0 (PR ε) — Player.name is now nullable.
  linkedPlayer: { id: string; name: string | null } | null
}

interface PlayerOption {
  id: string         // DB Player.id (with p- prefix)
  // v1.33.0 (PR ε) — Player.name is nullable; renderer falls back to "Unnamed".
  name: string | null
  hasLineLink: boolean
}

interface RemapTarget {
  id: string
  // v1.33.0 (PR ε) — Player.name is nullable.
  name: string | null
  currentLineId: string | null
  currentLineName: string | null
}

interface BaseProps {
  leagueId: string
  orphans: OrphanLineLogin[]
  players: PlayerOption[]
}

interface AssignProps extends BaseProps {
  mode?: undefined | 'assign'
  allLineLogins?: never
  remapTarget?: never
  onClose?: never
}

interface RemapProps extends BaseProps {
  mode: 'remap'
  allLineLogins: AllLineLogin[]
  remapTarget: RemapTarget
  onClose: () => void
}

type Props = AssignProps | RemapProps

/**
 * Two-mode dialog driving admin LINE-user link operations.
 *
 * Default mode (`mode` omitted or 'assign'): the original PR 6 / Flow B
 * affordance. Renders a "+ Assign Player (n)" button that opens a modal
 * showing the orphan LINE-user dropdown and a target-player dropdown.
 *
 * v1.10.0 / PR B remap mode (`mode="remap"`): mounted directly by the
 * parent when the admin clicks the per-row Remap button. The target
 * player is pre-selected and locked; the LINE-user dropdown shows
 * BOTH orphan and currently-linked-elsewhere LINE users. Picking a
 * linked-elsewhere user surfaces a clear "this will unlink {OldPlayer}"
 * warning. The atomic clear-then-set is handled by the existing
 * `adminLinkLineToPlayer` server action.
 */
export default function AssignLineDialog(props: Props) {
  const isRemap = props.mode === 'remap'
  const [open, setOpen] = useState(isRemap) // remap mode opens immediately
  const [selectedLineId, setSelectedLineId] = useState<string>('')
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>(
    isRemap ? props.remapTarget.id : '',
  )
  const [pending, startTransition] = useTransition()
  const { toast } = useToast()

  // Close handler routes back to the parent in remap mode (so the
  // controlled `remapPlayerId` state can clear), or just toggles
  // local `open` in assign mode.
  function handleClose() {
    if (isRemap) {
      props.onClose()
    } else {
      setOpen(false)
      setSelectedLineId('')
      setSelectedPlayerId('')
    }
  }

  // Keep ESC behavior consistent
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function handleConfirm() {
    if (!selectedLineId || !selectedPlayerId) return
    startTransition(async () => {
      try {
        await adminLinkLineToPlayer({
          playerId: selectedPlayerId,
          lineId: selectedLineId,
          leagueId: props.leagueId,
        })
        if (isRemap) {
          const picked =
            props.allLineLogins.find((o) => o.lineId === selectedLineId) ?? null
          toast(
            `Remapped ${picked?.name ?? selectedLineId} → ${props.remapTarget.name ?? 'Unnamed player'}`,
            'success',
          )
        } else {
          const orphan = props.orphans.find((o) => o.lineId === selectedLineId)
          const player = props.players.find((p) => p.id === selectedPlayerId)
          toast(
            `Linked ${orphan?.name ?? selectedLineId} → ${player?.name ?? 'Unnamed player'}`,
            'success',
          )
        }
        handleClose()
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Link failed', 'error')
      }
    })
  }

  // Assign-mode toolbar button. Hidden entirely in remap mode (parent
  // renders the dialog directly when the per-row Remap button is clicked).
  const assignToolbarButton = !isRemap ? (
    <button
      type="button"
      onClick={() => setOpen(true)}
      disabled={props.orphans.length === 0}
      title={
        props.orphans.length === 0
          ? 'No orphan LINE logins waiting'
          : 'Assign an orphan LINE login to a player'
      }
      className="inline-flex items-center gap-1.5 rounded-[6px] bg-admin-green px-2.5 py-1 text-xs font-semibold text-admin-ink hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Plus className="w-3 h-3" />
      Assign Player {props.orphans.length > 0 ? <span className="font-mono">({props.orphans.length})</span> : null}
    </button>
  ) : null

  // The dropdown source differs by mode. Remap shows ALL logins with a
  // distinguishing suffix for those already linked to another player.
  const lineUserOptions = isRemap
    ? props.allLineLogins.filter((l) =>
        // Hide the target's own current LINE user from the picker — it
        // would be a no-op self-remap.
        l.lineId !== props.remapTarget.currentLineId,
      )
    : props.orphans

  // Lookup for the warning banner: did the admin pick a LINE user that
  // is currently linked to a different player?
  const pickedLineUser = isRemap
    ? props.allLineLogins.find((l) => l.lineId === selectedLineId) ?? null
    : null
  const willUnlinkPlayer =
    isRemap && pickedLineUser?.linkedPlayer && pickedLineUser.linkedPlayer.id !== props.remapTarget.id
      ? pickedLineUser.linkedPlayer
      : null

  return (
    <>
      {assignToolbarButton}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={handleClose} />
          <div className="relative bg-admin-surface border border-admin-border rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-admin-text font-condensed font-bold text-lg">
                {isRemap ? `Remap LINE for ${props.remapTarget.name ?? 'Unnamed player'}` : 'Assign LINE login'}
              </h3>
              <button onClick={handleClose} className="text-admin-text3 hover:text-admin-text">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-admin-text2 text-sm mb-4">
              {isRemap
                ? props.remapTarget.currentLineId
                  ? `Currently linked to ${props.remapTarget.currentLineName ?? '(no name)'} — pick a different LINE user to remap.`
                  : `${props.remapTarget.name ?? 'Unnamed player'} has no LINE link. Pick a LINE user to link.`
                : 'Pick an orphan LINE user (signed in to the public site but not yet linked to a player) and a target player from this league.'}
            </p>

            <div className="space-y-3 mb-5">
              <label className="block">
                <span className="block text-admin-text3 text-[10px] font-bold uppercase tracking-widest mb-1">
                  {isRemap ? 'LINE user' : 'Orphan LINE user'}
                </span>
                <select
                  value={selectedLineId}
                  onChange={(e) => setSelectedLineId(e.target.value)}
                  className="w-full bg-admin-surface2 border border-admin-border rounded px-3 py-2 text-sm text-admin-text"
                  data-testid="line-user-select"
                >
                  <option value="">— Pick one —</option>
                  {lineUserOptions.map((o) => {
                    const linkedSuffix =
                      isRemap && (o as AllLineLogin).linkedPlayer
                        ? ` · linked to ${(o as AllLineLogin).linkedPlayer!.name}`
                        : ''
                    return (
                      <option key={o.lineId} value={o.lineId}>
                        {o.name ?? '(no name)'} · {o.lineId.slice(0, 8)}…{linkedSuffix}
                      </option>
                    )
                  })}
                </select>
              </label>

              <label className="block">
                <span className="block text-admin-text3 text-[10px] font-bold uppercase tracking-widest mb-1">
                  Target player
                </span>
                <select
                  value={selectedPlayerId}
                  onChange={(e) => setSelectedPlayerId(e.target.value)}
                  disabled={isRemap}
                  className="w-full bg-admin-surface2 border border-admin-border rounded px-3 py-2 text-sm text-admin-text disabled:opacity-70 disabled:cursor-not-allowed"
                  data-testid="target-player-select"
                >
                  {!isRemap && <option value="">— Pick one —</option>}
                  {props.players.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name ?? 'Unnamed'}{p.hasLineLink ? ' · already linked (will replace)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {willUnlinkPlayer && (
              <div
                className="mb-4 rounded-md border border-admin-amber/30 bg-admin-amber-dim/30 px-3 py-2 text-xs text-admin-text2"
                data-testid="will-unlink-warning"
              >
                <strong className="text-admin-amber font-semibold">Heads up:</strong>{' '}
                this will unlink LINE from{' '}
                <strong className="text-admin-text">{willUnlinkPlayer.name ?? 'Unnamed player'}</strong>.
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <button
                onClick={handleClose}
                className="px-4 py-2 rounded-lg text-sm text-admin-text2 border border-admin-border hover:border-admin-border2 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={pending || !selectedLineId || !selectedPlayerId}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-admin-green text-admin-ink hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {pending ? (isRemap ? 'Remapping…' : 'Linking…') : isRemap ? 'Remap' : 'Link'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
