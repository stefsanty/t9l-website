/**
 * v1.83.0 — multi-league redesign of /account/player.
 *
 * Pre-v1.83.0 (under v1.82.0):
 *   - The page resolved `getDefaultLeagueId()` and surfaced one PLM.
 *   - The form passed a SINGLE `initialPositions` + `ballType` +
 *     `currentTeamName` — only ONE league.
 *   - `updatePlayerSelf` accepted positions[] and wrote them to EVERY
 *     active membership, validating per-league but cross-bleeding the
 *     same array. A multi-league user couldn't represent different
 *     positions per league.
 *
 * v1.83.0:
 *   - Page reads ALL active memberships and builds one
 *     `LeagueCardData` per row.
 *   - Form accepts `leagues: LeagueCardData[]` (not scalar
 *     team/position/ballType props), renders one card per league.
 *   - Server actions split into `updatePlayerProfile({ name })` and
 *     `updatePlayerLeague({ leagueId, positions, idShared })`. The
 *     per-league action's owner gate scopes writes to one PLM.
 *
 * Structural assertions on the source — these regression-target the
 * specific failure modes that produced the v1.82.0 multi-league bug
 * (and would re-introduce it if reverted).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')

function read(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf-8')
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
}

describe('v1.83.0 — page reads ALL active memberships, not just default league', () => {
  const PAGE = 'src/app/account/player/page.tsx'

  it('builds a leagues array from active memberships (toGameWeek === null)', () => {
    const src = stripComments(read(PAGE))
    expect(src).toMatch(/leagues:\s*LeagueCardData\[\]|leagueCards/)
    expect(src).toMatch(/toGameWeek\s*===\s*null/)
  })

  it('regression-target — does NOT short-circuit to a single activeAssignment scalar', () => {
    const src = stripComments(read(PAGE))
    // Pre-v1.83.0 the page picked one `activeAssignment` and passed
    // scalar `currentTeamName` / `currentLeagueName` / `initialPositions`
    // / `ballType` props. The new form accepts `leagues: [...]` only —
    // those scalar props are gone.
    expect(src).not.toMatch(/initialPositions:\s*\[?\.\.\.\s*sourceAssignment/)
    expect(src).not.toMatch(/currentTeamName:\s*activeAssignment/)
    expect(src).not.toMatch(/currentLeagueName:\s*activeAssignment/)
    expect(src).not.toMatch(/const\s+sourceAssignment\s*=/)
  })

  it('passes leagues prop to AccountPlayerForm', () => {
    const src = stripComments(read(PAGE))
    expect(src).toMatch(/leagues:\s*leagueCards/)
  })

  it('orders cards: default league first', () => {
    const src = stripComments(read(PAGE))
    expect(src).toMatch(/isDefaultLeague/)
    expect(src).toMatch(/getDefaultLeagueId/)
  })

  it('eager-loads league.positionFees for the per-card fee resolver', () => {
    const src = stripComments(read(PAGE))
    expect(src).toMatch(/positionFees:/)
    expect(src).toMatch(/resolvePlayerFee/)
  })
})

describe('v1.83.0 — server actions split into profile + per-league', () => {
  const ACTIONS = 'src/app/account/player/actions.ts'

  it('exports `updatePlayerProfile` (player-level)', () => {
    const src = stripComments(read(ACTIONS))
    expect(src).toMatch(/export\s+async\s+function\s+updatePlayerProfile\s*\(/)
  })

  it('exports `updatePlayerLeague` (per-league, scoped)', () => {
    const src = stripComments(read(ACTIONS))
    expect(src).toMatch(/export\s+async\s+function\s+updatePlayerLeague\s*\(/)
  })

  it("regression-target — the monolithic `updatePlayerSelf` is gone (no cross-league bleed)", () => {
    const src = stripComments(read(ACTIONS))
    // Re-introducing `updatePlayerSelf` (the pre-v1.83.0 monolithic
    // action that wrote one positions[] to every active membership)
    // restores the multi-league overwrite bug. This guards against it.
    expect(src).not.toMatch(/export\s+async\s+function\s+updatePlayerSelf/)
  })

  it('updatePlayerLeague owner gate scopes lookup to (playerId, leagueId, toGameWeek === null)', () => {
    const src = stripComments(read(ACTIONS))
    const fn = src.slice(
      src.indexOf('export async function updatePlayerLeague'),
      src.indexOf('export async function uploadPlayerProfilePicture'),
    )
    expect(fn).toMatch(/findFirst[\s\S]*?playerId[\s\S]*?leagueId:\s*input\.leagueId[\s\S]*?toGameWeek:\s*null/m)
  })

  it("regression-target — updatePlayerLeague does NOT use `where: { playerId, toGameWeek: null }` alone (pre-v1.83.0 bleed shape)", () => {
    const src = stripComments(read(ACTIONS))
    // Pre-v1.83.0 the write was `updateMany({ playerId, toGameWeek: null })`
    // which targets EVERY active membership — the cross-league bleed
    // bug. Post-v1.83.0 every PLM write must be scoped to leagueId too.
    const updateMany = [...src.matchAll(/playerLeagueMembership\.updateMany\(\s*\{[\s\S]*?\}\s*\)/g)]
    for (const m of updateMany) {
      expect(m[0]).toMatch(/leagueId/)
    }
  })

  it('updatePlayerLeague validates positions per the league ballType', () => {
    const src = stripComments(read(ACTIONS))
    expect(src).toMatch(/normalizePositions/)
    expect(src).toMatch(/legacyPositionFromArray/)
  })

  it('updatePlayerLeague writes idShared when supplied', () => {
    const src = stripComments(read(ACTIONS))
    const fn = src.slice(
      src.indexOf('export async function updatePlayerLeague'),
      src.indexOf('export async function uploadPlayerProfilePicture'),
    )
    expect(fn).toMatch(/idShared/)
  })

  it('updatePlayerProfile does NOT touch any PLM rows (player-level only)', () => {
    const src = stripComments(read(ACTIONS))
    const fn = src.slice(
      src.indexOf('export async function updatePlayerProfile'),
      src.indexOf('export async function updatePlayerLeague'),
    )
    expect(fn).not.toMatch(/playerLeagueMembership/)
  })
})

describe('v1.83.0 — form renders per-league cards', () => {
  const FORM = 'src/app/account/player/AccountPlayerForm.tsx'

  it('imports updatePlayerProfile + updatePlayerLeague (not updatePlayerSelf)', () => {
    const src = stripComments(read(FORM))
    expect(src).toMatch(/import[\s\S]*?updatePlayerProfile[\s\S]*?from\s*['"]\.\/actions['"]/m)
    expect(src).toMatch(/import[\s\S]*?updatePlayerLeague[\s\S]*?from\s*['"]\.\/actions['"]/m)
    expect(src).not.toMatch(/import[\s\S]*?updatePlayerSelf/)
  })

  it('exports LeagueCardData type (the per-card data shape)', () => {
    const src = stripComments(read(FORM))
    expect(src).toMatch(/export\s+interface\s+LeagueCardData/)
  })

  it('renders one card per league via map', () => {
    const src = stripComments(read(FORM))
    expect(src).toMatch(/props\.leagues\.map/)
    expect(src).toMatch(/<LeagueCard\b/)
  })

  it('NoLeaguesNotice covers the empty active-memberships branch', () => {
    const src = stripComments(read(FORM))
    expect(src).toMatch(/NoLeaguesNotice/)
    expect(src).toMatch(/data-testid="no-leagues-notice"/)
  })

  it('LeagueCard wires position chips to the card own ballType (per-league vocab)', () => {
    const src = stripComments(read(FORM))
    expect(src).toMatch(/ballType=\{league\.ballType\}/)
  })

  it('LeagueCard saves via updatePlayerLeague with the card leagueId', () => {
    const src = stripComments(read(FORM))
    expect(src).toMatch(/updatePlayerLeague\(\s*\{\s*leagueId:\s*league\.leagueId/m)
  })

  it('regression-target — LeagueCard sends scoped positions/idShared, not a global update', () => {
    const src = stripComments(read(FORM))
    // Reverting to a global `updatePlayerSelf({ positions })` shape
    // would be a regression. v1.86.0: the card sends preferredPositions +
    // secondaryPositions (not the legacy `positions`) as partial updates.
    expect(src).toMatch(/positionsChanged\s*\?\s*preferred\s*:\s*undefined/)
    expect(src).toMatch(/idSharedChanged\s*\?\s*idShared\s*:\s*undefined/)
  })

  it('renders application-pending badge when applicationStatus === PENDING', () => {
    const src = stripComments(read(FORM))
    expect(src).toMatch(/applicationStatus\s*===\s*['"]PENDING['"]/)
    expect(src).toMatch(/Application pending/)
  })

  it('renders paid/unpaid badges based on paidStatus', () => {
    const src = stripComments(read(FORM))
    expect(src).toMatch(/paidStatus\s*===\s*['"]PAID['"]/)
  })

  it('renders idShared toggle (per-league consent)', () => {
    const src = stripComments(read(FORM))
    expect(src).toMatch(/league-card-id-shared-/)
    expect(src).toMatch(/Share my uploaded ID/)
  })

  it('renders applicant comments (read-only) when present', () => {
    const src = stripComments(read(FORM))
    expect(src).toMatch(/league\.comments/)
    expect(src).toMatch(/Your application notes/)
  })
})
