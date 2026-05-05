/**
 * v1.61.0 — `getLinkedPlayerIds` is extended to consider `Player.userId`
 * (in addition to `Player.lineId`) so non-LINE flows (Google / email)
 * see linked players filtered too. Pre-v1.61.0 the picker was LINE-keyed
 * end-to-end so the filter only checked `Player.lineId`.
 *
 * The viewer-exclusion seam now accepts both `lineId` and `userId` so a
 * non-LINE viewer can still see and re-confirm / unassign their OWN
 * player (which is bound via `Player.userId @unique` for them).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    player: {
      findMany: vi.fn(),
    },
  },
}))

import { getLinkedPlayerIds } from '@/lib/linkedPlayers'
import { prisma } from '@/lib/prisma'

const findMany = prisma.player.findMany as unknown as ReturnType<typeof vi.fn>

describe('getLinkedPlayerIds — v1.61.0', () => {
  beforeEach(() => {
    findMany.mockReset()
  })

  it('queries with OR: lineId NOT NULL OR userId NOT NULL (v1.61.0 extension)', async () => {
    findMany.mockResolvedValue([])
    await getLinkedPlayerIds(null)
    expect(findMany).toHaveBeenCalledTimes(1)
    const args = findMany.mock.calls[0][0]
    expect(args.where).toMatchObject({
      OR: [{ lineId: { not: null } }, { userId: { not: null } }],
    })
    // No NOT clause when the viewer is unauthenticated — they have no
    // own-player to exclude.
    expect(args.where.NOT).toBeUndefined()
  })

  it('excludes viewer.lineId when supplied (LINE viewer)', async () => {
    findMany.mockResolvedValue([])
    await getLinkedPlayerIds({ lineId: 'U_stefan', userId: null })
    const args = findMany.mock.calls[0][0]
    expect(args.where.NOT).toEqual([{ lineId: 'U_stefan' }])
  })

  it('excludes viewer.userId when supplied (non-LINE viewer)', async () => {
    findMany.mockResolvedValue([])
    await getLinkedPlayerIds({ lineId: null, userId: 'user-google-123' })
    const args = findMany.mock.calls[0][0]
    expect(args.where.NOT).toEqual([{ userId: 'user-google-123' }])
  })

  it('excludes BOTH viewer.lineId AND viewer.userId when both supplied', async () => {
    findMany.mockResolvedValue([])
    await getLinkedPlayerIds({ lineId: 'U_stefan', userId: 'user-stefan' })
    const args = findMany.mock.calls[0][0]
    expect(args.where.NOT).toEqual([
      { lineId: 'U_stefan' },
      { userId: 'user-stefan' },
    ])
  })

  it('strips the "p-" prefix and returns public-side slugs', async () => {
    findMany.mockResolvedValue([
      { id: 'p-stefan-s' },
      { id: 'p-ian-noseda' },
    ])
    const result = await getLinkedPlayerIds(null)
    expect(result).toEqual(new Set(['stefan-s', 'ian-noseda']))
  })

  it('returns empty Set on Prisma rejection (defensive — never crash the picker)', async () => {
    findMany.mockRejectedValue(new Error('connection failed'))
    const result = await getLinkedPlayerIds({ lineId: 'U_stefan', userId: null })
    expect(result).toEqual(new Set())
  })

  it('selects only id (no over-fetching)', async () => {
    findMany.mockResolvedValue([])
    await getLinkedPlayerIds(null)
    const args = findMany.mock.calls[0][0]
    expect(args.select).toEqual({ id: true })
  })
})
