/**
 * Account backfill (v1.28.0 / stage α.5 — POST-merge optimization).
 *
 * Pre-stages User + Account rows for every existing Player.lineId so
 * stage β has data to dual-write into immediately, instead of waiting
 * for each user's first post-α.5 sign-in.
 *
 * Run this AFTER α.5 ships and the migration has run on prod (Vercel
 * build runs `prisma migrate deploy` automatically — Account and
 * VerificationToken tables are created at deploy time). Pre-merge runs
 * are NOT possible because the table doesn't exist yet.
 *
 * Why this is not a hard merge gate (despite the original design doc
 * calling it one): pre-α.5, no `User` row exists for any LINE user (the
 * User table is dormant for the public flow). On first post-α.5 LINE
 * login, the adapter creates a fresh User + Account; the `syncUserLineId`
 * bridge in `lib/auth.ts` then sets `User.lineId = profile.sub` so the
 * legacy lineId-based resolver keeps working. There's no duplicate-User
 * regression to prevent — the backfill is an optimization that pre-stages
 * rows for users who haven't logged in post-α.5 yet.
 *
 * Sources of truth this script consults (all must produce a User + Account):
 *   1. Existing `User` rows where `lineId IS NOT NULL` (the v1.27.0 schema
 *      had this column live, populated by `lib/auth.ts#trackLineLogin` on
 *      every LINE auth — though pre-α.5 nothing wrote `User.lineId`
 *      directly; that field was reserved). In practice this set may be
 *      empty if no admin or migration ever populated it.
 *   2. `Player.lineId IS NOT NULL` rows where no User has that lineId yet
 *      (the post-PR-6 backfill state — every linked Player has a lineId,
 *      but the corresponding User may not exist). For these we create
 *      both a User row AND an Account row, sourcing display name +
 *      pictureUrl from the matching `LineLogin` row when present.
 *
 * Idempotent. Safe to re-run. Per-row decisions:
 *   - ACCOUNT-EXISTS          : Account row already present, no-op.
 *   - CREATE-ACCOUNT          : User exists with lineId, Account missing → INSERT Account.
 *   - CREATE-USER-AND-ACCOUNT : Player.lineId points at a human with no User → INSERT both.
 *
 * Usage:
 *   npx tsx scripts/backfillAccountFromLineLogin.ts --dry-run     # report only
 *   npx tsx scripts/backfillAccountFromLineLogin.ts --apply       # actually write
 *   --verbose                                                      # per-row trace
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import { PrismaClient } from '@prisma/client'

dotenv.config({ path: path.resolve(process.cwd(), '.env.preview') })
dotenv.config({ path: path.resolve(process.cwd(), '.env.production') })
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config()

const PROVIDER = 'line'
const ACCOUNT_TYPE = 'oauth'

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

/**
 * Pure decision helper. Given the inputs from Prisma, decide what to do.
 * Exported for unit testing.
 *
 * Inputs:
 *   - lineId             : the LINE provider's user identifier (the "sub")
 *   - existingUser       : a User row matching by User.lineId, or null
 *   - existingAccount    : an Account row matching (provider, providerAccountId), or null
 *   - playerWithLineId   : a Player row whose lineId matches, or null
 *   - lineLogin          : a LineLogin row with this lineId (for name/picture), or null
 */
export type BackfillDecision =
  | { kind: 'account-exists'; userId: string }
  | { kind: 'create-account'; userId: string }
  | {
      kind: 'create-user-and-account'
      userPayload: {
        lineId: string
        name: string | null
        pictureUrl: string | null
      }
    }
  | { kind: 'skip-orphan-line-login'; reason: string }

export interface BackfillInputs {
  lineId: string
  existingUser: { id: string; lineId: string | null } | null
  existingAccount: { id: string; userId: string } | null
  // v1.33.0 (PR ε) — `Player.name` widened to nullable. Pre-α.5 backfill
  // continues to work the same: if a name is set, prefer the LineLogin
  // name; otherwise fall back to whatever Player has (which may now itself
  // be null — covered by `?? null` in the userPayload below).
  playerWithLineId: { id: string; name: string | null } | null
  lineLogin: { name: string | null; pictureUrl: string | null } | null
}

export function decideBackfillAction(inputs: BackfillInputs): BackfillDecision {
  const { lineId, existingUser, existingAccount, playerWithLineId, lineLogin } = inputs

  // Case 1: Account row already present. No-op. The adapter will find this
  // on the next LINE login and reuse the matched User.
  if (existingAccount) {
    return { kind: 'account-exists', userId: existingAccount.userId }
  }

  // Case 2: User exists with this lineId but no Account row yet. Insert
  // Account pointing at the existing User.
  if (existingUser) {
    return { kind: 'create-account', userId: existingUser.id }
  }

  // Case 3: A Player has this lineId but no User exists yet. Create both.
  // This is the dominant case for prod data — pre-α.5 the User table was
  // dormant for public flows; identity lived on Player.lineId.
  if (playerWithLineId) {
    return {
      kind: 'create-user-and-account',
      userPayload: {
        lineId,
        name: lineLogin?.name ?? playerWithLineId.name ?? null,
        pictureUrl: lineLogin?.pictureUrl ?? null,
      },
    }
  }

  // Case 4: We have a LineLogin row (someone authenticated once via LINE)
  // but no Player or User to bind it to — they're an orphan. Skip; the
  // adapter will create a fresh User on their next sign-in, which is fine
  // because they have no Player association anyway. The backfill's job is
  // to prevent duplicate-User-creation for HUMANS WHO ARE ALREADY LINKED
  // to a Player; orphan LineLogins are out of scope.
  return {
    kind: 'skip-orphan-line-login',
    reason: 'LineLogin without matching Player or User — adapter will create User on next sign-in',
  }
}

