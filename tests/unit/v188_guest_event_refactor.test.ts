/**
 * v1.88.0 — refactor "Guest" from a per-team pseudo-Player on the
 * roster to an event-level concept on MatchEvent.
 *
 * Tests pin the load-bearing behavior:
 *
 *   1. APP_VERSION bumped to 1.88.0.
 *   2. Schema: MatchEvent.scorerId is nullable; MatchEvent.isGuestScorer
 *      and MatchEvent.isGuestAssister are Boolean @default(false);
 *      `scorer` relation widened to `Player?`.
 *   3. Migration file exists at the expected path with the additive
 *      schema deltas + UPDATE backfills, and contains NO `DELETE FROM`
 *      (per docs/migration-sql-lessons.md checklist; destructive
 *      cleanup lives in scripts/v188CleanupGuestPseudoPlayers.ts).
 *   4. Admin server actions (adminCreateMatchEvent / adminUpdateMatchEvent)
 *      accept isGuestScorer + isGuestAssister and enforce the XOR shape
 *      (guest flag set ⇒ id null + beneficiaryTeamId required).
 *   5. Player server action (submitOwnMatchEvent) accepts isGuestScorer
 *      + isGuestAssister and enforces the same XOR.
 *   6. computeScoreFromEvents handles `scorerId: null` for guest events,
 *      using the explicit beneficiaryTeamId. (Guest goal increments the
 *      beneficiary team's tally; guest OG increments the OPPOSING team's
 *      tally because beneficiaryTeamId is set to the opposing team at
 *      write time.)
 *   7. buildScorerStatsFromEvents in StatsTab does NOT credit guest
 *      events to any individual leaderboard row — guest goal/assist
 *      doesn't inflate any player's stats.
 *   8. dbToPublicLeagueData surfaces `Guest` as the scorer/assister
 *      label for guest events, and filters Guest pseudo-Players from
 *      the public Squad list (covers both legacy `p-guest` and
 *      per-team `p-guest-<lt-id>`).
 *   9. Cleanup script exists with --dry-run default and --apply gates.
 *  10. CLAUDE.md current-release header lists v1.88.0.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  computeScoreFromEvents,
  type EventForScore,
} from '@/lib/matchScore'
import { buildScorerStatsFromEvents } from '@/components/admin/StatsTab'

const REPO_ROOT = join(__dirname, '..', '..')
const SCHEMA = readFileSync(join(REPO_ROOT, 'prisma/schema.prisma'), 'utf8')
const MIGRATION_DIR = 'prisma/migrations/20260519000000_match_event_guest_flags'
const MIGRATION = readFileSync(
  join(REPO_ROOT, MIGRATION_DIR, 'migration.sql'),
  'utf8',
)
const VERSION_SRC = readFileSync(join(REPO_ROOT, 'src/lib/version.ts'), 'utf8')
const CLAUDE_MD = readFileSync(join(REPO_ROOT, 'CLAUDE.md'), 'utf8')
const ADMIN_ACTIONS_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/admin/leagues/actions.ts'),
  'utf8',
)
const PLAYER_ACTION_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/matchday/[id]/actions.ts'),
  'utf8',
)
const STATS_TAB_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/admin/StatsTab.tsx'),
  'utf8',
)
const SUBMIT_FORM_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/matchday/SubmitGoalForm.tsx'),
  'utf8',
)
const DB_TO_PUBLIC_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/dbToPublicLeagueData.ts'),
  'utf8',
)
const CLEANUP_SCRIPT_PATH = join(
  REPO_ROOT,
  'scripts/v188CleanupGuestPseudoPlayers.ts',
)

describe('v1.88.0 — version bump', () => {
  // Forward-compat shape (mirrors v1.87.0 pin) — passes for any APP_VERSION
  // ≥ 1.88.0 so subsequent PRs don't have to touch this file just to keep
  // the suite green. The v1.88.0 ship event itself is recorded in the
  // CLAUDE.md ledger.
  it('APP_VERSION is 1.88.0 or higher', () => {
    expect(VERSION_SRC).toMatch(
      /APP_VERSION\s*=\s*['"]1\.(8[8-9]|9\d?)\.\d+['"]/,
    )
  })

  it('CLAUDE.md current-release header lists v1.88.0 or higher', () => {
    expect(CLAUDE_MD).toMatch(
      /\*\*Current release:\*\*\s+v1\.(8[8-9]|9\d?)\.\d+\./,
    )
  })
})

describe('v1.88.0 — schema deltas', () => {
  it('MatchEvent.scorerId is now nullable', () => {
    const block = SCHEMA.match(/model MatchEvent\s*\{[\s\S]+?\n\}/)
    expect(block).toBeTruthy()
    expect(block![0]).toMatch(/scorerId\s+String\?/)
  })

  it('MatchEvent.scorer relation widened to Player?', () => {
    const block = SCHEMA.match(/model MatchEvent\s*\{[\s\S]+?\n\}/)
    expect(block![0]).toMatch(/scorer\s+Player\?\s+@relation\("EventScorer"/)
  })

  it('MatchEvent has isGuestScorer + isGuestAssister booleans defaulting false', () => {
    const block = SCHEMA.match(/model MatchEvent\s*\{[\s\S]+?\n\}/)
    expect(block![0]).toMatch(/isGuestScorer\s+Boolean\s+@default\(false\)/)
    expect(block![0]).toMatch(/isGuestAssister\s+Boolean\s+@default\(false\)/)
  })
})

describe('v1.88.0 — migration shape', () => {
  it('migration directory + migration.sql exist', () => {
    expect(existsSync(join(REPO_ROOT, MIGRATION_DIR, 'migration.sql'))).toBe(true)
  })

  it('adds isGuestScorer + isGuestAssister + drops NOT NULL on scorerId', () => {
    expect(MIGRATION).toMatch(/ADD COLUMN\s+"isGuestScorer"\s+BOOLEAN NOT NULL DEFAULT false/i)
    expect(MIGRATION).toMatch(/ADD COLUMN\s+"isGuestAssister"\s+BOOLEAN NOT NULL DEFAULT false/i)
    expect(MIGRATION).toMatch(/ALTER COLUMN "scorerId" DROP NOT NULL/i)
  })

  it('rebuilds the scorerId FK with ON DELETE SET NULL (Prisma default for nullable)', () => {
    expect(MIGRATION).toMatch(/MatchEvent_scorerId_fkey[\s\S]+?ON DELETE SET NULL/i)
  })

  it('UPDATE backfills use the @@map\'d table name "PlayerLeagueAssignment", not the model name', () => {
    // Per docs/migration-sql-lessons.md post-mortem (v1.86.0 incident).
    expect(MIGRATION).toMatch(/"PlayerLeagueAssignment"/)
    expect(MIGRATION).not.toMatch(/"PlayerLeagueMembership"/)
  })

  it('contains UPDATE backfill flipping guest-scorer events', () => {
    expect(MIGRATION).toMatch(/UPDATE "MatchEvent"[\s\S]+?"scorerId"\s*=\s*NULL,\s*\n\s*"isGuestScorer"\s*=\s*TRUE/i)
  })

  it('contains UPDATE backfill flipping guest-assister events', () => {
    expect(MIGRATION).toMatch(/UPDATE "MatchEvent"[\s\S]+?"assisterId"\s*=\s*NULL,\s*\n\s*"isGuestAssister"\s*=\s*TRUE/i)
  })

  it('contains NO DELETE FROM (per migration-sql-lessons.md checklist; cleanup script handles it)', () => {
    // Strip comments first so the "DELETE FROM ... lives in a separate"
    // commentary doesn't trip the regex.
    const stripped = MIGRATION.split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
    expect(stripped).not.toMatch(/\bDELETE FROM\b/i)
    expect(stripped).not.toMatch(/\bDROP TABLE\b/i)
    expect(stripped).not.toMatch(/\bTRUNCATE\b/i)
  })
})

describe('v1.88.0 — admin server actions accept guest flags + enforce XOR', () => {
  it('adminCreateMatchEvent input accepts isGuestScorer + isGuestAssister', () => {
    expect(ADMIN_ACTIONS_SRC).toMatch(/adminCreateMatchEvent[\s\S]+?isGuestScorer\?\s*:\s*boolean/)
    expect(ADMIN_ACTIONS_SRC).toMatch(/adminCreateMatchEvent[\s\S]+?isGuestAssister\?\s*:\s*boolean/)
  })

  it('adminUpdateMatchEvent input accepts isGuestScorer + isGuestAssister', () => {
    expect(ADMIN_ACTIONS_SRC).toMatch(/adminUpdateMatchEvent[\s\S]+?isGuestScorer\?\s*:\s*boolean/)
    expect(ADMIN_ACTIONS_SRC).toMatch(/adminUpdateMatchEvent[\s\S]+?isGuestAssister\?\s*:\s*boolean/)
  })

  it('rejects scorerId AND isGuestScorer set together (XOR)', () => {
    expect(ADMIN_ACTIONS_SRC).toMatch(/Cannot pass scorerId when isGuestScorer is true/)
  })

  it('rejects neither scorerId nor isGuestScorer set', () => {
    expect(ADMIN_ACTIONS_SRC).toMatch(/scorerId is required \(or set isGuestScorer\)/)
  })

  it('persists isGuestScorer + isGuestAssister flags on matchEvent.create', () => {
    expect(ADMIN_ACTIONS_SRC).toMatch(/tx\.matchEvent\.create\(\{[\s\S]+?isGuestScorer/)
    expect(ADMIN_ACTIONS_SRC).toMatch(/tx\.matchEvent\.create\(\{[\s\S]+?isGuestAssister/)
  })

  it('skips the membership lookup when scorerId is null (guest events)', () => {
    // Old code unconditionally ran `playerLeagueMembership.findFirst`
    // for the scorer; v1.88.0 wraps it in `if (scorerId) { ... }`.
    expect(ADMIN_ACTIONS_SRC).toMatch(
      /if \(scorerId\)\s*\{[\s\S]+?playerLeagueMembership\.findFirst/,
    )
  })
})

describe('v1.88.0 — player server action accepts guest flags', () => {
  it('submitOwnMatchEvent input accepts isGuestScorer + isGuestAssister', () => {
    expect(PLAYER_ACTION_SRC).toMatch(/isGuestScorer\?\s*:\s*boolean/)
    expect(PLAYER_ACTION_SRC).toMatch(/isGuestAssister\?\s*:\s*boolean/)
  })

  it('rejects scorerPlayerSlug AND isGuestScorer set together', () => {
    expect(PLAYER_ACTION_SRC).toMatch(/Cannot pass scorerPlayerSlug when isGuestScorer is true/)
  })

  it('rejects neither scorerPlayerSlug nor isGuestScorer set', () => {
    expect(PLAYER_ACTION_SRC).toMatch(/Scorer is required \(or set isGuestScorer\)/)
  })

  it('persists isGuestScorer + isGuestAssister flags on matchEvent.create', () => {
    expect(PLAYER_ACTION_SRC).toMatch(/tx\.matchEvent\.create\(\{[\s\S]+?isGuestScorer/)
    expect(PLAYER_ACTION_SRC).toMatch(/tx\.matchEvent\.create\(\{[\s\S]+?isGuestAssister/)
  })
})

describe('v1.88.0 — computeScoreFromEvents handles null scorerId', () => {
  const HOME = 'lt-home'
  const AWAY = 'lt-away'

  it('guest goal (scorerId=null) tallies for the explicit beneficiaryTeamId', () => {
    const events: EventForScore[] = [
      {
        scorerId: null,
        goalType: 'OPEN_PLAY',
        beneficiaryTeamId: HOME,
      },
    ]
    expect(computeScoreFromEvents(HOME, AWAY, events, new Map())).toEqual({
      home: 1,
      away: 0,
    })
  })

  it('guest OG (scorerId=null + goalType=OWN_GOAL) tallies per the WRITTEN beneficiary (caller flips)', () => {
    // The write-side flips beneficiary to the OPPOSING team for OG;
    // the recompute trusts whatever it's given. Verify both directions.
    const evHome: EventForScore[] = [
      { scorerId: null, goalType: 'OWN_GOAL', beneficiaryTeamId: HOME },
    ]
    expect(computeScoreFromEvents(HOME, AWAY, evHome, new Map())).toEqual({
      home: 1,
      away: 0,
    })
    const evAway: EventForScore[] = [
      { scorerId: null, goalType: 'OWN_GOAL', beneficiaryTeamId: AWAY },
    ]
    expect(computeScoreFromEvents(HOME, AWAY, evAway, new Map())).toEqual({
      home: 0,
      away: 1,
    })
  })

  it('two guests scoring against each other in the same match works', () => {
    const events: EventForScore[] = [
      { scorerId: null, goalType: 'OPEN_PLAY', beneficiaryTeamId: HOME },
      { scorerId: null, goalType: 'OPEN_PLAY', beneficiaryTeamId: AWAY },
      { scorerId: null, goalType: 'PENALTY', beneficiaryTeamId: HOME },
    ]
    expect(computeScoreFromEvents(HOME, AWAY, events, new Map())).toEqual({
      home: 2,
      away: 1,
    })
  })

  it('guest event with NO beneficiaryTeamId is skipped (no scorer to derive from)', () => {
    const events: EventForScore[] = [
      { scorerId: null, goalType: 'OPEN_PLAY', beneficiaryTeamId: null },
    ]
    expect(computeScoreFromEvents(HOME, AWAY, events, new Map())).toEqual({
      home: 0,
      away: 0,
    })
  })
})

describe('v1.88.0 — buildScorerStatsFromEvents skips guest events', () => {
  // Minimal EventRow stub matching the StatsTab interface.
  function ev(overrides: Record<string, unknown>) {
    return {
      id: 'me-1',
      matchId: 'm-1',
      goalType: 'OPEN_PLAY' as const,
      minute: null,
      scorer: { id: 'p-stefan', name: 'Stefan' },
      isGuestScorer: false,
      assister: { id: 'p-alex', name: 'Alex' },
      isGuestAssister: false,
      beneficiaryTeamId: 'lt-home',
      match: {
        id: 'm-1',
        homeTeamId: 'lt-home',
        awayTeamId: 'lt-away',
        homeTeam: { team: { name: 'Home' } },
        awayTeam: { team: { name: 'Away' } },
        gameWeek: { weekNumber: 1 },
      },
      ...overrides,
    }
  }

  it('a real-scorer goal increments the scorer (and assister) leaderboard rows', () => {
    const stats = buildScorerStatsFromEvents([ev({})], null)
    const stefan = stats.find((s) => s.name === 'Stefan')
    const alex = stats.find((s) => s.name === 'Alex')
    expect(stefan?.goals).toBe(1)
    expect(alex?.assists).toBe(1)
  })

  it('a guest goal does NOT increment any leaderboard row', () => {
    const stats = buildScorerStatsFromEvents(
      [ev({ scorer: null, isGuestScorer: true, assister: null })],
      null,
    )
    expect(stats).toHaveLength(0)
  })

  it('a guest OG also does not credit any leaderboard row (goal type AND guest flag both excluded)', () => {
    const stats = buildScorerStatsFromEvents(
      [ev({ goalType: 'OWN_GOAL', scorer: null, isGuestScorer: true, assister: null })],
      null,
    )
    expect(stats).toHaveLength(0)
  })

  it('a guest assist on a real-scorer goal credits the scorer but NOT the assist (no off-roster assister)', () => {
    const stats = buildScorerStatsFromEvents(
      [ev({ assister: null, isGuestAssister: true })],
      null,
    )
    const stefan = stats.find((s) => s.name === 'Stefan')
    expect(stefan?.goals).toBe(1)
    expect(stefan?.assists).toBe(0)
    // No row materialized for "Guest" (no playerId to key on).
    expect(stats.find((s) => s.name === 'Guest')).toBeUndefined()
  })
})

describe('v1.88.0 — dbToPublicLeagueData filters guest pseudo-players + renders Guest label', () => {
  it('uses isGuestPseudoPlayerId() to filter Squad list (covers per-team p-guest-<lt-id>)', () => {
    expect(DB_TO_PUBLIC_SRC).toMatch(/function isGuestPseudoPlayerId/)
    expect(DB_TO_PUBLIC_SRC).toMatch(/PLAYER_ID_PREFIX.*guest/)
    expect(DB_TO_PUBLIC_SRC).toMatch(/if \(isGuestPseudoPlayerId\(pla\.player\.id\)\) continue/)
  })

  it('renders "Guest" as scorer label when isGuestScorer is true', () => {
    expect(DB_TO_PUBLIC_SRC).toMatch(/ev\.isGuestScorer\s*\n?\s*\?\s*'Guest'/)
  })

  it('renders "Guest" as assister label when isGuestAssister is true', () => {
    expect(DB_TO_PUBLIC_SRC).toMatch(/ev\.isGuestAssister\s*\n?\s*\?\s*'Guest'/)
  })

  it('skips guest pseudo-players from the playerToLt lookup so legacy refs do not bleed', () => {
    expect(DB_TO_PUBLIC_SRC).toMatch(
      /if \(isGuestPseudoPlayerId\(pla\.playerId\)\) continue/,
    )
  })
})

describe('v1.88.0 — admin EventEditor + player SubmitGoalForm wire the guest toggles', () => {
  it('admin EventEditor has the "Scored by guest" checkbox + state', () => {
    expect(STATS_TAB_SRC).toMatch(/isGuestScorer/)
    expect(STATS_TAB_SRC).toMatch(/data-testid="event-editor-is-guest-scorer"/)
    expect(STATS_TAB_SRC).toMatch(/Scored by guest/)
  })

  it('admin EventEditor has the "Assisted by guest" checkbox + state', () => {
    expect(STATS_TAB_SRC).toMatch(/isGuestAssister/)
    expect(STATS_TAB_SRC).toMatch(/data-testid="event-editor-is-guest-assister"/)
    expect(STATS_TAB_SRC).toMatch(/Assisted by guest/)
  })

  it('admin EventEditor passes the flags to the server action', () => {
    expect(STATS_TAB_SRC).toMatch(/adminCreateMatchEvent\(\{[\s\S]+?isGuestScorer/)
    expect(STATS_TAB_SRC).toMatch(/adminUpdateMatchEvent\(\{[\s\S]+?isGuestScorer/)
  })

  it('player SubmitGoalForm has the "Scored by guest" checkbox + state', () => {
    expect(SUBMIT_FORM_SRC).toMatch(/isGuestScorer/)
    expect(SUBMIT_FORM_SRC).toMatch(/data-testid="submit-goal-is-guest-scorer"/)
    expect(SUBMIT_FORM_SRC).toMatch(/Scored by guest/)
  })

  it('player SubmitGoalForm has the "Assisted by guest" checkbox + state', () => {
    expect(SUBMIT_FORM_SRC).toMatch(/isGuestAssister/)
    expect(SUBMIT_FORM_SRC).toMatch(/data-testid="submit-goal-is-guest-assister"/)
  })

  it('player SubmitGoalForm passes the flags to submitOwnMatchEvent', () => {
    expect(SUBMIT_FORM_SRC).toMatch(/submitOwnMatchEvent\(\{[\s\S]+?isGuestScorer/)
    expect(SUBMIT_FORM_SRC).toMatch(/submitOwnMatchEvent\(\{[\s\S]+?isGuestAssister/)
  })
})

describe('v1.88.0 — cleanup script exists with safety gates', () => {
  it('the cleanup script file exists', () => {
    expect(existsSync(CLEANUP_SCRIPT_PATH)).toBe(true)
  })

  it('defaults to --dry-run; --apply gates the destruction', () => {
    const src = readFileSync(CLEANUP_SCRIPT_PATH, 'utf8')
    expect(src).toMatch(/process\.argv\.includes\('--apply'\)/)
    expect(src).toMatch(/Mode:\s*\$\{apply\s*\?\s*'APPLY'\s*:\s*'dry-run'\}/)
  })

  it('the schema gate fails when MatchEvent.isGuestScorer column is missing', () => {
    const src = readFileSync(CLEANUP_SCRIPT_PATH, 'utf8')
    expect(src).toMatch(/MatchEvent.*isGuestScorer column missing/)
  })

  it('the dangling-reference gate refuses to delete if any MatchEvent still points at a guest playerId', () => {
    const src = readFileSync(CLEANUP_SCRIPT_PATH, 'utf8')
    expect(src).toMatch(/still reference a guest playerId/)
  })
})
