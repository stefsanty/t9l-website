import Link from 'next/link'
import { getAllPlayers } from '@/lib/admin-data'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export default async function PlayersPage() {
  const players = await getAllPlayers()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Players</h1>
        <Button asChild>
          <Link href="/admin/players/new">+ New Player</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden sm:table-cell">LINE ID</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {players.map((player) => {
                const team = player.playerTeams[0]?.team
                return (
                  <TableRow key={player.id}>
                    <TableCell className="text-white font-medium">{player.name}</TableCell>
                    <TableCell className="text-gray-400">{team?.name ?? '—'}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          player.role === 'admin'
                            ? 'warning'
                            : player.role === 'guest'
                            ? 'outline'
                            : 'default'
                        }
                      >
                        {player.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-gray-500 font-mono text-xs">
                      {player.lineId ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/admin/players/${player.id}`}>Edit</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
