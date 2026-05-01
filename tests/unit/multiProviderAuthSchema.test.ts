import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * v1.28.0 — Multi-provider auth foundation (stage α.5, additive schema).
 *
 * See outputs/account-player-rework-plan.md §3 "Stage α.5" for the plan.
 *
 * This stage adds:
 *   - User.email          (nullable @unique)  — NextAuth adapter requirement
 *   - User.emailVerified  (nullable timestamp) — adapter EmailProvider field
 *   - Account             (new table)          — multi-provider join
 *   - VerificationToken   (new table)          — EmailProvider tokens
 *
 * Reads pattern from identityReworkAlphaSchema.test.ts: the schema +
 * migration files are read as text; comments are stripped so docstrings
 * that legitimately reference these symbols don't trip false positives.
 */

const repoRoot = join(__dirname, '..', '..')
const schemaRaw = readFileSync(join(repoRoot, 'prisma/schema.prisma'), 'utf8')
const migrationRaw = readFileSync(
  join(
    repoRoot,
    'prisma/migrations/20260502000000_multi_provider_auth_foundation/migration.sql',
  ),
  'utf8',
)

function stripPrismaComments(src: string): string {
  return src.replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

function stripSqlComments(src: string): string {
  return src.replace(/--[^\n]*/g, '')
}

const schema = stripPrismaComments(schemaRaw)
const migration = stripSqlComments(migrationRaw)

describe('multi-provider auth foundation — schema additions', () => {
  describe('User model', () => {
    it('adds nullable email column with @unique', () => {
      // Match within the User model only — schema has multiple `email` mentions
      // potentially in comments / future models. Match on the field declaration
      // shape: "email   String?  @unique"
      const userBlock = schema.match(/model User \{[\s\S]*?\n\}/)?.[0] ?? ''
      expect(userBlock).toMatch(/email\s+String\?\s+@unique/)
    })

    it('adds nullable emailVerified DateTime column', () => {
      const userBlock = schema.match(/model User \{[\s\S]*?\n\}/)?.[0] ?? ''
      expect(userBlock).toMatch(/emailVerified\s+DateTime\?/)
    })

    it('adds nullable image column (NextAuth adapter writes here)', () => {
      // The PrismaAdapter writes the OAuth profile picture to `User.image`.
      // Without this column present, adapter `createUser` fails with
      // "Unknown argument `image`" on first non-LINE provider sign-in.
      const userBlock = schema.match(/model User \{[\s\S]*?\n\}/)?.[0] ?? ''
      expect(userBlock).toMatch(/image\s+String\?/)
    })

    it('declares accounts relation list', () => {
      const userBlock = schema.match(/model User \{[\s\S]*?\n\}/)?.[0] ?? ''
      expect(userBlock).toMatch(/accounts\s+Account\[\]/)
    })

    it('preserves existing User.lineId @unique (legacy compat through stage 3)', () => {
      const userBlock = schema.match(/model User \{[\s\S]*?\n\}/)?.[0] ?? ''
      expect(userBlock).toMatch(/lineId\s+String\?\s+@unique/)
    })

    it('preserves existing User.playerId @unique (v1.27.0 stage 1)', () => {
      const userBlock = schema.match(/model User \{[\s\S]*?\n\}/)?.[0] ?? ''
      expect(userBlock).toMatch(/playerId\s+String\?\s+@unique/)
    })
  })

  describe('Account model', () => {
    it('exists as a top-level model', () => {
      expect(schema).toMatch(/model Account \{/)
    })

    it('has the NextAuth adapter-canonical field set', () => {
      const accountBlock = schema.match(/model Account \{[\s\S]*?\n\}/)?.[0] ?? ''
      // NextAuth's PrismaAdapter expects EXACT field names. A regression
      // that renames any of these breaks the adapter at runtime.
      expect(accountBlock).toMatch(/userId\s+String/)
      expect(accountBlock).toMatch(/type\s+String/)
      expect(accountBlock).toMatch(/provider\s+String/)
      expect(accountBlock).toMatch(/providerAccountId\s+String/)
      expect(accountBlock).toMatch(/refresh_token\s+String\?/)
      expect(accountBlock).toMatch(/access_token\s+String\?/)
      expect(accountBlock).toMatch(/expires_at\s+Int\?/)
      expect(accountBlock).toMatch(/token_type\s+String\?/)
      expect(accountBlock).toMatch(/scope\s+String\?/)
      expect(accountBlock).toMatch(/id_token\s+String\?/)
      expect(accountBlock).toMatch(/session_state\s+String\?/)
    })

    it('enforces @@unique([provider, providerAccountId])', () => {
      const accountBlock = schema.match(/model Account \{[\s\S]*?\n\}/)?.[0] ?? ''
      expect(accountBlock).toMatch(/@@unique\(\[provider,\s*providerAccountId\]\)/)
    })

    it('cascades on User delete', () => {
      const accountBlock = schema.match(/model Account \{[\s\S]*?\n\}/)?.[0] ?? ''
      expect(accountBlock).toMatch(/@relation\(fields: \[userId\], references: \[id\], onDelete: Cascade\)/)
    })

    it('indexes userId for efficient User → Accounts lookup', () => {
      const accountBlock = schema.match(/model Account \{[\s\S]*?\n\}/)?.[0] ?? ''
      expect(accountBlock).toMatch(/@@index\(\[userId\]\)/)
    })
  })

  describe('VerificationToken model', () => {
    it('exists as a top-level model', () => {
      expect(schema).toMatch(/model VerificationToken \{/)
    })

    it('has the NextAuth adapter-canonical field set', () => {
      const tokenBlock = schema.match(/model VerificationToken \{[\s\S]*?\n\}/)?.[0] ?? ''
      expect(tokenBlock).toMatch(/identifier\s+String/)
      expect(tokenBlock).toMatch(/token\s+String\s+@unique/)
      expect(tokenBlock).toMatch(/expires\s+DateTime/)
    })

    it('enforces @@unique([identifier, token]) for the consume-and-delete flow', () => {
      const tokenBlock = schema.match(/model VerificationToken \{[\s\S]*?\n\}/)?.[0] ?? ''
      expect(tokenBlock).toMatch(/@@unique\(\[identifier,\s*token\]\)/)
    })
  })

  describe('migration SQL', () => {
    it('adds User.email column', () => {
      expect(migration).toMatch(/ALTER TABLE "User" ADD COLUMN "email" TEXT/)
    })

    it('adds User.emailVerified column', () => {
      expect(migration).toMatch(/ALTER TABLE "User" ADD COLUMN "emailVerified" TIMESTAMP\(3\)/)
    })

    it('adds User.image column', () => {
      expect(migration).toMatch(/ALTER TABLE "User" ADD COLUMN "image" TEXT/)
    })

    it('creates the User_email unique index', () => {
      expect(migration).toMatch(/CREATE UNIQUE INDEX "User_email_key" ON "User"\("email"\)/)
    })

    it('creates the Account table with all adapter-canonical columns', () => {
      expect(migration).toMatch(/CREATE TABLE "Account"/)
      expect(migration).toMatch(/"userId" TEXT NOT NULL/)
      expect(migration).toMatch(/"provider" TEXT NOT NULL/)
      expect(migration).toMatch(/"providerAccountId" TEXT NOT NULL/)
    })

    it('creates the (provider, providerAccountId) compound unique index on Account', () => {
      expect(migration).toMatch(
        /CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"\("provider", "providerAccountId"\)/,
      )
    })

    it('adds the Account → User foreign key with ON DELETE CASCADE', () => {
      // Use [\s\S] instead of /s flag for ES5 / pre-ES2018 target compat.
      expect(migration).toMatch(
        /ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey"[\s\S]*REFERENCES "User"\("id"\) ON DELETE CASCADE/,
      )
    })

    it('creates the VerificationToken table', () => {
      expect(migration).toMatch(/CREATE TABLE "VerificationToken"/)
      expect(migration).toMatch(
        /CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"\("identifier", "token"\)/,
      )
    })

    it('does NOT drop or alter any existing column (additive only)', () => {
      // No DROP COLUMN, no DROP TABLE, no DROP TYPE, no ALTER COLUMN that
      // changes a type. The migration is purely additive; a regression
      // would surface as one of these statements appearing.
      expect(migration).not.toMatch(/DROP COLUMN/)
      expect(migration).not.toMatch(/DROP TABLE/)
      expect(migration).not.toMatch(/DROP TYPE/)
      expect(migration).not.toMatch(/ALTER COLUMN/)
    })
  })
})

describe('multi-provider auth foundation — auth.ts wiring', () => {
  const authSrc = readFileSync(join(repoRoot, 'src/lib/auth.ts'), 'utf8')

  it('imports PrismaAdapter from @auth/prisma-adapter', () => {
    expect(authSrc).toMatch(/from\s+["']@auth\/prisma-adapter["']/)
    expect(authSrc).toMatch(/PrismaAdapter/)
  })

  it('imports GoogleProvider', () => {
    expect(authSrc).toMatch(/from\s+["']next-auth\/providers\/google["']/)
  })

  it('imports EmailProvider', () => {
    expect(authSrc).toMatch(/from\s+["']next-auth\/providers\/email["']/)
  })

  it('wires adapter: PrismaAdapter(prisma) on authOptions', () => {
    expect(authSrc).toMatch(/adapter:\s*PrismaAdapter\(prisma\)/)
  })

  it('gates GoogleProvider behind GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET', () => {
    expect(authSrc).toMatch(/process\.env\.GOOGLE_CLIENT_ID/)
    expect(authSrc).toMatch(/process\.env\.GOOGLE_CLIENT_SECRET/)
    // The provider must be conditionally included (omitted when env unset).
    expect(authSrc).toMatch(/googleProviderEnabled/)
  })

  it('gates EmailProvider behind EMAIL_SERVER + EMAIL_FROM', () => {
    expect(authSrc).toMatch(/process\.env\.EMAIL_SERVER/)
    expect(authSrc).toMatch(/process\.env\.EMAIL_FROM/)
    expect(authSrc).toMatch(/emailProviderEnabled/)
  })

  it('points pages.signIn at /auth/signin (not /admin/login)', () => {
    expect(authSrc).toMatch(/signIn:\s*['"]\/auth\/signin['"]/)
  })

  it('points pages.verifyRequest at /auth/verify-request', () => {
    expect(authSrc).toMatch(/verifyRequest:\s*['"]\/auth\/verify-request['"]/)
  })

  it('captures token.userId on LINE sign-in (forward use for stage β)', () => {
    // The branch handling LINE sign-in must read user.id and set token.userId.
    // Match a window of the file rather than the whole file because there
    // are multiple userId mentions (session callback also surfaces it).
    expect(authSrc).toMatch(/token\.userId\s*=\s*user\.id/)
  })

  it('bridges User.lineId after adapter creates a User on first LINE login', () => {
    // The PrismaAdapter doesn't know about the custom `User.lineId` column
    // (NextAuth canonical User shape doesn't have it). Without a bridge,
    // existing legacy resolvers that look up User by lineId would fail
    // post-α.5. The syncUserLineId helper closes this gap.
    expect(authSrc).toMatch(/syncUserLineId/)
    expect(authSrc).toMatch(/updateMany/)
    expect(authSrc).toMatch(/lineId:\s*null/)
  })

  it('handles Google + email branches with no lineId set', () => {
    // The branch handling non-LINE adapter providers must explicitly clear
    // lineId so the JWT shape stays consistent with what session callback
    // expects.
    expect(authSrc).toMatch(/account\?\.provider === ["']google["']/)
    expect(authSrc).toMatch(/account\?\.provider === ["']email["']/)
  })

  it('exposes session.userId in the session callback', () => {
    expect(authSrc).toMatch(/session\.userId\s*=/)
  })
})

describe('multi-provider auth foundation — type augmentation', () => {
  const dts = readFileSync(join(repoRoot, 'src/types/next-auth.d.ts'), 'utf8')

  it('adds userId: string | null to Session', () => {
    const sessionBlock = dts.match(/interface Session[\s\S]*?\n\s*\}/)?.[0] ?? ''
    expect(sessionBlock).toMatch(/userId:\s*string\s*\|\s*null/)
  })

  it('adds userId?: string | null to JWT', () => {
    const jwtBlock = dts.match(/interface JWT[\s\S]*?\n\s*\}/)?.[0] ?? ''
    expect(jwtBlock).toMatch(/userId\?:\s*string\s*\|\s*null/)
  })
})

describe('multi-provider auth foundation — sign-in UI surfaces', () => {
  it('exposes /auth/signin as a Next page', () => {
    const pageSrc = readFileSync(
      join(repoRoot, 'src/app/auth/signin/page.tsx'),
      'utf8',
    )
    expect(pageSrc).toMatch(/export default function SignInPage/)
  })

  it('exposes /auth/verify-request as a Next page', () => {
    const pageSrc = readFileSync(
      join(repoRoot, 'src/app/auth/verify-request/page.tsx'),
      'utf8',
    )
    expect(pageSrc).toMatch(/export default function VerifyRequestPage/)
  })

  it('signin client conditionally renders Google + Email buttons by env', () => {
    const clientSrc = readFileSync(
      join(repoRoot, 'src/app/auth/signin/SignInClient.tsx'),
      'utf8',
    )
    expect(clientSrc).toMatch(/googleEnabled/)
    expect(clientSrc).toMatch(/emailEnabled/)
    expect(clientSrc).toMatch(/signIn\(['"]line['"]/)
    expect(clientSrc).toMatch(/signIn\(['"]google['"]/)
    expect(clientSrc).toMatch(/signIn\(['"]email['"]/)
  })
})
