/**
 * v1.70.0 — Move ID images from Player to User.
 *
 * Identity proof is per-person, not per-league. The three columns
 * `idFrontUrl` / `idBackUrl` / `idUploadedAt` move from Player to User
 * via the `move_id_to_user` migration: ADD on User → BACKFILL → DROP
 * from Player, all in one transaction.
 *
 * Tests pin the load-bearing shapes:
 *   - Schema: User has the three columns; Player no longer does.
 *   - Migration: ADD-then-BACKFILL-then-DROP ordering preserved (so
 *     rollback recipes can re-run the same shape inverted).
 *   - Source code: ID writes go to User, NOT Player; admin "View ID"
 *     reads from the new `idDataByPlayerId` map sourced from User.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const SCHEMA = readFileSync(join(ROOT, 'prisma', 'schema.prisma'), 'utf-8')
const MIGRATION_RAW = readFileSync(
  join(
    ROOT,
    'prisma',
    'migrations',
    '20260509000000_move_id_to_user',
    'migration.sql',
  ),
  'utf-8',
)
// Strip line comments so docstring mentions of "DROP COLUMN" inside
// rollback recipes don't trip the "no DROP outside the executable
// statements" assertions.
const MIGRATION_EXEC = MIGRATION_RAW.split(/\r?\n/)
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n')

const ADMIN_DATA = readFileSync(join(ROOT, 'src', 'lib', 'admin-data.ts'), 'utf-8')
const RECRUIT_ACTIONS = readFileSync(
  join(ROOT, 'src', 'app', 'api', 'recruiting', 'actions.ts'),
  'utf-8',
)
const JOIN_ACTIONS = readFileSync(
  join(ROOT, 'src', 'app', 'join', '[code]', 'actions.ts'),
  'utf-8',
)
const ADMIN_LEAGUES_ACTIONS = readFileSync(
  join(ROOT, 'src', 'app', 'admin', 'leagues', 'actions.ts'),
  'utf-8',
)
const ID_UPLOAD_PAGE = readFileSync(
  join(ROOT, 'src', 'app', 'join', '[code]', 'id-upload', 'page.tsx'),
  'utf-8',
)
const ACCOUNT_PLAYER_PAGE = readFileSync(
  join(ROOT, 'src', 'app', 'account', 'player', 'page.tsx'),
  'utf-8',
)
const PLAYERS_PAGE = readFileSync(
  join(ROOT, 'src', 'app', 'admin', 'leagues', '[id]', 'players', 'page.tsx'),
  'utf-8',
)

const userBlock = (() => {
  const m = SCHEMA.match(/model User\s*\{[\s\S]*?\n\}/)
  return m ? m[0] : ''
})()
const playerBlock = (() => {
  const m = SCHEMA.match(/model Player\s*\{[\s\S]*?\n\}/)
  return m ? m[0] : ''
})()

describe('v1.70.0 — schema: User has the three ID columns', () => {
  it('User declares idFrontUrl String?', () => {
    expect(userBlock).toMatch(/^\s*idFrontUrl\s+String\?/m)
  })
  it('User declares idBackUrl String?', () => {
    expect(userBlock).toMatch(/^\s*idBackUrl\s+String\?/m)
  })
  it('User declares idUploadedAt DateTime?', () => {
    expect(userBlock).toMatch(/^\s*idUploadedAt\s+DateTime\?/m)
  })
})

describe('v1.70.0 — schema: Player no longer has the three ID columns (regression target)', () => {
  it('Player block has no idFrontUrl line', () => {
    expect(playerBlock).not.toMatch(/^\s*idFrontUrl\s+String/m)
  })
  it('Player block has no idBackUrl line', () => {
    expect(playerBlock).not.toMatch(/^\s*idBackUrl\s+String/m)
  })
  it('Player block has no idUploadedAt line', () => {
    expect(playerBlock).not.toMatch(/^\s*idUploadedAt\s+DateTime/m)
  })
})

describe('v1.70.0 — migration: ADD then BACKFILL then DROP ordering', () => {
  it('adds three nullable columns on User', () => {
    expect(MIGRATION_EXEC).toMatch(
      /ALTER TABLE\s+"User"\s+ADD COLUMN\s+"idFrontUrl"\s+TEXT/i,
    )
    expect(MIGRATION_EXEC).toMatch(
      /ALTER TABLE\s+"User"\s+ADD COLUMN\s+"idBackUrl"\s+TEXT/i,
    )
    expect(MIGRATION_EXEC).toMatch(
      /ALTER TABLE\s+"User"\s+ADD COLUMN\s+"idUploadedAt"\s+TIMESTAMP\(3\)/i,
    )
  })

  it('backfill UPDATE happens between ADD and DROP', () => {
    const addUserIdx = MIGRATION_EXEC.search(
      /ALTER TABLE\s+"User"\s+ADD COLUMN\s+"idFrontUrl"/i,
    )
    const updateIdx = MIGRATION_EXEC.search(/UPDATE\s+"User"\s+u\s+SET/i)
    const dropPlayerIdx = MIGRATION_EXEC.search(
      /ALTER TABLE\s+"Player"\s+DROP COLUMN\s+"idFrontUrl"/i,
    )
    expect(addUserIdx).toBeGreaterThanOrEqual(0)
    expect(updateIdx).toBeGreaterThan(addUserIdx)
    expect(dropPlayerIdx).toBeGreaterThan(updateIdx)
  })

  it('backfill copies all three columns from Player to User via Player.userId', () => {
    expect(MIGRATION_EXEC).toMatch(/"idFrontUrl"\s*=\s*src\."idFrontUrl"/i)
    expect(MIGRATION_EXEC).toMatch(/"idBackUrl"\s*=\s*src\."idBackUrl"/i)
    expect(MIGRATION_EXEC).toMatch(/"idUploadedAt"\s*=\s*src\."idUploadedAt"/i)
    expect(MIGRATION_EXEC).toMatch(/FROM\s+"Player"/i)
    expect(MIGRATION_EXEC).toMatch(/"userId"\s+IS\s+NOT\s+NULL/i)
  })

  it('backfill uses DISTINCT ON("userId") with idUploadedAt DESC for multi-Player Users', () => {
    expect(MIGRATION_EXEC).toMatch(
      /SELECT\s+DISTINCT\s+ON\s*\(\s*"userId"\s*\)/i,
    )
    expect(MIGRATION_EXEC).toMatch(/ORDER\s+BY\s+"userId"\s*,\s*"idUploadedAt"\s+DESC/i)
  })

  it('drops all three columns from Player', () => {
    expect(MIGRATION_EXEC).toMatch(
      /ALTER TABLE\s+"Player"\s+DROP COLUMN\s+"idFrontUrl"/i,
    )
    expect(MIGRATION_EXEC).toMatch(
      /ALTER TABLE\s+"Player"\s+DROP COLUMN\s+"idBackUrl"/i,
    )
    expect(MIGRATION_EXEC).toMatch(
      /ALTER TABLE\s+"Player"\s+DROP COLUMN\s+"idUploadedAt"/i,
    )
  })
})

describe('v1.70.0 — write paths: recruit + onboarding write to User, not Player', () => {
  it('registerToLeague creates Player WITHOUT id columns; updates User with id columns', () => {
    // The Player.create block: no id field assignments
    const playerCreateMatch = RECRUIT_ACTIONS.match(
      /tx\.player\.create\(\{[\s\S]*?return created/,
    )
    expect(playerCreateMatch).toBeTruthy()
    const playerCreateBody = playerCreateMatch![0]
    expect(playerCreateBody).not.toMatch(/idFrontUrl:/)
    expect(playerCreateBody).not.toMatch(/idBackUrl:/)
    expect(playerCreateBody).not.toMatch(/idUploadedAt:/)
    // The User.update block carries them. v1.71.1 moves to client-direct
    // upload, so the URL source is `input.idFrontUrl` (typed input)
    // rather than `frontResult.url` (server-side put result).
    expect(RECRUIT_ACTIONS).toMatch(
      /tx\.user\.update\(\{[\s\S]*?idFrontUrl:\s*(?:input\.idFrontUrl|frontResult\.url)[\s\S]*?\}/,
    )
    expect(RECRUIT_ACTIONS).toMatch(
      /tx\.user\.update\(\{[\s\S]*?idBackUrl:\s*(?:input\.idBackUrl|backResult\.url)[\s\S]*?\}/,
    )
    expect(RECRUIT_ACTIONS).toMatch(
      /tx\.user\.update\(\{[\s\S]*?idUploadedAt:\s*new Date\(\)[\s\S]*?\}/,
    )
  })

  it('completeOnboardingWithId writes ID URLs to tx.user.update, NOT tx.player.update (regression target)', () => {
    // Locate just the function body so the assertion is scoped.
    const fnMatch = JOIN_ACTIONS.match(
      /export async function completeOnboardingWithId[\s\S]*?\n\}/,
    )
    expect(fnMatch).toBeTruthy()
    const fn = fnMatch![0]
    // Player.update block exists for name + profilePictureUrl, but
    // must NOT carry idFrontUrl/idBackUrl/idUploadedAt.
    const playerUpdateMatch = fn.match(/tx\.player\.update\(\{[\s\S]*?\}\)/)
    expect(playerUpdateMatch).toBeTruthy()
    expect(playerUpdateMatch![0]).not.toMatch(/idFrontUrl:/)
    expect(playerUpdateMatch![0]).not.toMatch(/idBackUrl:/)
    expect(playerUpdateMatch![0]).not.toMatch(/idUploadedAt:/)
    // tx.user.update DOES carry them. v1.71.1 sources URLs from the
    // typed input (`input.idFrontUrl`) instead of the v1.68.0 server-
    // side put result (`frontResult.url`).
    expect(fn).toMatch(/tx\.user\.update\(\{[\s\S]*?idFrontUrl:\s*(?:input\.idFrontUrl|frontResult\.url)/)
    expect(fn).toMatch(/tx\.user\.update\(\{[\s\S]*?idBackUrl:\s*(?:input\.idBackUrl|backResult\.url)/)
    expect(fn).toMatch(/tx\.user\.update\(\{[\s\S]*?idUploadedAt:\s*new Date\(\)/)
  })

  it('submitIdUpload writes to tx.user.update (legacy two-step flow)', () => {
    const fnMatch = JOIN_ACTIONS.match(
      /export async function submitIdUpload[\s\S]*?\nfunction extOf/,
    )
    expect(fnMatch).toBeTruthy()
    const fn = fnMatch![0]
    expect(fn).toMatch(/tx\.user\.update\(\{[\s\S]*?idFrontUrl:\s*frontResult\.url/)
    expect(fn).toMatch(/tx\.user\.update\(\{[\s\S]*?idBackUrl:\s*backResult\.url/)
    expect(fn).toMatch(/tx\.user\.update\(\{[\s\S]*?idUploadedAt:\s*new Date\(\)/)
    // No tx.player.update with id columns.
    const playerUpdateMatches = fn.match(/tx\.player\.update\(\{[\s\S]*?\}\)/g) ?? []
    for (const block of playerUpdateMatches) {
      expect(block).not.toMatch(/idFrontUrl:/)
      expect(block).not.toMatch(/idBackUrl:/)
      expect(block).not.toMatch(/idUploadedAt:/)
    }
  })
})

describe('v1.70.0 — read paths: admin + user surfaces read from User', () => {
  it('admin-data.getLeaguePlayers fetches User rows with id columns + builds idDataByPlayerId', () => {
    expect(ADMIN_DATA).toMatch(/prisma\.user\.findMany\(\{[\s\S]*?playerId:\s*\{\s*not:\s*null\s*\}/)
    expect(ADMIN_DATA).toMatch(/idUploadedAt:\s*\{\s*not:\s*null\s*\}/)
    expect(ADMIN_DATA).toMatch(/idDataByPlayerId/)
  })

  it('admin Players page consumes idDataByPlayerId from the tuple', () => {
    expect(PLAYERS_PAGE).toMatch(/idDataByPlayerId/)
    expect(PLAYERS_PAGE).toMatch(/idDataByPlayerId\[a\.player\.id\]\?\.idFrontUrl/)
    expect(PLAYERS_PAGE).toMatch(/idDataByPlayerId\[p\.id\]\?\.idFrontUrl/)
  })

  it('admin Players page no longer reads ID columns directly off Player (regression target)', () => {
    expect(PLAYERS_PAGE).not.toMatch(/a\.player\.idFrontUrl/)
    expect(PLAYERS_PAGE).not.toMatch(/a\.player\.idBackUrl/)
    expect(PLAYERS_PAGE).not.toMatch(/a\.player\.idUploadedAt/)
    // pendingApplications row `p` likewise.
    expect(PLAYERS_PAGE).not.toMatch(/\bp\.idFrontUrl\b/)
    expect(PLAYERS_PAGE).not.toMatch(/\bp\.idBackUrl\b/)
    expect(PLAYERS_PAGE).not.toMatch(/\bp\.idUploadedAt\b/)
  })

  it('id-upload page reads idUploadedAt from User, not Player', () => {
    expect(ID_UPLOAD_PAGE).toMatch(
      /prisma\.user\.findUnique\(\{[\s\S]*?select:\s*\{\s*idUploadedAt:\s*true\s*\}/,
    )
    expect(ID_UPLOAD_PAGE).toMatch(/!!user\?\.idUploadedAt/)
    // Not on the Player select either.
    const playerSelectMatch = ID_UPLOAD_PAGE.match(
      /player:\s*\{[\s\S]*?select:\s*\{[\s\S]*?\}\s*,?\s*\}/,
    )
    if (playerSelectMatch) {
      expect(playerSelectMatch[0]).not.toMatch(/idFrontUrl:\s*true/)
      expect(playerSelectMatch[0]).not.toMatch(/idBackUrl:\s*true/)
      expect(playerSelectMatch[0]).not.toMatch(/idUploadedAt:\s*true/)
    }
  })

  it('account/player page reads hasUploadedId from User, not Player', () => {
    expect(ACCOUNT_PLAYER_PAGE).toMatch(/hasUploadedId:\s*!!idUser\?\.idUploadedAt/)
    expect(ACCOUNT_PLAYER_PAGE).not.toMatch(/hasUploadedId:\s*!!player\.idUploadedAt/)
  })

  it('adminPurgePlayerId resolves the linked User and updates User columns (not Player)', () => {
    const fnMatch = ADMIN_LEAGUES_ACTIONS.match(
      /export async function adminPurgePlayerId[\s\S]*?revalidate\(\{[\s\S]*?\}\)\s*\n\}/,
    )
    expect(fnMatch).toBeTruthy()
    const fn = fnMatch![0]
    // Looks up User via Player.userId.
    expect(fn).toMatch(/prisma\.user\.findUnique\(/)
    // Writes the nulls via prisma.user.update.
    expect(fn).toMatch(/prisma\.user\.update\(/)
    // Does NOT call prisma.player.update with id columns.
    const playerUpdateMatches = fn.match(/prisma\.player\.update\([\s\S]*?\}\)/g) ?? []
    for (const block of playerUpdateMatches) {
      expect(block).not.toMatch(/idFrontUrl:/)
      expect(block).not.toMatch(/idBackUrl:/)
      expect(block).not.toMatch(/idUploadedAt:/)
    }
  })
})
