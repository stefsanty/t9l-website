import { getAllTeams } from '@/lib/admin-data'
import { createPlayer } from '@/app/admin/actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'

export default async function NewPlayerPage() {
  const teams = await getAllTeams()

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">New Player</h1>
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Player Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createPlayer} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Name *</Label>
              <Input id="name" name="name" required />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="lineId">LINE ID</Label>
              <Input id="lineId" name="lineId" className="font-mono" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="role">Role</Label>
              <Select id="role" name="role" defaultValue="player">
                <option value="player">player</option>
                <option value="admin">admin</option>
                <option value="guest">guest</option>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="teamId">Team</Label>
              <Select id="teamId" name="teamId">
                <option value="">— No team —</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </Select>
            </div>

            <Button type="submit">Create Player</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
