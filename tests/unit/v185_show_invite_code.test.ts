/**
 * v1.85.0 — "Show invite code" feature: admin can retrieve an existing
 * active invite without regenerating.
 *
 * Regression-target tests. The stash-pop sanity check:
 *   - Tests 1–4 fail if `activeInvite` is reverted to `activeInviteCount`
 *     in PlayersTab / page.tsx / admin-data.ts.
 *   - Test 5 fails if the "Show invite code" menu item is removed or its
 *     condition is wrong.
 *   - Test 6 fails if ViewInviteDialog is deleted.
 *   - Tests 7–8 fail if the admin-data select drops `code` / `skipOnboarding`.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')

function read(rel: string) {
  return readFileSync(join(ROOT, rel), 'utf-8')
}

function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

const PLAYERS_TAB = stripComments(read('src/components/admin/PlayersTab.tsx'))
const PAGE = stripComments(read('src/app/admin/leagues/[id]/players/page.tsx'))
const ADMIN_DATA = stripComments(read('src/lib/admin-data.ts'))
const VIEW_DIALOG = read('src/components/admin/ViewInviteDialog.tsx')

describe('v1.85.0 — activeInvite shape replaces activeInviteCount', () => {
  it('PlayerRow uses activeInvite (nullable object), not activeInviteCount', () => {
    expect(PLAYERS_TAB).toMatch(/activeInvite\s*:\s*\{[^}]*code\s*:\s*string/)
    expect(PLAYERS_TAB).not.toMatch(/activeInviteCount\s*:\s*number/)
  })

  it('page.tsx player map uses activeInvite, not activeInviteCount', () => {
    expect(PAGE).toMatch(/activeInvite\s*:\s*activeInviteByPlayerId/)
    expect(PAGE).not.toMatch(/activeInviteCount\s*:\s*activeInvite/)
  })

  it('admin-data returns activeInviteByPlayerId (record of objects)', () => {
    expect(ADMIN_DATA).toMatch(/activeInviteByPlayerId/)
    expect(ADMIN_DATA).not.toMatch(/activeInviteCountByPlayerId/)
  })

  it('pickSignInStatus is called with derived count from activeInvite', () => {
    expect(PLAYERS_TAB).toMatch(/activeInviteCount\s*:\s*player\.activeInvite\s*\?\s*1\s*:\s*0/)
  })
})

describe('v1.85.0 — menu item branching', () => {
  it('shows "Show invite code" when player has activeInvite', () => {
    expect(PLAYERS_TAB).toMatch(/player\.activeInvite/)
    expect(PLAYERS_TAB).toMatch(/Show invite code/)
  })

  it('keeps "Generate invite" for players without an active invite', () => {
    expect(PLAYERS_TAB).toMatch(/Generate invite/)
  })

  it('onShowInvite handler is wired in both mobile and desktop kebab call sites', () => {
    const matches = PLAYERS_TAB.match(/onShowInvite\s*:/g) ?? []
    // Two call sites (mobile card + desktop table) plus the interface definition
    expect(matches.length).toBeGreaterThanOrEqual(3)
  })
})

describe('v1.85.0 — ViewInviteDialog component', () => {
  it('ViewInviteDialog is imported in PlayersTab', () => {
    expect(PLAYERS_TAB).toMatch(/import\s+ViewInviteDialog\s+from\s+['"]\.\/ViewInviteDialog['"]/)
  })

  it('ViewInviteDialog is mounted when viewInvitePlayerId is set', () => {
    expect(PLAYERS_TAB).toMatch(/viewInvitePlayerId/)
    expect(PLAYERS_TAB).toMatch(/<ViewInviteDialog/)
  })

  it('ViewInviteDialog passes code, expiresAt, skipOnboarding props', () => {
    expect(VIEW_DIALOG).toMatch(/code\s*:/)
    expect(VIEW_DIALOG).toMatch(/expiresAt\s*:/)
    expect(VIEW_DIALOG).toMatch(/skipOnboarding\s*:/)
  })

  it('ViewInviteDialog renders InviteDisplay', () => {
    expect(VIEW_DIALOG).toMatch(/InviteDisplay/)
  })

  it('ViewInviteDialog builds joinUrl from window.location.host', () => {
    expect(VIEW_DIALOG).toMatch(/window\.location\.host/)
    expect(VIEW_DIALOG).toMatch(/buildInviteUrl/)
  })
})

describe('v1.85.0 — admin-data select includes code and skipOnboarding', () => {
  it('leagueInvite select includes code field', () => {
    expect(ADMIN_DATA).toMatch(/code\s*:\s*true/)
  })

  it('leagueInvite select includes skipOnboarding field', () => {
    expect(ADMIN_DATA).toMatch(/skipOnboarding\s*:\s*true/)
  })
})
