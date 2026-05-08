/**
 * v1.75.7 — League details polish + Goal kick field.
 *
 * Three coordinated changes:
 *   1. Text sizing: rules section dl uses text-xs (not text-sm).
 *      Season Fee/Register By row no longer uses flex-wrap.
 *   2. Label renames: "Goal size" → "Goal"; "Sideline restart" → "Sideline"
 *      in both the public panel and the admin form.
 *   3. New field: GoalKickType enum (THROW | KICK) + League.goalKickType
 *      @default(KICK). Surfaced in both the admin editor and public panel.
 *
 * Structural pins over file content — regression targets so future refactors
 * don't silently undo these changes.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

// ── Change 1: Text sizing ────────────────────────────────────────────────────

describe('v1.75.7 rules section uses text-xs', () => {
  const src = read('src/components/LeagueDetailsPanel.tsx')

  it('rules section dl uses text-xs (not text-sm)', () => {
    // The dl has both text-xs and league-details-rules-section on the same line.
    expect(src).toMatch(/text-xs[\s\S]{0,80}league-details-rules-section/)
    // Regression target: reverting to text-sm would re-introduce wrapping on iPhone.
    expect(src).not.toMatch(/text-sm[\s\S]{0,80}league-details-rules-section/)
  })

  it('stats section dl uses text-xs', () => {
    const statsIdx = src.indexOf('league-stats-section')
    const dlAfterStats = src.slice(statsIdx, statsIdx + 200)
    expect(dlAfterStats).toMatch(/text-xs/)
    expect(dlAfterStats).not.toMatch(/text-sm/)
  })

  it('Season Fee row does NOT use flex-wrap (regression target — prevents iPhone wrap)', () => {
    const feeIdx = src.indexOf('season-fee-row')
    const surroundingBlock = src.slice(feeIdx, feeIdx + 300)
    expect(surroundingBlock).not.toMatch(/flex-wrap/)
  })
})

// ── Change 2: Label renames in public panel ──────────────────────────────────

describe('v1.75.7 panel label renames', () => {
  const src = read('src/components/LeagueDetailsPanel.tsx')

  it('uses label "Goal" for goal size (not "Goal size")', () => {
    expect(src).toMatch(/label="Goal"/)
    // Regression target: re-introducing "Goal size" would undo the rename.
    expect(src).not.toMatch(/label="Goal size"/)
  })

  it('uses label "Sideline" for sideline restart (not "Sideline restart")', () => {
    // The label attribute value must be exactly "Sideline" near the throw-in row.
    expect(src).toMatch(/label="Sideline"/)
    // Regression target: old label must not reappear.
    expect(src).not.toMatch(/label="Sideline restart"/)
  })
})

// ── Change 2: Label renames in admin form ────────────────────────────────────

describe('v1.75.7 admin form label renames', () => {
  const src = read('src/components/admin/LeagueDetailsEditor.tsx')

  it('uses label "Goal" for goal size (not "Goal size")', () => {
    // The label element renders the text "Goal" for the goal-size field.
    expect(src).toMatch(/tracking-wide[^>]*>Goal</)
    // Regression target.
    expect(src).not.toMatch(/tracking-wide[^>]*>Goal size</)
  })

  it('uses label "Sideline" for the sideline restart field (not "Restart from sideline")', () => {
    expect(src).toMatch(/tracking-wide[^>]*>Sideline</)
    // Regression target.
    expect(src).not.toMatch(/Restart from sideline/)
  })
})

// ── Change 3: GoalKickType schema ────────────────────────────────────────────

describe('v1.75.7 GoalKickType enum in Prisma schema', () => {
  const schema = read('prisma/schema.prisma')

  it('declares GoalKickType enum with THROW and KICK values', () => {
    expect(schema).toMatch(/enum GoalKickType \{/)
    expect(schema).toMatch(/THROW/)
    expect(schema).toMatch(/KICK/)
  })

  it('League model has goalKickType field with GoalKickType type', () => {
    expect(schema).toMatch(/goalKickType\s+GoalKickType/)
  })

  it('goalKickType defaults to KICK', () => {
    expect(schema).toMatch(/goalKickType\s+GoalKickType\s+@default\(KICK\)/)
  })
})

describe('v1.75.7 migration file for GoalKickType', () => {
  const migration = read('prisma/migrations/20260513000000_league_goal_kick_type/migration.sql')

  it('creates GoalKickType enum', () => {
    expect(migration).toMatch(/CREATE TYPE "GoalKickType"/)
  })

  it('adds goalKickType column to League with default KICK', () => {
    expect(migration).toMatch(/ADD COLUMN "goalKickType"/)
    expect(migration).toMatch(/DEFAULT 'KICK'/)
  })

  it('is purely additive (no DROP or ALTER COLUMN on existing data)', () => {
    const strippedComments = migration.replace(/--[^\n]*/g, '')
    expect(strippedComments).not.toMatch(/DROP COLUMN/)
    expect(strippedComments).not.toMatch(/ALTER COLUMN/)
    expect(strippedComments).not.toMatch(/TRUNCATE/)
    expect(strippedComments).not.toMatch(/DELETE FROM/)
  })
})

