export default function ScheduleLoading() {
  return (
    <div className="p-4 md:p-6 space-y-4 animate-pulse">
      <div className="flex items-center justify-between mb-2">
        <div className="h-5 w-28 bg-admin-surface2 rounded" />
        <div className="h-8 w-28 bg-admin-surface2 rounded-lg" />
      </div>

      {[1, 2, 3].map((gw) => (
        <div key={gw} className="bg-admin-surface rounded-xl border border-admin-border overflow-hidden">
          {/* GameWeek header */}
          <div className="flex items-center gap-3 px-4 py-3 bg-admin-surface2">
            <div className="h-4 w-20 bg-admin-surface3 rounded" />
            <div className="h-4 w-24 bg-admin-surface3 rounded" />
            <div className="ml-auto h-4 w-16 bg-admin-surface3 rounded" />
          </div>

          {/* Match rows */}
          <div className="divide-y divide-admin-border">
            {[1, 2, 3].map((m) => (
              <div key={m} className="flex items-center gap-3 px-4 py-3">
                <div className="h-4 w-6 bg-admin-surface2 rounded" />
                <div className="h-4 w-16 bg-admin-surface2 rounded" />
                <div className="h-4 flex-1 bg-admin-surface2 rounded" />
                <div className="h-4 w-12 bg-admin-surface2 rounded" />
                <div className="h-4 flex-1 bg-admin-surface2 rounded" />
                <div className="h-6 w-14 bg-admin-surface2 rounded" />
                <div className="h-4 w-16 bg-admin-surface2 rounded" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
