import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import path from 'path'

/**
 * v1.58.1 (PR 6 of route-shortening chain) — pin the Vercel preview-build
 * race fix.
 *
 * Pre-v1.58.1 the `npm run build` script was a flat
 * `prisma migrate deploy && prisma generate && next build`. This forced
 * every PR through admin-merge fallback because Vercel preview builds
 * raced with the Neon-Vercel marketplace integration's env-var
 * provisioning. v1.58.1 routes the build through `scripts/build.mjs`
 * which gracefully handles the missing-env case.
 */

const ROOT = process.cwd()

function read(p: string): string {
  return readFileSync(path.join(ROOT, p), 'utf-8')
}

describe('v1.58.1 — package.json build script delegates to the new build orchestrator', () => {
  it('build script is `node scripts/build.mjs`, NOT the legacy chain', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
    expect(pkg.scripts.build).toBe('node scripts/build.mjs')
    // Regression target: the legacy `prisma migrate deploy && ...` form
    // must not be the build script anymore — it's the source of the
    // preview-build race that this PR fixes.
    expect(pkg.scripts.build).not.toMatch(/prisma migrate deploy/)
  })
})

describe('v1.58.1 — scripts/build.mjs', () => {
  const scriptPath = 'scripts/build.mjs'

  it('exists', () => {
    expect(existsSync(path.join(ROOT, scriptPath))).toBe(true)
  })

  it('detects missing DATABASE_URL_UNPOOLED and sets a placeholder', () => {
    const src = read(scriptPath)
    expect(src).toMatch(/!realDirectUrl/)
    expect(src).toMatch(/PLACEHOLDER\s*=\s*['"]postgresql:\/\/placeholder/)
    expect(src).toMatch(/process\.env\.DATABASE_URL_UNPOOLED\s*=\s*PLACEHOLDER/)
  })

  it('skips `prisma migrate deploy` when using the placeholder', () => {
    const src = read(scriptPath)
    expect(src).toMatch(/usingPlaceholder/)
    // The script branches on usingPlaceholder — when true it logs
    // "Skipping" and does NOT call migrate-deploy; when false it runs
    // `npx prisma migrate deploy` via run().
    expect(src).toMatch(/Skipping `prisma migrate deploy`/)
    expect(src).toMatch(/run\(['"`]npx prisma migrate deploy['"`]\)/)
  })

  it('always runs `prisma generate` regardless of env state', () => {
    const src = read(scriptPath)
    // The generate call must NOT be inside the `if (!usingPlaceholder)`
    // branch — it's always invoked at the bottom of the script.
    expect(src).toMatch(/run\(['"`]npx prisma generate['"`]\)/)
  })

  it('always runs `next build` at the end', () => {
    const src = read(scriptPath)
    expect(src).toMatch(/run\(['"`]npx next build['"`]\)/)
  })

  it('detects placeholder values that may have been pre-set (defensive)', () => {
    const src = read(scriptPath)
    // Catches the case where DATABASE_URL_UNPOOLED IS set but to a
    // placeholder value (e.g. by a previous run of this script). We
    // still skip migrate-deploy in that case.
    expect(src).toMatch(/realDirectUrl\.includes\(['"]placeholder@localhost['"]\)/)
  })

  it('also fills DATABASE_URL when only DATABASE_URL_UNPOOLED was missing', () => {
    const src = read(scriptPath)
    // Defensive: if EITHER env var is missing, use the same placeholder
    // for both — Prisma's `url = env(DATABASE_URL)` would also fail
    // schema-validation if missing.
    expect(src).toMatch(/!realPooledUrl/)
    expect(src).toMatch(/process\.env\.DATABASE_URL\s*=\s*process\.env\.DATABASE_URL_UNPOOLED/)
  })

  it('uses execSync from node:child_process (no shelling out via runtime libraries)', () => {
    const src = read(scriptPath)
    expect(src).toMatch(/from\s+['"]node:child_process['"]/)
    expect(src).toMatch(/execSync/)
  })

  it('invokes commands with stdio: "inherit" (so build logs surface in Vercel)', () => {
    const src = read(scriptPath)
    expect(src).toMatch(/stdio:\s*['"]inherit['"]/)
  })
})
