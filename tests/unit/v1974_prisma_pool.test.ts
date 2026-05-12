/**
 * v1.97.4 — Prisma connection-pool widening.
 *
 * Prod logs (2026-05-12, v1.97.3) showed P2024 timeouts on multiple
 * findMany calls during the v1.97.2 `?_rsc=` prefetch storm. Cause:
 * `connection_limit: 5` (Prisma default on 1-vCPU serverless) is too
 * narrow when `getLeaguePageBundle`'s 7-query `Promise.all` + Next.js
 * Link prefetches all hit the same function instance.
 *
 * Fix: `withPoolParams` injects `connection_limit=20&pool_timeout=20`
 * into `DATABASE_URL` if the operator hasn't already pinned them.
 *
 * Tests pin:
 *   1. APP_VERSION bumped to 1.97.4.
 *   2. `withPoolParams` is exported from src/lib/prisma.ts.
 *   3. Injects `connection_limit=20` + `pool_timeout=20` on a bare URL.
 *   4. Preserves operator-supplied values (does NOT overwrite).
 *   5. Preserves the host, db name, and unrelated query params.
 *   6. Pure no-op on non-postgres or unparseable strings.
 *   7. Build path: PrismaClient receives a `datasourceUrl` derived
 *      from the augmented value when DATABASE_URL is set.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { withPoolParams } from '@/lib/prisma'

const REPO_ROOT = join(__dirname, '..', '..')
const VERSION_SRC = readFileSync(join(REPO_ROOT, 'src/lib/version.ts'), 'utf8')
const PRISMA_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/prisma.ts'),
  'utf8',
)

describe('v1.97.4 — version bump', () => {
  it('APP_VERSION is 1.97.4 or higher', () => {
    expect(VERSION_SRC).toMatch(
      /APP_VERSION\s*=\s*['"]1\.(97\.([4-9]|\d{2,})|9[89]\.\d+|\d{3,}\.\d+)['"]/,
    )
  })
})

describe('v1.97.4 — withPoolParams helper', () => {
  it('is exported from src/lib/prisma.ts', () => {
    expect(PRISMA_SRC).toMatch(/export function withPoolParams/)
  })

  it('adds connection_limit=20 to a bare postgresql:// URL', () => {
    const out = withPoolParams(
      'postgresql://user:pw@host.neon.tech/db?sslmode=require',
    )
    expect(out).toContain('connection_limit=20')
  })

  it('adds pool_timeout=20 to a bare postgresql:// URL', () => {
    const out = withPoolParams(
      'postgresql://user:pw@host.neon.tech/db?sslmode=require',
    )
    expect(out).toContain('pool_timeout=20')
  })

  it('preserves existing sslmode and other params', () => {
    const out = withPoolParams(
      'postgresql://user:pw@host.neon.tech/db?sslmode=require&channel_binding=require',
    )
    expect(out).toContain('sslmode=require')
    expect(out).toContain('channel_binding=require')
  })

  it('does NOT overwrite operator-supplied connection_limit', () => {
    const out = withPoolParams(
      'postgresql://user:pw@host.neon.tech/db?connection_limit=42&sslmode=require',
    )
    expect(out).toContain('connection_limit=42')
    expect(out).not.toContain('connection_limit=20')
  })

  it('does NOT overwrite operator-supplied pool_timeout', () => {
    const out = withPoolParams(
      'postgresql://user:pw@host.neon.tech/db?pool_timeout=60&sslmode=require',
    )
    expect(out).toContain('pool_timeout=60')
    expect(out).not.toContain('pool_timeout=20')
  })

  it('accepts the postgres:// scheme (alias of postgresql://)', () => {
    const out = withPoolParams('postgres://u:p@h/db')
    expect(out).toContain('connection_limit=20')
    expect(out).toContain('pool_timeout=20')
  })

  it('is a pure no-op on empty string', () => {
    expect(withPoolParams('')).toBe('')
  })

  it('is a pure no-op on non-postgres URLs', () => {
    expect(withPoolParams('https://example.com/db')).toBe(
      'https://example.com/db',
    )
    expect(withPoolParams('mysql://u:p@h/db')).toBe('mysql://u:p@h/db')
  })

  it('is a pure no-op on unparseable input', () => {
    expect(withPoolParams('not a url at all')).toBe('not a url at all')
  })

  it('preserves the host and database name', () => {
    const out = withPoolParams(
      'postgresql://neondb_owner:secret@ep-steep-bonus-aol2051y-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
    )
    expect(out).toContain('ep-steep-bonus-aol2051y-pooler.c-2.ap-southeast-1.aws.neon.tech')
    expect(out).toContain('/neondb')
  })

  it('handles trailing newline gracefully (matches prod env var quirk)', () => {
    // The prod DATABASE_URL has a trailing `\n` in its value; the
    // helper should not throw — the trailing newline is naturally
    // stripped by URL parsing.
    const out = withPoolParams(
      'postgresql://u:p@host/db?sslmode=require\n',
    )
    // Either it parsed and injected, or it returned the input
    // verbatim — both are acceptable. The contract is "does not throw".
    expect(typeof out).toBe('string')
  })
})

describe('v1.97.4 — Prisma client construction', () => {
  it('builds the client with a datasourceUrl derived from DATABASE_URL', () => {
    expect(PRISMA_SRC).toMatch(/datasourceUrl/)
    expect(PRISMA_SRC).toMatch(/withPoolParams\(process\.env\.DATABASE_URL\)/)
  })

  it('omits datasourceUrl when DATABASE_URL is unset (preserves dev/test fallback)', () => {
    // The spread `...(datasourceUrl ? { datasourceUrl } : {})` keeps
    // the default Prisma client behaviour when DATABASE_URL is not
    // configured (test environments, certain CI setups).
    expect(PRISMA_SRC).toMatch(
      /\.\.\.\(datasourceUrl\s*\?\s*\{\s*datasourceUrl\s*\}\s*:\s*\{\}\)/,
    )
  })

  it('only touches the pooled DATABASE_URL, not DATABASE_URL_UNPOOLED', () => {
    // The unpooled URL drives migrations/admin scripts where serial
    // patterns make the default pool fine. The fix is targeted.
    const stripped = PRISMA_SRC
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    expect(stripped).not.toMatch(/DATABASE_URL_UNPOOLED/)
  })
})
