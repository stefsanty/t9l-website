'use client'

import { useState } from 'react'
import { toast } from 'sonner'

/**
 * v1.48.0 — clickable section-header eyebrow that copies a deep-link to the
 * current matchday view to the clipboard.
 *
 * Wraps the matchday-card eyebrow text ("MATCHDAY RESULTS" / "YOUR NEXT
 * MATCHDAY" / "MATCHDAY DETAILS"). On click:
 *   1. Compute `https://<host>/matchday/<id>` from `window.location.origin`
 *      so the URL works on apex AND any subdomain without per-tenant config.
 *   2. Write to clipboard via `navigator.clipboard.writeText`.
 *   3. Fire a Sonner toast confirmation.
 *   4. Show a brief visual checkmark on the icon.
 *
 * The eyebrow text + icon together are the affordance — both are the
 * clickable surface (single button). The icon is a small link/share glyph
 * that telegraphs "click to copy/share".
 */
export default function CopyMatchdayLink({
  matchdayId,
  label,
}: {
  matchdayId: string
  label: string
}) {
  const [copied, setCopied] = useState(false)

  function copy() {
    if (typeof window === 'undefined') return
    const url = `${window.location.origin}/matchday/${matchdayId}`

    const onSuccess = () => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
      toast.success('Link copied to clipboard', {
        description: url,
      })
    }
    const onFailure = () => {
      toast.error('Could not copy link')
    }

    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === 'function'
    ) {
      navigator.clipboard.writeText(url).then(onSuccess, onFailure)
    } else {
      onFailure()
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.25em] text-fg-high hover:text-vibrant-pink transition-colors group/copy"
      aria-label={`Copy link to ${label}`}
      data-testid={`copy-matchday-link-${matchdayId}`}
    >
      <span>{label}</span>
      {copied ? (
        <svg
          className="w-3 h-3 text-electric-green shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg
          className="w-3 h-3 text-fg-mid group-hover/copy:text-vibrant-pink transition-colors shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2.2}
            d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 11-5.656-5.656l1.5-1.5M10.172 13.828a4 4 0 010-5.656l3-3a4 4 0 015.656 5.656l-1.5 1.5"
          />
        </svg>
      )}
    </button>
  )
}
