import { PrismaClient } from '@prisma/client'

/**
 * v1.97.4 — explicit Prisma connection pool sizing for Vercel serverless.
 *
 * Background. Prod logs (2026-05-12, v1.97.3) showed `P2024 — Timed out
 * fetching a new connection from the connection pool. (Current connection
 * pool timeout: 10, connection limit: 5)` on multiple findMany calls:
 * `prisma.user.findMany`, `prisma.lineLogin.findMany`,
 * `prisma.playerLeagueMembership.findMany`. Each timeout produced a
 * 503 from Vercel's edge. The user-reported symptom: every `?_rsc=`
 * prefetch returned 503, and league-switch navigations took 2-3 s.
 *
 * Root cause. Prisma's default pool size is `num_physical_cpus * 2 + 1`.
 * On Vercel's 1-vCPU serverless functions Prisma sometimes reports 5
 * (varies by runtime detection). Critically, `getLeaguePageBundle`
 * (`src/lib/leaguePageData.ts`) issues 7 queries via `Promise.all` —
 * one render already saturates the 5-connection pool. When Next.js's
 * built-in `<Link prefetch>` (every visible nav link on a logged-in
 * page) AND the v1.97.2 `router.prefetch()` loop both fire on the
 * same function instance, queries pile up faster than they drain, and
 * the 10 s pool-acquisition timeout kicks in.
 *
 * Fix. Inject `connection_limit=20&pool_timeout=20` into the pooled
 * `DATABASE_URL` if the user hasn't already pinned them. 20 is the
 * Vercel/Prisma/Neon recommendation for serverless + pgBouncer (the
 * Neon `-pooler.` host this project uses is built for high
 * concurrency through transaction pooling, so widening Prisma's local
 * pool just lets one function instance use what Neon already affords).
 * `pool_timeout=20` doubles the wait window so transient spikes
 * resolve instead of failing the request.
 *
 * The override applies via `datasourceUrl` (Prisma 5+). We don't touch
 * `DATABASE_URL_UNPOOLED` — direct connections are used by migrations
 * and admin scripts where serial query patterns make the default
 * adequate, and PR safety would change otherwise.
 *
 * Pure helper extracted so the URL-augmentation logic is unit-testable.
 */

const POOL_SIZE = 20
const POOL_TIMEOUT_SECONDS = 20

export function withPoolParams(rawUrl: string): string {
  if (!rawUrl) return rawUrl
  // Defensive: only mutate URLs that look like a real Postgres
  // connection string. Tests + dev sometimes pass placeholder values.
  if (!rawUrl.startsWith('postgres://') && !rawUrl.startsWith('postgresql://')) {
    return rawUrl
  }
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return rawUrl
  }
  if (!url.searchParams.has('connection_limit')) {
    url.searchParams.set('connection_limit', String(POOL_SIZE))
  }
  if (!url.searchParams.has('pool_timeout')) {
    url.searchParams.set('pool_timeout', String(POOL_TIMEOUT_SECONDS))
  }
  return url.toString()
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }

function buildClient(): PrismaClient {
  const datasourceUrl = process.env.DATABASE_URL
    ? withPoolParams(process.env.DATABASE_URL)
    : undefined
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    ...(datasourceUrl ? { datasourceUrl } : {}),
  })
}

export const prisma = globalForPrisma.prisma ?? buildClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
