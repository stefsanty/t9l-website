/**
 * v1.73.0 — League abbreviation field for header + page title.
 *
 * Regression targets (stash-pop verification):
 * - Schema: League has nullable abbreviation column.
 * - Migration: additive column + isDefault backfill.
 * - Server action: updateLeagueAbbreviation exported + asserts admin + writes field.
 * - SettingsTab: imports action + has abbreviation input testid + calls action in save.
 * - Header: leagueTitle prop used; hardcoded two-span form is gone as primary render.
 * - Dashboard: threads abbreviation from league prop to Header.
 * - Pages: generateMetadata returns `<short> | <name>` format.
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const root = path.resolve(__dirname, '../../src')
const migrationPath = path.resolve(
  __dirname,
  '../../prisma/migrations/20260511000000_league_abbreviation/migration.sql',
)
const schemaPath = path.resolve(__dirname, '../../prisma/schema.prisma')

function readSrc(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

// ── Schema ────────────────────────────────────────────────────────────────────

describe('v1.73.0 — schema', () => {
  it('League model has abbreviation field', () => {
    const schema = fs.readFileSync(schemaPath, 'utf8')
    expect(schema).toMatch(/abbreviation\s+String\?/)
  })

  it('abbreviation field is nullable (String?)', () => {
    const schema = fs.readFileSync(schemaPath, 'utf8')
    // Must be String? not String (non-nullable would break existing leagues)
    const leagueBlock = schema.slice(schema.indexOf('model League {'))
    expect(leagueBlock).toMatch(/abbreviation\s+String\?/)
  })
})

// ── Migration ─────────────────────────────────────────────────────────────────

describe('v1.73.0 — migration', () => {
  it('migration file exists', () => {
    expect(fs.existsSync(migrationPath)).toBe(true)
  })

  it('migration adds abbreviation column (ADD COLUMN)', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')
    expect(sql).toMatch(/ADD COLUMN.*"abbreviation"/i)
  })

  it('migration does not DROP any column (purely additive)', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')
    // Rollback comments are fine; executable DROP would re-introduce data loss risk
    const executableLines = sql
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n')
    expect(executableLines).not.toMatch(/DROP\s+COLUMN/i)
  })

  it('migration backfills isDefault league with abbreviation', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')
    expect(sql).toMatch(/UPDATE\s+"League"/i)
    expect(sql).toMatch(/isDefault.*=.*true/i)
    expect(sql).toMatch(/"abbreviation"/)
  })
})

// ── Server action ─────────────────────────────────────────────────────────────

describe('v1.73.0 — updateLeagueAbbreviation action', () => {
  const actions = readSrc('app/admin/leagues/actions.ts')

  it('updateLeagueAbbreviation is exported', () => {
    expect(actions).toMatch(/export\s+async\s+function\s+updateLeagueAbbreviation/)
  })

  it('action calls assertAdmin()', () => {
    const fnStart = actions.indexOf('async function updateLeagueAbbreviation')
    const fnSnippet = actions.slice(fnStart, fnStart + 300)
    expect(fnSnippet).toMatch(/assertAdmin\(\)/)
  })

  it('action writes abbreviation to prisma.league.update', () => {
    const fnStart = actions.indexOf('async function updateLeagueAbbreviation')
    const fnSnippet = actions.slice(fnStart, fnStart + 400)
    expect(fnSnippet).toMatch(/prisma\.league\.update/)
    expect(fnSnippet).toMatch(/abbreviation/)
  })

  it('action calls revalidate', () => {
    const fnStart = actions.indexOf('async function updateLeagueAbbreviation')
    const fnSnippet = actions.slice(fnStart, fnStart + 500)
    expect(fnSnippet).toMatch(/revalidate\(/)
  })
})

// ── SettingsTab ───────────────────────────────────────────────────────────────

describe('v1.73.0 — SettingsTab', () => {
  const tab = readSrc('components/admin/SettingsTab.tsx')

  it('imports updateLeagueAbbreviation', () => {
    expect(tab).toMatch(/updateLeagueAbbreviation/)
    expect(tab).toMatch(/from '@\/app\/admin\/leagues\/actions'/)
  })

  it('League interface has abbreviation field', () => {
    expect(tab).toMatch(/abbreviation:\s*string\s*\|\s*null/)
  })

  it('has abbreviation input with testid', () => {
    expect(tab).toMatch(/data-testid="settings-tab-abbreviation-input"/)
  })

  it('helper text says "Used in the page title and header home button"', () => {
    expect(tab).toMatch(/Used in the page title and header home button/)
  })

  it('calls updateLeagueAbbreviation in save handler', () => {
    expect(tab).toMatch(/updateLeagueAbbreviation\(/)
  })
})

// ── Header ────────────────────────────────────────────────────────────────────

describe('v1.73.0 — Header', () => {
  const header = readSrc('components/Header.tsx')

  it('accepts leagueTitle prop', () => {
    expect(header).toMatch(/leagueTitle/)
  })

  it('has data-testid on the league title span', () => {
    expect(header).toMatch(/data-testid="header-league-title"/)
  })

  it('renders leagueTitle when provided (not hardcoded primary path)', () => {
    // The primary render path must use leagueTitle, not hardcoded T9L text.
    // v1.97.3 — Header now derives `titleText = leagueTitle ?? "T9L '26 春"`
    // and threads it into both the multi-league `<LeagueSwitcher
    // leagueTitle={titleText} />` branch and the single-league `<Link>`
    // fallback span. Accept either the original `{leagueTitle` shape OR
    // the v1.97.3 `leagueTitle ??` derivation.
    expect(header).toMatch(/\{leagueTitle|leagueTitle\s*\?\?/)
  })

  it('the two hardcoded spans are gone (regression target: restoring them breaks test)', () => {
    // Previously: <span>T9L &apos;26</span> + <span className="text-primary">春</span>
    // After v1.73.0: a single span using leagueTitle
    expect(header).not.toMatch(/<span[^>]*>T9L\s*&apos;26<\/span>/)
    expect(header).not.toMatch(/<span[^>]*className="[^"]*text-primary[^"]*">\s*春\s*<\/span>/)
  })
})

// ── Dashboard ─────────────────────────────────────────────────────────────────

describe('v1.73.0 — Dashboard', () => {
  const dashboard = readSrc('components/Dashboard.tsx')

  it('league prop type includes abbreviation', () => {
    expect(dashboard).toMatch(/league\?:\s*\{[^}]*abbreviation/)
  })

  it('passes leagueTitle to Header (abbreviation ?? name)', () => {
    expect(dashboard).toMatch(/leagueTitle=\{league\?\.abbreviation\s*\?\?\s*league\?\.name/)
  })

  it('Header receives leagueTitle prop from Dashboard', () => {
    expect(dashboard).toMatch(/<Header[^/]*leagueTitle=/)
  })
})

// ── Page titles ───────────────────────────────────────────────────────────────

describe('v1.73.0 — page titles', () => {
  const apexPage = fs.readFileSync(path.resolve(__dirname, '../../src/app/page.tsx'), 'utf8')
  const slugPage = fs.readFileSync(
    path.resolve(__dirname, '../../src/app/id/[slug]/page.tsx'),
    'utf8',
  )

  it('apex page has generateMetadata export', () => {
    expect(apexPage).toMatch(/export\s+async\s+function\s+generateMetadata/)
  })

  it('/id/[slug] page has generateMetadata export', () => {
    expect(slugPage).toMatch(/export\s+async\s+function\s+generateMetadata/)
  })

  it('apex page generates title as "<short> | <name>"', () => {
    // The format string must compose abbreviation (or name fallback) + league.name
    expect(apexPage).toMatch(/`\$\{short\}\s*\|\s*\$\{league\.name\}`/)
  })

  it('/id/[slug] page generates title as "<short> | <name>"', () => {
    expect(slugPage).toMatch(/`\$\{short\}\s*\|\s*\$\{league\.name\}`/)
  })

  it('apex page selects abbreviation from Prisma', () => {
    expect(apexPage).toMatch(/select:\s*\{[^}]*abbreviation:\s*true/)
  })

  it('/id/[slug] page selects abbreviation from Prisma', () => {
    expect(slugPage).toMatch(/select:\s*\{[^}]*abbreviation:\s*true/)
  })

  it('apex page falls back to League.name when abbreviation is null', () => {
    expect(apexPage).toMatch(/league\.abbreviation\s*\?\?\s*league\.name/)
  })

  it('/id/[slug] page falls back to League.name when abbreviation is null', () => {
    expect(slugPage).toMatch(/league\.abbreviation\s*\?\?\s*league\.name/)
  })

  it('/id/[slug] static metadata export is gone (replaced by generateMetadata)', () => {
    // Regression target: restoring `export const metadata = { title: 'League | T9L' }`
    // alongside generateMetadata would produce the wrong title
    expect(slugPage).not.toMatch(/export\s+const\s+metadata\s*=/)
  })
})
