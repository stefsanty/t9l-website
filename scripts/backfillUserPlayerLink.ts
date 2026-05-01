/**
 * Backfill User ↔ Player 1:1 link (v1.29.0 / stage β companion).
 *
 * For every Player with `lineId IS NOT NULL`, find the matching User by
 * `User.lineId` (created either by α.5's syncUserLineId bridge on first
 * sign-in, or by the post-α.5 backfillAccountFromLineLogin script). Set
 * `Player.userId = user.id` AND `User.playerId = player.id` atomically.
 *
 * Run this AFTER β ships to populate the new columns for every existing
 * link. β's dual-write only fires on new mutations; without this script
 * the existing 30-ish linked players have null `Player.userId` and null
 * `User.playerId`, which is correct for stage β reads (still through
 * `Player.lineId`) but useless for stage γ when the resolver flips.
 *
 * Idempotent. Per-row decisions:
 *   - LINK-EXISTS                : both pointers already correct, no-op.
 *   - CREATE-LINK                : pointers null on both sides, populate.
 *   - DRIFT-OVERWRITE            : pointers exist but mismatch, repair.
 *   - SKIP-NO-USER               : Player.lineId set but no matching
 *                                   User row (user hasn't authenticated
 *                                   post-α.5 yet AND
 *                                   backfillAccountFromLineLogin didn't
 *                                   pick them up — degenerate case).
 *
 * Usage:
 *   npx tsx scripts/backfillUserPlayerLink.ts --dry-run     # report only
 *   npx tsx scripts/backfillUserPlayerLink.ts --apply       # actually write
 *   --verbose                                                # per-row trace
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import { PrismaClient } from '@prisma/client'

dotenv.config({ path: path.resolve(process.cwd(), '.env.preview') })
dotenv.config({ path: path.resolve(process.cwd(), '.env.production') })
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config()

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

export type BackfillDecision =
  | { kind: 'link-exists'; userId: string; playerId: string }
  | { kind: 'create-link'; userId: string; playerId: string }
  | {
      kind: 'drift-overwrite'
      userId: string
      playerId: string
      hadPlayerUserId: string | null
      hadUserPlayerId: string | null
    }
  | { kind: 'skip-no-user'; lineId: string; playerId: string }

export interface BackfillInputs {
  player: { id: string; lineId: string; userId: string | null }
  user: { id: string; playerId: string | null } | null
}

export function decideBackfillAction(inputs: BackfillInputs): BackfillDecision {
  const { player, user } = inputs

  // No User row for this lineId — degenerate case. Both the post-α.5
  // adapter creation AND the backfillAccountFromLineLogin script should
  // produce User rows; if we hit this branch in prod something is off.
  if (!user) {
    return { kind: 'skip-no-user', lineId: player.lineId, playerId: player.id }
  }

  // Already in the desired state.
  if (player.userId === user.id && user.playerId === player.id) {
    return { kind: 'link-exists', userId: user.id, playerId: player.id }
  }

  // Both pointers null — clean create.
  if (player.userId === null && user.playerId === null) {
    return { kind: 'create-link', userId: user.id, playerId: player.id }
  }

  // Drift: at least one pointer exists but they don't match the canonical
  // (player.lineId → user) binding. Repair by overwriting both.
  return {
    kind: 'drift-overwrite',
    userId: user.id,
    playerId: player.id,
    hadPlayerUserId: player.userId,
    hadUserPlayerId: user.playerId,
  }
}

interface Tally {
  linkExists: number
  createLink: number
  driftOverwrite: number
  skipNoUser: number
}

interface Action {
  decision: BackfillDecision
}

async function planActions(prisma: PrismaClient): Promise<Action[]> {
  const [players, users] = await Promise.all([
    prisma.player.findMany({
      where: { lineId: { not: null } },
      select: { id: true, lineId: true, userId: true },
    }),
    prisma.user.findMany({
      where: { lineId: { not: null } },
      select: { id: true, lineId: true, playerId: true },
    }),
  ])

  const userByLineId = new Map<string, { id: string; playerId: string | null }>()
  for (const u of users) {
    if (u.lineId) {
      userByLineId.set(u.lineId, { id: u.id, playerId: u.playerId })
    }
  }

  const actions: Action[] = []
  for (const p of players) {
    if (!p.lineId) continue
    actions.push({
      decision: decideBackfillAction({
        player: { id: p.id, lineId: p.lineId, userId: p.userId },
        user: userByLineId.get(p.lineId) ?? null,
      }),
    })
  }
  return actions
}

async function applyActions(
  prisma: PrismaClient,
  actions: Action[],
  flags: Flags,
): Promise<Tally> {
  const tally: Tally = {
    linkExists: 0,
    createLink: 0,
    driftOverwrite: 0,
    skipNoUser: 0,
  }

  for (const { decision } of actions) {
    switch (decision.kind) {
      case 'link-exists':
        tally.linkExists += 1
        if (flags.verbose) {
          console.log(`  [link-exists] userId=${decision.userId} playerId=${decision.playerId}`)
        }
        break
      case 'create-link': {
        tally.createLink += 1
        if (flags.verbose) {
          console.log(`  [create-link] userId=${decision.userId} playerId=${decision.playerId}`)
        }
        if (flags.apply) {
          await prisma.$transaction([
            prisma.player.update({
              where: { id: decision.playerId },
              data: { userId: decision.userId },
            }),
            prisma.user.update({
              where: { id: decision.userId },
              data: { playerId: decision.playerId },
            }),
          ])
        }
        break
      }
      case 'drift-overwrite': {
        tally.driftOverwrite += 1
        if (flags.verbose) {
          console.log(
            `  [drift-overwrite] userId=${decision.userId} playerId=${decision.playerId} hadPlayerUserId=${decision.hadPlayerUserId} hadUserPlayerId=${decision.hadUserPlayerId}`,
          )
        }
        if (flags.apply) {
          // Repair: clear stale Player.userId rows pointing at this User
          // (the @unique constraint would block the new write otherwise),
          // clear the User's prior playerId binding, then set both
          // pointers to the canonical values.
          await prisma.$transaction(async (tx) => {
            await tx.player.updateMany({
              where: { userId: decision.userId, id: { not: decision.playerId } },
              data: { userId: null },
            })
            await tx.player.update({
              where: { id: decision.playerId },
              data: { userId: decision.userId },
            })
            await tx.user.update({
              where: { id: decision.userId },
              data: { playerId: decision.playerId },
            })
          })
        }
        break
      }
      case 'skip-no-user':
        tally.skipNoUser += 1
        console.warn(
          `  [skip-no-user] lineId=${decision.lineId} playerId=${decision.playerId} — Player has lineId but no matching User; run backfillAccountFromLineLogin first`,
        )
        break
    }
  }

  return tally
}

async function main() {
  const flags = parseFlags(process.argv.slice(2))
  if (!flags.dryRun && !flags.apply) {
    console.error('Pass either --dry-run or --apply.')
    process.exit(2)
  }
  if (flags.dryRun && flags.apply) {
    console.error('Pass exactly one of --dry-run / --apply, not both.')
    process.exit(2)
  }

  const prisma = new PrismaClient()
  try {
    console.log(
      `[backfillUserPlayerLink] mode=${flags.apply ? 'APPLY' : 'DRY-RUN'} verbose=${flags.verbose}`,
    )

    const actions = await planActions(prisma)
    console.log(`[backfillUserPlayerLink] planned ${actions.length} actions`)

    const tally = await applyActions(prisma, actions, flags)

    console.log('')
    console.log('=== Summary ===')
    console.log(`link-exists:      ${tally.linkExists}`)
    console.log(`create-link:      ${tally.createLink}`)
    console.log(`drift-overwrite:  ${tally.driftOverwrite}`)
    console.log(`skip-no-user:     ${tally.skipNoUser}`)
    console.log(`total:            ${actions.length}`)
    console.log('')
    if (flags.dryRun) {
      console.log('Dry-run only — no changes written.')
      console.log('Re-run with --apply to execute.')
    } else {
      console.log('Apply complete.')
    }
  } finally {
    await prisma.$disconnect()
  }
}

const isMain = typeof require !== 'undefined' && require.main === module
if (isMain) {
  main().catch((err) => {
    console.error('[backfillUserPlayerLink] fatal:', err)
    process.exit(1)
  })
}
