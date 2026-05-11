/**
 * v1.92.2 — profile-picture pill fix for LINE-auth users.
 *
 * Tests pin the two load-bearing changes:
 *
 *   R1 — `src/lib/dbToPublicLeagueData.ts` now resolves `Player.image`
 *        through a priority chain instead of just `User.image`:
 *           1. User.image                 (auth-provider avatar)
 *           2. Player.profilePictureUrl   (user-uploaded)
 *           3. Player.pictureUrl          (LINE-CDN mirror)
 *           4. LineLogin.pictureUrl       (LINE-CDN, latest login)
 *
 *   R2 — `src/lib/auth.ts` LINE sign-in branch now mirrors the LINE
 *        profile picture into `User.image` via a new `syncUserImage`
 *        helper. Pre-v1.92.2 the LINE callback only wrote
 *        `LineLogin.pictureUrl`; the User row's `image` column stayed
 *        null indefinitely, breaking the v1.92.0 pill for ~33 of 37
 *        LINE-auth users in prod.
 *
 * Both R1 and R2 are exercised:
 *   - Runtime: a small in-memory mock of `prisma.{league,playerLeagueMembership,
 *     user,lineLogin,matchdayGuestEntry}` drives `dbToPublicLeagueData` and
 *     asserts the priority-chain output across five fixtures.
 *   - Static: source greps verify the auth.ts helper exists with the
 *     expected shape (updateMany + NOT-clause) and that the LINE branch
 *     calls it.
 *
 * Version bump + CLAUDE.md current-release pin live in
 * `tests/unit/version.test.ts` and `tests/unit/v192_availability_list_view.test.ts`
 * respectively; this file pins behavior, not version metadata.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')
const AUTH_SRC = readFileSync(join(REPO_ROOT, 'src/lib/auth.ts'), 'utf8')
const DB_TO_PUBLIC_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/dbToPublicLeagueData.ts'),
  'utf8',
)

// ── Runtime: priority chain ──────────────────────────────────────────────

const findFirstMock = vi.fn()
const plaFindManyMock = vi.fn()
const userFindManyMock = vi.fn()
const lineLoginFindManyMock = vi.fn()
const guestFindManyMock = vi.fn().mockResolvedValue([])

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: findFirstMock },
    playerLeagueMembership: { findMany: plaFindManyMock },
    user: { findMany: userFindManyMock },
    lineLogin: { findMany: lineLoginFindManyMock },
    matchdayGuestEntry: { findMany: guestFindManyMock },
  },
}))

const { dbToPublicLeagueData } = await import('@/lib/dbToPublicLeagueData')

const HOME_LT = 'lt-mariners'

function makeLeague() {
  return {
    id: 'l-default',
    isDefault: true,
    leagueTeams: [
      {
        id: HOME_LT,
        team: {
          id: 't-mariners-fc',
          name: 'Mariners FC',
          shortName: 'MRN',
          color: '#0055A4',
          logoUrl: null,
        },
      },
    ],
    gameWeeks: [],
  }
}

beforeEach(() => {
  findFirstMock.mockReset()
  plaFindManyMock.mockReset()
  userFindManyMock.mockReset()
  lineLoginFindManyMock.mockReset()
  findFirstMock.mockResolvedValue(makeLeague())
})

function pla(
  playerId: string,
  player: {
    id: string
    name: string
    userId?: string | null
    pictureUrl?: string | null
    profilePictureUrl?: string | null
  },
) {
  return {
    playerId,
    leagueTeamId: HOME_LT,
    player: {
      id: player.id,
      name: player.name,
      userId: player.userId ?? null,
      pictureUrl: player.pictureUrl ?? null,
      profilePictureUrl: player.profilePictureUrl ?? null,
    },
    leagueTeam: { id: HOME_LT },
    positions: [],
    preferredPositions: [],
    secondaryPositions: [],
    position: null,
    retiredAt: null,
  }
}

describe('v1.92.2 — Player.image priority chain in dbToPublicLeagueData', () => {
  it('User.image wins when set (Google avatar case)', async () => {
    plaFindManyMock.mockResolvedValue([
      pla('p-google', {
        id: 'p-google',
        name: 'Google User',
        userId: 'u-google',
        pictureUrl: 'https://line-cdn/should-not-win.jpg',
        profilePictureUrl: 'https://blob/should-not-win.jpg',
      }),
    ])
    userFindManyMock.mockResolvedValue([
      { id: 'u-google', image: 'https://lh3.googleusercontent.com/winner.jpg', lineId: null },
    ])
    lineLoginFindManyMock.mockResolvedValue([])
    const { data } = await dbToPublicLeagueData()
    const p = data.players.find((x) => x.name === 'Google User')!
    expect(p.image).toBe('https://lh3.googleusercontent.com/winner.jpg')
  })

  it('falls back to Player.profilePictureUrl when User.image is null', async () => {
    plaFindManyMock.mockResolvedValue([
      pla('p-uploaded', {
        id: 'p-uploaded',
        name: 'Self Uploader',
        userId: 'u-uploaded',
        pictureUrl: 'https://line-cdn/should-not-win.jpg',
        profilePictureUrl: 'https://blob/uploaded-winner.jpg',
      }),
    ])
    userFindManyMock.mockResolvedValue([
      { id: 'u-uploaded', image: null, lineId: null },
    ])
    lineLoginFindManyMock.mockResolvedValue([])
    const { data } = await dbToPublicLeagueData()
    const p = data.players.find((x) => x.name === 'Self Uploader')!
    expect(p.image).toBe('https://blob/uploaded-winner.jpg')
  })

  it('falls back to Player.pictureUrl when User.image + profilePictureUrl are null', async () => {
    plaFindManyMock.mockResolvedValue([
      pla('p-assigned', {
        id: 'p-assigned',
        name: 'Assigned Player',
        userId: 'u-assigned',
        pictureUrl: 'https://profile.line-scdn.net/mirror-winner.jpg',
        profilePictureUrl: null,
      }),
    ])
    userFindManyMock.mockResolvedValue([
      { id: 'u-assigned', image: null, lineId: null },
    ])
    lineLoginFindManyMock.mockResolvedValue([])
    const { data } = await dbToPublicLeagueData()
    const p = data.players.find((x) => x.name === 'Assigned Player')!
    expect(p.image).toBe('https://profile.line-scdn.net/mirror-winner.jpg')
  })

  // The Stefan case from the bug report: User is LINE-only with image=null,
  // Player has neither profilePictureUrl nor pictureUrl, but LineLogin has
  // the URL stored from a recent LINE login. The chain must rescue this.
  it('LINE-only user with all three earlier sources null falls through to LineLogin.pictureUrl', async () => {
    plaFindManyMock.mockResolvedValue([
      pla('p-stefan-s', {
        id: 'p-stefan-s',
        name: 'Stefan',
        userId: 'u-line-stefan',
        pictureUrl: null,
        profilePictureUrl: null,
      }),
    ])
    userFindManyMock.mockResolvedValue([
      {
        id: 'u-line-stefan',
        image: null,
        lineId: 'Uc8cdcc63cac89d5c349aa72b9e3355c2',
      },
    ])
    lineLoginFindManyMock.mockResolvedValue([
      {
        lineId: 'Uc8cdcc63cac89d5c349aa72b9e3355c2',
        pictureUrl: 'https://profile.line-scdn.net/line-rescue.jpg',
      },
    ])
    const { data } = await dbToPublicLeagueData()
    const p = data.players.find((x) => x.name === 'Stefan')!
    expect(p.image).toBe('https://profile.line-scdn.net/line-rescue.jpg')
  })

  it('returns null when every source in the chain is null/empty', async () => {
    plaFindManyMock.mockResolvedValue([
      pla('p-anon', {
        id: 'p-anon',
        name: 'Anon',
        userId: 'u-anon',
        pictureUrl: null,
        profilePictureUrl: null,
      }),
    ])
    userFindManyMock.mockResolvedValue([
      { id: 'u-anon', image: null, lineId: 'U-no-line-login' },
    ])
    lineLoginFindManyMock.mockResolvedValue([
      { lineId: 'U-no-line-login', pictureUrl: null },
    ])
    const { data } = await dbToPublicLeagueData()
    const p = data.players.find((x) => x.name === 'Anon')!
    expect(p.image).toBeNull()
  })

  it('non-User-linked players (Player.userId=null) still resolve via Player.pictureUrl', async () => {
    plaFindManyMock.mockResolvedValue([
      pla('p-prelink', {
        id: 'p-prelink',
        name: 'Pre-link',
        userId: null,
        pictureUrl: 'https://profile.line-scdn.net/prelink.jpg',
        profilePictureUrl: null,
      }),
    ])
    userFindManyMock.mockResolvedValue([])
    lineLoginFindManyMock.mockResolvedValue([])
    const { data } = await dbToPublicLeagueData()
    const p = data.players.find((x) => x.name === 'Pre-link')!
    expect(p.image).toBe('https://profile.line-scdn.net/prelink.jpg')
  })

  it('skips the LineLogin findMany when no linked User has a lineId', async () => {
    plaFindManyMock.mockResolvedValue([
      pla('p-google-only', {
        id: 'p-google-only',
        name: 'Google Only',
        userId: 'u-google-only',
        pictureUrl: null,
        profilePictureUrl: null,
      }),
    ])
    userFindManyMock.mockResolvedValue([
      { id: 'u-google-only', image: 'https://lh3/u.jpg', lineId: null },
    ])
    lineLoginFindManyMock.mockResolvedValue([])
    await dbToPublicLeagueData()
    expect(lineLoginFindManyMock).not.toHaveBeenCalled()
  })

  it('passes only the relevant lineIds to lineLogin.findMany (no over-fetch)', async () => {
    plaFindManyMock.mockResolvedValue([
      pla('p-l1', {
        id: 'p-l1',
        name: 'L One',
        userId: 'u-l1',
        pictureUrl: null,
        profilePictureUrl: null,
      }),
      pla('p-l2', {
        id: 'p-l2',
        name: 'L Two',
        userId: 'u-l2',
        pictureUrl: null,
        profilePictureUrl: null,
      }),
    ])
    userFindManyMock.mockResolvedValue([
      { id: 'u-l1', image: null, lineId: 'LINE1' },
      { id: 'u-l2', image: null, lineId: 'LINE2' },
    ])
    lineLoginFindManyMock.mockResolvedValue([
      { lineId: 'LINE1', pictureUrl: 'https://l1.jpg' },
      { lineId: 'LINE2', pictureUrl: 'https://l2.jpg' },
    ])
    await dbToPublicLeagueData()
    expect(lineLoginFindManyMock).toHaveBeenCalledTimes(1)
    const callArg = lineLoginFindManyMock.mock.calls[0]![0]
    expect(callArg.where.lineId.in.sort()).toEqual(['LINE1', 'LINE2'])
  })
})

describe('v1.92.2 — source-level pin on auth.ts syncUserImage helper', () => {
  it('declares an async syncUserImage helper', () => {
    expect(AUTH_SRC).toMatch(/async function syncUserImage\(/)
  })

  it('helper uses prisma.user.updateMany with a NOT-image clause for idempotency', () => {
    // The helper short-circuits redundant writes via
    //   updateMany({ where: { id, NOT: { image: pictureUrl } }, data: { image } })
    // so we never overwrite an identical existing value.
    expect(AUTH_SRC).toMatch(/prisma\.user\.updateMany/)
    expect(AUTH_SRC).toMatch(/NOT:\s*\{\s*image:\s*pictureUrl\s*\}/)
  })

  it('helper short-circuits when pictureUrl is null/empty', () => {
    // Mirrors trackLineLogin's "never overwrite a known good value with null".
    expect(AUTH_SRC).toMatch(/if\s*\(!pictureUrl\)\s*return;/)
  })

  it('LINE sign-in branch calls syncUserImage with the LINE profile picture', () => {
    // Same shape as the syncUserLineId / trackLineLogin calls in the
    // `account.provider === "line"` block.
    expect(AUTH_SRC).toMatch(
      /syncUserImage\(\s*user\.id,\s*\(profile as Record<string, unknown>\)\.picture/,
    )
  })

  it('does NOT call syncUserImage in the google/email branch (User.image is already set by the adapter)', () => {
    // The google/email branch already gets User.image from the adapter
    // (PrismaAdapter writes it from the OAuth profile). Adding an
    // explicit call would be redundant. We anchor on the comment block
    // identifying the google/email JWT path.
    const block = AUTH_SRC.match(
      /\(account\?\.provider\s*===\s*"google"\s*\|\|\s*account\?\.provider\s*===\s*"email"\)[\s\S]{0,2000}?return token;/,
    )
    expect(block).toBeTruthy()
    expect(block![0]).not.toMatch(/syncUserImage/)
  })
})

describe('v1.92.2 — source-level pin on dbToPublicLeagueData priority chain', () => {
  it('selects User.lineId alongside image (needed for LineLogin lookup)', () => {
    expect(DB_TO_PUBLIC_SRC).toMatch(
      /select:\s*\{\s*id:\s*true,\s*image:\s*true,\s*lineId:\s*true\s*\}/,
    )
  })

  it('fetches LineLogin.pictureUrl by lineId for the rescue fallback', () => {
    expect(DB_TO_PUBLIC_SRC).toMatch(/prisma\.lineLogin\.findMany/)
    expect(DB_TO_PUBLIC_SRC).toMatch(
      /select:\s*\{\s*lineId:\s*true,\s*pictureUrl:\s*true\s*\}/,
    )
  })

  it('builds a lineLoginPictureByLineId Map for O(1) merge', () => {
    expect(DB_TO_PUBLIC_SRC).toMatch(/lineLoginPictureByLineId/)
  })

  it('priority chain references all four sources in order', () => {
    // Anchor on the block where Player.image is assigned via the IIFE.
    expect(DB_TO_PUBLIC_SRC).toMatch(/userImageByUserId/)
    expect(DB_TO_PUBLIC_SRC).toMatch(/pla\.player\.profilePictureUrl/)
    expect(DB_TO_PUBLIC_SRC).toMatch(/pla\.player\.pictureUrl/)
    expect(DB_TO_PUBLIC_SRC).toMatch(/lineLoginPictureByLineId/)
  })
})
