/**
 * Prisma → Redis RSVP backfill (PR 19 / v1.7.0).
 *
 * Rebuilds the Redis RSVP store (`t9l:rsvp:gw:<gameWeekId>` hashes) from
 * Prisma `Availability` rows. Used in two situations:
 *
 *   1. **One-time migration** when v1.7.0 lands: Redis is the new canonical
 *      read source for RSVP signals. Pre-v1.7.0 the same Redis namespace
 *      was empty (RSVPs lived only in Prisma); the public dashboard read
 *      from `dbToPublicLeagueData`'s availability include and the
 *      `unstable_cache` 30s wrapper. Run this script BEFORE the no-fallback
 *      code deploys, otherwise the first dashboard render for each GameWeek
 *      misses Redis and falls through to Prisma — defensible (the
 *      publicData backfill repopulates on miss) but a transient cold-Neon
 *      storm at deploy time.
 *
 *   2. **Disaster recovery** if Upstash ever loses data or the RSVP
 *      namespace is cleared accidentally. Prisma `Availability` is the
 *      durable backup; this script rebuilds Redis from it on demand.
 *
 * Idempotent. Safe to re-run. The `--dry-run` mode reports exactly what
 * would change without writing.
 *
 * Output: per-GameWeek decisions (CREATE / MATCH / DRIFT-OVERWRITE) + a
 * summary.
 *
 * Usage:
 *   npx tsx scripts/backfillRedisRsvpFromPrisma.ts --dry-run     # report only
 *   npx tsx scripts/backfillRedisRsvpFromPrisma.ts --apply       # actually write
 *   --verbose                                                     # per-row trace
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import { PrismaClient, type RsvpStatus, type ParticipatedStatus } from '@prisma/client'
import { Redis } from '@upstash/redis'

dotenv.config({ path: path.resolve(process.cwd(), '.env.preview') })
dotenv.config({ path: path.resolve(process.cwd(), '.env.production') })
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config()

// Mirrors `rsvpStore.ts` — same prefix, same field naming, same TTL math.
const KEY_PREFIX = 't9l:rsvp:gw:'
const SEEDED_FIELD = '__seeded'
const SEEDED_VALUE = '1'
const RSVP_SUFFIX = ':rsvp'
const PARTICIPATED_SUFFIX = ':p'
const TTL_DAYS_AFTER_MATCH = 90
const PLAYER_ID_PREFIX = 'p-'

interface Flags {
  dryRun: boolean
  apply: boolean
  verbose: boolean
}

function parseFlags(argv: string[]): Flags {
  return {
    dryRun: argv.includes('--dry-run'),
    apply: argv.includes('--apply'),
    verbose: argv.includes('--verbose'),
  }
}

export type RsvpEntry = {
  rsvp?: RsvpStatus
  participated?: ParticipatedStatus
}

/**
 * Pure decision helper. Given the truth from Prisma (target hash fields)
 * and what Redis currently holds for the same GameWeek, decide what action
 * to take. Exported for unit testing.
 *
 * `targetFields` is the desired full hash content including `__seeded=1`
 * and per-player `<slug>:rsvp` / `<slug>:p` fields. `redisRaw` is the
 * Upstash HGETALL result (null when the key doesn't exist).
 */
export type RsvpBackfillDecision =
  | { kind: 'create'; targetFields: Record<string, string> }
  | { kind: 'match'; targetFields: Record<string, string> }
  | {
      kind: 'drift-overwrite'
      targetFields: Record<string, string>
      redisHad: Record<string, string> | null
      diff: { onlyInPrisma: string[]; onlyInRedis: string[]; differing: string[] }
    }

export function decideBackfillAction(
  targetFields: Record<string, string>,
  redisRaw: Record<string, string> | null,
): RsvpBackfillDecision {
  if (redisRaw === null || Object.keys(redisRaw).length === 0) {
    return { kind: 'create', targetFields }
  }
  // Drop the sentinel from the comparison — both sides should always have
  // it post-write; treat its absence on the Redis side as drift.
  const target = { ...targetFields }
  const redis = { ...redisRaw }

  const onlyInPrisma: string[] = []
  const onlyInRedis: string[] = []
  const differing: string[] = []

  const allFields = new Set<string>([...Object.keys(target), ...Object.keys(redis)])
  for (const field of allFields) {
    const t = target[field]
    const r = redis[field]
    if (t === undefined && r !== undefined) onlyInRedis.push(field)
    else if (r === undefined && t !== undefined) onlyInPrisma.push(field)
    else if (t !== r) differing.push(field)
  }

  if (
    onlyInPrisma.length === 0 &&
    onlyInRedis.length === 0 &&
    differing.length === 0
  ) {
    return { kind: 'match', targetFields }
  }
  return {
    kind: 'drift-overwrite',
    targetFields,
    redisHad: redisRaw,
    diff: { onlyInPrisma, onlyInRedis, differing },
  }
}

function stripPrefix(id: string, prefix: string): string {
  return id.startsWith(prefix) ? id.slice(prefix.length) : id
}

export function computeExpireAt(
  gwStartDate: Date,
  now: Date = new Date(),
): number {
  const base = Math.max(gwStartDate.getTime(), now.getTime())
  return Math.floor(
    (base + TTL_DAYS_AFTER_MATCH * 24 * 60 * 60 * 1000) / 1000,
  )
}

/**
 * Build the desired Redis hash content for a GameWeek from a list of
 * Availability rows. Always includes `__seeded=1`.
 *
 * Pure — exported for unit testing.
 */
