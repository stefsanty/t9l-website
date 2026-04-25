import { getLeague } from '@/lib/admin-data'
import { updateLeague } from '@/app/admin/actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'

export default async function SettingsPage() {
  const league = await getLeague()
  if (!league) return <p className="text-gray-400">No league found.</p>

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">League Settings</h1>
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
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
              <Select id="status" name="status" defaultValue={league.status}>
                <option value="active">active</option>
                <option value="completed">completed</option>
                <option value="draft">draft</option>
              </Select>
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
