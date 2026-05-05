import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import path from 'path'

/**
 * v1.56.0 (PR 3 of route-shortening chain) — structural assertions on
 * the cross-league linking surfaces.
 *
 * The PR adds:
 *   1. `LinkExistingPlayerDialog.tsx` — modal with search + per-row
 *      team picker + bulk-link, calls `adminLinkExistingPlayer` /
 *      `adminLinkExistingPlayersBulk`.
 *   2. PlayersTab integration — mounts the dialog in the toolbar next
 *      to `AddPlayerDialog`, accepts new `linkableCandidates` prop.
 *   3. PlayerRow gains optional `otherLeagues: string[]` field; when
 *      non-empty, an "Also in: <league>" chip renders below the name
 *      on both mobile and desktop layouts.
 *   4. Page-level wiring fetches `getLinkablePlayersForLeague(id)` +
 *      `getPlayerOtherLeaguesForLeague(id)` in parallel with the
 *      existing payload pieces.
 *   5. New helpers in `lib/admin-data.ts` —
 *      `getLinkablePlayersForLeague` returns global Players NOT on
 *      this league's roster + their other-league context;
 *      `getPlayerOtherLeaguesForLeague` returns the same context for
 *      players ALREADY on the roster.
 */

const ROOT = process.cwd()

function read(p: string): string {
  return readFileSync(path.join(ROOT, p), 'utf-8')
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
}

