/**
 * v1.72.0 — User.name ↔ Player.name synchronisation.
 *
 * User.name should always equal the linked Player's name when a Player is
 * bound. The auth-provider-supplied name (LINE display name / Google name /
 * email address) is preserved separately in User.authAccountName and
 * restored to User.name when the Player is unlinked.
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const root = path.resolve(__dirname, '../..')

// ── helpers ──────────────────────────────────────────────────────────────────

function readSrc(...parts: string[]) {
  return fs.readFileSync(path.join(root, ...parts), 'utf8')
}

function readMigration(name: string) {
  return fs.readFileSync(
    path.join(root, 'prisma', 'migrations', name, 'migration.sql'),
    'utf8',
  )
}

// ── 1. Schema ─────────────────────────────────────────────────────────────────

describe('v1.72.0 schema', () => {
  const schema = readSrc('prisma', 'schema.prisma')

  it('User model declares authAccountName as nullable', () => {
    // Must appear as a nullable String field
    expect(schema).toMatch(/authAccountName\s+String\?/)
  })

  it('User model still has name field', () => {
    expect(schema).toMatch(/\bname\s+String\?/)
  })
})

// ── 2. Migration ──────────────────────────────────────────────────────────────

describe('v1.72.0 migration', () => {
  const sql = readMigration('20260510000000_user_auth_account_name')

  it('adds authAccountName column', () => {
    expect(sql).toMatch(/ADD COLUMN.*"authAccountName".*TEXT/i)
  })

  it('backfills authAccountName from current User.name', () => {
    // Must copy name → authAccountName for existing rows
    expect(sql).toMatch(/UPDATE[\s\S]*"User"[\s\S]*SET[\s\S]*"authAccountName"\s*=\s*"name"/i)
  })

  it('overwrites User.name with Player.name for linked users', () => {
    // Must UPDATE User joined to Player where playerId is not null
    expect(sql).toMatch(/UPDATE[\s\S]*"User"[\s\S]*SET[\s\S]*"name"\s*=[\s\S]*p\."name"[\s\S]*FROM[\s\S]*"Player"/i)
  })

  it('backfill step precedes the Player.name overwrite (correct ordering)', () => {
    const authAccountPos = sql.indexOf('SET "authAccountName"')
    const playerNamePos = sql.search(/SET\s+"name"\s+=\s+p\."name"/)
    expect(authAccountPos).toBeGreaterThan(-1)
    expect(playerNamePos).toBeGreaterThan(-1)
    expect(authAccountPos).toBeLessThan(playerNamePos)
  })

  it('has no DROP COLUMN, TRUNCATE, or DELETE FROM (purely additive + data migration)', () => {
    // Strip comments first so we don't false-positive on rollback recipe
    const stripped = sql.replace(/--[^\n]*/g, '')
    expect(stripped).not.toMatch(/DROP\s+COLUMN/i)
    expect(stripped).not.toMatch(/TRUNCATE/i)
    expect(stripped).not.toMatch(/DELETE\s+FROM/i)
  })
})

// ── 3. auth.ts sign-in callback ───────────────────────────────────────────────

describe('v1.72.0 auth.ts sign-in callback', () => {
  const auth = readSrc('src', 'lib', 'auth.ts')

  it('defines syncUserAuthAccountName helper', () => {
    expect(auth).toMatch(/async function syncUserAuthAccountName/)
  })

  it('syncUserAuthAccountName writes authAccountName column', () => {
    expect(auth).toMatch(/authAccountName:\s*providerName/)
  })

  it('syncUserAuthAccountName derives User.name from linked Player when bound', () => {
    // Must look up User.playerId, then Player.name, then use it as derivedName
    expect(auth).toMatch(/player\.name[\s\S]*derivedName|derivedName[\s\S]*player\.name/)
  })

  it('syncUserAuthAccountName falls back to providerName when no Player linked', () => {
    // derivedName starts as providerName ?? null
    expect(auth).toMatch(/let derivedName.*=.*providerName.*null/)
  })

  it('calls syncUserAuthAccountName on LINE initial sign-in', () => {
    // Must be called in the LINE account.provider === "line" branch
    const lineBlock = auth.slice(
      auth.indexOf('account.provider === "line"'),
      auth.indexOf('v1.53.0'),
    )
    expect(lineBlock).toMatch(/syncUserAuthAccountName/)
  })

  it('calls syncUserAuthAccountName on Google/email initial sign-in', () => {
    const googleBlock = auth.slice(
      auth.indexOf('account?.provider === "google"'),
      auth.indexOf('Set LINE-specific fields on initial sign-in'),
    )
    expect(googleBlock).toMatch(/syncUserAuthAccountName/)
  })
})

