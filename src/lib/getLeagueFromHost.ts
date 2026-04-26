import { headers } from 'next/headers'
import { prisma } from './prisma'

/**
 * Reads the Host header from the incoming request and resolves the matching
 * League from the database via the subdomain field.
 *
 * Subdomain extraction examples:
 *   test.dev.t9l.me   → "test"
 *   dev.t9l.me        → null  (base domain, no league subdomain)
 *   t9l.me            → null
 *   localhost:3000     → null
 *
 * Returns the League row if found, otherwise null (caller should fall back to
 * default Google Sheets-backed league).
 */
export async function getLeagueFromHost() {
  const hdrs = await headers()
  const host = (hdrs.get('host') ?? '').split(':')[0] // strip port

  // Count dots to determine if there's a meaningful subdomain.
  // t9l.me         = 1 dot (no subdomain)
  // dev.t9l.me     = 2 dots (Vercel preview domain, no user subdomain)
  // test.dev.t9l.me = 3 dots (user subdomain = "test")
  // test.t9l.me    = 2 dots (user subdomain = "test" on prod)
  const parts = host.split('.')
  const baseDomains = ['t9l.me', 'dev.t9l.me', 'localhost', 'vercel.app']

  let subdomain: string | null = null

  if (parts.length >= 4) {
    // test.dev.t9l.me → "test"
    subdomain = parts[0]
  } else if (parts.length === 3 && !host.endsWith('vercel.app')) {
    // test.t9l.me → "test" (production subdomain)
    subdomain = parts[0]
  }

  if (!subdomain) return null

  return prisma.league.findFirst({ where: { subdomain } })
}
