'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { DEFAULT_LEAGUE_SLUG } from '@/lib/leagueSlug'

/**
 * v1.48.0 — clickable section-header eyebrow that copies a deep-link to the
 * current matchday view to the clipboard.
 *
 * v1.51.0 (PR 2 of the path-routing chain) — URL form upgraded to the
 * canonical path-based shape `/league/<slug>/md/<id>` so users sharing
 * the link see the canonical URL rather than the legacy
 * `/matchday/<id>` form (which still works via 308 redirect for old
 * shared links). When the parent component knows which league this
 * matchday belongs to, it threads the slug via the `leagueSlug` prop;
 * otherwise the `DEFAULT_LEAGUE_SLUG` constant ('t9l') is used as a
 * sensible fallback (today there's only one league with public
 * matchdays, so this preserves working URLs across every legacy
 * call site).
 *
 * Wraps the matchday-card eyebrow text ("MATCHDAY RESULTS" / "YOUR NEXT
 * MATCHDAY" / "MATCHDAY DETAILS"). On click:
 *   1. Compute `https://<host>/league/<slug>/md/<id>` from
 *      `window.location.origin` so the URL works on apex AND any
 *      subdomain without per-tenant config.
 *   2. Write to clipboard via `navigator.clipboard.writeText`.
 *   3. Fire a Sonner toast confirmation.
 *   4. Show a brief visual checkmark on the icon.
 */
export default function CopyMatchdayLink({
  matchdayId,
  label,
  leagueSlug,
}: {
  matchdayId: string
  label: string
  leagueSlug?: string
}) {
  const [copied, setCopied] = useState(false)

  function copy() {
    if (typeof window === 'undefined') return
    const slug = leagueSlug ?? DEFAULT_LEAGUE_SLUG
    const url = `${window.location.origin}/league/${slug}/md/${matchdayId}`

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
