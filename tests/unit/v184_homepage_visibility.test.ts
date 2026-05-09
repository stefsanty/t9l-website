// v1.84.0 — homepage redesign Phase 1a: League.visibility + User.defaultLeagueId.
//
// Pins the load-bearing surfaces of the schema foundation:
//
//   1. Schema           — League.visibility enum + User.defaultLeagueId FK.
//   2. Migration        — additive, includes the recruiting -> visibility
//                         backfill, and ON DELETE SET NULL on the User FK.
//   3. Server actions   — setLeagueVisibility exists with the right shape;
//                         legacy setLeagueRecruiting dual-writes visibility.
//   4. leagueFlags      — gate flips from `recruiting` to
//                         `visibility === 'PUBLIC_OPEN'`.
//   5. apply / register — gates on `visibility !== 'PRIVATE'`.
//   6. recruit page     — same visibility gate.
//   7. SettingsTab      — three-radio visibility surface.
//
// Structural-test convention (file content) per the v1.63.0 / v1.65.x /
// v1.82.0 family — the load-bearing contract is "did the gate land in
// the source," not "does the rendered tree match a synthetic snapshot."
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')

const SCHEMA = read('prisma/schema.prisma')
const MIGRATION = read(
  'prisma/migrations/20260517000000_league_visibility_and_user_default_league/migration.sql',
)
const FLAGS = read('src/lib/leagueFlags.ts')
const ACTIONS = read('src/app/admin/leagues/actions.ts')
const RECRUITING = read('src/app/api/recruiting/actions.ts')
const RECRUIT_PAGE = read('src/app/recruit/[slug]/page.tsx')
const SETTINGS = read('src/components/admin/SettingsTab.tsx')

// ────────────────────────────────────────────────────────────────────────────
// 1) Schema
// ────────────────────────────────────────────────────────────────────────────

