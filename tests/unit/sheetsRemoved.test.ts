import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import path from 'path'

/**
 * v1.71.0 — Google Sheets retirement regression targets.
 *
 * The app fully cut over to Postgres at v1.0.x; the Sheets parser path
 * stayed dormant under `dataSource='db'`. v1.71.0 retires the Sheets
 * surface entirely. These tests pin the load-bearing absences so a future
 * PR cannot accidentally re-introduce the dependency.
 *
 * If any of these fail, the broken state is "Sheets came back" — either
 * the file was re-added, the package was re-installed, or a former import
 * site re-acquired the dependency.
 */

const ROOT = process.cwd()

function read(p: string): string {
  return readFileSync(path.join(ROOT, p), 'utf-8')
}

function exists(p: string): boolean {
  return existsSync(path.join(ROOT, p))
}

describe('v1.71.0 — files removed', () => {
  it('src/lib/sheets.ts is gone (Sheets API client)', () => {
    expect(exists('src/lib/sheets.ts')).toBe(false)
  })

  it('src/lib/mock-data.ts is gone (was only a Sheets-credentials fallback)', () => {
    expect(exists('src/lib/mock-data.ts')).toBe(false)
  })

  it('scripts/importFromSheets.ts is gone (legacy one-shot import)', () => {
    expect(exists('scripts/importFromSheets.ts')).toBe(false)
  })

  it('scripts/sheetsToDbBackfill.ts is archived, not in active scripts/', () => {
    expect(exists('scripts/sheetsToDbBackfill.ts')).toBe(false)
    expect(exists('scripts/_archive/sheetsToDbBackfill.ts')).toBe(true)
  })

  it('scripts/backfillMatchEventsFromSheet.ts is archived, not in active scripts/', () => {
    expect(exists('scripts/backfillMatchEventsFromSheet.ts')).toBe(false)
    expect(exists('scripts/_archive/backfillMatchEventsFromSheet.ts')).toBe(true)
  })
})

describe('v1.71.0 — package.json no longer ships googleapis or the db:import script', () => {
  const pkg = JSON.parse(read('package.json')) as {
    scripts?: Record<string, string>
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }

  it('googleapis is not in dependencies (would re-pull the Sheets API)', () => {
    expect(pkg.dependencies?.['googleapis']).toBeUndefined()
  })

  it('googleapis is not in devDependencies', () => {
    expect(pkg.devDependencies?.['googleapis']).toBeUndefined()
  })

  it('db:import script is gone (pointed at the deleted importFromSheets.ts)', () => {
    expect(pkg.scripts?.['db:import']).toBeUndefined()
  })
})

describe('v1.71.0 — settings.ts no longer exposes the dataSource / writeMode toggles', () => {
  const src = read('src/lib/settings.ts')

  it('does not export DataSource type', () => {
    expect(src).not.toMatch(/export\s+type\s+DataSource\b/)
  })

  it('does not export WriteMode type', () => {
    expect(src).not.toMatch(/export\s+type\s+WriteMode\b/)
  })

  it('does not export getDataSource', () => {
    expect(src).not.toMatch(/export\s+const\s+getDataSource\b/)
  })

  it('does not export getWriteMode', () => {
    expect(src).not.toMatch(/export\s+const\s+getWriteMode\b/)
  })

  it('does not export resolveDataSource (the v1.12.0 fail-safe helper)', () => {
    expect(src).not.toMatch(/export\s+function\s+resolveDataSource\b/)
  })

  it('does not export SETTING_IDS (the dataSource/writeMode seed-row id map)', () => {
    expect(src).not.toMatch(/export\s+const\s+SETTING_IDS\b/)
  })
})

describe('v1.71.0 — admin/leagues/actions.ts no longer exports setDataSource / setWriteMode', () => {
  const src = read('src/app/admin/leagues/actions.ts')

  it('does not export setDataSource server action', () => {
    expect(src).not.toMatch(/export\s+async\s+function\s+setDataSource\b/)
  })

  it('does not export setWriteMode server action', () => {
    expect(src).not.toMatch(/export\s+async\s+function\s+setWriteMode\b/)
  })

  it('does not import DataSource / WriteMode from settings', () => {
    expect(src).not.toMatch(/from\s+'@\/lib\/settings'/)
  })
})

