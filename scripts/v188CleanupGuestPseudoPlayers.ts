/**
 * v1.88.0 — One-shot cleanup script for the Guest pseudo-Player rows
 * left behind after the v1.88.0 Guest refactor migration runs.
 *
 * Why this is a separate script (not in the migration SQL):
 *   docs/migration-sql-lessons.md (post-v1.86.0 incident) requires that
 *   migrations not contain `DELETE FROM` statements outside the initial
 *   `new_schema` migration. The schema change + UPDATE backfill ship in
 *   `prisma/migrations/20260519000000_match_event_guest_flags/migration.sql`;
 *   this script handles the destructive deletion of the *seeded* Guest
 *   Player + PlayerLeagueAssignment rows that the v1.46.x Sheets
 *   backfill scripts inserted.
 *
 * What it deletes (v1.88.1 — scoped to PER-TEAM Guests only):
 *   1. PlayerLeagueAssignment rows where playerId LIKE 'p-guest-%'
 *      (4 rows — one per team in the v1.46.1 backfill).
 *   2. Player rows where id LIKE 'p-guest-%' (4 rows — the per-team
 *      `p-guest-<lt-id>` records).
 *
 *   The legacy single `p-guest` Player (created by the older v1.46.0
 *   `sheetsToDbBackfill.ts`) is INTENTIONALLY out of scope:
 *     - It has no PlayerLeagueAssignment, so it never appeared in any
 *       roster / scorer dropdown — i.e. nothing to clean from a
 *       user-visible-state standpoint.
 *     - It is referenced by 4 legacy `Goal` + 3 legacy `Assist` rows
 *       (pre-v1.42.0 model) that include one goal with NO MatchEvent
 *       counterpart. Live scoreline already ignores those rows
 *       (recompute path is MatchEvent-only since v1.42.0), but the
 *       Goal record is the only remaining trace of that goal in the
 *       DB. Deleting the Player row would cascade-fail on the
 *       Goal_playerId_fkey FK; deleting the Goal/Assist rows along
 *       with it would erase that historical record. Out of scope for
 *       this PR — explicit operator authorization required.
 *
 * No real player data is touched — these are seeded pseudo-records.
 *
 * Safety gates:
 *   - --dry-run by default (prints what would happen).
 *   - --apply mode requires the migration to have run first
 *     (verifies via the presence of `MatchEvent.isGuestScorer` column).
 *   - Aborts if any MatchEvent still references a guest playerId on
 *     scorerId or assisterId — that means the migration's UPDATE
 *     backfill didn't run, and deleting the Player rows would FK-fail.
 *
 * Run:
 *   npx tsx scripts/v188CleanupGuestPseudoPlayers.ts            # dry-run
 *   npx tsx scripts/v188CleanupGuestPseudoPlayers.ts --apply    # delete
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const apply = process.argv.includes('--apply')
  console.log(`Mode: ${apply ? 'APPLY' : 'dry-run'}`)

  // Gate 1: schema must have the new boolean columns.
  const schemaCheck: Array<{ column_name: string }> = await prisma.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'MatchEvent' AND column_name = 'isGuestScorer'
  `)
  if (schemaCheck.length === 0) {
    throw new Error('Schema gate failed — MatchEvent.isGuestScorer column missing. Run `prisma migrate deploy` first.')
  }

  // Gate 2: no MatchEvent may still reference a guest pseudo-Player.
  const danglingScorers: Array<{ n: bigint }> = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::bigint AS n FROM "MatchEvent" WHERE "scorerId" LIKE 'p-guest-%'
  `)
  const danglingAssisters: Array<{ n: bigint }> = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::bigint AS n FROM "MatchEvent" WHERE "assisterId" LIKE 'p-guest-%'
  `)
  const dangling = Number(danglingScorers[0].n) + Number(danglingAssisters[0].n)
  if (dangling > 0) {
    throw new Error(
      `MatchEvent gate failed — ${dangling} rows still reference a guest playerId. ` +
        `The migration's UPDATE backfill should have flipped them; aborting before FK-failure.`,
    )
  }

  // Audit current state.
  const guests: Array<{ id: string; name: string | null }> = await prisma.$queryRawUnsafe(`
    SELECT id, name FROM "Player" WHERE id LIKE 'p-guest-%' ORDER BY id
  `)
  const plms: Array<{ id: string; playerId: string; leagueTeamId: string | null }> = await prisma.$queryRawUnsafe(`
    SELECT id, "playerId", "leagueTeamId" FROM "PlayerLeagueAssignment" WHERE "playerId" LIKE 'p-guest-%' ORDER BY "playerId"
  `)

  console.log(`\nGuest Player rows (${guests.length}):`)
  for (const g of guests) console.log(`  ${g.id}  name=${JSON.stringify(g.name)}`)
  console.log(`\nGuest PlayerLeagueAssignment rows (${plms.length}):`)
  for (const p of plms) console.log(`  ${p.id}  playerId=${p.playerId}  leagueTeamId=${p.leagueTeamId}`)

  if (!apply) {
    console.log('\nDry-run only. Re-run with --apply to delete.')
    return
  }

  // Apply: PLMs first (so the Player FK from PLM is gone), then Players.
  await prisma.$transaction(async (tx) => {
    const plmDel: Array<{ count: bigint }> = await tx.$queryRawUnsafe(`
      WITH d AS (DELETE FROM "PlayerLeagueAssignment" WHERE "playerId" LIKE 'p-guest-%' RETURNING 1)
      SELECT COUNT(*)::bigint AS count FROM d
    `)
    console.log(`Deleted ${plmDel[0].count} PlayerLeagueAssignment rows.`)

    const playerDel: Array<{ count: bigint }> = await tx.$queryRawUnsafe(`
      WITH d AS (DELETE FROM "Player" WHERE id LIKE 'p-guest-%' RETURNING 1)
      SELECT COUNT(*)::bigint AS count FROM d
    `)
    console.log(`Deleted ${playerDel[0].count} Player rows.`)
  })

  console.log('\nApply complete.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
