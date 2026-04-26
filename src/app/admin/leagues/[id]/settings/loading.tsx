export default function SettingsLoading() {
  return (
    <div className="p-4 md:p-6 max-w-2xl space-y-6 animate-pulse">
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-admin-surface rounded-xl border border-admin-border p-5 space-y-4">
          <div className="h-5 w-28 bg-admin-surface2 rounded" />
          <div className="space-y-3">
            <div className="h-9 w-full bg-admin-surface2 rounded-lg" />
            <div className="h-20 w-full bg-admin-surface2 rounded-lg" />
            <div className="h-9 w-full bg-admin-surface2 rounded-lg" />
          </div>
          <div className="h-9 w-28 bg-admin-surface2 rounded-lg" />
        </div>
      ))}
    </div>
  )
}
