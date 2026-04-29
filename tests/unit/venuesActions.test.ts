/**
 * Unit tests for v1.18.0 admin venues server actions:
 *   - createVenue: trims, normalizes empty → null, creates row
 *   - updateVenue: trims, normalizes, calls update with the right id
 *   - deleteVenue: blocks when GameWeek.venueId or Match.venueId references it,
 *     otherwise deletes
 *
 * Verifies the BEHAVIOR (per CLAUDE.md "End-to-end verification rule"):
 *   (1) creating a venue stores trimmed fields, with empty strings → null
 *   (2) creating with empty name throws (validation)
 *   (3) deleting a venue still in use throws with a useful message + does NOT
 *       call prisma.venue.delete (regression target — pre-PR a raw delete
 *       would 500 with a foreign-key violation, masking the real cause)
 *   (4) deleting an unused venue actually deletes
 *   (5) every successful action calls `revalidate({ domain: 'admin', paths })`
 *       with the venues path so the listing re-renders
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { venueCreateMock, venueUpdateMock, venueDeleteMock, gameWeekCountMock, matchCountMock } = vi.hoisted(() => ({
  venueCreateMock: vi.fn().mockResolvedValue({ id: 'v-new' }),
  venueUpdateMock: vi.fn().mockResolvedValue({}),
  venueDeleteMock: vi.fn().mockResolvedValue({}),
  gameWeekCountMock: vi.fn().mockResolvedValue(0),
  matchCountMock: vi.fn().mockResolvedValue(0),
}))

const { revalidateMock } = vi.hoisted(() => ({
  revalidateMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    venue: {
      create: venueCreateMock,
      update: venueUpdateMock,
      delete: venueDeleteMock,
    },
    gameWeek: { count: gameWeekCountMock },
    match: { count: matchCountMock },
  },
}))

vi.mock('@/lib/revalidate', () => ({
  revalidate: revalidateMock,
}))

vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue({ isAdmin: true }),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

import { createVenue, updateVenue, deleteVenue } from '@/app/admin/venues/actions'

beforeEach(() => {
  vi.clearAllMocks()
  gameWeekCountMock.mockResolvedValue(0)
  matchCountMock.mockResolvedValue(0)
})

describe('createVenue (v1.18.0)', () => {
  it('creates a venue with trimmed fields; empty strings collapse to null', async () => {
    await createVenue({
      name: '  Tennozu Pitch  ',
      address: '',
      city: 'Tokyo',
      url: '',
      courtSize: '5x5',
      notes: '   ',
    })

    expect(venueCreateMock).toHaveBeenCalledWith({
      data: {
        name: 'Tennozu Pitch',
        address: null,
        city: 'Tokyo',
        notes: null,
        url: null,
        courtSize: '5x5',
      },
    })
    expect(revalidateMock).toHaveBeenCalledWith({
      domain: 'admin',
      paths: ['/admin/venues'],
    })
  })

  it('throws when name is empty after trim (validation seam)', async () => {
    await expect(createVenue({ name: '   ' })).rejects.toThrow(/name required/i)
    expect(venueCreateMock).not.toHaveBeenCalled()
  })
})

describe('updateVenue (v1.18.0)', () => {
  it('updates the venue by id with normalized fields', async () => {
    await updateVenue('v-1', {
      name: 'New Name',
      address: 'Renamed St',
      city: null,
      notes: null,
      url: null,
      courtSize: null,
    })

    expect(venueUpdateMock).toHaveBeenCalledWith({
      where: { id: 'v-1' },
      data: {
        name: 'New Name',
        address: 'Renamed St',
        city: null,
        notes: null,
        url: null,
        courtSize: null,
      },
    })
    expect(revalidateMock).toHaveBeenCalledWith({
      domain: 'admin',
      paths: ['/admin/venues'],
    })
  })

  it('throws when name is empty', async () => {
    await expect(updateVenue('v-1', { name: '' })).rejects.toThrow(/name required/i)
    expect(venueUpdateMock).not.toHaveBeenCalled()
  })
})

describe('deleteVenue (v1.18.0)', () => {
  it('blocks delete when any GameWeek still references the venue', async () => {
    gameWeekCountMock.mockResolvedValueOnce(2)
    matchCountMock.mockResolvedValueOnce(0)

    await expect(deleteVenue('v-busy')).rejects.toThrow(/2 matchday\(s\)/)
    expect(venueDeleteMock).not.toHaveBeenCalled()
  })

  it('blocks delete when any Match still references the venue', async () => {
    gameWeekCountMock.mockResolvedValueOnce(0)
    matchCountMock.mockResolvedValueOnce(5)

    await expect(deleteVenue('v-busy')).rejects.toThrow(/5 match\(es\)/)
    expect(venueDeleteMock).not.toHaveBeenCalled()
  })

  it('deletes when no GameWeek or Match references the venue', async () => {
    gameWeekCountMock.mockResolvedValueOnce(0)
    matchCountMock.mockResolvedValueOnce(0)

    await deleteVenue('v-unused')

    expect(venueDeleteMock).toHaveBeenCalledWith({ where: { id: 'v-unused' } })
    expect(revalidateMock).toHaveBeenCalledWith({
      domain: 'admin',
      paths: ['/admin/venues'],
    })
  })
})
