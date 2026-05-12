import LoadingSpinner from './LoadingSpinner'

/**
 * v2.1.0 — Suspense fallback for the multi-boundary `/id/<slug>` body.
 *
 * Renders the placeholder footprint for the BANNER strip (unpaid-fee
 * banner + recruiting banner + league-details panel) so the
 * fallback → resolved swap is a content replace, not a flow jump.
 *
 * A small `<LoadingSpinner>` sits inline next to the first placeholder
 * row — the v1.99.0 `animate-pulse`-only skeleton was easy to miss,
 * which made the wait feel like a frozen screen. The spinner provides
 * an unmistakeable rotating-arc cue that pairs with the pulse.
 */
export default function LeagueBannersSkeleton() {
  return (
    <div
      data-testid="league-banners-skeleton"
      aria-busy="true"
      aria-live="polite"
      className="w-full"
    >
      <div className="flex items-center gap-3 mb-3">
        <LoadingSpinner size="sm" tone="bold" />
        <div className="h-3 w-28 rounded bg-card animate-pulse" />
      </div>
      <div className="animate-pulse space-y-2">
        <div className="h-14 w-full rounded-2xl bg-card" />
        <div className="h-20 w-full rounded-2xl bg-card" />
      </div>
    </div>
  )
}
