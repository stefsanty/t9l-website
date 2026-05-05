/**
 * v1.59.0 — root-level loading skeleton for the apex `/` Dashboard.
 *
 * Pre-v1.59.0 no public route had a `loading.tsx`, so navigation to `/`,
 * `/stats`, `/assign-player`, `/schedule` etc. blocked until the full RSC
 * payload resolved server-side (cached `getDefaultLeagueId` +
 * `getPublicLeagueData` + per-route extras = ~1-2s warm and worse on cold
 * Neon). With this file in place Next.js streams the skeleton instantly on
 * navigation and swaps in the real payload when ready — the user sees the
 * route change immediately.
 *
 * The skeleton mirrors Dashboard's actual structure (header band, nextMd
 * banner, availability grid, RSVP bar) so the visual transition is minimal.
 * Header isn't fully rebuilt; we render a static dim band that matches the
 * fixed `<Header>` height (h-12) so the layout doesn't reflow.
 */
export default function Loading() {
  return (
    <div className="flex flex-col min-h-dvh max-w-lg mx-auto bg-background animate-pulse">
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-full max-w-lg z-50 bg-header-bg backdrop-blur-md border-b border-border-default h-12" />
      <main className="flex-1 px-4 pt-16 pb-32">
        <div className="h-7 w-40 bg-card rounded mb-3" />
        <div className="h-48 w-full bg-card rounded-3xl mb-4" />
        <div className="h-64 w-full bg-card rounded-3xl" />
      </main>
    </div>
  );
}
