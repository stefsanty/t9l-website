'use client'

import { useState, useTransition } from 'react'
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

interface PlayerOption {
  id: string         // DB Player.id (with p- prefix)
  name: string
  hasLineLink: boolean
}

interface Props {
  leagueId: string
  orphans: OrphanLineLogin[]
  players: PlayerOption[]
}

/**
 * Flow B for the admin Players tab: link an orphan LINE login (a LINE user
 * who's signed in to the public site but isn't on any Player.lineId yet) to
 * a Player record from this league. Server action handles the atomic write.
 *
 * Disabled state: rendered when there are zero orphans. We still mount the
 * button so the operator sees the affordance and the "(0)" badge tells them
 * the queue is empty, rather than the button vanishing.
 */
export default function AssignLineDialog({ leagueId, orphans, players }: Props) {
  const [open, setOpen] = useState(false)
  const [selectedLineId, setSelectedLineId] = useState<string>('')
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>('')
  const [pending, startTransition] = useTransition()
  const { toast } = useToast()

  const empty = orphans.length === 0

  function reset() {
    setSelectedLineId('')
    setSelectedPlayerId('')
  }

  function close() {
    setOpen(false)
    reset()
  }

  function handleConfirm() {
    if (!selectedLineId || !selectedPlayerId) return
    startTransition(async () => {
      try {
        await adminLinkLineToPlayer({
          playerId: selectedPlayerId,
          lineId: selectedLineId,
          leagueId,
        })
        const orphan = orphans.find((o) => o.lineId === selectedLineId)
        const player = players.find((p) => p.id === selectedPlayerId)
        toast(
          `Linked ${orphan?.name ?? selectedLineId} → ${player?.name ?? 'player'}`,
          'success',
        )
        close()
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Link failed', 'error')
      }
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={empty}
        title={empty ? 'No orphan LINE logins waiting' : 'Assign an orphan LINE login to a player'}
        className="inline-flex items-center gap-1.5 rounded-[6px] bg-admin-green px-2.5 py-1 text-xs font-semibold text-admin-ink hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Plus className="w-3 h-3" />
        Assign Player {orphans.length > 0 ? <span className="font-mono">({orphans.length})</span> : null}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={close} />
          <div className="relative bg-admin-surface border border-admin-border rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-admin-text font-condensed font-bold text-lg">Assign LINE login</h3>
              <button onClick={close} className="text-admin-text3 hover:text-admin-text">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-admin-text2 text-sm mb-4">
              Pick an orphan LINE user (signed in to the public site but not yet linked to a player) and a target player from this league.
            </p>

            <div className="space-y-3 mb-5">
              <label className="block">
                <span className="block text-admin-text3 text-[10px] font-bold uppercase tracking-widest mb-1">
                  Orphan LINE user
                </span>
                <select
                  value={selectedLineId}
                  onChange={(e) => setSelectedLineId(e.target.value)}
                  className="w-full bg-admin-surface2 border border-admin-border rounded px-3 py-2 text-sm text-admin-text"
                >
                  <option value="">— Pick one —</option>
                  {orphans.map((o) => (
                    <option key={o.lineId} value={o.lineId}>
                      {o.name ?? '(no name)'} · {o.lineId.slice(0, 8)}…
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="block text-admin-text3 text-[10px] font-bold uppercase tracking-widest mb-1">
                  Target player
                </span>
                <select
                  value={selectedPlayerId}
                  onChange={(e) => setSelectedPlayerId(e.target.value)}
                  className="w-full bg-admin-surface2 border border-admin-border rounded px-3 py-2 text-sm text-admin-text"
                >
                  <option value="">— Pick one —</option>
                  {players.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.hasLineLink ? ' · already linked (will replace)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={close}
                className="px-4 py-2 rounded-lg text-sm text-admin-text2 border border-admin-border hover:border-admin-border2 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={pending || !selectedLineId || !selectedPlayerId}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-admin-green text-admin-ink hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {pending ? 'Linking…' : 'Link'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
