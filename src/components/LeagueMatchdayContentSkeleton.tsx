import LoadingSpinner from './LoadingSpinner'

/**
 * v2.1.0 — Suspense fallback for the matchday-content boundary on
 * `/id/<slug>`. Replaces v1.99.0's single `<DashboardBodySkeleton>` for
 * the matchday region; the banner region now has its own
 * `<LeagueBannersSkeleton>` so the two areas stream independently.
 *
 * The footprint mirrors `<ClassicLeagueHomepage>` (NextMatchdayBanner
 * card + MatchdayAvailability list) to keep CLS at zero when the
 * resolved data swaps in. A centred `<LoadingSpinner size="lg">` sits
 * inside the matchday card so the user sees an active rotating cue
 * during the heaviest wait window (`getPublicLeagueData` is the
 * Redis-fanout call that drives the dashboard's tail latency).
 */
export default function LeagueMatchdayContentSkeleton() {
  return (
    <div
      data-testid="league-matchday-skeleton"
      aria-busy="true"
      aria-live="polite"
      className="w-full"
    >
      <div className="animate-pulse">
        {/* UserTeamBadge placeholder */}
        <div className="h-7 w-44 rounded bg-card mb-3" />
        {/* NextMatchdayBanner placeholder with spinner inside */}
        <div className="relative h-56 w-full rounded-3xl bg-card mb-4 overflow-hidden">
          <div className="absolute inset-0 flex items-center justify-center">
            <LoadingSpinner size="lg" tone="bold" />
          </div>
        </div>
        {/* MatchdayAvailability list placeholder */}
        <div className="space-y-2">
          <div className="h-3 w-32 rounded bg-card" />
          <div className="h-16 w-full rounded-2xl bg-card" />
          <div className="h-16 w-full rounded-2xl bg-card" />
          <div className="h-16 w-full rounded-2xl bg-card" />
        </div>
      </div>
    </div>
  )
}
