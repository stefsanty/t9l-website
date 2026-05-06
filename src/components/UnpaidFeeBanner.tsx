/**
 * v1.66.0 — Unpaid league-fee banner.
 *
 * Per outputs/v1.66.0-player-payment-status-spec.md. Renders a permanent
 * (non-dismissible) banner across all league-scoped pages when the
 * authenticated viewer has a PlayerLeagueMembership for that league
 * with paidStatus === UNPAID and resolved fee > 0.
 *
 * Computed server-side via `getUnpaidFeeBannerData(leagueId)` and
 * threaded as a prop. The banner is purely presentational; null prop
 * (no data) → render nothing.
 *
 * Visual: amber/red gradient ribbon at the top of the viewport-anchored
 * area, separate from the recruiting banner. Renders ABOVE the
 * RecruitingBanner so the unpaid-fee message takes priority on the
 * apex / `/id/<slug>` Dashboards. /schedule and /stats render it at
 * the top of their content area.
 */

'use client'

import { formatJpyFee } from '@/lib/playerFee'
import type { UnpaidFeeBannerData } from '@/lib/unpaidFeeBanner'

interface Props {
  data: UnpaidFeeBannerData | null
}

export default function UnpaidFeeBanner({ data }: Props) {
  if (!data) return null

  return (
    <div
      data-testid="unpaid-fee-banner"
      className="w-full mt-2 mb-3 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 relative overflow-hidden"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-warning/15 border border-warning/40 flex items-center justify-center shrink-0">
          <svg
            className="w-5 h-5 text-warning"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v3m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-warning">
            League fee due
          </p>
          <p
            className="font-display text-base font-black uppercase tracking-tight text-fg-high leading-tight"
            data-testid="unpaid-fee-amount"
          >
            You have not paid your {formatJpyFee(data.fee)} league fee.
          </p>
        </div>
      </div>
    </div>
  )
}
