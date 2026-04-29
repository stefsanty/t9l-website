/**
 * Redis → Prisma audit (PR 20 / v1.8.0).
 *
 * The inverse direction of `backfillRedisFromPrisma.ts` and
 * `backfillRedisRsvpFromPrisma.ts`. Used to detect (and optionally repair)
 * **write-side drift**: state present in the canonical Redis store that
 * never made it to the durable Prisma backup because the deferred
 * `waitUntil` Prisma write failed in the background.
 *
 * Why the inverse direction matters in v1.8.0:
 *   v1.5.0/v1.7.0 made Redis canonical for **reads**; Prisma was both the
 *   write target and the recovery source. Drift was always Redis-stale →
 *   Prisma-fresh, recoverable by re-writing Redis from Prisma (which the
 *   pre-existing backfill scripts do).
 *
 *   v1.8.0 makes Redis canonical for **writes** on public hot paths
 *   (`/api/assign-player`, `/api/rsvp`). The Prisma write is deferred via
 *   `waitUntil`. If the deferred Prisma write fails (cold-Neon timeout,
 *   transient connection issue, etc.), the route handler emits a
 *   `[v1.8.0 DRIFT]` log line — but the operator needs a way to find AND
 *   repair the durable side. This script is that lever.
 *
 * Two domains, one script:
 *   1. **Player mapping** (`t9l:auth:map:*` ↔ `Player.lineId`)
 *   2. **RSVP** (`t9l:rsvp:gw:*` ↔ `Availability` rows)
 *
 * Scans both, reports rows present in Redis but missing OR differing in
 * Prisma. `--dry-run` (default) reports a punch list. `--repair-prisma`
 * writes the missing rows back to Prisma using Redis as truth.
 *
 * Usage:
 *   npx tsx scripts/auditRedisVsPrisma.ts                          # dry-run, both domains
 *   npx tsx scripts/auditRedisVsPrisma.ts --domain=playerMapping   # one domain only
 *   npx tsx scripts/auditRedisVsPrisma.ts --domain=rsvp
 *   npx tsx scripts/auditRedisVsPrisma.ts --repair-prisma          # actually repair
 *   --verbose                                                       # per-row trace
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import { PrismaClient, type RsvpStatus, type ParticipatedStatus } from '@prisma/client'
import { Redis } from '@upstash/redis'
import { playerIdToSlug, slugToPlayerId } from '../src/lib/ids'
import {
  RSVP_KEY_PREFIX,
  RSVP_SEEDED_FIELD as SEEDED_FIELD,
  RSVP_FIELD_SUFFIX as RSVP_SUFFIX,
  PARTICIPATED_FIELD_SUFFIX as PARTICIPATED_SUFFIX,
} from '../src/lib/rsvpStoreSchema'

dotenv.config({ path: path.resolve(process.cwd(), '.env.preview') })
dotenv.config({ path: path.resolve(process.cwd(), '.env.production') })
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config()

const PLAYER_MAP_KEY_PREFIX = 't9l:auth:map:'
const NULL_SENTINEL = '__null__'

interface Flags {
  repairPrisma: boolean
  domain: 'playerMapping' | 'rsvp' | 'both'
  verbose: boolean
}

function parseFlags(argv: string[]): Flags {
  let domain: Flags['domain'] = 'both'
  for (const arg of argv) {
    if (arg.startsWith('--domain=')) {
      const v = arg.slice('--domain='.length)
      if (v === 'playerMapping' || v === 'rsvp' || v === 'both') {
        domain = v
      } else {
        console.error(`Invalid --domain=${v}; expected playerMapping|rsvp|both`)
        process.exit(2)
      }
    }
  }
  return {
    repairPrisma: argv.includes('--repair-prisma'),
    domain,
    verbose: argv.includes('--verbose'),
  }
}

// ─── Player mapping audit ───────────────────────────────────────────────────

export type PlayerMapping = {
  playerId: string
  playerName: string
  teamId: string
}

/**
 * Pure decision helper for the player-mapping domain. Given what Redis
 * holds for a lineId and what Prisma has for the same lineId, decide what
 * action to take.
 *
 *   match              — Redis = Prisma; nothing to do.
 *   prisma-only        — Prisma has lineId, Redis missing. Audit reports it
 *                        but takes no action: this is the v1.5.0 read-side
 *                        drift case (Redis stale). The pre-existing
 *                        `backfillRedisFromPrisma.ts` is the right tool.
 *   redis-only         — Redis has a mapping, Prisma has no row holding
 *                        this lineId. The v1.8.0 write-side drift case.
 *                        --repair-prisma sets `Player.lineId` on the row
 *                        whose id matches `p-{redis.playerId}`.
 *   redis-null         — Redis has the null sentinel for this lineId.
 *                        Authoritative "no mapping" — match if Prisma also
 *                        empty, otherwise report `prisma-only`.
 *   redis-malformed    — Redis has a value we couldn't parse. Report only;
 *                        this is admin garbage, not v1.8.0 drift.
 */