interface Tally {
  accountExists: number
  createAccount: number
  createUserAndAccount: number
  skipOrphan: number
}

interface Action {
  lineId: string
  decision: BackfillDecision
}

async function planActions(prisma: PrismaClient): Promise<Action[]> {
  // Collect every distinct lineId across the three tables we care about.
  const [users, accounts, players, lineLogins] = await Promise.all([
    prisma.user.findMany({
      where: { lineId: { not: null } },
      select: { id: true, lineId: true },
    }),
    prisma.account.findMany({
      where: { provider: PROVIDER },
      select: { id: true, userId: true, providerAccountId: true },
    }),
    prisma.player.findMany({
      where: { lineId: { not: null } },
      select: { id: true, name: true, lineId: true },
    }),
    prisma.lineLogin.findMany({
      select: { lineId: true, name: true, pictureUrl: true },
    }),
  ])

  const userByLineId = new Map(
    users.filter((u) => u.lineId).map((u) => [u.lineId as string, u]),
  )
  const accountByLineId = new Map(
    accounts.map((a) => [a.providerAccountId, a]),
  )
  const playerByLineId = new Map(
    players.filter((p) => p.lineId).map((p) => [p.lineId as string, p]),
  )
  const lineLoginByLineId = new Map(lineLogins.map((l) => [l.lineId, l]))

  const allLineIds = new Set<string>([
    ...userByLineId.keys(),
    ...playerByLineId.keys(),
    ...lineLoginByLineId.keys(),
  ])

  const actions: Action[] = []
  for (const lineId of allLineIds) {
    actions.push({
      lineId,
      decision: decideBackfillAction({
        lineId,
        existingUser: userByLineId.get(lineId) ?? null,
        existingAccount: accountByLineId.get(lineId) ?? null,
        playerWithLineId: playerByLineId.get(lineId) ?? null,
        lineLogin: lineLoginByLineId.get(lineId) ?? null,
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
    accountExists: 0,
    createAccount: 0,
    createUserAndAccount: 0,
    skipOrphan: 0,
  }

  for (const action of actions) {
    const { lineId, decision } = action
    switch (decision.kind) {
      case 'account-exists':
        tally.accountExists += 1
        if (flags.verbose) {
          console.log(`  [account-exists] lineId=${lineId} userId=${decision.userId}`)
        }
        break
      case 'create-account': {
        tally.createAccount += 1
        if (flags.verbose) {
          console.log(`  [create-account] lineId=${lineId} userId=${decision.userId}`)
        }
        if (flags.apply) {
          await prisma.account.create({
            data: {
              userId: decision.userId,
              type: ACCOUNT_TYPE,
              provider: PROVIDER,
              providerAccountId: lineId,
            },
          })
        }
        break
      }
      case 'create-user-and-account': {
        tally.createUserAndAccount += 1
        if (flags.verbose) {
          console.log(`  [create-user-and-account] lineId=${lineId}`)
        }
        if (flags.apply) {
          // Use a transaction so we never end up with a User without an
          // Account or vice versa.
          await prisma.$transaction(async (tx) => {
            const newUser = await tx.user.create({
              data: {
                lineId,
                name: decision.userPayload.name,
                pictureUrl: decision.userPayload.pictureUrl,
              },
            })
            await tx.account.create({
              data: {
                userId: newUser.id,
                type: ACCOUNT_TYPE,
                provider: PROVIDER,
                providerAccountId: lineId,
              },
            })
          })
        }
        break
      }
      case 'skip-orphan-line-login':
        tally.skipOrphan += 1
        if (flags.verbose) {
          console.log(`  [skip-orphan] lineId=${lineId} reason=${decision.reason}`)
        }
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
      `[backfillAccountFromLineLogin] mode=${flags.apply ? 'APPLY' : 'DRY-RUN'} verbose=${flags.verbose}`,
    )

    const actions = await planActions(prisma)
    console.log(`[backfillAccountFromLineLogin] planned ${actions.length} actions`)

    const tally = await applyActions(prisma, actions, flags)

    console.log('')
    console.log('=== Summary ===')
    console.log(`account-exists:           ${tally.accountExists}`)
    console.log(`create-account:           ${tally.createAccount}`)
    console.log(`create-user-and-account:  ${tally.createUserAndAccount}`)
    console.log(`skip-orphan-line-login:   ${tally.skipOrphan}`)
    console.log(`total:                    ${actions.length}`)
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

// Only run main when executed directly. The pure helpers above are
// exported for unit testing without booting Prisma.
const isMain =
  typeof require !== 'undefined' && require.main === module
if (isMain) {
  main().catch((err) => {
    console.error('[backfillAccountFromLineLogin] fatal:', err)
    process.exit(1)
  })
}
