/**
 * Prisma → Redis backfill (PR 16 / v1.5.0).
 *
 * Rebuilds the Redis player-mapping store from `Player.lineId` rows in
 * Prisma. Used in two situations:
 *
 *   1. **One-time migration** when v1.5.0 lands: Redis is the new canonical
 *      store for the lineId→Player auth lookup. Pre-v1.5.0 the same Redis
 *      keys served a 60-second cache; entries that were never written there
 *      (or expired before the cutover) need to be seeded from Prisma BEFORE
 *      the no-Prisma-fallback code deploys, so authenticated users don't
 *      flap to "orphan" on the first request after the cutover.
 *
 *   2. **Disaster recovery** if Upstash ever loses data or the namespace is
 *      cleared accidentally. Prisma `Player.lineId` is the durable backup;
 *      this script rebuilds Redis from it on demand.
 *
 * Idempotent. Safe to re-run. The `--dry-run` mode reports exactly what
 * would change without writing.
 *
 * Output: per-row decisions (CREATE / MATCH / DRIFT-OVERWRITE) + a summary.
 *
 * Usage:
 *   npx tsx scripts/backfillRedisFromPrisma.ts --dry-run     # report only
 *   npx tsx scripts/backfillRedisFromPrisma.ts --apply       # actually write
 *   --verbose                                                 # per-row trace
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import { PrismaClient } from '@prisma/client'
import { Redis } from '@upstash/redis'

dotenv.config({ path: path.resolve(process.cwd(), '.env.preview') })
dotenv.config({ path: path.resolve(process.cwd(), '.env.production') })
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config()

// Mirrors `playerMappingStore.ts` — same prefix, same TTL.
const KEY_PREFIX = 't9l:auth:map:'
const TTL_SECONDS = 60 * 60 * 24
const NULL_SENTINEL = '__null__'
const PLAYER_ID_PREFIX = 'p-'
const TEAM_ID_PREFIX = 't-'

interface Flags {
  dryRun: boolean
  apply: boolean
  verbose: boolean
}

function parseFlags(argv: string[]): Flags {
  const dryRun = argv.includes('--dry-run')
  const apply = argv.includes('--apply')
  return {
    dryRun,
    apply,
    verbose: argv.includes('--verbose'),
  }
}

export interface PlayerMapping {
  playerId: string
  playerName: string
  teamId: string
}

/**
 * Pure decision helper. Given the truth from Prisma and what Redis currently
 * holds for the same lineId, decide what action to take. Exported for unit
 * testing in `tests/unit/backfillRedisFromPrisma.test.ts`.
 */
export type BackfillDecision =
  | { kind: 'create'; mapping: PlayerMapping }
  | { kind: 'match'; mapping: PlayerMapping }
  | { kind: 'drift-overwrite'; redisHad: PlayerMapping | null | 'malformed'; mapping: PlayerMapping }

export function decideBackfillAction(
  prismaMapping: PlayerMapping,
  redisRaw: string | object | null,
): BackfillDecision {
  if (redisRaw === null || redisRaw === undefined) {
    return { kind: 'create', mapping: prismaMapping }
  }
  // Null sentinel: Redis explicitly says "no mapping", Prisma says otherwise.
  // Treat as drift — Prisma is recovery truth.
  if (redisRaw === NULL_SENTINEL) {
    return { kind: 'drift-overwrite', redisHad: null, mapping: prismaMapping }
  }
  // Already-parsed object (Upstash auto-parse path).
  if (typeof redisRaw === 'object') {
    const obj = redisRaw as Record<string, unknown>
    if (typeof obj.playerId !== 'string' || typeof obj.teamId !== 'string') {
      return { kind: 'drift-overwrite', redisHad: 'malformed', mapping: prismaMapping }
    }
    const current = obj as unknown as PlayerMapping
    if (mappingEqual(current, prismaMapping)) {
      return { kind: 'match', mapping: prismaMapping }
    }
    return { kind: 'drift-overwrite', redisHad: current, mapping: prismaMapping }
  }
  // String-encoded JSON.
  try {
    const parsed = JSON.parse(redisRaw) as PlayerMapping
    if (mappingEqual(parsed, prismaMapping)) {
      return { kind: 'match', mapping: prismaMapping }
    }
    return { kind: 'drift-overwrite', redisHad: parsed, mapping: prismaMapping }
  } catch {
    return { kind: 'drift-overwrite', redisHad: 'malformed', mapping: prismaMapping }
  }
}

function mappingEqual(a: PlayerMapping, b: PlayerMapping): boolean {
  return (
    a.playerId === b.playerId &&
    a.playerName === b.playerName &&
    a.teamId === b.teamId
  )
}

function stripPrefix(id: string, prefix: string): string {
  return id.startsWith(prefix) ? id.slice(prefix.length) : id
}

interface BackfillResult {
  scanned: number
  created: number
  matched: number
  driftOverwritten: number
  errors: number
}

