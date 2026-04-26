import * as dotenv from 'dotenv'
import * as path from 'path'
import { PrismaClient } from '@prisma/client'

dotenv.config({ path: path.resolve(__dirname, '../.env') })

const prisma = new PrismaClient()

// ── Stable deterministic IDs (same pattern as importFromSheets) ───────────────

function slugify(s: string) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

const SLUG        = 'test-2025'
const mkLTId      = (team: string) => `lt-${SLUG}-${slugify(team)}`
const mkGWId      = (wk: number)   => `gw-${SLUG}-${wk}`
const mkMatchId   = (wk: number, h: string, a: string) => `m-${SLUG}-wk${wk}-${slugify(h)}-vs-${slugify(a)}`
const mkPlayerId  = (name: string) => `p-${slugify(name)}`
const mkPlaId     = (pId: string, ltId: string) => `pla-${pId}-${ltId}`

async function main() {
  console.log('🌱 Seeding Test League 2025…')

  // ── 1. League ──────────────────────────────────────────────────────────────
  const league = await prisma.league.upsert({
    where: { id: 'l-test-2025' },
    update: { subdomain: 'test' },
    create: {
      id:          'l-test-2025',
      name:        'Test League 2025',
      subdomain:   'test',
      location:    'Minato Sports Complex',
      startDate:   new Date('2025-05-10'),
      endDate:     new Date('2025-08-31'),
    },
  })
  console.log(`  ✓ League: ${league.name} (subdomain: ${league.subdomain})`)

  // ── 2. Teams ───────────────────────────────────────────────────────────────
  const mariners = await prisma.team.upsert({
    where: { id: 't-mariners-fc' },
    update: {},
    create: { id: 't-mariners-fc', name: 'Mariners FC' },
  })
  const phoenix = await prisma.team.upsert({
    where: { id: 't-phoenix-fc' },
    update: {},
    create: { id: 't-phoenix-fc', name: 'Phoenix FC' },
  })
  const storm = await prisma.team.upsert({
    where: { id: 't-storm-united' },
    update: {},
    create: { id: 't-storm-united', name: 'Storm United' },
  })
  console.log(`  ✓ Teams: ${[mariners, phoenix, storm].map(t => t.name).join(', ')}`)

  // ── 3. League Teams (enroll) ───────────────────────────────────────────────
  const ltMariners = await prisma.leagueTeam.upsert({
    where: { id: mkLTId('Mariners FC') },
    update: {},
    create: { id: mkLTId('Mariners FC'), leagueId: league.id, teamId: mariners.id },
  })
  const ltPhoenix = await prisma.leagueTeam.upsert({
    where: { id: mkLTId('Phoenix FC') },
    update: {},
    create: { id: mkLTId('Phoenix FC'), leagueId: league.id, teamId: phoenix.id },
  })
  const ltStorm = await prisma.leagueTeam.upsert({
    where: { id: mkLTId('Storm United') },
    update: {},
    create: { id: mkLTId('Storm United'), leagueId: league.id, teamId: storm.id },
  })
  console.log('  ✓ LeagueTeams enrolled')

  // ── 4. Players ────────────────────────────────────────────────────────────
  // Stefan S already exists in DB (imported from Sheets) — just ensure lineId is set
  const stefan = await prisma.player.upsert({
    where:  { id: mkPlayerId('Stefan S') },
    update: { lineId: 'Uc8cdcc63cac89d5c349aa72b9e3355c2' },
    create: {
      id:     mkPlayerId('Stefan S'),
      name:   'Stefan S',
      lineId: 'Uc8cdcc63cac89d5c349aa72b9e3355c2',
    },
  })

  const playerDefs: { name: string; ltId: string }[] = [
    { name: 'Stefan S',       ltId: ltMariners.id },
    { name: 'Player Alpha',   ltId: ltMariners.id },
    { name: 'Player Beta',    ltId: ltMariners.id },
    { name: 'Player Gamma',   ltId: ltPhoenix.id  },
    { name: 'Player Delta',   ltId: ltPhoenix.id  },
    { name: 'Player Epsilon', ltId: ltStorm.id    },
  ]

  for (const def of playerDefs) {
    let player = def.name === 'Stefan S' ? stefan : null
    if (!player) {
      player = await prisma.player.upsert({
        where:  { id: mkPlayerId(def.name) },
        update: {},
        create: { id: mkPlayerId(def.name), name: def.name },
      })
    }
    await prisma.playerLeagueAssignment.upsert({
      where:  { id: mkPlaId(player.id, def.ltId) },
      update: {},
      create: { id: mkPlaId(player.id, def.ltId), playerId: player.id, leagueTeamId: def.ltId, fromGameWeek: 1 },
    })
  }
  console.log(`  ✓ Players: ${playerDefs.length} assigned`)

  // ── 5. GameWeeks ──────────────────────────────────────────────────────────
  const gwDefs = [
    { wk: 1, date: '2025-05-10' },
    { wk: 2, date: '2025-06-10' },
    { wk: 3, date: '2025-07-10' },
    { wk: 4, date: '2025-08-10' },
  ]

  const gameWeekIdMap: Record<number, string> = {}
  for (const gw of gwDefs) {
    const record = await prisma.gameWeek.upsert({
      where:  { leagueId_weekNumber: { leagueId: league.id, weekNumber: gw.wk } },
      update: {},
      create: {
        id:         mkGWId(gw.wk),
        leagueId:   league.id,
        weekNumber: gw.wk,
        startDate:  new Date(gw.date),
        endDate:    new Date(gw.date),
      },
    })
    gameWeekIdMap[gw.wk] = record.id
  }
  console.log('  ✓ GameWeeks: 4')

  // ── 6. Matches ────────────────────────────────────────────────────────────
  type MatchDef = { wk: number; home: string; away: string; time: string }

  const lt = { mariners: ltMariners, phoenix: ltPhoenix, storm: ltStorm }

  function matchDt(date: string, time: string) {
    return new Date(`${date}T${time}:00+09:00`)
  }

  const matchDefs: MatchDef[] = [
    // GW1 — May 10
    { wk: 1, home: 'Mariners FC', away: 'Phoenix FC',   time: '19:00' },
    { wk: 1, home: 'Phoenix FC',  away: 'Storm United', time: '19:45' },
    { wk: 1, home: 'Storm United',away: 'Mariners FC',  time: '20:30' },
    // GW2 — Jun 10
    { wk: 2, home: 'Mariners FC', away: 'Storm United', time: '15:00' },
    { wk: 2, home: 'Storm United',away: 'Mariners FC',  time: '16:00' },
    // GW3 — Jul 10
    { wk: 3, home: 'Phoenix FC',  away: 'Mariners FC',  time: '19:00' },
    { wk: 3, home: 'Mariners FC', away: 'Storm United', time: '19:45' },
    { wk: 3, home: 'Storm United',away: 'Phoenix FC',   time: '20:30' },
    // GW4 — Aug 10
    { wk: 4, home: 'Phoenix FC',  away: 'Storm United', time: '15:00' },
    { wk: 4, home: 'Storm United',away: 'Phoenix FC',   time: '16:00' },
  ]

  const gwDateMap: Record<number, string> = { 1: '2025-05-10', 2: '2025-06-10', 3: '2025-07-10', 4: '2025-08-10' }
  const ltByName: Record<string, typeof ltMariners> = {
    'Mariners FC': lt.mariners,
    'Phoenix FC':  lt.phoenix,
    'Storm United': lt.storm,
  }

  for (const m of matchDefs) {
    const matchId = mkMatchId(m.wk, m.home, m.away)
    await prisma.match.upsert({
      where:  { id: matchId },
      update: {},
      create: {
        id:         matchId,
        leagueId:   league.id,
        gameWeekId: gameWeekIdMap[m.wk],
        homeTeamId: ltByName[m.home].id,
        awayTeamId: ltByName[m.away].id,
        playedAt:   matchDt(gwDateMap[m.wk], m.time),
        status:     'SCHEDULED',
      },
    })
  }
  console.log(`  ✓ Matches: ${matchDefs.length}`)

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n✅ Seed complete:')
  console.log(`   1 league   | id: ${league.id}`)
  console.log(`   3 teams    | Mariners FC, Phoenix FC, Storm United`)
  console.log(`   6 players  | Stefan S + 5 others`)
  console.log(`   4 gameweeks`)
  console.log(`  10 matches`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
