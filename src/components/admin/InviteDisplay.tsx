'use client'

import { useEffect, useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { formatInviteCodeForDisplay } from '@/lib/inviteCodes'

interface InviteDisplayProps {
  code: string
  joinUrl: string
  expiresAt: string | null // ISO 8601 (or null = no expiry)
  skipOnboarding: boolean
}

/**
 * v1.33.0 (PR ε) — single-invite display surface, shared by:
 *   - AddPlayerDialog (immediately after Create + Invite)
 *   - GenerateInviteDialog (per-row invite from PlayersTab)
 *
 * Renders: the human-grouped code (`ABCD-EFGH-JKMN`), the absolute join
 * URL with a one-click copy button, an SVG QR code (rendered client-side
 * via the `qrcode` package — kept off the server response so bulk
 * generation doesn't pay N × `toDataURL` round-trips), and a small
 * footer with the expiry date + skipOnboarding badge.
 *
 * QR rendering: `qrcode/lib/browser` exports `toString` returning an SVG
 * string. We render via `dangerouslySetInnerHTML` because React doesn't
 * have a streaming-from-string SVG primitive. The SVG is generated from
 * the join URL only — no XSS surface (the URL is constructed by our
 * server and the QR encoder doesn't interpret HTML).
 */
export default function InviteDisplay({ code, joinUrl, expiresAt, skipOnboarding }: InviteDisplayProps) {
  const [qrSvg, setQrSvg] = useState<string | null>(null)
  const [copiedCode, setCopiedCode] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState(false)

  useEffect(() => {
    let cancelled = false
    // Lazy-import the QR encoder so the JS chunk is only paid for when an
    // admin actually opens an invite display.
    import('qrcode')
      .then((qrcode) => qrcode.toString(joinUrl, { type: 'svg', margin: 1, width: 192 }))
      .then((svg) => {
        if (!cancelled) setQrSvg(svg)
      })
      .catch(() => {
        // If the QR encoder fails to load, render the URL surface only.
        if (!cancelled) setQrSvg(null)
      })
    return () => {
      cancelled = true
    }
  }, [joinUrl])

  function copy(text: string, which: 'code' | 'url') {
    navigator.clipboard.writeText(text).then(() => {
      if (which === 'code') {
        setCopiedCode(true)
        setTimeout(() => setCopiedCode(false), 1500)
      } else {
        setCopiedUrl(true)
        setTimeout(() => setCopiedUrl(false), 1500)
      }
    })
  }

  const expiryLabel = expiresAt
    ? new Date(expiresAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'Never expires'

  return (
    <div className="space-y-4" data-testid="invite-display">
      {/* QR */}
      <div className="flex flex-col items-center bg-white rounded-md p-3 border border-admin-border">
        {qrSvg ? (
          <div
            className="w-48 h-48"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
            data-testid="invite-qr"
          />
        ) : (
          <div className="w-48 h-48 flex items-center justify-center text-gray-500 text-xs">
            QR loading…
          </div>
        )}
      </div>

      {/* Code */}
      <div>
        <span className="block text-admin-text3 text-[10px] font-bold uppercase tracking-widest mb-1">
          Invite code
        </span>
        <div className="flex items-center gap-2">
          <code
            className="flex-1 bg-admin-surface2 border border-admin-border rounded px-3 py-2 text-sm font-mono text-admin-text"
            data-testid="invite-code"
          >
            {formatInviteCodeForDisplay(code)}
          </code>
          <button
            type="button"
            onClick={() => copy(code, 'code')}
            title="Copy code (without hyphens)"
            className="p-2 rounded text-admin-text3 hover:text-admin-text hover:bg-admin-surface3 transition-colors"
            data-testid="invite-copy-code"
          >
            {copiedCode ? <Check className="w-4 h-4 text-admin-green" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* URL */}
      <div>
        <span className="block text-admin-text3 text-[10px] font-bold uppercase tracking-widest mb-1">
          Join URL
        </span>
        <div className="flex items-center gap-2">
          <code
            className="flex-1 bg-admin-surface2 border border-admin-border rounded px-3 py-2 text-xs font-mono text-admin-text break-all"
            data-testid="invite-url"
          >
            {joinUrl}
          </code>
          <button
            type="button"
            onClick={() => copy(joinUrl, 'url')}
            title="Copy URL"
            className="p-2 rounded text-admin-text3 hover:text-admin-text hover:bg-admin-surface3 transition-colors"
            data-testid="invite-copy-url"
          >
            {copiedUrl ? <Check className="w-4 h-4 text-admin-green" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Footer: expiry + skip-onboarding badge */}
      <div className="flex items-center justify-between text-xs text-admin-text3">
        <span data-testid="invite-expires">Expires: {expiryLabel}</span>
        {skipOnboarding && (
          <span
            className="rounded-full bg-admin-amber-dim/40 border border-admin-amber/40 px-2 py-0.5 text-admin-amber font-medium"
            data-testid="invite-skip-onboarding-badge"
          >
            Skips onboarding
          </span>
        )}
      </div>
    </div>
  )
}
