/**
 * v1.59.0 — loading skeleton for `/stats`.
 *
 * StatsDashboard renders: Header → league-table → top performers → squads.
 * The full RSC fetch chain is `getDefaultLeagueId` + `getPublicLeagueData`
 * + `fetchPlayerPictures` (Upstash mget over ~53 keys) which is the
 * heaviest of the public routes. Streaming the skeleton is the high-ROI
 * fix.
 */
export default function StatsLoading() {
  return (
    <div className="flex flex-col min-h-dvh pb-0 max-w-lg mx-auto bg-background animate-pulse">
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-full max-w-lg z-50 bg-header-bg backdrop-blur-md border-b border-border-default h-12" />
      <main className="flex-1 px-4 pt-16 pb-12 space-y-4">
        <div className="h-9 w-32 bg-card rounded" />
        <div className="h-56 w-full bg-card rounded-2xl" />
        <div className="h-72 w-full bg-card rounded-2xl" />
        <div className="h-60 w-full bg-card rounded-2xl" />
      </main>
    </div>
  );
}
