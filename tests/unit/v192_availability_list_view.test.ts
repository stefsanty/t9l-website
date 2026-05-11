/**
 * v1.92.0 — PlayerAvailability list-view refresh.
 *
 * Tests pin the load-bearing behavior:
 *
 *   1. APP_VERSION bumped to 1.92.0; CLAUDE.md header lists v1.92.0.
 *   2. `getPositionBucketByScore` (new helper in src/lib/positions.ts)
 *      passes the five worked examples from the product brief plus
 *      every boundary + empty-array + GK-short-circuit edge case.
 *   3. `bucketConfirmedPlayers` (MatchdayAvailability) uses the new
 *      helper — players with preferredPositions=[CB,CM,ST] land in
 *      Midfield, not Defense (which positions[0]=CB would have
 *      produced under the old rule).
 *   4. Empty preferredPositions array → 'UNB' bucket, not 'MF'.
 *   5. `playerInitials` produces correct initials for two-token,
 *      one-token, multi-token, and null/empty names.
 *   6. Type: `Player.image?: string | null` exists in src/types/index.ts.
 *   7. dbToPublicLeagueData populates `image` from the linked User and
 *      threads `user: { select: { image: true } }` in the prisma include.
 *   8. The list-view pill renders a PlayerPillAvatar for non-guest
 *      players (data-testids `availability-pill-avatar` /
 *      `availability-pill-avatar-initials`) and explicitly NOT for
 *      guest pseudo-players.
 *   9. PlayerAvailability tsx now imports getPositionBucketByScore.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getPositionBucketByScore,
  type ScoreBucket,
} from '@/lib/positions'
import {
  bucketConfirmedPlayers,
  playerInitials,
  BUCKET_LABEL,
  BUCKET_DOT,
} from '@/components/MatchdayAvailability'
import { synthesizeGuestPlayers } from '@/lib/guestSynthesis'
import type { Player } from '@/types'

const REPO_ROOT = join(__dirname, '..', '..')
const VERSION_SRC = readFileSync(join(REPO_ROOT, 'src/lib/version.ts'), 'utf8')
const CLAUDE_MD = readFileSync(join(REPO_ROOT, 'CLAUDE.md'), 'utf8')
const TYPES_SRC = readFileSync(join(REPO_ROOT, 'src/types/index.ts'), 'utf8')
const DB_TO_PUBLIC_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/dbToPublicLeagueData.ts'),
  'utf8',
)
const AVAILABILITY_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/MatchdayAvailability.tsx'),
  'utf8',
)

describe('v1.92.0 — version bump', () => {
  it('APP_VERSION is 1.92.2', () => {
    expect(VERSION_SRC).toMatch(/APP_VERSION\s*=\s*'1\.92\.2'/)
  })

  it('CLAUDE.md current-release header lists v1.92.2', () => {
    expect(CLAUDE_MD).toMatch(/Current release.*v?1\.92\.2/i)
  })
})

describe('v1.92.0 — getPositionBucketByScore: worked examples from the brief', () => {
  it('[CB,CM,ST] → avg 3.0 → MF (boundary inclusive lower)', () => {
    expect(getPositionBucketByScore(['CB', 'CM', 'ST'])).toBe<ScoreBucket>('MF')
  })

  it('[CAM,ST,LW] → avg 4.33 → FW', () => {
    expect(getPositionBucketByScore(['CAM', 'ST', 'LW'])).toBe<ScoreBucket>('FW')
  })

  it('[CB,DM] → avg 1.5 → MF (boundary inclusive lower)', () => {
    expect(getPositionBucketByScore(['CB', 'DM'])).toBe<ScoreBucket>('MF')
  })

  it('[GK,CB] → Goalkeepers (short-circuit)', () => {
    expect(getPositionBucketByScore(['GK', 'CB'])).toBe<ScoreBucket>('GK')
  })

  it('[ST] → 5 → FW', () => {
    expect(getPositionBucketByScore(['ST'])).toBe<ScoreBucket>('FW')
  })
})

describe('v1.92.0 — getPositionBucketByScore: edge cases', () => {
  it('empty array → null (unbucketed)', () => {
    expect(getPositionBucketByScore([])).toBe<ScoreBucket>(null)
  })

  it('null input → null', () => {
    expect(getPositionBucketByScore(null)).toBe<ScoreBucket>(null)
  })

  it('undefined input → null', () => {
    expect(getPositionBucketByScore(undefined)).toBe<ScoreBucket>(null)
  })

  it('all-empty-string input → null', () => {
    expect(getPositionBucketByScore(['', '   '])).toBe<ScoreBucket>(null)
  })

  it('all-unknown-codes input → null (not 0-default)', () => {
    expect(getPositionBucketByScore(['NOT_A_CODE'])).toBe<ScoreBucket>(null)
  })

  it('case-insensitive: ["cb","cm","st"] → MF', () => {
    expect(getPositionBucketByScore(['cb', 'cm', 'st'])).toBe<ScoreBucket>('MF')
  })

  it('LB alone → 1 → DF (below 1.5 boundary)', () => {
    expect(getPositionBucketByScore(['LB'])).toBe<ScoreBucket>('DF')
  })

  it('CB+LB → avg 1.0 → DF', () => {
    expect(getPositionBucketByScore(['CB', 'LB'])).toBe<ScoreBucket>('DF')
  })

  it('CAM+LW → avg 4.0 → FW', () => {
    expect(getPositionBucketByScore(['CAM', 'LW'])).toBe<ScoreBucket>('FW')
  })

  it('GK alone → GK', () => {
    expect(getPositionBucketByScore(['GK'])).toBe<ScoreBucket>('GK')
  })

  it('GK as second entry still short-circuits → GK', () => {
    expect(getPositionBucketByScore(['ST', 'GK'])).toBe<ScoreBucket>('GK')
  })

  it('futsal FIXO+ALA → avg 2.0 → MF', () => {
    expect(getPositionBucketByScore(['FIXO', 'ALA'])).toBe<ScoreBucket>('MF')
  })

  it('futsal ALA+PIVOT → avg 4.0 → FW', () => {
    expect(getPositionBucketByScore(['ALA', 'PIVOT'])).toBe<ScoreBucket>('FW')
  })

  it('futsal PIVOT → 5 → FW', () => {
    expect(getPositionBucketByScore(['PIVOT'])).toBe<ScoreBucket>('FW')
  })

  it('mixed-known-unknown drops unknown rather than scoring 0: [CB, NOT_A_CODE] → 1 → DF', () => {
    expect(getPositionBucketByScore(['CB', 'NOT_A_CODE'])).toBe<ScoreBucket>('DF')
  })
})

describe('v1.92.0 — bucketConfirmedPlayers (MatchdayAvailability) uses score-based bucket', () => {
  function mkPlayer(overrides: Partial<Player> & { id: string; name: string }): Player {
    return {
      id: overrides.id,
      name: overrides.name,
      teamId: 't',
      position: overrides.position ?? null,
      preferredPositions: overrides.preferredPositions,
      secondaryPositions: overrides.secondaryPositions,
      picture: overrides.picture ?? null,
      image: overrides.image ?? null,
      retiredAt: overrides.retiredAt ?? null,
    }
  }

  it('CB+CM+ST player lands in Midfield, not Defense (post-v1.92.0 score rule)', () => {
    const p = mkPlayer({
      id: 'p1',
      name: 'Alex',
      preferredPositions: ['CB', 'CM', 'ST'],
      position: 'CB/CM/ST',
    })
    const groups = bucketConfirmedPlayers(['p1'], [p])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.bucket).toBe('MF')
  })

  it('empty preferredPositions → UNB bucket (not silently MF)', () => {
    const p = mkPlayer({
      id: 'p1',
      name: 'Bob',
      preferredPositions: [],
      position: null,
    })
    const groups = bucketConfirmedPlayers(['p1'], [p])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.bucket).toBe('UNB')
  })

  it('falls back to splitting `position` when preferredPositions is undefined (legacy memberships)', () => {
    const p = mkPlayer({
      id: 'p1',
      name: 'Casey',
      preferredPositions: undefined,
      position: 'CB/CM/ST',
    })
    const groups = bucketConfirmedPlayers(['p1'], [p])
    expect(groups[0]!.bucket).toBe('MF')
  })

  it('GK player lands in Goalkeepers regardless of other preferred entries', () => {
    const p = mkPlayer({ id: 'p1', name: 'Dee', preferredPositions: ['GK', 'CB'] })
    const groups = bucketConfirmedPlayers(['p1'], [p])
    expect(groups[0]!.bucket).toBe('GK')
  })

  it('guest pseudo-players land in GUEST bucket, never UNB even though they have no positions', () => {
    const real = mkPlayer({ id: 'p1', name: 'Real', preferredPositions: ['ST'] })
    const [guest] = synthesizeGuestPlayers('t', 1)
    const groups = bucketConfirmedPlayers([real.id, guest!.id], [real, guest!])
    const buckets = groups.map((g) => g.bucket)
    expect(buckets).toContain('FW')
    expect(buckets).toContain('GUEST')
    expect(buckets).not.toContain('UNB')
  })

  it('bucket-order in output respects GK→DF→MF→FW→UNB→GUEST', () => {
    const players: Player[] = [
      mkPlayer({ id: 'fw', name: 'F', preferredPositions: ['ST'] }),
      mkPlayer({ id: 'df', name: 'D', preferredPositions: ['CB'] }),
      mkPlayer({ id: 'gk', name: 'G', preferredPositions: ['GK'] }),
      mkPlayer({ id: 'mf', name: 'M', preferredPositions: ['CM'] }),
      mkPlayer({ id: 'unb', name: 'U', preferredPositions: [], position: null }),
    ]
    const [guest] = synthesizeGuestPlayers('t', 1)
    players.push(guest!)
    const groups = bucketConfirmedPlayers(
      players.map((p) => p.id),
      players,
    )
    expect(groups.map((g) => g.bucket)).toEqual(['GK', 'DF', 'MF', 'FW', 'UNB', 'GUEST'])
  })

  it('BUCKET_LABEL["UNB"] is "Other" (renders as a human-readable section)', () => {
    expect(BUCKET_LABEL.UNB).toBe('Other')
  })

  it('BUCKET_DOT["UNB"] exists (renders a muted dot, not a missing class)', () => {
    expect(BUCKET_DOT.UNB).toBeTruthy()
  })
})

describe('v1.92.0 — playerInitials helper', () => {
  it('two-token name → first letter of each: "Stefan Santos" → "SS"', () => {
    expect(playerInitials('Stefan Santos')).toBe('SS')
  })

  it('three-token name → first + last: "Maria del Carmen" → "MC"', () => {
    expect(playerInitials('Maria del Carmen')).toBe('MC')
  })

  it('single-token name → single letter: "Madonna" → "M"', () => {
    expect(playerInitials('Madonna')).toBe('M')
  })

  it('null name → "?"', () => {
    expect(playerInitials(null)).toBe('?')
  })

  it('undefined name → "?"', () => {
    expect(playerInitials(undefined)).toBe('?')
  })

  it('empty string → "?"', () => {
    expect(playerInitials('')).toBe('?')
  })

  it('whitespace-only string → "?"', () => {
    expect(playerInitials('   ')).toBe('?')
  })

  it('lowercase name uppercases the initials', () => {
    expect(playerInitials('alex chen')).toBe('AC')
  })

  it('extra internal whitespace collapses cleanly', () => {
    expect(playerInitials('Stefan    Santos')).toBe('SS')
  })
})

describe('v1.92.0 — Player.image threaded through types + db adapter', () => {
  it('Player type declares image?: string | null', () => {
    expect(TYPES_SRC).toMatch(/image\?:\s*string\s*\|\s*null/)
  })

  it('dbToPublicLeagueData fetches User.image via prisma.user.findMany (no @relation on Player → User)', () => {
    expect(DB_TO_PUBLIC_SRC).toMatch(/prisma\.user\.findMany/)
    expect(DB_TO_PUBLIC_SRC).toMatch(/image:\s*true/)
  })

  it('dbToPublicLeagueData populates image via the userImageByUserId Map', () => {
    // v1.92.2 wrapped the `image` value in an IIFE for the priority
    // chain (User.image → profilePictureUrl → pictureUrl → LineLogin).
    // The userImageByUserId Map is still the leading lookup; assert on
    // its presence + the userId-conditional inside the IIFE.
    expect(DB_TO_PUBLIC_SRC).toMatch(/userImageByUserId/)
    expect(DB_TO_PUBLIC_SRC).toMatch(/pla\.player\.userId/)
  })
})

describe('v1.92.0 — list-view pill renders avatar (and skips for guests)', () => {
  it('imports getPositionBucketByScore', () => {
    expect(AVAILABILITY_SRC).toMatch(/getPositionBucketByScore/)
  })

  it('renders PlayerPillAvatar for non-guest pills (gated on `!isGuest`)', () => {
    expect(AVAILABILITY_SRC).toMatch(/!isGuest\s*&&\s*<PlayerPillAvatar/)
  })

  it('has data-testid="availability-pill-avatar" for the image branch', () => {
    expect(AVAILABILITY_SRC).toMatch(/data-testid="availability-pill-avatar"/)
  })

  it('has data-testid="availability-pill-avatar-initials" for the fallback branch', () => {
    expect(AVAILABILITY_SRC).toMatch(/data-testid="availability-pill-avatar-initials"/)
  })

  it('PlayerPillAvatar takes src + name props', () => {
    expect(AVAILABILITY_SRC).toMatch(/function PlayerPillAvatar\([\s\S]*?src[\s\S]*?name/)
  })

  it('pill layout uses inline-flex items-center gap-1.5 for avatar+pill+name alignment', () => {
    expect(AVAILABILITY_SRC).toMatch(/inline-flex items-center gap-1\.5/)
  })

  it('synthesised guest players have image: undefined (no avatar rendered)', () => {
    const [guest] = synthesizeGuestPlayers('t', 1)
    expect(guest!.image).toBeUndefined()
  })
})
