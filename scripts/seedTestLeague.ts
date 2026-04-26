import * as dotenv from 'dotenv'
import * as path from 'path'
import { PrismaClient } from '@prisma/client'

dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding Test League 2025...')

  // ── League ──────────────────────────────────────────────────────────────────
  const league = await prisma.league.upsert({
    where: { subdomain: 'test' },
    update: {},
    create: {
      name: 'Test League 2025',
      subdomain: 'test',
      location: 'Minato Sports Complex',
      description: 'End-to-end test league',
      startDate: new Date('2025-05-10T00:00:00+09:00'),
      endDate: new Date('2025-08-10T00:00:00+09:00'),
    },
  })
  console.log(`League: ${league.id} (${league.name})`)

  // ── Teams ────────────────────────────────────────────────────────────────────
  const phoenix = await prisma.team.upsert({
    where: { id: 'test-phoenix-fc' },
    update: { name: 'Phoenix FC' },
    create: { id: 'test-phoenix-fc', name: 'Phoenix FC' },
  })

  const storm = await prisma.team.upsert({
    where: { id: 'test-storm-united' },
    update: { name: 'Storm United' },
    create: { id: 'test-storm-united', name: 'Storm United' },
  })

  // Find existing Mariners FC or create
  let mariners = await prisma.team.findFirst({ where: { name: 'Mariners FC' } })
  if (!mariners) {
    mariners = await prisma.team.create({ data: { name: 'Mariners FC' } })
  }
  console.log(`Teams: Mariners FC (${mariners.id}), Phoenix FC (${phoenix.id}), Storm United (${storm.id})`)

  // ── LeagueTeams ──────────────────────────────────────────────────────────────
  const ltMariners = await prisma.leagueTeam.upsert({
    where: { leagueId_teamId: { leagueId: league.id, teamId: mariners.id } },
    update: {},
    create: { leagueId: league.id, teamId: mariners.id },
  })
  const ltPhoenix = await prisma.leagueTeam.upsert({
    where: { leagueId_teamId: { leagueId: league.id, teamId: phoenix.id } },
    update: {},
    create: { leagueId: league.id, teamId: phoenix.id },
  })
  const ltStorm = await prisma.leagueTeam.upsert({
    where: { leagueId_teamId: { leagueId: league.id, teamId: storm.id } },
    update: {},
    create: { leagueId: league.id, teamId: storm.id },
  })
  console.log('LeagueTeams created')

  // ── Players ──────────────────────────────────────────────────────────────────
  // Find Stefan S by lineId
  let stefan = await prisma.player.findFirst({
    where: { lineId: 'Uc8cdcc63cac89d5c349aa72b9e3355c2' },
  })
  if (!stefan) {
    stefan = await prisma.player.findFirst({ where: { name: { contains: 'Stefan' } } })
  }
  if (!stefan) {
    stefan = await prisma.player.create({
      data: { name: 'Stefan S', lineId: 'Uc8cdcc63cac89d5c349aa72b9e3355c2' },
    })
  }
  console.log(`Stefan S: ${stefan.id}`)

  const placeholders = [
    { name: 'Player Alpha', leagueTeamId: ltMariners.id },
    { name: 'Player Beta', leagueTeamId: ltMariners.id },
    { name: 'Player Gamma', leagueTeamId: ltPhoenix.id },
    { name: 'Player Delta', leagueTeamId: ltPhoenix.id },
    { name: 'Player Epsilon', leagueTeamId: ltStorm.id },
  ]

  for (const p of placeholders) {
    const player = await prisma.player.upsert({
      where: { id: `test-${p.name.toLowerCase().replace(' ', '-')}` },
      update: { name: p.name },
      create: { id: `test-${p.name.toLowerCase().replace(' ', '-')}`, name: p.name },
    })
    await prisma.playerLeagueAssignment.upsert({
      where: {
        id: `test-assign-${player.id}`,
      },
      update: {},
      create: {
        id: `test-assign-${player.id}`,
        playerId: player.id,
        leagueTeamId: p.leagueTeamId,
        fromGameWeek: 1,
      },
    })
    console.log(`  Player ${p.name}: ${player.id}`)
  }

  // Assign Stefan to Mariners
  const stefanAssign = await prisma.playerLeagueAssignment.findFirst({
    where: { playerId: stefan.id, leagueTeamId: ltMariners.id },
  })
  if (!stefanAssign) {
    await prisma.playerLeagueAssignment.create({
      data: { playerId: stefan.id, leagueTeamId: ltMariners.id, fromGameWeek: 1 },
    })
  }

  // ── Game Weeks ───────────────────────────────────────────────────────────────
  const gwDefs = [
    { weekNumber: 1, date: '2025-05-10' },
    { weekNumber: 2, date: '2025-06-10' },
    { weekNumber: 3, date: '2025-07-10' },
    { weekNumber: 4, date: '2025-08-10' },
  ]

  const gameWeeks: Record<number, { id: string }> = {}
  for (const def of gwDefs) {
    const start = new Date(`${def.date}T09:00:00+09:00`)
    const end = new Date(`${def.date}T23:59:00+09:00`)
    const gw = await prisma.gameWeek.upsert({
      where: { leagueId_weekNumber: { leagueId: league.id, weekNumber: def.weekNumber } },
      update: {},
      create: { leagueId: league.id, weekNumber: def.weekNumber, startDate: start, endDate: end },
    })
    gameWeeks[def.weekNumber] = gw
    console.log(`GW${def.weekNumber}: ${gw.id}`)
  }

  // ── Matches ──────────────────────────────────────────────────────────────────
  type MatchDef = { date: string; time: string; home: { id: string }; away: { id: string } }
  const matchDefs: { gw: number; matches: MatchDef[] }[] = [
    {
      gw: 1,
      matches: [
        { date: '2025-05-10', time: '19:00', home: ltMariners, away: ltPhoenix },
        { date: '2025-05-10', time: '19:45', home: ltPhoenix, away: ltStorm },
        { date: '2025-05-10', time: '20:30', home: ltStorm, away: ltMariners },
      ],
    },
    {
      gw: 2,
      matches: [
        { date: '2025-06-10', time: '15:00', home: ltMariners, away: ltStorm },
        { date: '2025-06-10', time: '16:00', home: ltStorm, away: ltMariners },
      ],
    },
    {
      gw: 3,
      matches: [
        { date: '2025-07-10', time: '19:00', home: ltPhoenix, away: ltMariners },
        { date: '2025-07-10', time: '19:45', home: ltMariners, away: ltStorm },
        { date: '2025-07-10', time: '20:30', home: ltStorm, away: ltPhoenix },
      ],
    },
    {
      gw: 4,
      matches: [
        { date: '2025-08-10', time: '15:00', home: ltPhoenix, away: ltStorm },
        { date: '2025-08-10', time: '16:00', home: ltStorm, away: ltPhoenix },
      ],
    },
  ]

  for (const { gw, matches } of matchDefs) {
    const gwRecord = gameWeeks[gw]
    for (const m of matches) {
      const [h, min] = m.time.split(':').map(Number)
      const playedAt = new Date(`${m.date}T${m.time}:00+09:00`)
      // Check if match already exists
      const existing = await prisma.match.findFirst({
        where: {
          gameWeekId: gwRecord.id,
          homeTeamId: m.home.id,
          awayTeamId: m.away.id,
        },
      })
      if (!existing) {
        await prisma.match.create({
          data: {
            leagueId: league.id,
            gameWeekId: gwRecord.id,
            homeTeamId: m.home.id,
            awayTeamId: m.away.id,
            playedAt,
            status: 'SCHEDULED',
          },
        })
      }
      console.log(`  GW${gw} match: ${m.home.id} vs ${m.away.id} at ${m.time}`)
    }
  }

  console.log('\n✓ Test League seeded successfully!')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
