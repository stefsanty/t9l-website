import CreateLeagueForm from '@/components/admin/CreateLeagueForm'

export default function NewLeaguePage() {
  return (
    <div className="p-4 md:p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="font-condensed font-extrabold text-admin-text text-3xl tracking-tight mb-1">
          New League
        </h1>
        <p className="text-admin-text3 text-sm">Set up a new football league.</p>
      </div>
      <CreateLeagueForm />
    </div>
  )
}
