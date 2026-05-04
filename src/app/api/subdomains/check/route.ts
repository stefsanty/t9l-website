import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { validateLeagueSlug } from '@/lib/leagueSlug'

/**
 * v1.53.1 (PR 5 of the path-routing chain) — slug-availability check
 * for the admin CreateLeagueModal. The endpoint name is `subdomains/check`
 * for legacy compat (the column was historically called `subdomain`),
 * but the value validated is now treated as a URL path slug.
 *
 * Returns `{ available, reason? }`:
 *   - `available: true` when the slug passes format + reserved-word
 *     validation AND no other League row claims it.
 *   - `available: false` for any of:
 *       - missing/empty input
 *       - format failure (`invalid-format`, `too-short`, `too-long`, `empty`)
 *       - reserved-word collision (`reserved`)
 *       - DB collision (already in use — `reason: 'in-use'`)
 *
 * The `reason` field on the response surfaces the specific failure to
 * the modal so it can render targeted error copy ("This slug is too
 * short" vs "This slug is reserved" vs "Already taken").
 *
 * `?exclude=<id>` lets the edit-flow skip its own row when checking.
 */
export async function GET(req: NextRequest) {
  const value   = req.nextUrl.searchParams.get('value')?.trim().toLowerCase() ?? ''
  const exclude = req.nextUrl.searchParams.get('exclude') ?? ''

  if (!value) {
    return NextResponse.json({ available: false, reason: 'empty' })
  }

  const validation = validateLeagueSlug(value)
  if (!validation.ok) {
    return NextResponse.json({ available: false, reason: validation.reason })
  }

  const existing = await prisma.league.findFirst({
    where: { subdomain: value, NOT: exclude ? { id: exclude } : undefined },
    select: { id: true },
  })

  if (existing) {
    return NextResponse.json({ available: false, reason: 'in-use' })
  }

  return NextResponse.json({ available: true })
}
