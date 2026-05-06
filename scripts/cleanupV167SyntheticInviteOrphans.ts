/**
 * v1.67.2 — One-time orphan-cleanup script for the v1.67.0 synthetic-invite bug.
 *
 * Pre-v1.67.2, the State C recruiting CTA called
 * `recruitToLeagueWithOnboarding` which created (in one transaction):
 *   - Player { name: null, userId, lineId? }
 *   - User.playerId = player.id
 *   - PlayerLeagueMembership { playerId, leagueId, applicationStatus: PENDING,
 *                              joinSource: SELF_SERVE, onboardingStatus: NOT_YET,
 *                              position: null, leagueTeamId: null, fromGameWeek: 1 }
 *   - LeagueInvite { code, kind: PERSONAL, targetPlayerId: player.id,
 *                    leagueId, createdById: userId, maxUses: 1, usedCount: 1,
 *                    skipOnboarding: false }
 *
 * The user then landed on `/join/<code>` which surfaced
 * "This invite has been used" because `validateInvite` rejected
 * `usedCount >= maxUses` BEFORE the existingBinding-detection branch
 * could route them to /onboarding. The user bounced; the orphan rows
 * stayed in prod.
 *
 * Signature of an orphan row (for deletion):
 *   - Player.name IS NULL (user never filled the form)
 *   - LeagueInvite EXISTS where targetPlayerId = player.id
 *     AND createdById = player.userId
 *     AND maxUses = 1 AND usedCount = 1 AND skipOnboarding = FALSE
 *
 * If a Player.name happens to be NULL for any other reason (admin
 * pre-stage, manual debugging), the LeagueInvite signature filter
 * protects it. Only Players that were created by the synthetic-invite
 * action match — admin-pre-staged Players have no matching invite
 * with `createdById = User.id` for the bound user.
 *
 * The script is `--dry-run` by default. Output:
 *   - Per-row summary: playerId, userId, leagueId, inviteCode, createdAt
 *   - Total counts
 *
 * `--apply` mode deletes (in one transaction per orphan):
 *   1. LeagueInvite (the synthetic invite)
 *   2. PlayerLeagueMembership (cascades from Player anyway, but explicit)
 *   3. User.playerId = null (clear the dual-write pointer first)
 *   4. Player (the orphan)
 *
 * Order matters — Player.userId @unique and User.playerId @unique mean
 * we can't have stale pointers mid-deletion. We clear User.playerId
 * before deleting Player so the unique constraint on User doesn't
 * fire.
 *
 * Idempotent — safe to re-run. Once an orphan is cleaned, the next run
 * won't see it (no Player with the matching signature).
 *
 * Run:
 *   npx tsx scripts/cleanupV167SyntheticInviteOrphans.ts            # dry-run
 *   npx tsx scripts/cleanupV167SyntheticInviteOrphans.ts --apply    # actually delete
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface OrphanRow {
  playerId: string
  userId: string | null
  leagueId: string
  inviteId: string
  inviteCode: string
  createdAt: Date
}

async function findOrphans(): Promise<OrphanRow[]> {
  // Find all PERSONAL invites with the v1.67.0 synthetic signature:
  // maxUses = 1, usedCount = 1, skipOnboarding = false, AND the
  // targetPlayer has name = null AND the createdBy User has
  // playerId = invite.targetPlayerId (i.e. the bound user is also the
  // creator — the synthetic-invite signature).
  const candidates = await prisma.leagueInvite.findMany({
    where: {
      kind: 'PERSONAL',
      maxUses: 1,
      usedCount: 1,
      skipOnboarding: false,
      targetPlayerId: { not: null },
    },
    select: {
      id: true,
      code: true,
      leagueId: true,
      targetPlayerId: true,
      createdById: true,
      createdAt: true,
    },
  })

  const orphans: OrphanRow[] = []
  for (const inv of candidates) {
    if (!inv.targetPlayerId) continue
    const player = await prisma.player.findUnique({
      where: { id: inv.targetPlayerId },
      select: { id: true, name: true, userId: true },
    })
    if (!player) continue
    if (player.name !== null) continue // user filled the form — not orphan
    // The synthetic action sets `createdById = userId` AND
    // `User.playerId = player.id`. Both must hold for this to be a
    // synthetic-invite orphan rather than an admin-issued invite that
    // happens to match the maxUses/usedCount shape.
    if (!inv.createdById) continue
    if (player.userId !== inv.createdById) continue
    orphans.push({
      playerId: player.id,
      userId: player.userId,
      leagueId: inv.leagueId,
      inviteId: inv.id,
      inviteCode: inv.code,
      createdAt: inv.createdAt,
    })
  }
  return orphans
}

async function deleteOrphan(orphan: OrphanRow): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Clear User.playerId pointer FIRST so the unique constraint on
    // User.playerId @unique doesn't trip when we delete the Player.
    if (orphan.userId) {
      await tx.user.update({
        where: { id: orphan.userId },
        data: { playerId: null },
      })
    }
    // Delete invite explicitly (it doesn't cascade from Player because
    // the FK is targetPlayerId, which is nullable).
    await tx.leagueInvite.delete({ where: { id: orphan.inviteId } })
    // Delete PLM (also cascades from Player but be explicit).
    await tx.playerLeagueMembership.deleteMany({
      where: { playerId: orphan.playerId },
    })
    // Finally the Player row itself.
    await tx.player.delete({ where: { id: orphan.playerId } })
  })
}

async function main() {
  const apply = process.argv.includes('--apply')
  const verbose = process.argv.includes('--verbose')

  console.log(
    `[cleanupV167SyntheticInviteOrphans] mode=${apply ? 'APPLY' : 'DRY-RUN'}`,
  )
  const orphans = await findOrphans()
  console.log(`Found ${orphans.length} orphan record(s).`)

  if (verbose || !apply) {
    for (const o of orphans) {
      console.log(
        `  - playerId=${o.playerId} userId=${o.userId ?? '(null)'} leagueId=${o.leagueId} ` +
          `inviteCode=${o.inviteCode} createdAt=${o.createdAt.toISOString()}`,
      )
    }
  }

  if (!apply) {
    console.log('\nRun with --apply to actually delete the orphan rows.')
    return
  }

  let succeeded = 0
  let failed = 0
  for (const orphan of orphans) {
    try {
      await deleteOrphan(orphan)
      succeeded += 1
      if (verbose) console.log(`  ✓ deleted ${orphan.playerId}`)
    } catch (err) {
      failed += 1
      console.error(`  ✗ failed to delete ${orphan.playerId}: %o`, err)
    }
  }
  console.log(`\nDeleted: ${succeeded}, failed: ${failed}, total: ${orphans.length}`)
}

main()
  .catch((err) => {
    console.error('[cleanupV167SyntheticInviteOrphans] fatal:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
