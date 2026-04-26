import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'
import { PrismaClient } from '@prisma/client'

// Load .env.local from cwd or 3 levels up (git worktrees)
for (const p of [
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), '..', '..', '..', '.env.local'),
]) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p })
    console.log(`  env: ${p}`)
    break
  }
}
dotenv.config()

function slugify(s: string): string {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

const SLUG = 'test'
const mkTeamId   = (name: string)                  => `t-${slugify(name)}`
const mkGwId     = (leagueId: string, wk: number)  => `gw-${SLUG}-${wk}-${leagueId.slice(-6)}`
const mkPlayerId = (name: string)                   => `p-${slugify(name)}`
const mkPlaId    = (pId: string, ltId: string)      => `pla-${pId}-${ltId}`
const mkMatchId  = (leagueId: string, wk: number, h: string, a: string) =>
  `m-${SLUG}-wk${wk}-${slugify(h)}-vs-${slugify(a)}-${leagueId.slice(-6)}`

/** Create a UTC Date from a JST date string + hour + minute. */
function jst(date: string, hour: number, minute: number): Date {
  return new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+09:00`)
}

async function main() {
  const prisma = new PrismaClient({ log: ['error'] })

  try {
    console.log('\n🏟  Seeding Test League 2025...\n')

    // ── League ─────────────────────────────────────────────────────────────────
    // Find by subdomain (unique), then upsert by id.
    const bySubdomain = await prisma.league.findUnique({ where: { subdomain: 'test' } })
    const league = await prisma.league.upsert({
      where:  { id: bySubdomain?.id ?? 'l-test' },
      create: {
        id:        'l-test',
        name:      'Test League 2025',
        subdomain: 'test',
        location:  'Minato Sports Complex',
        startDate: new Date('2025-05-10'),
      },
      update: {
        name:      'Test League 2025',
        subdomain: 'test',
        location:  'Minato Sports Complex',
        startDate: new Date('2025-05-10'),
      },
    })
    console.log(`✓ League: ${league.name}  (${league.id})`)

    // ── Teams + LeagueTeams ────────────────────────────────────────────────────
    const teamNames = ['Mariners FC', 'Phoenix FC', 'Storm United']
    const ltIdMap = new Map<string, string>() // team name → actual LeagueTeam.id

    for (const name of teamNames) {
      const tId = mkTeamId(name)

      await prisma.team.upsert({
        where:  { id: tId },
        create: { id: tId, name },
        update: { name },
      })

      // Use the unique constraint to upsert; capture the real id back.
      const lt = await prisma.leagueTeam.upsert({
        where:  { leagueId_teamId: { leagueId: league.id, teamId: tId } },
        create: { leagueId: league.id, teamId: tId },
        update: {},
      })

      ltIdMap.set(name, lt.id)
    }
    console.log(`✓ Teams + LeagueTeams: ${ltIdMap.size}`)

    // ── Players ────────────────────────────────────────────────────────────────
    const STEFAN_LINE_ID = 'Uc8cdcc63cac89d5c349aa72b9e3355c2'

    const existingStefan = await prisma.player.findUnique({ where: { lineId: STEFAN_LINE_ID } })
    const stefanId = existingStefan?.id ?? mkPlayerId('Stefan S')

    if (!existingStefan) {
      await prisma.player.upsert({
        where:  { id: stefanId },
        create: { id: stefanId, name: 'Stefan S', lineId: STEFAN_LINE_ID },
        update: { lineId: STEFAN_LINE_ID },
      })
    }
    console.log(`✓ Stefan S (${existingStefan ? 'found' : 'created'})  id=${stefanId}`)

    const testPlayers: Array<{ name: string; team: string }> = [
      { name: 'Player Alpha',   team: 'Mariners FC'  },
      { name: 'Player Beta',    team: 'Mariners FC'  },
      { name: 'Player Gamma',   team: 'Phoenix FC'   },
      { name: 'Player Delta',   team: 'Phoenix FC'   },
      { name: 'Player Epsilon', team: 'Storm United' },
    ]

    for (const { name } of testPlayers) {
      const pId = mkPlayerId(name)
      await prisma.player.upsert({
        where:  { id: pId },
        create: { id: pId, name },
        update: { name },
      })
    }
    console.log(`✓ Test players: ${testPlayers.length}`)

    // ── PlayerLeagueAssignments (all from GW1) ─────────────────────────────────
    const assignments: Array<{ playerId: string; ltId: string }> = [
      { playerId: stefanId,               ltId: ltIdMap.get('Mariners FC')!  },
      { playerId: mkPlayerId('Player Alpha'),   ltId: ltIdMap.get('Mariners FC')!  },
      { playerId: mkPlayerId('Player Beta'),    ltId: ltIdMap.get('Mariners FC')!  },
      { playerId: mkPlayerId('Player Gamma'),   ltId: ltIdMap.get('Phoenix FC')!   },
      { playerId: mkPlayerId('Player Delta'),   ltId: ltIdMap.get('Phoenix FC')!   },
      { playerId: mkPlayerId('Player Epsilon'), ltId: ltIdMap.get('Storm United')! },
    ]

    for (const { playerId, ltId } of assignments) {
      const plaId = mkPlaId(playerId, ltId)
      await prisma.playerLeagueAssignment.upsert({
        where:  { id: plaId },
        create: { id: plaId, playerId, leagueTeamId: ltId, fromGameWeek: 1 },
        update: {},
      })
    }
    console.log(`✓ PlayerLeagueAssignments: ${assignments.length}`)

    // ── GameWeeks ──────────────────────────────────────────────────────────────
    const gwDefs = [
      { wk: 1, date: '2025-05-10' },
      { wk: 2, date: '2025-06-10' },
      { wk: 3, date: '2025-07-10' },
      { wk: 4, date: '2025-08-10' },
    ]

    const gwIdMap = new Map<number, string>() // weekNumber → actual GameWeek.id
    for (const { wk, date } of gwDefs) {
      const d  = new Date(date)
      const gw = await prisma.gameWeek.upsert({
        where:  { leagueId_weekNumber: { leagueId: league.id, weekNumber: wk } },
        create: { leagueId: league.id, weekNumber: wk, startDate: d, endDate: d },
        update: { startDate: d, endDate: d },
      })
      gwIdMap.set(wk, gw.id)
    }
    console.log(`✓ GameWeeks: ${gwIdMap.size}`)

    // ── Matches ────────────────────────────────────────────────────────────────
    type MD = { wk: number; home: string; away: string; h: number; m: number; date: string }
    const matchDefs: MD[] = [
      // GW1 — May 10 2025, 19:00 / 19:45 / 20:30 JST
      { wk: 1, home: 'Mariners FC',  away: 'Phoenix FC',   h: 19, m:  0, date: '2025-05-10' },
      { wk: 1, home: 'Phoenix FC',   away: 'Storm United', h: 19, m: 45, date: '2025-05-10' },
      { wk: 1, home: 'Storm United', away: 'Mariners FC',  h: 20, m: 30, date: '2025-05-10' },
      // GW2 — Jun 10 2025, 15:00 / 16:00 JST
      { wk: 2, home: 'Mariners FC',  away: 'Storm United', h: 15, m:  0, date: '2025-06-10' },
      { wk: 2, home: 'Storm United', away: 'Mariners FC',  h: 16, m:  0, date: '2025-06-10' },
      // GW3 — Jul 10 2025, 19:00 / 19:45 / 20:30 JST
      { wk: 3, home: 'Phoenix FC',   away: 'Mariners FC',  h: 19, m:  0, date: '2025-07-10' },
      { wk: 3, home: 'Mariners FC',  away: 'Storm United', h: 19, m: 45, date: '2025-07-10' },
      { wk: 3, home: 'Storm United', away: 'Phoenix FC',   h: 20, m: 30, date: '2025-07-10' },
      // GW4 — Aug 10 2025, 15:00 / 16:00 JST
      { wk: 4, home: 'Phoenix FC',   away: 'Storm United', h: 15, m:  0, date: '2025-08-10' },
      { wk: 4, home: 'Storm United', away: 'Phoenix FC',   h: 16, m:  0, date: '2025-08-10' },
    ]

    let matchCount = 0
    for (const { wk, home, away, h, m, date } of matchDefs) {
      const ltHomeId = ltIdMap.get(home)!
      const ltAwayId = ltIdMap.get(away)!
      const gwId     = gwIdMap.get(wk)!
      const playedAt = jst(date, h, m)

      // Use upsert via unique match attributes — fallback to findFirst + create if no stable unique key.
      const existing = await prisma.match.findFirst({
        where: { gameWeekId: gwId, homeTeamId: ltHomeId, awayTeamId: ltAwayId },
      })

      if (existing) {
        await prisma.match.update({ where: { id: existing.id }, data: { playedAt } })
      } else {
        await prisma.match.create({
          data: {
            leagueId:   league.id,
            gameWeekId: gwId,
            homeTeamId: ltHomeId,
            awayTeamId: ltAwayId,
            playedAt,
            status:     'SCHEDULED',
          },
        })
      }
      matchCount++
    }
    console.log(`✓ Matches: ${matchCount}`)

    console.log('\n✅  Done.\n')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(err => {
  console.error('\n❌  Seed failed:', err)
  process.exit(1)
})
