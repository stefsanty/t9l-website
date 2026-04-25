import { getLeague } from '@/lib/admin-data'
import { updateLeague } from '@/app/admin/actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default async function SettingsPage() {
  const league = await getLeague()
  if (!league) return <p className="text-muted-foreground">No league found.</p>

  return (
    <div className="space-y-6 max-w-lg">
      <h1 className="text-2xl font-bold tracking-tight">League Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">League Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updateLeague} className="space-y-4">
            <input type="hidden" name="id" value={league.id} />

            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" defaultValue={league.name} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="season">Season</Label>
              <Input id="season" name="season" defaultValue={league.season ?? ''} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="court">Court / Venue</Label>
              <Input id="court" name="court" defaultValue={league.court ?? ''} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dayOfWeek">Day of Week</Label>
              <Input id="dayOfWeek" name="dayOfWeek" defaultValue={league.dayOfWeek ?? ''} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="status">Status</Label>
              <select
                id="status"
                name="status"
                defaultValue={league.status}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="active">active</option>
                <option value="completed">completed</option>
                <option value="draft">draft</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="logoUrl">Logo URL</Label>
              <Input id="logoUrl" name="logoUrl" defaultValue={league.logoUrl ?? ''} />
            </div>

            <Button type="submit">Save Changes</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