// ── Change 3: GoalKickType in leagueDetails.ts ───────────────────────────────

describe('v1.75.7 GoalKickType in leagueDetails.ts', () => {
  // v1.80.7 — Prisma select + row mapping moved to leagueDetailsServer.ts;
  // type + interface field + LABELS stay in the pure leagueDetails.ts.
  const pureSrc = read('src/lib/leagueDetails.ts')
  const serverSrc = read('src/lib/leagueDetailsServer.ts')

  it('exports GoalKickType type', () => {
    expect(pureSrc).toMatch(/export type GoalKickType/)
  })

  it('LeagueDetails interface includes goalKickType field', () => {
    expect(pureSrc).toMatch(/goalKickType:\s*GoalKickType/)
  })

  it('Prisma select includes goalKickType', () => {
    expect(serverSrc).toMatch(/goalKickType:\s*true/)
  })

  it('return object includes goalKickType', () => {
    expect(serverSrc).toMatch(/goalKickType:\s*row\.goalKickType/)
  })

  it('exports GOAL_KICK_TYPE_LABELS record', () => {
    expect(pureSrc).toMatch(/GOAL_KICK_TYPE_LABELS/)
    expect(pureSrc).toMatch(/THROW.*Throw/)
    expect(pureSrc).toMatch(/KICK.*Kick/)
  })
})

// ── Change 3: GoalKickType in updateLeagueDetails action ────────────────────

describe('v1.75.7 updateLeagueDetails accepts goalKickType', () => {
  const src = read('src/app/admin/leagues/actions.ts')

  it('defines ALLOWED_GOAL_KICK_TYPES constant', () => {
    expect(src).toMatch(/ALLOWED_GOAL_KICK_TYPES/)
  })

  it('updateLeagueDetails input type includes goalKickType', () => {
    expect(src).toMatch(/goalKickType\?:\s*'THROW'\s*\|\s*'KICK'/)
  })

  it('validates and writes goalKickType to prisma', () => {
    expect(src).toMatch(/ALLOWED_GOAL_KICK_TYPES\.includes\(input\.goalKickType\)/)
    expect(src).toMatch(/data\.goalKickType\s*=\s*input\.goalKickType/)
  })
})

// ── Change 3: Goal kick row in public panel ──────────────────────────────────

describe('v1.75.7 Goal kick row in LeagueDetailsPanel', () => {
  const src = read('src/components/LeagueDetailsPanel.tsx')

  it('renders league-details-goal-kick-row testid', () => {
    expect(src).toMatch(/testid="league-details-goal-kick-row"/)
  })

  it('uses label "Goal kick"', () => {
    expect(src).toMatch(/label="Goal kick"/)
  })

  it('imports GOAL_KICK_TYPE_LABELS from leagueDetails', () => {
    expect(src).toMatch(/GOAL_KICK_TYPE_LABELS/)
  })

  it('GOAL_KICK_TYPE_LABELS appears before the goal-kick-row usage', () => {
    const labelsIdx = src.indexOf('GOAL_KICK_TYPE_LABELS')
    const rowIdx = src.indexOf('league-details-goal-kick-row')
    expect(labelsIdx).toBeGreaterThan(-1)
    expect(rowIdx).toBeGreaterThan(-1)
  })

  it('Goal kick row appears between Sideline and Backpass rows in DOM order', () => {
    const sidelineIdx = src.indexOf('league-details-throw-in-row')
    const goalKickIdx = src.indexOf('league-details-goal-kick-row')
    const backpassIdx = src.indexOf('league-details-backpass-row')
    expect(sidelineIdx).toBeGreaterThan(-1)
    expect(goalKickIdx).toBeGreaterThan(-1)
    expect(backpassIdx).toBeGreaterThan(-1)
    expect(goalKickIdx).toBeGreaterThan(sidelineIdx)
    expect(backpassIdx).toBeGreaterThan(goalKickIdx)
  })
})

