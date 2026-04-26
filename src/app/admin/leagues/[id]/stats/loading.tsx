export default function StatsLoading() {
  return (
    <div className="p-4 md:p-6 space-y-6 animate-pulse">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-admin-surface rounded-xl border border-admin-border p-4">
            <div className="h-3 w-16 bg-admin-surface2 rounded mb-2" />
            <div className="h-7 w-10 bg-admin-surface2 rounded" />
          </div>
        ))}
      </div>

      {/* Table skeleton */}
      <div className="bg-admin-surface rounded-xl border border-admin-border overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 bg-admin-surface2">
          <div className="h-4 w-32 bg-admin-surface3 rounded" />
        </div>
        <div className="divide-y divide-admin-border">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <div className="h-4 w-4 bg-admin-surface2 rounded" />
              <div className="h-4 flex-1 bg-admin-surface2 rounded" />
              <div className="h-4 w-8 bg-admin-surface2 rounded" />
              <div className="h-4 w-8 bg-admin-surface2 rounded" />
              <div className="h-4 w-8 bg-admin-surface2 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
