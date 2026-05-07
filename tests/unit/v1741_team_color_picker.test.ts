/**
 * v1.74.1 — Team color field + color picker on admin Teams tab.
 *
 * Regression targets:
 * - `adminUpdateTeamColor` action exists, gates on assertAdmin, validates
 *   hex format, accepts null to clear.
 * - AllTeamsList renders a color swatch per row (data-testid) and a
 *   color input element wired to adminUpdateTeamColor.
 * - EditTeamDialog includes a color picker input and a clear button.
 * - TeamsAllRow interface includes `color: string | null`.
 * - getAllTeamsForAdmin returns `color` in the mapped row.
 * - Version bumped to 1.74.1.
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '../..')

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

// ── Server action ─────────────────────────────────────────────────────

describe('v1.74.1 — adminUpdateTeamColor action', () => {
  const src = read('src/app/admin/teams-all/actions.ts')

  it('exports adminUpdateTeamColor', () => {
    expect(src).toMatch(/export async function adminUpdateTeamColor/)
  })

  it('gates on assertAdmin', () => {
    const block = src.slice(src.indexOf('adminUpdateTeamColor'))
    // assertAdmin must appear before the prisma.team.update call
    const assertIdx = block.indexOf('assertAdmin()')
    const prismaIdx = block.indexOf('prisma.team.update')
    expect(assertIdx).toBeGreaterThanOrEqual(0)
    expect(assertIdx).toBeLessThan(prismaIdx)
  })

  it('validates hex format with a regex', () => {
    expect(src).toMatch(/#\[0-9a-fA-F\]\{6\}/)
  })

  it('accepts null to clear the color', () => {
    const block = src.slice(src.indexOf('adminUpdateTeamColor'))
    expect(block).toMatch(/color:\s*null/)
  })

  it('calls revalidate after update', () => {
    const block = src.slice(src.indexOf('adminUpdateTeamColor'))
    expect(block.slice(0, block.indexOf('adminDeleteTeam'))).toMatch(/revalidate\(/)
  })
})

// ── AllTeamsList component ────────────────────────────────────────────

describe('v1.74.1 — AllTeamsList color swatch', () => {
  const src = read('src/components/admin/AllTeamsList.tsx')

  it('imports adminUpdateTeamColor', () => {
    expect(src).toMatch(/adminUpdateTeamColor/)
  })

  it('renders color swatch testid per row', () => {
    expect(src).toMatch(/all-teams-color-swatch-/)
  })

  it('renders color input testid per row (regression target — removing wires the picker)', () => {
    expect(src).toMatch(/all-teams-color-input-/)
  })

  it('ColorSwatch component calls adminUpdateTeamColor on change', () => {
    const swatchBlock = src.slice(src.indexOf('function ColorSwatch'), src.indexOf('function TeamRowView'))
    expect(swatchBlock).toMatch(/adminUpdateTeamColor/)
  })

  it('TeamRow interface includes color field', () => {
    const interfaceBlock = src.slice(src.indexOf('interface TeamRow'), src.indexOf('interface LeagueRef'))
    expect(interfaceBlock).toMatch(/color:\s*string \| null/)
  })

  it('table header includes Color column', () => {
    expect(src).toMatch(/Color/)
  })
})

// ── EditTeamDialog color picker ───────────────────────────────────────

describe('v1.74.1 — EditTeamDialog color picker', () => {
  const src = read('src/components/admin/AllTeamsList.tsx')

  it('edit dialog has color input testid', () => {
    expect(src).toMatch(/all-teams-edit-color/)
  })

  it('edit dialog has clear color button testid', () => {
    expect(src).toMatch(/all-teams-edit-color-clear/)
  })

  it('edit dialog calls adminUpdateTeamColor', () => {
    const dialogBlock = src.slice(src.indexOf('function EditTeamDialog'))
    expect(dialogBlock.slice(0, dialogBlock.indexOf('function DialogShell'))).toMatch(/adminUpdateTeamColor/)
  })

  it('edit dialog uses type="color" input', () => {
    const dialogBlock = src.slice(src.indexOf('function EditTeamDialog'))
    expect(dialogBlock).toMatch(/type="color"/)
  })
})

// ── admin-data TeamsAllRow ────────────────────────────────────────────

describe('v1.74.1 — TeamsAllRow interface and getAllTeamsForAdmin', () => {
  const src = read('src/lib/admin-data.ts')

  it('TeamsAllRow interface includes color field', () => {
    const block = src.slice(src.indexOf('interface TeamsAllRow'), src.indexOf('export async function getAllTeamsForAdmin'))
    expect(block).toMatch(/color:\s*string \| null/)
  })

  it('getAllTeamsForAdmin maps color from team row', () => {
    const fn = src.slice(src.indexOf('export async function getAllTeamsForAdmin'))
    expect(fn).toMatch(/color:\s*t\.color/)
  })
})

// ── Version ───────────────────────────────────────────────────────────

describe('v1.74.1 — version bump', () => {
  it('APP_VERSION is 1.74.1', () => {
    const src = read('src/lib/version.ts')
    expect(src).toMatch(/1\.74\.1/)
  })
})