export function buildTargetFields(
  rows: { playerId: string; rsvp: RsvpStatus | null; participated: ParticipatedStatus | null }[],
): Record<string, string> {
  const fields: Record<string, string> = { [SEEDED_FIELD]: SEEDED_VALUE }
  for (const row of rows) {
    const slug = stripPrefix(row.playerId, PLAYER_ID_PREFIX)
    if (row.rsvp !== null) {
      fields[`${slug}${RSVP_SUFFIX}`] = row.rsvp
    }
    if (row.participated !== null) {
      fields[`${slug}${PARTICIPATED_SUFFIX}`] = row.participated
    }
  }
  return fields
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

  console.log(`Prisma → Redis RSVP backfill ${flags.dryRun ? '(DRY RUN)' : '(APPLY)'}`)
  console.log(`  KV URL:  ${process.env.KV_REST_API_URL?.replace(/\/\/[^@]+@/, '//***@')}`)
  console.log(`  TTL:     matchday + ${TTL_DAYS_AFTER_MATCH}d (absolute, EXPIREAT)`)
  console.log('')

  const leagues = await prisma.league.findMany({
    select: {
      id: true,
      name: true,
      gameWeeks: {
        select: { id: true, weekNumber: true, startDate: true },
        orderBy: { weekNumber: 'asc' },
      },
    },
  })

  let totalGws = 0
  for (const lg of leagues) totalGws += lg.gameWeeks.length
  console.log(`Found ${leagues.length} leagues / ${totalGws} GameWeeks total.`)
  console.log('')

  const result: BackfillResult = {
    scanned: 0,
    created: 0,
    matched: 0,
    driftOverwritten: 0,
    errors: 0,
  }
  const driftSamples: Array<{
    leagueName: string
    gwId: string
    weekNumber: number
    diff: { onlyInPrisma: string[]; onlyInRedis: string[]; differing: string[] }
  }> = []

  for (const lg of leagues) {
    if (flags.verbose) console.log(`-- League: ${lg.name} (${lg.id})`)
    for (const gw of lg.gameWeeks) {
      result.scanned++

      const rows = await prisma.availability.findMany({
        where: { gameWeekId: gw.id },
        select: { playerId: true, rsvp: true, participated: true },
      })
      const targetFields = buildTargetFields(rows)

      const key = `${KEY_PREFIX}${gw.id}`
      let redisRaw: Record<string, string> | null
      try {
        redisRaw = await redis.hgetall(key) as Record<string, string> | null
      } catch (err) {
        console.warn(
          `  ERROR  ${gw.id} (W${gw.weekNumber}): redis.hgetall failed: ${err instanceof Error ? err.message : err}`,
        )
        result.errors++
        continue
      }

      const decision = decideBackfillAction(targetFields, redisRaw)

      switch (decision.kind) {
        case 'create': {
          if (flags.verbose || flags.dryRun) {
            const fieldCount = Object.keys(targetFields).length - 1 // exclude __seeded
            console.log(
              `  CREATE ${lg.name} W${gw.weekNumber} (${gw.id}) → ${fieldCount} field(s) from ${rows.length} row(s)`,
            )
          }
          result.created++
          break
        }
        case 'match': {
          if (flags.verbose) {
            console.log(`  MATCH  ${lg.name} W${gw.weekNumber} (${gw.id})`)
          }
          result.matched++
          break
        }
        case 'drift-overwrite': {
          console.log(
            `  DRIFT  ${lg.name} W${gw.weekNumber} (${gw.id}): +prisma=${decision.diff.onlyInPrisma.length} +redis=${decision.diff.onlyInRedis.length} ≠=${decision.diff.differing.length}`,
          )
          driftSamples.push({
            leagueName: lg.name,
            gwId: gw.id,
            weekNumber: gw.weekNumber,
            diff: decision.diff,
          })
          result.driftOverwritten++
          break
        }
      }

      if (
        flags.apply &&
        (decision.kind === 'create' || decision.kind === 'drift-overwrite')
      ) {
        try {
          // Drift-overwrite: DEL the existing key first so onlyInRedis fields
          // don't survive. Create: no key exists yet, DEL is a no-op.
          if (decision.kind === 'drift-overwrite') {
            await redis.del(key)
          }
          await redis.hset(key, targetFields)
          await redis.expireat(key, computeExpireAt(gw.startDate))
        } catch (err) {
          console.warn(
            `  ERROR  ${gw.id} (W${gw.weekNumber}): write failed: ${err instanceof Error ? err.message : err}`,
          )
          result.errors++
        }
      }
    }
  }

  console.log('')
  console.log('Summary:')
  console.log(`  Scanned (GameWeeks across all leagues)  ${result.scanned}`)
  console.log(`  Would create (Redis key missing)         ${result.created}`)
  console.log(`  Already match (Redis = Prisma)           ${result.matched}`)
  console.log(`  Drift (Redis ≠ Prisma; overwrite)        ${result.driftOverwritten}`)
  console.log(`  Errors during scan                       ${result.errors}`)
  if (flags.dryRun) {
    console.log(`  Mode: DRY RUN — no writes performed`)
    if (driftSamples.length > 0) {
      console.log('')
      console.log('Drift detail:')
      for (const d of driftSamples) {
        console.log(`  ${d.leagueName} W${d.weekNumber} (${d.gwId})`)
        if (d.diff.onlyInPrisma.length)
          console.log(`    only in prisma : ${d.diff.onlyInPrisma.join(', ')}`)
        if (d.diff.onlyInRedis.length)
          console.log(`    only in redis  : ${d.diff.onlyInRedis.join(', ')}`)
        if (d.diff.differing.length)
          console.log(`    differing      : ${d.diff.differing.join(', ')}`)
      }
    }
  } else {
    console.log(
      `  Mode: APPLY — wrote ${result.created + result.driftOverwritten} GameWeek hashes to Redis`,
    )
  }

  await prisma.$disconnect()
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