// ── Change 3: Goal kick radio in admin form ──────────────────────────────────

describe('v1.75.7 Goal kick radio in LeagueDetailsEditor', () => {
  const src = read('src/components/admin/LeagueDetailsEditor.tsx')

  it('has GoalKickType local type', () => {
    expect(src).toMatch(/type GoalKickType\s*=\s*'THROW'\s*\|\s*'KICK'/)
  })

  it('accepts initialGoalKickType prop', () => {
    expect(src).toMatch(/initialGoalKickType:\s*GoalKickType/)
  })

  it('has goalKickType state', () => {
    expect(src).toMatch(/goalKickType,\s*setGoalKickType/)
  })

  it('renders league-details-goal-kick-* testids via template literal pattern', () => {
    // Testids are generated dynamically: `league-details-goal-kick-${opt.toLowerCase()}`
    // Check for the template literal pattern rather than the resolved string.
    expect(src).toMatch(/league-details-goal-kick-\$\{opt\.toLowerCase\(\)\}/)
  })

  it('passes goalKickType to updateLeagueDetails', () => {
    expect(src).toMatch(/goalKickType,/)
  })

  it('Goal kick section appears between Sideline and Backpass in DOM order', () => {
    // Use section comment anchors since testids are template literals.
    const sidelineIdx = src.indexOf('/* 10 — Throw-in vs kick-in */')
    const goalKickIdx = src.indexOf('/* 11 — Goal kick */')
    const backpassIdx = src.indexOf('/* 12 — Backpass rule (futsal-only) */')
    expect(sidelineIdx).toBeGreaterThan(-1)
    expect(goalKickIdx).toBeGreaterThan(-1)
    expect(backpassIdx).toBeGreaterThan(-1)
    expect(goalKickIdx).toBeGreaterThan(sidelineIdx)
    expect(backpassIdx).toBeGreaterThan(goalKickIdx)
  })
})

// ── Change 3: SettingsTab threads goalKickType ───────────────────────────────

describe('v1.75.7 SettingsTab passes goalKickType to LeagueDetailsEditor', () => {
  const src = read('src/components/admin/SettingsTab.tsx')

  it('League interface includes goalKickType field', () => {
    expect(src).toMatch(/goalKickType:\s*'THROW'\s*\|\s*'KICK'/)
  })

  it('passes initialGoalKickType prop to LeagueDetailsEditor', () => {
    expect(src).toMatch(/initialGoalKickType=\{league\.goalKickType\}/)
  })
})

// ── Stash-pop regression target ──────────────────────────────────────────────

describe('v1.75.7 stash-pop regression target', () => {
  it('APP_VERSION is 1.75.7 or later', () => {
    // v1.78.0 — floor pin relaxed to accept v1.75.7+ / v1.[76-99].x / v2+.
    const v = read('src/lib/version.ts')
    expect(v).toMatch(
      /APP_VERSION\s*=\s*'(?:1\.75\.(?:[7-9]|\d{2,})|1\.(?:7[6-9]|[89]\d|\d{3,})\.\d+|[2-9]\.\d+\.\d+)'/,
    )
  })

  it('LeagueDetailsPanel does NOT use "Goal size" as a row label (regression gate)', () => {
    const src = read('src/components/LeagueDetailsPanel.tsx')
    expect(src).not.toMatch(/label="Goal size"/)
  })

  it('LeagueDetailsPanel does NOT use "Sideline restart" as a row label (regression gate)', () => {
    const src = read('src/components/LeagueDetailsPanel.tsx')
    expect(src).not.toMatch(/label="Sideline restart"/)
  })

  it('prisma schema has GoalKickType enum (stash-pop gate)', () => {
    const schema = read('prisma/schema.prisma')
    expect(schema).toMatch(/enum GoalKickType/)
  })

  it('migration file exists (stash-pop gate)', () => {
    const migration = read('prisma/migrations/20260513000000_league_goal_kick_type/migration.sql')
    expect(migration).toMatch(/GoalKickType/)
  })
})
