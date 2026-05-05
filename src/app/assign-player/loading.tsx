/**
 * v1.59.0 — loading skeleton for `/assign-player`.
 */
export default function AssignPlayerLoading() {
  return (
    <div className="min-h-dvh bg-background flex flex-col items-center justify-start pt-12 px-4 animate-pulse">
      <div className="w-full max-w-sm space-y-4 mt-8">
        <div className="h-10 w-44 bg-card rounded mx-auto" />
        <div className="h-5 w-64 bg-card rounded mx-auto" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="h-5 w-32 bg-card rounded" />
            {Array.from({ length: 3 }).map((__, j) => (
              <div key={j} className="h-12 w-full bg-card rounded-xl" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
