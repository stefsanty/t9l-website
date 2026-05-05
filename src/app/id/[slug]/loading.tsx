/**
 * v1.59.0 — loading skeleton for `/id/[slug]` (canonical per-league
 * Dashboard route). Same shape as the apex `/loading.tsx` since the
 * route renders the same Dashboard component.
 */
export default function IdSlugLoading() {
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
