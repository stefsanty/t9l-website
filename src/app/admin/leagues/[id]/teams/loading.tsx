export default function TeamsLoading() {
  return (
    <div className="p-4 md:p-6 space-y-4 animate-pulse">
      <div className="flex items-center justify-between mb-2">
        <div className="h-5 w-20 bg-admin-surface2 rounded" />
        <div className="h-8 w-24 bg-admin-surface2 rounded-lg" />
      </div>

      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="bg-admin-surface rounded-xl border border-admin-border p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-admin-surface2 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-36 bg-admin-surface2 rounded" />
              <div className="h-3 w-20 bg-admin-surface2 rounded" />
            </div>
            <div className="h-7 w-16 bg-admin-surface2 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}
