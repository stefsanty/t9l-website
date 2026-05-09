'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'
import InviteDisplay from './InviteDisplay'
import { buildInviteUrl } from '@/lib/inviteCodes'

interface ViewInviteDialogProps {
  playerName: string | null
  code: string
  expiresAt: string | null
  skipOnboarding: boolean
  onClose: () => void
}

/**
 * v1.85.0 — read-only view of an existing active personal invite.
 *
 * Opens when the admin clicks "Show invite code" for a player that already
 * has a PERSONAL invite (generated but not yet redeemed). Re-surfaces the
 * same InviteDisplay used by GenerateInviteDialog, including the QR code
 * and copy buttons. No server action is called — the code comes from the
 * cached admin-data fetch.
 *
 * joinUrl is computed client-side from window.location.host so subdomain-
 * aware invites (tamachi.t9l.me) produce the correct URL.
 */
export default function ViewInviteDialog({
  playerName,
  code,
  expiresAt,
  skipOnboarding,
  onClose,
}: ViewInviteDialogProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const joinUrl = buildInviteUrl(
    typeof window !== 'undefined' ? window.location.host : 't9l.me',
    code,
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" data-testid="view-invite-dialog">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-admin-surface border border-admin-border rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-admin-text font-condensed font-bold text-lg">
            Invite for {playerName ?? 'Unnamed player'}
          </h3>
          <button onClick={onClose} className="text-admin-text3 hover:text-admin-text" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-admin-text2 text-sm mb-4">
          This invite is still active. Share with {playerName ?? 'this player'} — they sign in
          with any provider and the invite binds them to this slot.
        </p>

        <InviteDisplay
          code={code}
          joinUrl={joinUrl}
          expiresAt={expiresAt}
          skipOnboarding={skipOnboarding}
        />

        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm bg-admin-green text-admin-ink font-medium hover:opacity-90"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