export type PlayerMappingAuditDecision =
  | { kind: 'match' }
  | { kind: 'prisma-only'; prismaPlayerId: string }
  | {
      kind: 'redis-only'
      redisMapping: PlayerMapping
      targetDbPlayerId: string
    }
  | { kind: 'redis-malformed'; rawRedisValue: string | object }

export function decidePlayerMappingAudit(
  redisRaw: string | object | null,
  prismaPlayerId: string | null,
): PlayerMappingAuditDecision {
  // Parse the Redis side first.
  let redisMapping: PlayerMapping | null | 'malformed'
  if (redisRaw === null || redisRaw === undefined) {
    redisMapping = null
  } else if (redisRaw === NULL_SENTINEL) {
    redisMapping = null
  } else if (typeof redisRaw === 'object') {
    const obj = redisRaw as Record<string, unknown>
    if (typeof obj.playerId === 'string' && typeof obj.teamId === 'string' && typeof obj.playerName === 'string') {
      redisMapping = obj as unknown as PlayerMapping
    } else {
      redisMapping = 'malformed'
    }
  } else {
    try {
      const parsed = JSON.parse(redisRaw) as PlayerMapping
      if (typeof parsed.playerId === 'string' && typeof parsed.teamId === 'string' && typeof parsed.playerName === 'string') {
        redisMapping = parsed
      } else {
        redisMapping = 'malformed'
      }
    } catch {
      redisMapping = 'malformed'
    }
  }

  if (redisMapping === 'malformed') {
    return { kind: 'redis-malformed', rawRedisValue: redisRaw as string | object }
  }

  // Match cases.
  if (redisMapping === null && prismaPlayerId === null) return { kind: 'match' }
  if (redisMapping !== null && prismaPlayerId !== null) {
    // Both populated; check the player slug matches.
    const redisDbId = slugToPlayerId(redisMapping.playerId)
    if (redisDbId === prismaPlayerId) return { kind: 'match' }
    // Both populated but pointing at different players — Redis says lineId →
    // player A, Prisma has lineId → player B. Treat as redis-only with the
    // intended target being Redis's view (audit's job is to reflect canonical
    // Redis into Prisma). Operator can spot-check via the diff.
    return {
      kind: 'redis-only',
      redisMapping,
      targetDbPlayerId: redisDbId,
    }
  }
  if (redisMapping === null && prismaPlayerId !== null) {
    return { kind: 'prisma-only', prismaPlayerId }
  }
  // redisMapping !== null && prismaPlayerId === null
  return {
    kind: 'redis-only',
    redisMapping: redisMapping as PlayerMapping,
    targetDbPlayerId: slugToPlayerId((redisMapping as PlayerMapping).playerId),
  }
}

// ─── RSVP audit ─────────────────────────────────────────────────────────────

