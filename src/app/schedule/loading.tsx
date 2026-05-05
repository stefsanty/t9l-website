/**
 * v1.59.0 — loading skeleton for `/schedule`.
 */
export default function ScheduleLoading() {
  return (
    <div className="flex flex-col min-h-dvh bg-background animate-pulse">
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-full max-w-lg z-50 bg-header-bg backdrop-blur-md border-b border-border-default h-12" />
      <main className="flex-1 max-w-lg mx-auto px-4 pt-16 pb-12 space-y-5 w-full">
        <div className="h-12 w-48 bg-card rounded" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-44 w-full bg-card rounded-2xl" />
        ))}
      </main>
    </div>
  );
}