describe('v1.56.0 — LinkExistingPlayerDialog component', () => {
  const dialogPath = 'src/components/admin/LinkExistingPlayerDialog.tsx'

  it('file exists', () => {
    expect(existsSync(path.join(ROOT, dialogPath))).toBe(true)
  })

  it('declares "use client"', () => {
    const src = read(dialogPath)
    expect(src.split('\n')[0].trim().replace(/['";]/g, '')).toBe('use client')
  })

  it('imports both link actions (single + bulk)', () => {
    const src = stripComments(read(dialogPath))
    expect(src).toMatch(/adminLinkExistingPlayer\b/)
    expect(src).toMatch(/adminLinkExistingPlayersBulk\b/)
  })

  it('exports LinkablePlayerRow type so PlayersTab can re-import it', () => {
    const src = stripComments(read(dialogPath))
    expect(src).toMatch(/export\s+(?:type\s+)?interface\s+LinkablePlayerRow/)
  })

  it('mounts a modal with role="dialog" + aria-modal + closable via Escape + backdrop', () => {
    const src = read(dialogPath)
    expect(src).toMatch(/role="dialog"/)
    expect(src).toMatch(/aria-modal="true"/)
    expect(src).toMatch(/e\.key === 'Escape'/)
    expect(src).toMatch(/data-testid="link-existing-player-backdrop"/)
  })

  it('exposes the testids the e2e + unit specs key off', () => {
    const src = read(dialogPath)
    expect(src).toMatch(/data-testid="link-existing-player-trigger"/)
    expect(src).toMatch(/data-testid="link-existing-player-search"/)
    expect(src).toMatch(/data-testid="link-existing-player-list"/)
    expect(src).toMatch(/data-testid="link-existing-player-summary"/)
    expect(src).toMatch(/data-testid="link-existing-player-submit"/)
    expect(src).toMatch(/data-testid=\{`link-existing-player-row-\$\{c\.id\}`\}/)
    expect(src).toMatch(/data-testid=\{`link-existing-player-check-\$\{c\.id\}`\}/)
    expect(src).toMatch(/data-testid=\{`link-existing-player-team-\$\{c\.id\}`\}/)
    expect(src).toMatch(/data-testid=\{`link-existing-player-other-leagues-\$\{c\.id\}`\}/)
  })

  it('uses adminLinkExistingPlayer for single-link path (cleaner error surfacing)', () => {
    const src = stripComments(read(dialogPath))
    // The dialog branches: 1 selected → call adminLinkExistingPlayer; >1 → call bulk.
    expect(src).toMatch(/selectedItems\.length === 1/)
    expect(src).toMatch(/adminLinkExistingPlayer\(\{/)
  })

  it('disables submit when no selections OR when any selected row has no team', () => {
    const src = read(dialogPath)
    expect(src).toMatch(/disabled=\{[\s\S]{0,100}selectedCount === 0[\s\S]{0,100}hasUnassignedTeam/)
  })

  it('avatar uses AdminPlayerAvatar with profilePictureUrl + pictureUrl props', () => {
    const src = stripComments(read(dialogPath))
    expect(src).toMatch(/<AdminPlayerAvatar\b[\s\S]{0,200}profilePictureUrl=\{c\.profilePictureUrl\}/)
    expect(src).toMatch(/<AdminPlayerAvatar\b[\s\S]{0,200}pictureUrl=\{c\.pictureUrl\}/)
  })
})

describe('v1.56.0 — PlayersTab integration', () => {
  const tabPath = 'src/components/admin/PlayersTab.tsx'

  it('imports LinkExistingPlayerDialog and the LinkablePlayerRow type', () => {
    const src = stripComments(read(tabPath))
    expect(src).toMatch(/import\s+LinkExistingPlayerDialog,?\s*\{[^}]*LinkablePlayerRow[^}]*\}\s+from\s+['"]\.\/LinkExistingPlayerDialog['"]/)
  })

  it('accepts new linkableCandidates? prop on PlayersTabProps', () => {
    const src = stripComments(read(tabPath))
    expect(src).toMatch(/linkableCandidates\?:\s*LinkablePlayerRow\[\]/)
  })

  it('mounts <LinkExistingPlayerDialog> in the toolbar (next to AddPlayerDialog)', () => {
    const src = stripComments(read(tabPath))
    expect(src).toMatch(
      /<AddPlayerDialog[\s\S]{0,400}<LinkExistingPlayerDialog/,
    )
  })

  it('threads linkableCandidates prop through to the dialog', () => {
    const src = read(tabPath)
    expect(src).toMatch(/<LinkExistingPlayerDialog[\s\S]{0,400}candidates=\{linkableCandidates\}/)
  })

  it('PlayerRow type accepts optional otherLeagues field', () => {
    const src = stripComments(read(tabPath))
    expect(src).toMatch(/otherLeagues\?:\s*string\[\]/)
  })

  it('renders mobile "Also in: <league>" chip when otherLeagues is non-empty', () => {
    const src = read(tabPath)
    expect(src).toMatch(
      /player\.otherLeagues\s*&&\s*player\.otherLeagues\.length\s*>\s*0[\s\S]{0,800}data-testid=\{`player-other-leagues-mobile-\$\{player\.id\}`\}/,
    )
  })

  it('renders desktop "Also in: <league>" chip with the desktop testid', () => {
    const src = read(tabPath)
    expect(src).toMatch(/data-testid=\{`player-other-leagues-\$\{player\.id\}`\}/)
  })
})

describe('v1.56.0 — page-level data wiring', () => {
  const pagePath = 'src/app/admin/leagues/[id]/players/page.tsx'

  it('imports getLinkablePlayersForLeague + getPlayerOtherLeaguesForLeague', () => {
    const src = read(pagePath)
    expect(src).toMatch(/getLinkablePlayersForLeague/)
    expect(src).toMatch(/getPlayerOtherLeaguesForLeague/)
  })

  it('fetches both helpers in parallel via Promise.all', () => {
    const src = stripComments(read(pagePath))
    expect(src).toMatch(/await\s+Promise\.all\(\[[\s\S]+getLinkablePlayersForLeague\(id\)[\s\S]+getPlayerOtherLeaguesForLeague\(id\)/)
  })

  it('threads linkableCandidates to <PlayersTab>', () => {
    const src = read(pagePath)
    expect(src).toMatch(/<PlayersTab[\s\S]{0,400}linkableCandidates=\{linkableCandidates\}/)
  })

  it('populates each playerMap row with otherLeagues from otherLeaguesByPlayerId', () => {
    const src = read(pagePath)
    expect(src).toMatch(/otherLeagues:\s*otherLeaguesByPlayerId\[a\.player\.id\]\s*\?\?\s*\[\]/)
  })
})

describe('v1.56.0 — admin-data helpers', () => {
  const dataPath = 'src/lib/admin-data.ts'

  it('exports getLinkablePlayersForLeague', () => {
    const src = stripComments(read(dataPath))
    expect(src).toMatch(/export\s+async\s+function\s+getLinkablePlayersForLeague\s*\(/)
  })

  it('exports getPlayerOtherLeaguesForLeague', () => {
    const src = stripComments(read(dataPath))
    expect(src).toMatch(/export\s+async\s+function\s+getPlayerOtherLeaguesForLeague\s*\(/)
  })

  it('getLinkablePlayersForLeague filters by NOT-IN current-league active assignments', () => {
    const src = stripComments(read(dataPath))
    // The helper queries playerLeagueMembership.findMany with toGameWeek: null
    // and leagueTeam.leagueId, then filters players by NOT IN that set.
    expect(src).toMatch(/playerLeagueMembership\.findMany\(\{[\s\S]{0,200}toGameWeek:\s*null[\s\S]{0,200}leagueTeam:\s*\{\s*leagueId\s*\}/)
    expect(src).toMatch(/inThisLeague\.has\(p\.id\)/)
  })

  it('getLinkablePlayersForLeague projects otherLeagues from active assignments', () => {
    const src = stripComments(read(dataPath))
    // The map call extracts league.name from each leagueAssignments row.
    expect(src).toMatch(/leagueAssignments[\s\S]{0,200}leagueTeam:\s*\{\s*select:\s*\{\s*league/)
  })

  it('getPlayerOtherLeaguesForLeague excludes the supplied leagueId from results', () => {
    const src = stripComments(read(dataPath))
    expect(src).toMatch(/leagueId:\s*\{\s*not:\s*leagueId\s*\}/)
  })
})
