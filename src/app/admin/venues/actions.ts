'use server'

import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { revalidate } from '@/lib/revalidate'

async function assertAdmin() {
  const session = await getServerSession(authOptions)
  if (!session?.isAdmin) throw new Error('Unauthorized')
}

export interface VenueInput {
  name: string
  address?: string | null
  city?: string | null
  notes?: string | null
  url?: string | null
  courtSize?: string | null
}

function normalize(input: VenueInput): VenueInput {
  return {
    name: input.name.trim(),
    address: input.address?.trim() || null,
    city: input.city?.trim() || null,
    notes: input.notes?.trim() || null,
    url: input.url?.trim() || null,
    courtSize: input.courtSize?.trim() || null,
  }
}

export async function createVenue(input: VenueInput) {
  await assertAdmin()
  const data = normalize(input)
  if (!data.name) throw new Error('Venue name required')
  await prisma.venue.create({ data })
  revalidate({ domain: 'admin', paths: ['/admin/venues'] })
}

export async function updateVenue(id: string, input: VenueInput) {
  await assertAdmin()
  const data = normalize(input)
  if (!data.name) throw new Error('Venue name required')
  await prisma.venue.update({ where: { id }, data })
  revalidate({ domain: 'admin', paths: ['/admin/venues'] })
}

export async function deleteVenue(id: string) {
  await assertAdmin()
  // Block delete if any GameWeek or Match still references this venue —
  // FK is `onDelete: NoAction` (Prisma default), so a raw delete would 500
  // with a foreign-key violation. Surface a friendly error instead.
  const [gameWeekCount, matchCount] = await Promise.all([
    prisma.gameWeek.count({ where: { venueId: id } }),
    prisma.match.count({ where: { venueId: id } }),
  ])
  if (gameWeekCount > 0 || matchCount > 0) {
    throw new Error(
      `Cannot delete venue: ${gameWeekCount} matchday(s) and ${matchCount} match(es) still reference it. Reassign them first.`,
    )
  }
  await prisma.venue.delete({ where: { id } })
  revalidate({ domain: 'admin', paths: ['/admin/venues'] })
}
