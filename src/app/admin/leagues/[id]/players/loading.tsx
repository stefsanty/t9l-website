export default function PlayersLoading() {
  return (
    <div className="p-4 md:p-6 space-y-3 animate-pulse">
      <div className="flex items-center justify-between mb-2">
        <div className="h-5 w-24 bg-admin-surface2 rounded" />
        <div className="h-8 w-28 bg-admin-surface2 rounded-lg" />
      </div>

      {/* Filter bar */}
      <div className="flex gap-2 mb-4">
        <div className="h-8 w-20 bg-admin-surface2 rounded" />
        <div className="h-8 w-20 bg-admin-surface2 rounded" />
        <div className="h-8 w-20 bg-admin-surface2 rounded" />
      </div>

      {/* Player rows */}
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="bg-admin-surface rounded-xl border border-admin-border p-3">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 bg-admin-surface2 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-4 w-32 bg-admin-surface2 rounded" />
              <div className="h-3 w-20 bg-admin-surface2 rounded" />
            </div>
            <div className="h-6 w-6 bg-admin-surface2 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}
