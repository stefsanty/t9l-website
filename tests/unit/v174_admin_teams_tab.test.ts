/**
 * v1.74.0 — Replace the legacy "All Teams" admin link with a real
 * `/admin/teams-all` route: global Team CRUD list across leagues with
 * filter, sort, create (name + league required), edit (name + logo),
 * delete (soft-blocked when references exist), and client-direct
 * Vercel Blob logo upload.
 *
 * Regression targets:
 * - Server actions: adminCreateTeam / adminUpdateTeam / adminUpdateTeamLogo /
 *   adminDeleteTeam exist, all assertAdmin, validate inputs, soft-block
 *   delete on player/match references, and validate logo URL ownership.
 * - Upload-token route accepts `team-logo/<teamId>/...` paths gated on
 *   `session.isAdmin` (not userId), with SVG content-type allowed.
 * - admin-data exposes getAllTeamsForAdmin + getAllLeaguesForPicker with
 *   the right Prisma shape.
 * - Page + AllTeamsList component exist and render the expected testids.
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '../..')

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}
function exists(rel: string): boolean {
  return fs.existsSync(path.join(ROOT, rel))
}

// ── Files exist ───────────────────────────────────────────────────────

describe('v1.74.0 — files exist', () => {
  it('actions file exists', () => {
    expect(exists('src/app/admin/teams-all/actions.ts')).toBe(true)
  })
  it('page route exists', () => {
    expect(exists('src/app/admin/teams-all/page.tsx')).toBe(true)
  })
  it('AllTeamsList component exists', () => {
    expect(exists('src/components/admin/AllTeamsList.tsx')).toBe(true)
  })
})

// ── Server actions ────────────────────────────────────────────────────

describe('v1.74.0 — server actions', () => {
  const src = read('src/app/admin/teams-all/actions.ts')

  it("declares 'use server'", () => {
    expect(src.split('\n').slice(0, 3).join('\n')).toMatch(/['"]use server['"]/)
  })

  it('exports adminCreateTeam', () => {
    expect(src).toMatch(/export async function adminCreateTeam\s*\(/)
  })
  it('exports adminUpdateTeam', () => {
    expect(src).toMatch(/export async function adminUpdateTeam\s*\(/)
  })
  it('exports adminUpdateTeamLogo', () => {
    expect(src).toMatch(/export async function adminUpdateTeamLogo\s*\(/)
  })
  it('exports adminDeleteTeam', () => {
    expect(src).toMatch(/export async function adminDeleteTeam\s*\(/)
  })

  it('every action gates on assertAdmin', () => {
    // Each export should call assertAdmin before any prisma write
    const exports = src.match(/export async function \w+/g) ?? []
    expect(exports.length).toBeGreaterThanOrEqual(4)
    for (const exp of exports) {
      const fnName = exp.replace('export async function ', '')
      const blockStart = src.indexOf(exp)
      const blockEnd = src.indexOf('\n}\n', blockStart)
      const block = src.slice(blockStart, blockEnd)
      expect(block, `${fnName} must call assertAdmin`).toMatch(/await assertAdmin\(/)
    }
  })

  it('adminCreateTeam validates name is non-empty', () => {
    expect(src).toMatch(/Team name required/)
  })

  it('adminCreateTeam validates league required', () => {
    expect(src).toMatch(/League required/)
  })

  it('adminCreateTeam wraps team + leagueTeam in a transaction', () => {
    expect(src).toMatch(/prisma\.\$transaction/)
    expect(src).toMatch(/tx\.team\.create/)
    expect(src).toMatch(/tx\.leagueTeam\.create/)
  })

  it('adminUpdateTeamLogo validates URL ownership via team-logo path', () => {
    expect(src).toMatch(/isOwnedTeamLogoUrl/)
    expect(src).toMatch(/team-logo\/\$\{teamId\}/)
  })

  it('adminDeleteTeam soft-blocks on player assignments', () => {
    expect(src).toMatch(/playerLeagueMembership\.count/)
    expect(src).toMatch(/Cannot delete team/)
    expect(src).toMatch(/player assignment\(s\) reference it/)
  })

  it('adminDeleteTeam soft-blocks on matches', () => {
    expect(src).toMatch(/match\.count/)
    expect(src).toMatch(/match\(es\) still reference/)
  })

  it('every mutating action calls revalidate with /admin/teams-all path', () => {
    // Each exported action that writes should bust the admin cache
    const matches = src.match(/revalidate\(\{[^}]+\}\)/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(4)
    for (const m of matches) {
      expect(m).toMatch(/admin/)
      expect(m).toMatch(/\/admin\/teams-all/)
    }
  })
})

// ── Upload-token route accepts team-logo paths ────────────────────────

describe('v1.74.0 — upload-token route extension', () => {
  const src = read('src/app/api/blob/upload-token/route.ts')

  it('accepts session.isAdmin (not just userId)', () => {
    expect(src).toMatch(/isAdmin/)
    // Authentication gate must allow either userId OR isAdmin
    expect(src).toMatch(/!userId\s*&&\s*!isAdmin/)
  })

  it('matches team-logo/<teamId>/ pathname prefix', () => {
    expect(src).toMatch(/team-logo\\\/\[\^\/\]\+\\\//)
  })

  it('rejects team-logo path when session is not admin', () => {
    expect(src).toMatch(/Admin role required for team-logo uploads/)
  })

  it('declares team-logo content-type allowlist with SVG', () => {
    expect(src).toMatch(/TEAM_LOGO_CONTENT_TYPES/)
    expect(src).toMatch(/image\/svg\+xml/)
  })

  it('declares team-logo size cap (5MB)', () => {
    expect(src).toMatch(/TEAM_LOGO_MAX_BYTES\s*=\s*5\s*\*\s*1024\s*\*\s*1024/)
  })

  it('still requires userId for register-pending / player-id / player-profile paths (regression target)', () => {
    expect(src).toMatch(/register-pending\/\$\{userId\}/)
    expect(src).toMatch(/player-id\\\/\[\^\/\]\+/)
    expect(src).toMatch(/player-profile\\\/\[\^\/\]\+/)
  })
})

// ── admin-data helpers ────────────────────────────────────────────────

describe('v1.74.0 — admin-data helpers', () => {
  const src = read('src/lib/admin-data.ts')

  it('exports getAllTeamsForAdmin', () => {
    expect(src).toMatch(/export async function getAllTeamsForAdmin\s*\(/)
  })

  it('exports getAllLeaguesForPicker', () => {
    expect(src).toMatch(/export async function getAllLeaguesForPicker\s*\(/)
  })

  it('getAllTeamsForAdmin includes leagueTeams + counts', () => {
    const start = src.indexOf('getAllTeamsForAdmin')
    const block = src.slice(start, start + 2000)
    expect(block).toMatch(/leagueTeams/)
    expect(block).toMatch(/playerAssignments/)
    expect(block).toMatch(/homeMatches/)
    expect(block).toMatch(/awayMatches/)
  })

  it('getAllTeamsForAdmin returns deterministic sort (league name, then team name)', () => {
    const start = src.indexOf('getAllTeamsForAdmin')
    const block = src.slice(start, start + 3000)
    expect(block).toMatch(/localeCompare/)
  })

  it('getAllLeaguesForPicker selects only id and name', () => {
    const start = src.indexOf('getAllLeaguesForPicker')
    const block = src.slice(start, start + 500)
    expect(block).toMatch(/select:\s*\{\s*id:\s*true,\s*name:\s*true\s*\}/)
    expect(block).toMatch(/orderBy:\s*\{\s*name:\s*['"]asc['"]\s*\}/)
  })
})

// ── Page route + component ────────────────────────────────────────────

describe('v1.74.0 — page route', () => {
  const src = read('src/app/admin/teams-all/page.tsx')

  it('imports AllTeamsList', () => {
    expect(src).toMatch(/import\s+AllTeamsList\s+from\s+['"]@\/components\/admin\/AllTeamsList['"]/)
  })

  it('imports both data helpers', () => {
    expect(src).toMatch(/getAllTeamsForAdmin/)
    expect(src).toMatch(/getAllLeaguesForPicker/)
  })

  it('renders AllTeamsList with teams + leagues props', () => {
    expect(src).toMatch(/<AllTeamsList[\s\S]*teams=\{teams\}[\s\S]*leagues=\{leagues\}/)
  })
})

describe('v1.74.0 — AllTeamsList component', () => {
  const src = read('src/components/admin/AllTeamsList.tsx')

  it("declares 'use client'", () => {
    expect(src.split('\n')[0]).toMatch(/['"]use client['"]/)
  })

  it("imports 'upload' from '@vercel/blob/client' (regression target — server-side put would re-introduce 4.5MB cliff)", () => {
    expect(src).toMatch(/import\s*\{\s*upload\s*\}\s*from\s*['"]@vercel\/blob\/client['"]/)
  })

  it('defines UPLOAD_TOKEN_URL pointing at /api/blob/upload-token', () => {
    expect(src).toMatch(/UPLOAD_TOKEN_URL\s*=\s*['"]\/api\/blob\/upload-token['"]/)
  })

  it("does NOT build FormData with 'logo' fields (regression target)", () => {
    expect(src).not.toMatch(/formData\.append\(\s*['"]logo['"]/)
  })

  it('imports the four server actions', () => {
    expect(src).toMatch(/adminCreateTeam/)
    expect(src).toMatch(/adminUpdateTeam[^L]/)
    expect(src).toMatch(/adminUpdateTeamLogo/)
    expect(src).toMatch(/adminDeleteTeam/)
  })

  it('renders search input + league filter dropdown testids', () => {
    expect(src).toMatch(/data-testid="all-teams-search"/)
    expect(src).toMatch(/data-testid="all-teams-league-filter"/)
  })

  it('renders create button testid', () => {
    expect(src).toMatch(/data-testid="all-teams-create-button"/)
  })

  it('create dialog requires name + league before submit', () => {
    expect(src).toMatch(/data-testid="all-teams-create-name"/)
    expect(src).toMatch(/data-testid="all-teams-create-league"/)
    expect(src).toMatch(/disabled=\{pending \|\| !name\.trim\(\) \|\| !leagueId\}/)
  })

  it('edit dialog renders logo upload input + name field', () => {
    expect(src).toMatch(/data-testid="all-teams-edit-logo-input"/)
    expect(src).toMatch(/data-testid="all-teams-edit-name"/)
  })

  it('logo upload posts to team-logo/<teamId>/ pathname', () => {
    expect(src).toMatch(/team-logo\/\$\{team\.id\}\//)
  })

  it('logo upload allows JPG, PNG, WEBP, and SVG', () => {
    expect(src).toMatch(/image\/jpeg/)
    expect(src).toMatch(/image\/png/)
    expect(src).toMatch(/image\/webp/)
    expect(src).toMatch(/image\/svg\+xml/)
  })

  it('logo upload caps at 5MB', () => {
    expect(src).toMatch(/MAX_BYTES\s*=\s*5\s*\*\s*1024\s*\*\s*1024/)
  })

  it('list applies league filter from filterLeagueId state', () => {
    expect(src).toMatch(/filterLeagueId/)
    expect(src).toMatch(/t\.leagues\.some\(\(l\) => l\.id === filterLeagueId\)/)
  })

  it('list applies search across team name + league name', () => {
    expect(src).toMatch(/t\.name\.toLowerCase\(\)\.includes\(q\)/)
    expect(src).toMatch(/t\.leagues\.some\(\(l\) => l\.name\.toLowerCase\(\)/)
  })

  it('row delete button is disabled when team has player or match references', () => {
    expect(src).toMatch(/canDelete\s*=\s*team\.playerCount === 0 && team\.matchCount === 0/)
  })

  it('row delete button uses ConfirmDialog (regression target — bare button would skip the confirm step)', () => {
    expect(src).toMatch(/<ConfirmDialog/)
    expect(src).toMatch(/onConfirm=\{handleDelete\}/)
  })
})

// ── AdminNav still references the route ───────────────────────────────

describe('v1.74.0 — AdminNav', () => {
  const src = read('src/components/admin/AdminNav.tsx')

  it("links to '/admin/teams-all' (regression target — renaming the route would break the nav)", () => {
    expect(src).toMatch(/['"]\/admin\/teams-all['"]/)
  })
})

// ── Version bump ──────────────────────────────────────────────────────

describe('v1.74.0 — version bump', () => {
  it('APP_VERSION is 1.74.0', () => {
    const src = read('src/lib/version.ts')
    expect(src).toMatch(/APP_VERSION\s*=\s*['"]1\.74\.0['"]/)
  })
})