describe('v1.71.0 — SettingsTab.tsx no longer renders the data-source / write-mode toggle UI', () => {
  const src = read('src/components/admin/SettingsTab.tsx')

  it('does not import setDataSource or setWriteMode from actions', () => {
    expect(src).not.toMatch(/setDataSource/)
    expect(src).not.toMatch(/setWriteMode/)
  })

  it('does not import DataSource / WriteMode types', () => {
    expect(src).not.toMatch(/import\s+type\s+\{[^}]*DataSource[^}]*\}\s+from\s+'@\/lib\/settings'/)
    expect(src).not.toMatch(/import\s+type\s+\{[^}]*WriteMode[^}]*\}\s+from\s+'@\/lib\/settings'/)
  })

  it('does not render the legacy "Public site source-of-truth" section heading', () => {
    expect(src).not.toMatch(/Public site source-of-truth/)
  })

  it('does not render the legacy "Google Sheets" toggle button', () => {
    expect(src).not.toMatch(/>Google Sheets</)
  })
})

describe('v1.71.0 — RSVP route no longer references Sheets', () => {
  const src = read('src/app/api/rsvp/route.ts')

  it('does not import writeRosterAvailability', () => {
    expect(src).not.toMatch(/writeRosterAvailability/)
  })

  it('does not import getWriteMode', () => {
    expect(src).not.toMatch(/getWriteMode/)
  })

  it('does not branch on writeMode', () => {
    expect(src).not.toMatch(/writeMode\s*===/)
    expect(src).not.toMatch(/sheets-only/)
  })
})

describe('v1.71.0 — public data dispatcher no longer dispatches to Sheets', () => {
  const src = read('src/lib/publicData.ts')

  it('does not import fetchSheetData', () => {
    expect(src).not.toMatch(/fetchSheetData/)
  })

  it('does not import parseAllData', () => {
    expect(src).not.toMatch(/parseAllData/)
  })

  it('does not declare getFromSheets', () => {
    expect(src).not.toMatch(/getFromSheets/)
  })

  it('does not call getDataSource (only one source remains)', () => {
    expect(src).not.toMatch(/getDataSource/)
  })
})

describe('v1.71.0 — lib/data.ts is reduced to slugify only', () => {
  const src = read('src/lib/data.ts')

  it('exports slugify (the load-bearing helper used by /api/assign-player)', () => {
    expect(src).toMatch(/export\s+function\s+slugify\b/)
  })

  it('does not export parseAllData', () => {
    expect(src).not.toMatch(/export\s+function\s+parseAllData\b/)
  })

  it('does not export parseTeams / parsePlayers / parseSchedule / parseGoals', () => {
    expect(src).not.toMatch(/export\s+function\s+parseTeams\b/)
    expect(src).not.toMatch(/export\s+function\s+parsePlayers\b/)
    expect(src).not.toMatch(/export\s+function\s+parseSchedule\b/)
    expect(src).not.toMatch(/export\s+function\s+parseGoals\b/)
  })

  it('does not import RawSheetData (the Sheets type is gone)', () => {
    expect(src).not.toMatch(/RawSheetData/)
  })
})

describe('v1.71.0 — admin Settings page no longer reads Sheets settings', () => {
  const src = read('src/app/admin/leagues/[id]/settings/page.tsx')

  it('does not import getDataSource / getWriteMode', () => {
    expect(src).not.toMatch(/getDataSource/)
    expect(src).not.toMatch(/getWriteMode/)
  })

  it('does not pass initialDataSource / initialWriteMode props to SettingsTab', () => {
    expect(src).not.toMatch(/initialDataSource/)
    expect(src).not.toMatch(/initialWriteMode/)
  })
})