// ── 4. identityLink.ts — link flows set User.name = Player.name ───────────────

describe('v1.72.0 identityLink — link sync', () => {
  const idLink = readSrc('src', 'lib', 'identityLink.ts')

  it('linkPlayerToUser fetches Player.name from tx.player.update select', () => {
    // Must select name from the player.update result
    expect(idLink).toMatch(/tx\.player\.update[\s\S]*?select:\s*\{[\s\S]*?name:\s*true/m)
  })

  it('linkPlayerToUser writes Player.name to User.name in the back-pointer update', () => {
    const linkBlock = idLink.slice(
      idLink.indexOf('export async function linkPlayerToUser'),
      idLink.indexOf('export async function linkUserToPlayer'),
    )
    expect(linkBlock).toMatch(/name:\s*player\.name/)
  })

  it('linkUserToPlayer fetches Player.name from tx.player.update select', () => {
    const linkBlock = idLink.slice(
      idLink.indexOf('export async function linkUserToPlayer'),
      idLink.indexOf('export async function unlinkPlayerFromUser'),
    )
    expect(linkBlock).toMatch(/select:\s*\{[\s\S]*?name:\s*true/m)
  })

  it('linkUserToPlayer writes Player.name to User.name in the back-pointer update', () => {
    const linkBlock = idLink.slice(
      idLink.indexOf('export async function linkUserToPlayer'),
      idLink.indexOf('export async function unlinkPlayerFromUser'),
    )
    expect(linkBlock).toMatch(/name:\s*linkedPlayer\.name/)
  })
})

// ── 5. identityLink.ts — unlink flows restore User.name = authAccountName ─────

describe('v1.72.0 identityLink — unlink restore', () => {
  const idLink = readSrc('src', 'lib', 'identityLink.ts')

  it('unlinkPlayerFromUser selects authAccountName', () => {
    const block = idLink.slice(
      idLink.indexOf('export async function unlinkPlayerFromUser'),
      idLink.indexOf('export async function unlinkUserFromPlayer'),
    )
    expect(block).toMatch(/authAccountName/)
  })

  it('unlinkPlayerFromUser restores User.name = authAccountName on unlink', () => {
    const block = idLink.slice(
      idLink.indexOf('export async function unlinkPlayerFromUser'),
      idLink.indexOf('export async function unlinkUserFromPlayer'),
    )
    expect(block).toMatch(/name:\s*user\.authAccountName/)
  })

  it('unlinkUserFromPlayer selects authAccountName', () => {
    const block = idLink.slice(idLink.indexOf('export async function unlinkUserFromPlayer'))
    expect(block).toMatch(/authAccountName/)
  })

  it('unlinkUserFromPlayer restores User.name = authAccountName on unlink', () => {
    const block = idLink.slice(idLink.indexOf('export async function unlinkUserFromPlayer'))
    expect(block).toMatch(/name:\s*user\.authAccountName/)
  })
})

// ── 6. adminUnlinkUserFromPlayer — direct DB path also restores name ──────────

describe('v1.72.0 adminUnlinkUserFromPlayer', () => {
  const actions = readSrc('src', 'app', 'admin', 'leagues', 'actions.ts')
  const block = actions.slice(
    actions.indexOf('export async function adminUnlinkUserFromPlayer'),
    actions.indexOf('export async function adminLinkExistingPlayer'),
  )

  it('selects authAccountName when fetching User in unlink', () => {
    expect(block).toMatch(/authAccountName/)
  })

  it('restores User.name = authAccountName in the unlink update', () => {
    expect(block).toMatch(/name:\s*user\.authAccountName/)
  })
})

// ── 7. adminUpdatePlayerName — propagates to User.name ────────────────────────

describe('v1.72.0 adminUpdatePlayerName', () => {
  const actions = readSrc('src', 'app', 'admin', 'leagues', 'actions.ts')
  const block = actions.slice(
    actions.indexOf('export async function adminUpdatePlayerName'),
    actions.indexOf('export async function adminUpdatePlayerPosition'),
  )

  it('wraps the player rename in a transaction', () => {
    expect(block).toMatch(/\$transaction/)
  })

  it('issues tx.user.updateMany to sync User.name = Player.name', () => {
    expect(block).toMatch(/tx\.user\.updateMany/)
    expect(block).toMatch(/data:\s*\{[\s\S]*?name:\s*trimmed/m)
  })

  // Regression target: prior shape was a bare prisma.player.update without a tx.
  it('does not use bare prisma.player.update (must be inside tx)', () => {
    // The only player.update in the block should be prefixed with tx.
    const barePlayerUpdate = block.match(/(?<!tx\.)prisma\.player\.update/)
    expect(barePlayerUpdate).toBeNull()
  })
})

// ── 8. updatePlayerSelf — propagates to User.name ────────────────────────────

describe('v1.72.0 updatePlayerSelf', () => {
  const actions = readSrc('src', 'app', 'account', 'player', 'actions.ts')
  const block = actions.slice(
    actions.indexOf('export async function updatePlayerSelf'),
    actions.indexOf('export async function uploadPlayerProfilePicture'),
  )

  it('issues tx.user.updateMany to sync User.name = Player.name', () => {
    expect(block).toMatch(/tx\.user\.updateMany/)
    expect(block).toMatch(/data:\s*\{[\s\S]*?name:\s*trimmedName/m)
  })
})

// ── 9. applyToLeague — sets User.name = Player.name on fresh creation ─────────

describe('v1.72.0 applyToLeague State C', () => {
  const actions = readSrc('src', 'app', 'api', 'recruiting', 'actions.ts')
  const block = actions.slice(
    actions.indexOf('// ── State C — fresh Player + dual-write the User binding'),
    actions.indexOf('export async function registerToLeague'),
  )

  it('sets User.name = trimmedName when setting playerId', () => {
    expect(block).toMatch(/data:\s*\{[\s\S]*?playerId:\s*created\.id[\s\S]*?name:\s*trimmedName/m)
  })
})

// ── 10. registerToLeague — sets User.name = Player.name on creation ───────────

describe('v1.72.0 registerToLeague', () => {
  const actions = readSrc('src', 'app', 'api', 'recruiting', 'actions.ts')
  const block = actions.slice(actions.indexOf('export async function registerToLeague'))

  it('sets User.name = trimmedName when setting playerId', () => {
    expect(block).toMatch(/data:\s*\{[\s\S]*?playerId:\s*created\.id[\s\S]*?name:\s*trimmedName/m)
  })
})

// ── 11. Regression: stash-pop targets ────────────────────────────────────────

describe('v1.72.0 regression targets', () => {
  it('schema has authAccountName (re-adding Player.idFrontUrl would fail — wrong target; this guards authAccountName)', () => {
    const schema = readSrc('prisma', 'schema.prisma')
    expect(schema).toMatch(/authAccountName/)
  })

  it('identityLink linkPlayerToUser back-pointer update carries name field', () => {
    const idLink = readSrc('src', 'lib', 'identityLink.ts')
    const block = idLink.slice(
      idLink.indexOf('export async function linkPlayerToUser'),
      idLink.indexOf('export async function linkUserToPlayer'),
    )
    // Regression target: restoring the old shape (no name field) breaks this.
    expect(block).toMatch(/data:\s*\{[\s\S]*?playerId:\s*args\.playerId[\s\S]*?name:/m)
  })

  it('identityLink unlinkPlayerFromUser restores name (regression: clearing name is incorrect)', () => {
    const idLink = readSrc('src', 'lib', 'identityLink.ts')
    const block = idLink.slice(
      idLink.indexOf('export async function unlinkPlayerFromUser'),
      idLink.indexOf('export async function unlinkUserFromPlayer'),
    )
    expect(block).toMatch(/name:\s*user\.authAccountName/)
  })

  it('version is 1.72.0 or later', () => {
    const ver = readSrc('src', 'lib', 'version.ts')
    // Relaxed from literal '1.72.0' to any version >= 1.72.x per CLAUDE.md
    // pinned-literal policy: patch/minor bumps should not require touching
    // all prior-version test files.
    expect(ver).toMatch(/APP_VERSION\s*=\s*'1\.(7[2-9]|[89]\d|\d{3,})\.\d+'/)
  })
})
