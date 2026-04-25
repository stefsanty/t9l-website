import { getAllTeams } from '@/lib/admin-data'
import { createPlayer } from '@/app/admin/actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default async function NewPlayerPage() {
  const teams = await getAllTeams()

  return (
    <div className="space-y-6 max-w-lg">
      <h1 className="text-2xl font-bold tracking-tight">New Player</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Player Details</CardTitle>
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
              <select
                id="role"
                name="role"
                defaultValue="player"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="player">player</option>
                <option value="admin">admin</option>
                <option value="guest">guest</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="teamId">Team</Label>
              <select
                id="teamId"
                name="teamId"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">— No team —</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </div>

            <Button type="submit">Create Player</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
