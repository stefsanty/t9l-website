#!/usr/bin/env node
/**
 * v1.58.1 (PR 6 of route-shortening chain) — Vercel preview-build
 * Neon-Vercel race fix.
 *
 * Pre-v1.58.1 the `npm run build` script was a flat
 * `prisma migrate deploy && prisma generate && next build`. This
 * worked for production (where DATABASE_URL_UNPOOLED is provisioned
 * by the Neon-Vercel marketplace integration) and for local dev (where
 * `.env.local` sets it). It DID NOT work for Vercel preview builds on
 * fresh PR branches: when a developer pushes a new branch, Vercel
 * starts the build immediately, but the Neon-Vercel integration
 * hasn't yet provisioned the per-branch DB and injected the env vars.
 * `prisma migrate deploy` (and even `prisma generate`'s schema
 * validation) requires the env var to merely EXIST at parse time —
 * not necessarily point at a real DB. The build dies with:
 *
 *   Error: Prisma schema validation - (get-config wasm)
 *   Error code: P1012
 *   error: Environment variable not found: DATABASE_URL_UNPOOLED.
 *
 * This forced every PR in the v1.50–v1.58 chain to be admin-merged
 * via the documented runbook fallback. It's documented as a "Known
 * infra issue" in CLAUDE.md but never fixed at the root.
 *
 * Strategy:
 *   1. If DATABASE_URL_UNPOOLED is missing, set placeholder values
 *      so `prisma generate` succeeds at parse time. The placeholders
 *      are scoped to this build process — they do NOT leak into the
 *      Vercel runtime, which loads its own env vars from project
 *      settings (eventually populated by the Neon-Vercel integration).
 *   2. Skip `prisma migrate deploy` when there's no real DB
 *      (placeholder detection). On preview branches the per-branch DB
 *      is forked from the parent (which already has migrations
 *      applied) so the integration handles migration via its own
 *      provisioning flow.
 *   3. Always run `prisma generate` (works with placeholder env vars)
 *      so the @prisma/client TypeScript types are emitted.
 *   4. Always run `next build` — Next.js compiles all routes; runtime
 *      env vars are injected at request time, so a placeholder at
 *      build time doesn't break runtime DB connections.
 *
 * For production builds where DATABASE_URL_UNPOOLED is set, behavior
 * is unchanged: migrate-deploy runs, generate runs, next build runs.
 *
 * For local builds (`npm run build` in dev), the .env.local var is
 * loaded by Next/Prisma; behavior is unchanged.
 */
import { execSync } from 'node:child_process'

function run(cmd) {
  console.log(`[build] $ ${cmd}`)
  execSync(cmd, { stdio: 'inherit' })
}

const PLACEHOLDER = 'postgresql://placeholder@localhost:5432/placeholder?sslmode=disable'

const realDirectUrl = process.env.DATABASE_URL_UNPOOLED
const realPooledUrl = process.env.DATABASE_URL

const usingPlaceholder =
  !realDirectUrl ||
  realDirectUrl.includes('placeholder@localhost')

if (!realDirectUrl) {
  console.log(
    '[build] DATABASE_URL_UNPOOLED is not set — using placeholder for prisma generate.\n' +
      '[build] This is expected on Vercel preview builds where the Neon-Vercel\n' +
      '[build] marketplace integration has not yet provisioned the per-branch DB.\n' +
      '[build] The placeholder is scoped to this build process and does not leak\n' +
      '[build] to runtime; runtime env vars come from Vercel project settings.',
  )
  process.env.DATABASE_URL_UNPOOLED = PLACEHOLDER
}
if (!realPooledUrl) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED
}

if (usingPlaceholder) {
  console.log('[build] Skipping `prisma migrate deploy` (no real DATABASE_URL_UNPOOLED).')
  console.log('[build] Production deploys with a real env var migrate normally.')
} else {
  run('npx prisma migrate deploy')
}

run('npx prisma generate')
run('npx next build')