/**
 * Pure decision helper for the RSVP domain. Given what Redis holds for a
 * GameWeek and what Prisma has for the same GameWeek, compute per-field
 * drift.
 *
 *   match              — Redis fields = Prisma rows; nothing to do.
 *   redis-only         — Redis has fields Prisma doesn't. v1.8.0 write-side
 *                        drift. --repair-prisma upserts the missing rows.
 *   prisma-only        — Prisma has rows Redis doesn't. Read-side drift;
 *                        `backfillRedisRsvpFromPrisma.ts` handles it.
 *   differing          — Same (player, gameWeek) pair but values differ.
 *                        Redis is canonical → repair upserts Prisma to
 *                        match Redis.
 *
 * The seed sentinel `__seeded=1` is ignored on both sides (it's bookkeeping,
 * not data). Empty Redis hash with only `__seeded` and no Prisma rows = match.
 */
export type RsvpAuditDecision = {
  redisOnly: Array<{ playerSlug: string; rsvp?: RsvpStatus; participated?: ParticipatedStatus }>
  prismaOnly: Array<{ playerSlug: string }>
  differing: Array<{
    playerSlug: string
    redis: { rsvp?: RsvpStatus; participated?: ParticipatedStatus }
    prisma: { rsvp: RsvpStatus | null; participated: ParticipatedStatus | null }
  }>
}

type RsvpRow = {
  playerId: string
  rsvp: RsvpStatus | null
  participated: ParticipatedStatus | null
}

const RSVP_VALUES: ReadonlySet<string> = new Set(['GOING', 'UNDECIDED', 'NOT_GOING'])
const PARTICIPATED_VALUES: ReadonlySet<string> = new Set(['JOINED', 'NO_SHOWED'])

export function decideRsvpAudit(
  redisRaw: Record<string, unknown> | null,
  prismaRows: RsvpRow[],
): RsvpAuditDecision {
  const decision: RsvpAuditDecision = {
    redisOnly: [],
    prismaOnly: [],
    differing: [],
  }

  // Parse Redis hash into per-slug entries.
  const redisBySlug = new Map<string, { rsvp?: RsvpStatus; participated?: ParticipatedStatus }>()
  if (redisRaw) {
    for (const [field, value] of Object.entries(redisRaw)) {
      if (field === SEEDED_FIELD) continue
      let slug: string
      let kind: 'rsvp' | 'participated'
      if (field.endsWith(RSVP_SUFFIX)) {
        slug = field.slice(0, -RSVP_SUFFIX.length)
        kind = 'rsvp'
      } else if (field.endsWith(PARTICIPATED_SUFFIX)) {
        slug = field.slice(0, -PARTICIPATED_SUFFIX.length)
        kind = 'participated'
      } else {
        continue
      }
      const v = String(value)
      const entry = redisBySlug.get(slug) ?? {}
      if (kind === 'rsvp' && RSVP_VALUES.has(v)) entry.rsvp = v as RsvpStatus
      if (kind === 'participated' && PARTICIPATED_VALUES.has(v)) entry.participated = v as ParticipatedStatus
      redisBySlug.set(slug, entry)
    }
  }

  // Index Prisma rows by slug.
  const prismaBySlug = new Map<string, { rsvp: RsvpStatus | null; participated: ParticipatedStatus | null }>()
  for (const row of prismaRows) {
    const slug = playerIdToSlug(row.playerId)
    prismaBySlug.set(slug, { rsvp: row.rsvp, participated: row.participated })
  }

  const allSlugs = new Set<string>([...redisBySlug.keys(), ...prismaBySlug.keys()])
  for (const slug of allSlugs) {
    const r = redisBySlug.get(slug)
    const p = prismaBySlug.get(slug)
    if (r && !p) {
      decision.redisOnly.push({ playerSlug: slug, ...r })
      continue
    }
    if (!r && p) {
      // Prisma has a row Redis is missing. If both rsvp + participated are
      // null, it's effectively absent on both sides — skip. Otherwise report.
      if (p.rsvp !== null || p.participated !== null) {
        decision.prismaOnly.push({ playerSlug: slug })
      }
      continue
    }
    if (r && p) {
      const rsvpEqual = (r.rsvp ?? null) === p.rsvp
      const participatedEqual = (r.participated ?? null) === p.participated
      if (!rsvpEqual || !participatedEqual) {
        decision.differing.push({
          playerSlug: slug,
          redis: r,
          prisma: p,
        })
      }
    }
  }

  return decision
}

