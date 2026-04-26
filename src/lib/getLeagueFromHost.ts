import { headers } from 'next/headers'
import { prisma } from './prisma'

/**
 * Reads the Host header and resolves which League to show.
 *
 * Subdomain extraction:
 *   test.dev.t9l.me  → subdomain "test"
 *   dev.t9l.me       → no subdomain → falls back to isDefault league
 *   t9l.me           → no subdomain → falls back to isDefault league
 *   localhost:3000   → no subdomain → falls back to isDefault league
 */
export async function getLeagueFromHost() {
  const hdrs = await headers()
  const host = (hdrs.get('host') ?? '').split(':')[0]

  const parts = host.split('.')
  let subdomain: string | null = null

  if (parts.length >= 4) {
    // test.dev.t9l.me → "test"
    subdomain = parts[0]
  } else if (parts.length === 3 && !host.endsWith('vercel.app')) {
    // test.t9l.me → "test"
    subdomain = parts[0]
  }

  if (subdomain) {
    const league = await prisma.league.findFirst({ where: { subdomain } })
    if (league) return league
  }

  return prisma.league.findFirst({ where: { isDefault: true } })
}
