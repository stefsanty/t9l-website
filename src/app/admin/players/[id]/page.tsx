import { notFound } from 'next/navigation'
import { getAllPlayers } from '@/lib/admin-data'
import { updatePlayer } from '@/app/admin/actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Props = { params: Promise<{ id: string }> }

export default async function EditPlayerPage({ params }: Props) {
  const { id } = await params
  const players = await getAllPlayers()
  const player = players.find((p) => p.id === id)
  if (!player) notFound()

  return (
    <div className="space-y-6 max-w-lg">
      <h1 className="text-2xl font-bold tracking-tight">Edit Player</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Player Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updatePlayer} className="space-y-4">
            <input type="hidden" name="id" value={player.id} />

            <div className="space-y-1.5">
              <Label htmlFor="name">Name *</Label>
              <Input id="name" name="name" required defaultValue={player.name} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="lineId">LINE ID</Label>
              <Input id="lineId" name="lineId" defaultValue={player.lineId ?? ''} className="font-mono" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="role">Role</Label>
              <select
                id="role"
                name="role"
                defaultValue={player.role}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="player">player</option>
                <option value="admin">admin</option>
                <option value="guest">guest</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pictureUrl">Picture URL</Label>
              <Input id="pictureUrl" name="pictureUrl" defaultValue={player.pictureUrl ?? ''} />
            </div>

            <p className="text-xs text-muted-foreground">
              Team: {player.playerTeams[0]?.team?.name ?? '—'}
            </p>

            <Button type="submit">Save Changes</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
