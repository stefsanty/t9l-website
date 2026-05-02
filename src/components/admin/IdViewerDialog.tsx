'use client'

import { useEffect, useState, useTransition } from 'react'
import { X, Trash2 } from 'lucide-react'
import { adminPurgePlayerId } from '@/app/admin/leagues/actions'
import { useToast } from './ToastProvider'
import ConfirmDialog from './ConfirmDialog'

/**
 * v1.35.0 (PR η) — admin viewer for a player's uploaded ID.
 *
 * Renders front + back images side-by-side, the upload timestamp, and
 * a Purge button (destructive — DELs the Blob assets and nulls the
 * three Player columns). Purge requires confirmation via ConfirmDialog
 * so a misclick can't accidentally wipe the upload.
 *
 * The Blob URLs are public (the Vercel Blob `access: 'public'` choice
 * — operator decision 2026-05-02 favored simplicity over signed-URL
 * complexity), so the <img> renders directly. Admin-only by route gate
 * (this component only mounts inside the /admin shell).
 */

interface Props {
  playerId: string
  playerName: string | null
  leagueId: string
  idFrontUrl: string | null
  idBackUrl: string | null
  idUploadedAt: string // ISO; required for the dialog to mount per the page-level guard
  onClose: () => void
}

export default function IdViewerDialog({
  playerId,
  playerName,
  leagueId,
  idFrontUrl,
  idBackUrl,
  idUploadedAt,
  onClose,
}: Props) {
  const { toast } = useToast()
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // ConfirmDialog wants `onConfirm: () => Promise<void>` so the dialog
  // can await before closing. Wrap startTransition in a promise that
  // resolves after the action completes — `useTransition`'s callback
  // isn't itself awaitable, so we promisify here.
  async function handlePurge() {
    return new Promise<void>((resolve) => {
      startTransition(async () => {
        try {
          await adminPurgePlayerId({ playerId, leagueId })
          toast(`Purged ID for ${playerName ?? 'this player'}`, 'success')
          onClose()
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Failed to purge', 'error')
        } finally {
          resolve()
        }
      })
    })
  }

  const uploadedDate = new Date(idUploadedAt).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      data-testid="id-viewer-dialog"
    >
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-admin-surface border border-admin-border rounded-xl p-6 w-full max-w-3xl mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-admin-text font-condensed font-bold text-lg">
              ID for {playerName ?? 'Unnamed player'}
            </h3>
            <p className="text-admin-text3 text-xs mt-0.5">
              Uploaded {uploadedDate}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-admin-text3 hover:text-admin-text"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
          <IdImagePane label="Front" url={idFrontUrl} testid="id-viewer-front" />
          <IdImagePane label="Back" url={idBackUrl} testid="id-viewer-back" />
        </div>

        <div className="flex items-center justify-between border-t border-admin-border pt-4">
          <p className="text-admin-text3 text-xs">
            Stored on Vercel Blob. Used solely for venue-booking documentation.
          </p>
          <ConfirmDialog
            trigger={
              <button
                type="button"
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-[6px] border border-admin-red/40 bg-admin-red-dim/30 px-3 py-1.5 text-xs text-admin-red hover:bg-admin-red-dim/60 disabled:opacity-50"
                data-testid="id-viewer-purge"
              >
                <Trash2 className="w-3 h-3" />
                Purge ID
              </button>
            }
            title={`Purge ID for ${playerName ?? 'Unnamed player'}?`}
            description="This will permanently delete both ID images from Vercel Blob and clear the columns. The user can re-upload after admin resets onboarding."
            confirmLabel="Purge"
            onConfirm={handlePurge}
          />
        </div>
      </div>
    </div>
  )
}

function IdImagePane({
  label,
  url,
  testid,
}: {
  label: string
  url: string | null
  testid: string
}) {
  if (!url) {
    return (
      <div className="rounded-md border border-admin-border bg-admin-surface2 p-4 text-center text-admin-text3 text-xs italic">
        {label}: not available
      </div>
    )
  }
  return (
    <div className="rounded-md border border-admin-border bg-admin-surface2 p-2">
      <p className="text-admin-text3 text-[10px] font-bold uppercase tracking-widest mb-1.5">
        {label}
      </p>
      <a href={url} target="_blank" rel="noopener noreferrer" data-testid={`${testid}-link`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={`${label} of ID`}
          className="w-full max-h-80 object-contain rounded bg-background"
          data-testid={testid}
        />
      </a>
    </div>
  )
}