describe('v1.84.0 — schema additions', () => {
  it('adds the LeagueVisibility enum with three tiers', () => {
    expect(SCHEMA).toMatch(/enum\s+LeagueVisibility\s*\{[\s\S]*?PRIVATE[\s\S]*?PUBLIC_CLOSED[\s\S]*?PUBLIC_OPEN[\s\S]*?\}/)
  })

  it('adds League.visibility with PUBLIC_CLOSED default', () => {
    expect(SCHEMA).toMatch(
      /visibility\s+LeagueVisibility\s+@default\(PUBLIC_CLOSED\)/,
    )
  })

  it('keeps the legacy League.recruiting field for one cycle (dual-write window)', () => {
    expect(SCHEMA).toMatch(/recruiting\s+Boolean\s+@default\(false\)/)
  })

  it('adds User.defaultLeagueId nullable + relation', () => {
    expect(SCHEMA).toMatch(/defaultLeagueId\s+String\?/)
    expect(SCHEMA).toMatch(
      /defaultLeague\s+League\?\s+@relation\("UserDefaultLeague",\s+fields:\s+\[defaultLeagueId\],\s+references:\s+\[id\],\s+onDelete:\s+SetNull\)/,
    )
  })

  it('adds the back-relation on League', () => {
    expect(SCHEMA).toMatch(/defaultForUsers\s+User\[\]\s+@relation\("UserDefaultLeague"\)/)
  })

  it('annotates League.isDefault as a removal candidate (TODO)', () => {
    // Per the briefing's Q3 — keep but mark for deletion.
    expect(SCHEMA).toMatch(/TODO[\s\S]{0,200}isDefault/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 2) Migration shape
// ────────────────────────────────────────────────────────────────────────────

describe('v1.84.0 — migration shape', () => {
  it('creates the LeagueVisibility enum', () => {
    expect(MIGRATION).toMatch(
      /CREATE\s+TYPE\s+"LeagueVisibility"\s+AS\s+ENUM\s*\(\s*'PRIVATE',\s*'PUBLIC_CLOSED',\s*'PUBLIC_OPEN'\s*\)/,
    )
  })

  it('adds visibility column NOT NULL DEFAULT PUBLIC_CLOSED', () => {
    expect(MIGRATION).toMatch(
      /ADD\s+COLUMN\s+"visibility"\s+"LeagueVisibility"\s+NOT\s+NULL\s+DEFAULT\s+'PUBLIC_CLOSED'/i,
    )
  })

  it('backfills visibility from recruiting (true → PUBLIC_OPEN; false → PUBLIC_CLOSED)', () => {
    expect(MIGRATION).toMatch(/UPDATE\s+"League"[\s\S]+?recruiting[\s\S]+?PUBLIC_OPEN[\s\S]+?PUBLIC_CLOSED/)
  })

  it('adds User.defaultLeagueId nullable TEXT', () => {
    expect(MIGRATION).toMatch(
      /ADD\s+COLUMN\s+"defaultLeagueId"\s+TEXT(?!\s+NOT\s+NULL)/i,
    )
  })

  it('adds the FK with ON DELETE SET NULL (so a league delete does not cascade-delete users)', () => {
    expect(MIGRATION).toMatch(
      /CONSTRAINT\s+"User_defaultLeagueId_fkey"[\s\S]+?ON\s+DELETE\s+SET\s+NULL/i,
    )
  })

  it('is purely additive (no DROP / TRUNCATE / DELETE FROM / ALTER COLUMN of existing data)', () => {
    const sqlOnly = MIGRATION
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*--.*$/gm, '')
    expect(sqlOnly).not.toMatch(/\bDROP\s+TABLE\b/i)
    expect(sqlOnly).not.toMatch(/\bDROP\s+COLUMN\b/i)
    expect(sqlOnly).not.toMatch(/\bALTER\s+COLUMN\b/i)
    expect(sqlOnly).not.toMatch(/\bTRUNCATE\b/i)
    expect(sqlOnly).not.toMatch(/\bDELETE\s+FROM\b/i)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 3) Server actions
// ────────────────────────────────────────────────────────────────────────────

describe('v1.84.0 — setLeagueVisibility server action', () => {
  it('exists with the three-tier signature', () => {
    expect(ACTIONS).toMatch(
      /export\s+async\s+function\s+setLeagueVisibility\s*\(\s*leagueId:\s*string,\s*value:\s*['"]PRIVATE['"]\s*\|\s*['"]PUBLIC_CLOSED['"]\s*\|\s*['"]PUBLIC_OPEN['"]/,
    )
  })

  it('gates on assertAdmin', () => {
    const body = ACTIONS.match(
      /export\s+async\s+function\s+setLeagueVisibility[\s\S]+?\n\}/,
    )
    expect(body?.[0]).toMatch(/await\s+assertAdmin\(\)/)
  })

  it('rejects values outside the three-tier enum', () => {
    expect(ACTIONS).toMatch(
      /value\s*!==\s*['"]PRIVATE['"]\s*&&\s*value\s*!==\s*['"]PUBLIC_CLOSED['"]\s*&&\s*value\s*!==\s*['"]PUBLIC_OPEN['"]/,
    )
  })

  it('writes BOTH visibility AND the legacy recruiting boolean (dual-write)', () => {
    const body = ACTIONS.match(
      /export\s+async\s+function\s+setLeagueVisibility[\s\S]+?\n\}/,
    )
    expect(body?.[0]).toMatch(/visibility:\s*value/)
    expect(body?.[0]).toMatch(/recruiting:\s*value\s*===\s*['"]PUBLIC_OPEN['"]/)
  })

  it('busts the canonical admin caches', () => {
    const body = ACTIONS.match(
      /export\s+async\s+function\s+setLeagueVisibility[\s\S]+?\n\}/,
    )
    expect(body?.[0]).toMatch(/revalidate\(\s*\{[\s\S]+?domain:\s*['"]admin['"]/)
  })
})

describe('v1.84.0 — legacy setLeagueRecruiting now dual-writes visibility', () => {
  it('still exists (one-cycle compat)', () => {
    expect(ACTIONS).toMatch(/export\s+async\s+function\s+setLeagueRecruiting/)
  })

  it('mirrors the boolean into visibility (true → PUBLIC_OPEN; false → PUBLIC_CLOSED)', () => {
    const body = ACTIONS.match(
      /export\s+async\s+function\s+setLeagueRecruiting[\s\S]+?\n\}/,
    )
    expect(body?.[0]).toMatch(
      /visibility:\s*value\s*\?\s*['"]PUBLIC_OPEN['"]\s*:\s*['"]PUBLIC_CLOSED['"]/,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 4) leagueFlags helper
// ────────────────────────────────────────────────────────────────────────────

describe('v1.84.0 — leagueFlags reads visibility', () => {
  it('selects visibility from Prisma (not the legacy recruiting boolean)', () => {
    expect(FLAGS).toMatch(
      /select:\s*\{\s*preseasonMode:\s*true,\s*visibility:\s*true\s*\}/,
    )
  })

  it('exports visibility on the LeagueFlags interface', () => {
    expect(FLAGS).toMatch(
      /visibility:\s*['"]PRIVATE['"]\s*\|\s*['"]PUBLIC_CLOSED['"]\s*\|\s*['"]PUBLIC_OPEN['"]/,
    )
  })

  it('derives recruiting from visibility (PUBLIC_OPEN only)', () => {
    expect(FLAGS).toMatch(/recruiting:\s*visibility\s*===\s*['"]PUBLIC_OPEN['"]/)
  })

  describe('runtime behavior', () => {
    beforeEach(() => {
      vi.resetModules()
    })

    it('PRIVATE league → recruiting false', async () => {
      vi.doMock('@/lib/prisma', () => ({
        prisma: {
          league: {
            findUnique: vi
              .fn()
              .mockResolvedValue({ preseasonMode: false, visibility: 'PRIVATE' }),
          },
        },
      }))
      const { __readLeagueFlags_for_testing } = await import(
        '../../src/lib/leagueFlags'
      )
      const flags = await __readLeagueFlags_for_testing('l-private')
      expect(flags.recruiting).toBe(false)
      expect(flags.visibility).toBe('PRIVATE')
    })

    it('PUBLIC_CLOSED league → recruiting false (banner hidden, but apply-flow still accepts via direct link)', async () => {
      vi.doMock('@/lib/prisma', () => ({
        prisma: {
          league: {
            findUnique: vi.fn().mockResolvedValue({
              preseasonMode: false,
              visibility: 'PUBLIC_CLOSED',
            }),
          },
        },
      }))
      const { __readLeagueFlags_for_testing } = await import(
        '../../src/lib/leagueFlags'
      )
      const flags = await __readLeagueFlags_for_testing('l-closed')
      expect(flags.recruiting).toBe(false)
      expect(flags.visibility).toBe('PUBLIC_CLOSED')
    })

    it('PUBLIC_OPEN league → recruiting true', async () => {
      vi.doMock('@/lib/prisma', () => ({
        prisma: {
          league: {
            findUnique: vi.fn().mockResolvedValue({
              preseasonMode: false,
              visibility: 'PUBLIC_OPEN',
            }),
          },
        },
      }))
      const { __readLeagueFlags_for_testing } = await import(
        '../../src/lib/leagueFlags'
      )
      const flags = await __readLeagueFlags_for_testing('l-open')
      expect(flags.recruiting).toBe(true)
      expect(flags.visibility).toBe('PUBLIC_OPEN')
    })
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 5) Apply-flow gates flip from recruiting to visibility
// ────────────────────────────────────────────────────────────────────────────

describe('v1.84.0 — applyToLeague gates on visibility', () => {
  it('selects visibility (not the legacy recruiting boolean) on the league row', () => {
    // Pin the SELECT in `applyToLeague` — there are two such selects in the
    // file (apply + register); both should have visibility.
    expect(RECRUITING).toMatch(
      /select:\s*\{[^}]*\bvisibility:\s*true[^}]*\bballType:\s*true[^}]*\}/,
    )
  })

  it('rejects when visibility === PRIVATE (invite-only)', () => {
    expect(RECRUITING).toMatch(/league\.visibility\s*===\s*['"]PRIVATE['"]/)
    expect(RECRUITING).toMatch(/league is private/)
  })

  it('does NOT reject when visibility === PUBLIC_CLOSED (direct-link applies still accepted)', () => {
    // Negative regex: the gate must not be `!== 'PUBLIC_OPEN'` — that would
    // reject CLOSED. It must be `=== 'PRIVATE'` only.
    expect(RECRUITING).not.toMatch(/visibility\s*!==\s*['"]PUBLIC_OPEN['"]/)
  })

  it('no longer reads the legacy `league.recruiting` field anywhere in the apply path', () => {
    // Strip docstrings; only enforce on live code.
    const stripped = RECRUITING.replace(/\/\*[\s\S]*?\*\//g, '').replace(
      /^\s*\/\/.*$/gm,
      '',
    )
    expect(stripped).not.toMatch(/league\.recruiting/)
  })
})

describe('v1.84.0 — /recruit/[slug] page gates on visibility', () => {
  it('selects visibility from the league row', () => {
    expect(RECRUIT_PAGE).toMatch(/visibility:\s*true/)
  })

  it('PRIVATE → mounts the not-recruiting surface', () => {
    expect(RECRUIT_PAGE).toMatch(
      /league\.visibility\s*===\s*['"]PRIVATE['"][\s\S]{0,200}NotRecruitingSurface/,
    )
  })

  it('preserves the not-recruiting surface testid (no UI-shape regression)', () => {
    expect(RECRUIT_PAGE).toMatch(/data-testid="recruit-not-recruiting"/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 6) Admin SettingsTab visibility radio
// ────────────────────────────────────────────────────────────────────────────

describe('v1.84.0 — SettingsTab three-tier visibility radio', () => {
  it('renders the visibility section with all three options', () => {
    expect(SETTINGS).toMatch(/data-testid="settings-tab-visibility-section"/)
    expect(SETTINGS).toMatch(/data-testid="settings-tab-visibility-private"/)
    expect(SETTINGS).toMatch(/data-testid="settings-tab-visibility-public-closed"/)
    expect(SETTINGS).toMatch(/data-testid="settings-tab-visibility-public-open"/)
  })

  it('uses admin-* design tokens (admin-orthogonal-UX rule)', () => {
    // The visibility section must NOT use public-site tokens — it lives
    // in the admin shell and inherits the admin-shell.dark theme.
    const section = SETTINGS.match(
      /settings-tab-visibility-section[\s\S]+?<\/section>/,
    )?.[0] ?? ''
    expect(section).toMatch(/border-admin-/)
    expect(section).toMatch(/text-admin-/)
    expect(section).toMatch(/bg-admin-/)
  })

  it('drops the legacy two-button recruiting toggle (replaced by the three-radio)', () => {
    // Strip docstrings/comments so the legacy mention in v1.84.0 doc
    // text doesn't trip the negative regex.
    const stripped = SETTINGS
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(stripped).not.toMatch(/data-testid="settings-tab-recruiting-on"/)
    expect(stripped).not.toMatch(/data-testid="settings-tab-recruiting-off"/)
  })
})
