/**
 * v1.38.0 (PR κ) — admin player list redesign.
 *
 * Pin the new column structure and decluttering decisions so a future
 * regression that re-introduces the inline action buttons or removes
 * the avatar/sign-in column gets caught at CI:
 *
 *   - Removed: StatusBadge column ("ACTIVE/SCHEDULED" badge), GW1+
 *     inline assignment tally, inline per-row Reset/ID/Invite/Transfer/
 *     Remove buttons.
 *   - Added: Avatar column leftmost, Position column, Sign-in status
 *     pill column, OverflowMenu kebab.
 *   - Per-row actions all live in `buildPlayerMenuItems` now.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const PLAYERS_TAB = readFileSync(
  join(ROOT, 'src', 'components', 'admin', 'PlayersTab.tsx'),
  'utf-8',
)

function stripComments(s: string): string {
  // Strip line + block comments (rough — JSX is forgiving). Keeps strings
  // intact since we're looking for code patterns, not comment text.
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

const cleaned = stripComments(PLAYERS_TAB)

describe('v1.38.0 (PR κ) — column structure changes', () => {
  it('imports the new AdminPlayerAvatar component', () => {
    expect(cleaned).toMatch(/import\s+AdminPlayerAvatar\s+from\s+['"]\.\/AdminPlayerAvatar['"]/)
  })

  it('imports the new SignInStatusBadge component', () => {
    expect(cleaned).toMatch(/import\s+SignInStatusBadge\s+from\s+['"]\.\/SignInStatusBadge['"]/)
  })

  it('imports OverflowMenu from MatchOverflowMenu (re-export pattern)', () => {
    expect(cleaned).toMatch(/import\s+OverflowMenu\s+from\s+['"]\.\/MatchOverflowMenu['"]/)
  })

  it('threads pickSignInStatus into the row render', () => {
    expect(cleaned).toMatch(/import\s+\{\s*pickSignInStatus\s*\}\s+from\s+['"]@\/lib\/playerSignInStatus['"]/)
    expect(cleaned).toMatch(/pickSignInStatus\(\{[\s\S]*?userId:\s*player\.userId/)
  })

  it("removes the legacy StatusBadge import (badge column was 'Active'/'Scheduled')", () => {
    // The legacy admin StatusBadge surfaced ACTIVE/SCHEDULED on every
    // row — clutter per the user's audit. It's still used by other
    // admin tabs, just not by PlayersTab anymore.
    expect(cleaned).not.toMatch(/import\s+StatusBadge/)
  })

  it('removes the inline GW1+ assignment tally', () => {
    // The pre-κ row showed `GW${current.fromGameWeek}${...}` next to the
    // status badge. Both are gone now.
    expect(cleaned).not.toMatch(/`GW\$\{current\.fromGameWeek\}/)
  })

  it('removes the LineInfoCell / LineInfoMobile components', () => {
    // Those collapsed into the new Avatar column + the LINE-name
    // sub-line under Player.name. Their helper functions and components
    // shouldn't be in the file.
    expect(cleaned).not.toMatch(/function LineInfoCell\b/)
    expect(cleaned).not.toMatch(/function LineInfoMobile\b/)
    expect(cleaned).not.toMatch(/function LineAvatar\b/)
  })

  it('renders the avatar leftmost in mobile + desktop', () => {
    // Two AdminPlayerAvatar invocations: one for mobile card, one for
    // desktop grid row.
    const matches = cleaned.match(/<AdminPlayerAvatar\b/g) ?? []
    expect(matches.length).toBe(2)
  })

  it('renders the SignInStatusBadge in mobile + desktop', () => {
    const matches = cleaned.match(/<SignInStatusBadge\b/g) ?? []
    expect(matches.length).toBe(2)
  })

  it('renders the OverflowMenu kebab in mobile + desktop', () => {
    const matches = cleaned.match(/<OverflowMenu\b/g) ?? []
    expect(matches.length).toBe(2)
  })

  it('the desktop grid uses 7 columns: chk, avatar, name, team, pos, sign-in, kebab', () => {
    // The header + each row sets gridTemplateColumns. Tally tokens.
    // v1.41.0 — final column widened from 40px to 80px so the row's
    // pencil "Edit" button fits next to the kebab.
    expect(cleaned).toMatch(/gridTemplateColumns:\s*['"]32px\s+40px\s+1fr\s+140px\s+60px\s+110px\s+80px['"]/)
  })

  it('builds the per-row menu via the buildPlayerMenuItems helper', () => {
    expect(cleaned).toMatch(/function buildPlayerMenuItems\b/)
    // Both rows pass through the same builder via items={buildPlayerMenuItems(...)}.
    // The function definition has its own occurrence; count call sites
    // by looking for the JSX `items={buildPlayerMenuItems(...)}` pattern.
    const callSites = cleaned.match(/items=\{buildPlayerMenuItems\(/g) ?? []
    expect(callSites.length).toBe(2)
  })

  it('the kebab menu offers Generate invite / Reset onboarding / View ID / Transfer / Remap / Unlink / Remove', () => {
    expect(cleaned).toMatch(/label:\s*['"]Generate invite['"]/)
    expect(cleaned).toMatch(/label:\s*['"]Reset onboarding['"]/)
    expect(cleaned).toMatch(/label:\s*['"]View ID['"]/)
    expect(cleaned).toMatch(/['"]Transfer to team…['"]/) // "Transfer to team…"
    expect(cleaned).toMatch(/label:\s*['"]Remap LINE link['"]/)
    expect(cleaned).toMatch(/label:\s*['"]Unlink LINE['"]/)
    expect(cleaned).toMatch(/label:\s*['"]Remove from league['"]/)
  })

  it('Position column renders Player.position (or em-dash placeholder)', () => {
    expect(cleaned).toMatch(/data-testid=\{`player-position-\$\{player\.id\}`\}/)
  })

  it('Sign-in status column receives the resolved status via SignInStatusBadge.status', () => {
    expect(cleaned).toMatch(/<SignInStatusBadge\s+status=\{signInStatus\}/)
  })

  it('the avatar receives all four URL sources (priority: profile → picture → linePicture → initials)', () => {
    // The component itself validates the priority via pickPlayerAvatarUrl
    // (tested separately). Here we just pin that the row passes all
    // three URL props so a future refactor doesn't drop one of them.
    expect(cleaned).toMatch(/profilePictureUrl=\{player\.profilePictureUrl\}/)
    expect(cleaned).toMatch(/pictureUrl=\{player\.pictureUrl\}/)
    expect(cleaned).toMatch(/linePictureUrl=\{player\.linePictureUrl\}/)
  })
})

describe('v1.38.0 (PR κ) — kebab menu visibility rules', () => {
  it('Generate invite is conditional on !player.lineId', () => {
    expect(cleaned).toMatch(/if\s*\(\s*!player\.lineId\s*\)\s*\{\s*items\.push\(\s*\{\s*label:\s*['"]Generate invite['"]/)
  })

  it('Reset onboarding is conditional on current?.onboardingStatus === "COMPLETED"', () => {
    expect(cleaned).toMatch(/if\s*\(\s*current\?\.onboardingStatus\s*===\s*['"]COMPLETED['"]\s*\)/)
  })

  it('View ID is conditional on player.idUploadedAt', () => {
    expect(cleaned).toMatch(/if\s*\(\s*player\.idUploadedAt\s*\)\s*\{\s*items\.push\(\s*\{\s*label:\s*['"]View ID['"]/)
  })

  it('Remap + Unlink are both conditional on player.lineId (linked players only)', () => {
    expect(cleaned).toMatch(/if\s*\(\s*player\.lineId\s*\)\s*\{[\s\S]*?Remap LINE link[\s\S]*?Unlink LINE/)
  })

  it('Remove from league is unconditional (always available)', () => {
    // Renders outside any conditional in the builder, last item.
    expect(cleaned).toMatch(/items\.push\(\s*\{\s*label:\s*['"]Remove from league['"]/)
  })
})