// ─── Main runner ────────────────────────────────────────────────────────────

interface PlayerMappingAuditResult {
  scanned: number
  match: number
  redisOnly: number
  prismaOnly: number
  malformed: number
  repaired: number
  errors: number
}

interface RsvpAuditResult {
  scanned: number
  redisOnly: number
  prismaOnly: number
  differing: number
  repaired: number
  errors: number
}

async function auditPlayerMapping(
  prisma: PrismaClient,
  redis: Redis,
  flags: Flags,
): Promise<PlayerMappingAuditResult> {
  const result: PlayerMappingAuditResult = {
    scanned: 0,
    match: 0,
    redisOnly: 0,
    prismaOnly: 0,
    malformed: 0,
    repaired: 0,
    errors: 0,
  }

  console.log('── Player mapping audit (Redis canonical → Prisma durable) ──')

  // SCAN the namespace. Upstash supports a SCAN cursor; we paginate to
  // tolerate any future growth past a single page.
  const scannedKeys: string[] = []
  let cursor: string | number = 0
  do {
    const [next, keys] = (await redis.scan(cursor, {
      match: `${PLAYER_MAP_KEY_PREFIX}*`,
      count: 200,
    })) as [string | number, string[]]
    scannedKeys.push(...keys)
    cursor = next
  } while (cursor && String(cursor) !== '0')

  console.log(`  Scanned ${scannedKeys.length} Redis keys`)
  result.scanned = scannedKeys.length

  // Pull all Prisma Player.lineId rows in one query for fast lookup.
  const prismaRows = await prisma.player.findMany({
    where: { lineId: { not: null } },
    select: { id: true, lineId: true },
  })
  const prismaByLineId = new Map<string, string>() // lineId → Player.id
  for (const row of prismaRows) {
    if (row.lineId) prismaByLineId.set(row.lineId, row.id)
  }

  for (const key of scannedKeys) {
    const lineId = key.slice(PLAYER_MAP_KEY_PREFIX.length)
    let redisRaw: string | object | null
    try {
      redisRaw = await redis.get(key)
    } catch (err) {
      console.warn(`  ERROR ${lineId}: redis.get failed: ${err instanceof Error ? err.message : err}`)
      result.errors++
      continue
    }
    const prismaPlayerId = prismaByLineId.get(lineId) ?? null
    const decision = decidePlayerMappingAudit(redisRaw, prismaPlayerId)

    switch (decision.kind) {
      case 'match':
        if (flags.verbose) console.log(`  MATCH       ${lineId}`)
        result.match++
        break
      case 'prisma-only':
        // Read-side drift; not v1.8.0's concern. Reported but not repaired
        // here — operator runs `backfillRedisFromPrisma.ts` if needed.
        console.log(`  PRISMA-ONLY ${lineId} → ${decision.prismaPlayerId} (run backfillRedisFromPrisma.ts to repair)`)
        result.prismaOnly++
        break
      case 'redis-only':
        console.log(
          `  REDIS-ONLY  ${lineId} → ${decision.redisMapping.playerId} (${decision.redisMapping.playerName})`,
        )
        result.redisOnly++
        if (flags.repairPrisma) {
          try {
            // Atomic clear-then-set, identical shape to /api/assign-player POST.
            await prisma.$transaction([
              prisma.player.updateMany({
                where: { lineId, id: { not: decision.targetDbPlayerId } },
                data: { lineId: null },
              }),
              prisma.player.update({
                where: { id: decision.targetDbPlayerId },
                data: { lineId },
              }),
            ])
            result.repaired++
            if (flags.verbose) console.log(`              repaired Prisma row for ${decision.targetDbPlayerId}`)
          } catch (err) {
            console.warn(`  ERROR ${lineId}: repair failed: ${err instanceof Error ? err.message : err}`)
            result.errors++
          }
        }
        break
      case 'redis-malformed':
        console.log(`  MALFORMED   ${lineId}: ${typeof decision.rawRedisValue === 'string' ? decision.rawRedisValue : JSON.stringify(decision.rawRedisValue)}`)
        result.malformed++
        break
    }
  }

  console.log('')
  console.log('Summary (player mapping):')
  console.log(`  Scanned (Redis keys)       ${result.scanned}`)
  console.log(`  MATCH (Redis = Prisma)      ${result.match}`)
  console.log(`  REDIS-ONLY (drift; v1.8.0)  ${result.redisOnly}`)
  console.log(`  PRISMA-ONLY (read-side)     ${result.prismaOnly}`)
  console.log(`  MALFORMED                   ${result.malformed}`)
  if (flags.repairPrisma) {
    console.log(`  REPAIRED (Prisma writes)    ${result.repaired}`)
  } else {
    console.log(`  Mode: DRY RUN — no Prisma writes performed`)
  }
  console.log(`  Errors during scan          ${result.errors}`)
  console.log('')

  return result
}

