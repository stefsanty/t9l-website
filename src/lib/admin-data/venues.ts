import { unstable_cache } from 'next/cache'
import { prisma } from '../prisma'

export const getAllVenues = unstable_cache(
  async () => prisma.venue.findMany({ orderBy: { name: 'asc' } }),
  ['all-venues'],
  { revalidate: 30, tags: ['leagues'] },
)

/**
 * Admin Venues page (v1.18.0). Same shape as `getAllVenues` plus usage
 * counts so the operator can see which venues are still referenced before
 * attempting a delete. `gameWeekCount` and `matchCount` are computed in
 * memory from a single `findMany` with `_count` on both relations.
 */
export const getAllVenuesWithUsage = unstable_cache(
  async () => {
    const venues = await prisma.venue.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { gameWeeks: true, matches: true } },
      },
    })
    return venues.map((v) => ({
      id: v.id,
      name: v.name,
      address: v.address,
      city: v.city,
      notes: v.notes,
      url: v.url,
      courtSize: v.courtSize,
      gameWeekCount: v._count.gameWeeks,
      matchCount: v._count.matches,
    }))
  },
  ['all-venues-with-usage'],
  { revalidate: 30, tags: ['leagues'] },
)
