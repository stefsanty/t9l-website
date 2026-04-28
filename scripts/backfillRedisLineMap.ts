/**
 * Redis line-player-map → Prisma backfill (PR 6 of the migration).
 *
 * Reads the legacy Upstash Redis hash `line-player-map` (lineId → {playerId,
 * playerName, teamId}) and writes the canonical link onto `Player.lineId` in
 * Postgres. Also seeds/updates a `LineLogin` row per migrated lineId so the
 * admin Flow B orphan dropdown reflects the full historical population (with
 * name=playerName fallback — Redis didn't store the LINE display name).
 *
 * Idempotent: re-runs are safe.
 *   - Player.lineId is set only when target Player exists AND its lineId is
 *     either null or already equal to the Redis lineId. Conflicts (same Redis
 *     lineId pointing at a different player than DB already records) are
 *     reported as warnings and skipped — operator decides via admin UI.
 *   - LineLogin upsert keys on lineId.
 *
 * Run order:
 *   1. Pull preview env (per-PR Neon branch) and verify against it first.
 *   2. After PR B's preview deploy verifies, pull prod env and run again
 *      against prod Neon BEFORE merging PR B (so the cutover route hits an
 *      already-populated table on first request).
 *
 * Flags:
 *   --dry-run        Don't write; just report what would happen.
 *   --verbose        Print per-row decisions.
 *
 * Usage: npx ts-node --project tsconfig.scripts.json scripts/backfillRedisLineMap.ts [flags]
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import { PrismaClient } from '@prisma/client'
import { Redis } from '@upstash/redis'

dotenv.config({ path: path.resolve(process.cwd(), '.env.preview') })
dotenv.config({ path: path.resolve(process.cwd(), '.env.production') })
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config()

const PLAYER_ID_PREFIX = 'p-'

interface Flags {
  dryRun: boolean
  verbose: boolean
}

function parseFlags(argv: string[]): Flags {
  return {
    dryRun: argv.includes('--dry-run'),
    verbose: argv.includes('--verbose'),
  }
}

interface RedisMapping {
  playerId: string
  playerName: string
  teamId: string
}

export interface BackfillResult {
  scanned: number
  linked: number
  alreadyLinked: number
  conflicts: number
  missingPlayer: number
  lineLoginUpserts: number
}

/**
 * Decide what to do for a single (lineId, mapping) pair given the current
 * DB state. Pure function for unit testing.
 */
export type LinkDecision =
  | { kind: 'link'; dbPlayerId: string; lineId: string }
  | { kind: 'already-linked'; dbPlayerId: string; lineId: string }
  | { kind: 'conflict'; dbPlayerId: string; existingLineId: string; redisLineId: string }
  | { kind: 'missing-player'; redisPlayerId: string }

export function decideLink(
  lineId: string,
  mapping: RedisMapping,
  dbPlayer: { id: string; lineId: string | null } | null,
): LinkDecision {
  if (!dbPlayer) {
    return { kind: 'missing-player', redisPlayerId: mapping.playerId }
  }
  if (dbPlayer.lineId === lineId) {
    return { kind: 'already-linked', dbPlayerId: dbPlayer.id, lineId }
  }
  if (dbPlayer.lineId && dbPlayer.lineId !== lineId) {
    return {
      kind: 'conflict',
      dbPlayerId: dbPlayer.id,
      existingLineId: dbPlayer.lineId,
      redisLineId: lineId,
    }
  }
  return { kind: 'link', dbPlayerId: dbPlayer.id, lineId }
}

async function main() {
  const flags = parseFlags(process.argv.slice(2))
  const prisma = new PrismaClient()

  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    console.error('KV_REST_API_URL / KV_REST_API_TOKEN not set — cannot read Redis')
    process.exit(1)
  }
  const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  })

  console.log(`Redis line-player-map → Prisma backfill ${flags.dryRun ? '(DRY RUN)' : '(LIVE)'}`)

  const hash = (await redis.hgetall<Record<string, RedisMapping>>('line-player-map')) ?? {}
  const entries = Object.entries(hash)
  console.log(`Found ${entries.length} entries in line-player-map`)

  const result: BackfillResult = {
    scanned: entries.length,
    linked: 0,
    alreadyLinked: 0,
    conflicts: 0,
    missingPlayer: 0,
    lineLoginUpserts: 0,
  }

  for (const [lineId, mapping] of entries) {
    const dbPlayerId = `${PLAYER_ID_PREFIX}${mapping.playerId}`
    const dbPlayer = await prisma.player.findUnique({
      where: { id: dbPlayerId },
      select: { id: true, lineId: true },
    })
    const decision = decideLink(lineId, mapping, dbPlayer)

    switch (decision.kind) {
      case 'link': {
        if (flags.verbose || flags.dryRun) {
          console.log(`LINK    ${lineId} → ${decision.dbPlayerId} (${mapping.playerName})`)
        }
        if (!flags.dryRun) {
          await prisma.$transaction([
            prisma.player.updateMany({
              where: { lineId, id: { not: decision.dbPlayerId } },
              data: { lineId: null },
            }),
            prisma.player.update({
              where: { id: decision.dbPlayerId },
              data: { lineId },
            }),
          ])
        }
        result.linked++
        break
      }
      case 'already-linked': {
        if (flags.verbose) {
          console.log(`SKIP    ${lineId} → ${decision.dbPlayerId} (already linked)`)
        }
        result.alreadyLinked++
        break
      }
      case 'conflict': {
        console.warn(
          `CONFLICT ${lineId}: Redis says player ${mapping.playerId}, DB has lineId=${decision.existingLineId} on ${decision.dbPlayerId} — skipping`,
        )
        result.conflicts++
        break
      }
      case 'missing-player': {
        console.warn(
          `MISSING  ${lineId}: Redis player ${decision.redisPlayerId} not found in DB — skipping`,
        )
        result.missingPlayer++
        break
      }
    }

    // Always upsert LineLogin so the admin Flow B dropdown sees the historical
    // population. Use playerName as a name fallback (LINE display name wasn't
    // stored in Redis).
    if (!flags.dryRun) {
      await prisma.lineLogin.upsert({
        where: { lineId },
        create: {
          lineId,
          name: mapping.playerName ?? null,
        },
        update: {
          // Don't overwrite a name LINE has since populated.
        },
      })
    }
    result.lineLoginUpserts++
  }

  console.log('')
  console.log('Summary:')
  console.log(`  Scanned         ${result.scanned}`)
  console.log(`  Linked          ${result.linked}`)
  console.log(`  Already linked  ${result.alreadyLinked}`)
  console.log(`  Conflicts       ${result.conflicts}`)
  console.log(`  Missing player  ${result.missingPlayer}`)
  console.log(`  LineLogin rows  ${result.lineLoginUpserts}`)
  if (flags.dryRun) console.log('  (dry run — no writes)')

  await prisma.$disconnect()
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