async function auditRsvp(
  prisma: PrismaClient,
  redis: Redis,
  flags: Flags,
): Promise<RsvpAuditResult> {
  const result: RsvpAuditResult = {
    scanned: 0,
    redisOnly: 0,
    prismaOnly: 0,
    differing: 0,
    repaired: 0,
    errors: 0,
  }

  console.log('── RSVP audit (Redis canonical → Prisma durable) ──')

  const scannedKeys: string[] = []
  let cursor: string | number = 0
  do {
    const [next, keys] = (await redis.scan(cursor, {
      match: `${RSVP_KEY_PREFIX}*`,
      count: 200,
    })) as [string | number, string[]]
    scannedKeys.push(...keys)
    cursor = next
  } while (cursor && String(cursor) !== '0')

  console.log(`  Scanned ${scannedKeys.length} Redis GameWeek hashes`)
  result.scanned = scannedKeys.length

  for (const key of scannedKeys) {
    const gameWeekId = key.slice(RSVP_KEY_PREFIX.length)
    let redisRaw: Record<string, unknown> | null
    try {
      redisRaw = (await redis.hgetall(key)) as Record<string, unknown> | null
    } catch (err) {
      console.warn(`  ERROR ${gameWeekId}: hgetall failed: ${err instanceof Error ? err.message : err}`)
      result.errors++
      continue
    }

    let prismaRows: RsvpRow[]
    try {
      prismaRows = await prisma.availability.findMany({
        where: { gameWeekId },
        select: { playerId: true, rsvp: true, participated: true },
      })
    } catch (err) {
      console.warn(`  ERROR ${gameWeekId}: prisma.availability lookup failed: ${err instanceof Error ? err.message : err}`)
      result.errors++
      continue
    }

    const decision = decideRsvpAudit(redisRaw, prismaRows)

    if (decision.redisOnly.length > 0) {
      console.log(`  REDIS-ONLY  gw=${gameWeekId}: ${decision.redisOnly.length} player(s) in Redis missing from Prisma`)
      for (const r of decision.redisOnly) {
        console.log(`              ${r.playerSlug}: rsvp=${r.rsvp ?? '-'} participated=${r.participated ?? '-'}`)
      }
      result.redisOnly += decision.redisOnly.length

      if (flags.repairPrisma) {
        for (const r of decision.redisOnly) {
          const dbPlayerId = slugToPlayerId(r.playerSlug)
          try {
            await prisma.availability.upsert({
              where: { playerId_gameWeekId: { playerId: dbPlayerId, gameWeekId } },
              create: {
                id: `av-${dbPlayerId}-${gameWeekId}`,
                playerId: dbPlayerId,
                gameWeekId,
                rsvp: r.rsvp ?? null,
                participated: r.participated ?? null,
              },
              update: {
                rsvp: r.rsvp ?? null,
                ...(r.participated !== undefined ? { participated: r.participated } : {}),
              },
            })
            result.repaired++
          } catch (err) {
            console.warn(`              ERROR repairing ${r.playerSlug}: ${err instanceof Error ? err.message : err}`)
            result.errors++
          }
        }
      }
    }
    if (decision.prismaOnly.length > 0) {
      console.log(
        `  PRISMA-ONLY gw=${gameWeekId}: ${decision.prismaOnly.length} player(s) in Prisma missing from Redis (run backfillRedisRsvpFromPrisma.ts to repair)`,
      )
      result.prismaOnly += decision.prismaOnly.length
    }
    if (decision.differing.length > 0) {
      console.log(`  DIFFERING   gw=${gameWeekId}: ${decision.differing.length} player(s) differ between Redis and Prisma`)
      for (const d of decision.differing) {
        console.log(
          `              ${d.playerSlug}: redis={rsvp:${d.redis.rsvp ?? '-'}, p:${d.redis.participated ?? '-'}} prisma={rsvp:${d.prisma.rsvp ?? '-'}, p:${d.prisma.participated ?? '-'}}`,
        )
      }
      result.differing += decision.differing.length

      if (flags.repairPrisma) {
        for (const d of decision.differing) {
          const dbPlayerId = slugToPlayerId(d.playerSlug)
          try {
            await prisma.availability.update({
              where: { playerId_gameWeekId: { playerId: dbPlayerId, gameWeekId } },
              data: {
                rsvp: d.redis.rsvp ?? null,
                ...(d.redis.participated !== undefined ? { participated: d.redis.participated } : {}),
              },
            })
            result.repaired++
          } catch (err) {
            console.warn(`              ERROR repairing ${d.playerSlug}: ${err instanceof Error ? err.message : err}`)
            result.errors++
          }
        }
      }
    }
    if (decision.redisOnly.length === 0 && decision.prismaOnly.length === 0 && decision.differing.length === 0) {
      if (flags.verbose) console.log(`  MATCH       gw=${gameWeekId}`)
    }
  }

  console.log('')
  console.log('Summary (RSVP):')
  console.log(`  Scanned (GameWeek hashes)        ${result.scanned}`)
  console.log(`  REDIS-ONLY rows (drift; v1.8.0)  ${result.redisOnly}`)
  console.log(`  PRISMA-ONLY rows (read-side)     ${result.prismaOnly}`)
  console.log(`  DIFFERING rows                   ${result.differing}`)
  if (flags.repairPrisma) {
    console.log(`  REPAIRED (Prisma writes)         ${result.repaired}`)
  } else {
    console.log(`  Mode: DRY RUN — no Prisma writes performed`)
  }
  console.log(`  Errors during scan               ${result.errors}`)
  console.log('')

  return result
}

async function main() {
  const flags = parseFlags(process.argv.slice(2))

  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    console.error('KV_REST_API_URL / KV_REST_API_TOKEN not set — cannot read Redis')
    process.exit(1)
  }

  const prisma = new PrismaClient()
  const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  })

  console.log(`Redis → Prisma audit ${flags.repairPrisma ? '(REPAIR)' : '(DRY RUN)'}`)
  console.log(`  KV URL:  ${process.env.KV_REST_API_URL?.replace(/\/\/[^@]+@/, '//***@')}`)
  console.log(`  Domain:  ${flags.domain}`)
  console.log('')

  if (flags.domain === 'playerMapping' || flags.domain === 'both') {
    await auditPlayerMapping(prisma, redis, flags)
  }
  if (flags.domain === 'rsvp' || flags.domain === 'both') {
    await auditRsvp(prisma, redis, flags)
  }

  await prisma.$disconnect()
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
