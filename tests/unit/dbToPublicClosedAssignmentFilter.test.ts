/**
 * v2.4.2 — closed PlayerLeagueAssignment rows (toGameWeek IS NOT NULL) must
 * not appear in the public squad list.
 *
 * Root cause: the Prisma query in `dbToPublicLeagueData` lacked a
 * `toGameWeek: null` filter. Players who changed teams mid-season had two
 * PLM rows (old team with toGameWeek set, new team with toGameWeek=null) and
 * appeared on BOTH squad lists simultaneously.
 *
 * Pins:
 *   1. `prisma.playerLeagueMembership.findMany` is called with
 *      `where: { toGameWeek: null, ... }` — the fix is structural.
 *   2. A player with a closed Fenix FC row and an active Hygge SC row
 *      appears only once in `data.players`, on Hygge SC.
 *   3. A player with only a single active row still appears normally.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

const findFirstMock = vi.fn()
const plaFindManyMock = vi.fn()
const guestFindManyMock = vi.fn().mockResolvedValue([])

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: findFirstMock },
    playerLeagueMembership: { findMany: plaFindManyMock },
    matchdayGuest: { findMany: guestFindManyMock },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    lineLogin: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))

const { dbToPublicLeagueData } = await import('@/lib/dbToPublicLeagueData')

const LT_FENIX = 'lt-minato-2025-fenix-fc'
const LT_HYGGE = 'lt-minato-2025-hygge-sc'

function makeLeague() {
  return {
    id: 'l-minato-2025',
    isDefault: true,
    leagueTeams: [
      { id: LT_FENIX, team: { id: 't-fenix-fc', name: 'Fenix FC', shortName: 'FEN', color: '#FFD700', logoUrl: null } },
      { id: LT_HYGGE, team: { id: 't-hygge-sc', name: 'Hygge SC', shortName: 'HSC', color: '#DC143C', logoUrl: null } },
    ],
    gameWeeks: [],
  }
}

function makePla(overrides: {
  id: string
  playerId: string
  leagueTeamId: string
  toGameWeek: number | null
  name: string
}) {
  return {
    id: overrides.id,
    playerId: overrides.playerId,
    leagueTeamId: overrides.leagueTeamId,
    toGameWeek: overrides.toGameWeek,
    fromGameWeek: 1,
    position: null,
    positions: [],
    preferredPositions: [],
    secondaryPositions: [],
    retiredAt: null,
    player: {
      id: overrides.playerId,
      name: overrides.name,
      pictureUrl: null,
      profilePictureUrl: null,
      userId: null,
    },
    leagueTeam: { id: overrides.leagueTeamId },
  }
}

beforeEach(() => {
  findFirstMock.mockReset()
  plaFindManyMock.mockReset()
  guestFindManyMock.mockResolvedValue([])
})

describe('dbToPublicLeagueData — closed assignment filter (v2.4.2)', () => {
  it('passes toGameWeek: null in the Prisma WHERE clause', async () => {
    findFirstMock.mockResolvedValue(makeLeague())
    plaFindManyMock.mockResolvedValue([])
    await dbToPublicLeagueData()
    expect(plaFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ toGameWeek: null }),
      }),
    )
  })

  it('player with active Hygge SC row and closed Fenix FC row appears only on Hygge SC', async () => {
    findFirstMock.mockResolvedValue(makeLeague())
    // Simulates what the DB returns AFTER the fix: only the active row
    // (toGameWeek=null) because the closed one is filtered at query time.
    plaFindManyMock.mockResolvedValue([
      makePla({ id: 'pla-hygge', playerId: 'p-ben-lee', leagueTeamId: LT_HYGGE, toGameWeek: null, name: 'Ben Lee' }),
    ])
    const { data } = await dbToPublicLeagueData()
    const benLeeEntries = data.players.filter((p) => p.id === 'ben-lee')
    expect(benLeeEntries).toHaveLength(1)
    expect(benLeeEntries[0].teamId).toBe('hygge-sc')
  })

  it('player with only an active row still appears normally', async () => {
    findFirstMock.mockResolvedValue(makeLeague())
    plaFindManyMock.mockResolvedValue([
      makePla({ id: 'pla-stefan', playerId: 'p-stefan', leagueTeamId: LT_FENIX, toGameWeek: null, name: 'Stefan S' }),
    ])
    const { data } = await dbToPublicLeagueData()
    expect(data.players).toHaveLength(1)
    expect(data.players[0].teamId).toBe('fenix-fc')
  })
})
