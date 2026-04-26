export default function AdminLoading() {
  return (
    <div className="p-4 md:p-8 animate-pulse">
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="h-8 w-32 bg-admin-surface2 rounded mb-2" />
          <div className="h-4 w-16 bg-admin-surface2 rounded" />
        </div>
        <div className="h-9 w-28 bg-admin-surface2 rounded-lg" />
      </div>

      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-admin-surface rounded-xl border border-admin-border p-5">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <div className="h-5 w-48 bg-admin-surface2 rounded" />
                <div className="h-4 w-32 bg-admin-surface2 rounded" />
                <div className="h-3 w-24 bg-admin-surface2 rounded mt-1" />
              </div>
              <div className="h-8 w-8 bg-admin-surface2 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
