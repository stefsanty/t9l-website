import { describe, it, expect, beforeAll, afterAll } from 'vitest'

/**
 * Integration test for PR 6's LineLogin model + admin assign flow.
 *
 * Requires a real Neon branch DB (per-PR preview branch). Pull the env first:
 *
 *   vercel env pull .env.preview --environment=preview --yes \
 *     --git-branch=feat/admin-assign-player-flow-b
 *   set -a; source .env.preview; set +a
 *   npx vitest run tests/unit/lineLoginIntegration.test.ts
 *
 * Skips in CI (vitest under `.github/workflows/test.yml` uses placeholder DB
 * URLs and never connects). The skip predicate matches the placeholder host
 * so it's only the explicit per-PR-branch run that exercises the assertions.
 */

const PLACEHOLDER_HOSTS = ['placeholder', 'localhost:5432/placeholder']
const dbUrl = process.env.DATABASE_URL ?? ''
const isPlaceholder = PLACEHOLDER_HOSTS.some((h) => dbUrl.includes(h)) || !dbUrl

describe.skipIf(isPlaceholder)('LineLogin + Player.lineId integration (per-PR Neon branch)', () => {
  // Lazy import inside the suite so the file imports cleanly even when no DB
  // is configured (so describe.skipIf can take effect).
  let prisma: import('@prisma/client').PrismaClient

  const TEST_LINE_ID = `test-line-${Date.now()}`
  const TEST_LOGIN_NAME = 'Test LINE User'

  beforeAll(async () => {
    const { PrismaClient } = await import('@prisma/client')
    prisma = new PrismaClient()
  })

  afterAll(async () => {
    if (!prisma) return
    // Clean up: remove test LineLogin row + clear lineId from any test Player.
    await prisma.player.updateMany({ where: { lineId: TEST_LINE_ID }, data: { lineId: null } })
    await prisma.lineLogin.deleteMany({ where: { lineId: TEST_LINE_ID } })
    await prisma.$disconnect()
  })

  it('upserts a LineLogin row and surfaces it as an orphan', async () => {
    await prisma.lineLogin.upsert({
      where: { lineId: TEST_LINE_ID },
      create: { lineId: TEST_LINE_ID, name: TEST_LOGIN_NAME },
      update: { name: TEST_LOGIN_NAME },
    })
    const row = await prisma.lineLogin.findUnique({ where: { lineId: TEST_LINE_ID } })
    expect(row).not.toBeNull()
    expect(row?.name).toBe(TEST_LOGIN_NAME)

    // Orphan check: no Player has this lineId.
    const linkedHolder = await prisma.player.findUnique({ where: { lineId: TEST_LINE_ID } })
    expect(linkedHolder).toBeNull()
  })

  it('linking a Player removes the row from orphan candidacy', async () => {
    // Pick any existing Player to link against. If none exist, skip the test.
    const anyPlayer = await prisma.player.findFirst({ where: { lineId: null } })
    if (!anyPlayer) return

    await prisma.player.update({
      where: { id: anyPlayer.id },
      data: { lineId: TEST_LINE_ID },
    })

    const linked = await prisma.player.findUnique({ where: { lineId: TEST_LINE_ID } })
    expect(linked?.id).toBe(anyPlayer.id)
  })
})
