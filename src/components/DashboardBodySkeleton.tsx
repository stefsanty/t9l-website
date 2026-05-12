/**
 * v1.99.0 — Suspense fallback for the streaming league-dashboard body.
 *
 * Renders the SAME outer wrapper shape as `<Dashboard>` (flex column,
 * max-w-lg centered, `pt-12` clearing the fixed Header band) so the
 * Suspense-fallback → resolved-children swap is a seamless content
 * replace with no CLS / no header re-mount.
 *
 * The page-level shell hoists the real `<Header>` (with the live
 * `<LeagueSwitcher>` chevron) ABOVE this Suspense boundary, so the
 * skeleton does NOT render a header band — the real one is already
 * painted. Reserving `pt-12` here matches the live Dashboard wrapper
 * so the skeleton sits in the right place under the fixed Header.
 *
 * Footprint: three placeholder cards (heading band → next-matchday-sized
 * panel → availability/matchday-list-sized panel) modeled on the
 * v1.59.0 `/loading.tsx` pattern. The `aria-busy` flag tells AT users
 * the body is loading; the inner `animate-pulse` is the visual cue.
 *
 * Used by `<Suspense fallback={<DashboardBodySkeleton />}>` in:
 *   - `/id/<slug>/page.tsx`
 *   - `<MultiLeagueHub>` (mounted under `/test`, swap-target `/`)
 *
 * Route-level `loading.tsx` files still cover the navigation-time
 * skeleton (full screen including a header band) because they fire
 * BEFORE the page's outer shell mounts. This component covers the
 * inside-the-page streaming window where the shell is already painted.
 */
export default function DashboardBodySkeleton() {
  return (
    <div
      data-testid="dashboard-body-skeleton"
      aria-busy="true"
      className="flex flex-col min-h-dvh pb-0 max-w-lg mx-auto bg-background"
    >
      <main className="flex-1 px-4 relative z-10 pt-12 pb-2">
        <div className="animate-pulse pt-2">
          <div className="h-7 w-40 rounded bg-card mb-3" />
          <div className="h-48 w-full rounded-3xl bg-card mb-4" />
          <div className="h-64 w-full rounded-3xl bg-card" />
        </div>
      </main>
    </div>
  )
}