async function main() {
  const flags = parseFlags(process.argv.slice(2))

  if (!flags.dryRun && !flags.apply) {
    console.error('Refusing to run: pass either --dry-run or --apply.')
    process.exit(2)
  }
  if (flags.dryRun && flags.apply) {
    console.error('Refusing to run: --dry-run and --apply are mutually exclusive.')
    process.exit(2)
  }

  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    console.error('KV_REST_API_URL / KV_REST_API_TOKEN not set — cannot read/write Redis')
    process.exit(1)
  }

  const prisma = new PrismaClient()
  const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  })

  console.log(`Prisma → Redis player-mapping backfill ${flags.dryRun ? '(DRY RUN)' : '(APPLY)'}`)
  console.log(`  KV URL:  ${process.env.KV_REST_API_URL?.replace(/\/\/[^@]+@/, '//***@')}`)
  console.log(`  TTL:     ${TTL_SECONDS}s (${(TTL_SECONDS / 3600).toFixed(0)}h sliding)`)
  console.log('')

  // Pull the same shape `getPlayerMappingFromDb` returns, in bulk. The
  // relation include is identical so the slug-stripped output exactly
  // matches what the JWT callback would have written via setMapping.
  const players = await prisma.player.findMany({
    where: { lineId: { not: null } },
    include: {
      leagueAssignments: {
        include: { leagueTeam: { include: { team: true } } },
        orderBy: { fromGameWeek: 'desc' },
      },
    },
  })

  console.log(`Found ${players.length} Player rows with lineId set in Prisma.`)
  console.log('')

  const result: BackfillResult = {
    scanned: 0,
    created: 0,
    matched: 0,
    driftOverwritten: 0,
    errors: 0,
  }
  const driftSamples: Array<{
    lineId: string
    redisHad: PlayerMapping | null | 'malformed'
    prismaSays: PlayerMapping
  }> = []

  for (const p of players) {
    if (!p.lineId) continue
    result.scanned++

    const current =
      p.leagueAssignments.find((a) => a.toGameWeek === null) ??
      p.leagueAssignments[0] ??
      null
    const prismaMapping: PlayerMapping = {
      playerId: stripPrefix(p.id, PLAYER_ID_PREFIX),
      playerName: p.name,
      teamId: current ? stripPrefix(current.leagueTeam.team.id, TEAM_ID_PREFIX) : '',
    }

    const key = `${KEY_PREFIX}${p.lineId}`
    let redisRaw: string | object | null
    try {
      redisRaw = await redis.get(key)
    } catch (err) {
      console.warn(`  ERROR  ${p.lineId}: redis.get failed: ${err instanceof Error ? err.message : err}`)
      result.errors++
      continue
    }

    const decision = decideBackfillAction(prismaMapping, redisRaw)

    switch (decision.kind) {
      case 'create': {
        if (flags.verbose || flags.dryRun) {
          console.log(`  CREATE ${p.lineId} → ${prismaMapping.playerId} (${prismaMapping.playerName}, ${prismaMapping.teamId || 'no-team'})`)
        }
        result.created++
        break
      }
      case 'match': {
        if (flags.verbose) {
          console.log(`  MATCH  ${p.lineId} → ${prismaMapping.playerId}`)
        }
        result.matched++
        break
      }
      case 'drift-overwrite': {
        const had =
          decision.redisHad === 'malformed'
            ? '<malformed>'
            : decision.redisHad === null
              ? '<null sentinel>'
              : `${decision.redisHad.playerId}/${decision.redisHad.teamId}`
        console.log(
          `  DRIFT  ${p.lineId}: redis=${had}  prisma=${prismaMapping.playerId}/${prismaMapping.teamId} (${prismaMapping.playerName})`,
        )
        driftSamples.push({
          lineId: p.lineId,
          redisHad: decision.redisHad,
          prismaSays: prismaMapping,
        })
        result.driftOverwritten++
        break
      }
    }

    if (flags.apply && (decision.kind === 'create' || decision.kind === 'drift-overwrite')) {
      try {
        await redis.set(key, JSON.stringify(prismaMapping), { ex: TTL_SECONDS })
      } catch (err) {
        console.warn(
          `  ERROR  ${p.lineId}: redis.set failed: ${err instanceof Error ? err.message : err}`,
        )
        result.errors++
      }
    }
  }

  console.log('')
  console.log('Summary:')
  console.log(`  Scanned (Prisma rows with lineId)  ${result.scanned}`)
  console.log(`  Would create (Redis missing)        ${result.created}`)
  console.log(`  Already match (Redis = Prisma)      ${result.matched}`)
  console.log(`  Drift (Redis ≠ Prisma; overwrite)   ${result.driftOverwritten}`)
  console.log(`  Errors during scan                  ${result.errors}`)
  if (flags.dryRun) {
    console.log(`  Mode: DRY RUN — no writes performed`)
    if (driftSamples.length > 0) {
      console.log('')
      console.log('Drift detail:')
      for (const d of driftSamples) {
        const had =
          d.redisHad === 'malformed'
            ? 'malformed'
            : d.redisHad === null
              ? 'null sentinel'
              : JSON.stringify(d.redisHad)
        console.log(`  ${d.lineId}`)
        console.log(`    redis  : ${had}`)
        console.log(`    prisma : ${JSON.stringify(d.prismaSays)}`)
      }
    }
  } else {
    console.log(`  Mode: APPLY — wrote ${result.created + result.driftOverwritten} entries to Redis`)
  }

  await prisma.$disconnect()
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
