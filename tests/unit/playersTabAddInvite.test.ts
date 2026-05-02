/**
 * v1.33.0 (PR ε) — structural assertions for the new Add Player +
 * Generate Invite affordances on the admin Players tab.
 *
 * No real DOM render (jsdom + RTL would be a project-wide setup change).
 * Read source files as text and assert the load-bearing wiring:
 *   - PlayersTab imports both new dialog components.
 *   - Add Player button mounts at the toolbar.
 *   - Per-row Invite button mounts in both desktop AND mobile branches.
 *   - Bulk-select checkbox column exists on desktop with a select-all
 *     header checkbox.
 *   - GenerateInviteDialog mounts in both single + bulk modes.
 *   - AddPlayerDialog uses the canonical adminCreatePlayer + adminGenerateInvite.
 *   - InviteDisplay surfaces the canonical code/URL/QR + copy buttons +
 *     skipOnboarding badge.
 *   - GenerateInviteDialog has a CSV download trigger in bulk mode.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const PLAYERS_TAB = readFileSync(
  join(ROOT, 'src', 'components', 'admin', 'PlayersTab.tsx'),
  'utf-8',
)
const ADD_PLAYER = readFileSync(
  join(ROOT, 'src', 'components', 'admin', 'AddPlayerDialog.tsx'),
  'utf-8',
)
const GEN_INVITE = readFileSync(
  join(ROOT, 'src', 'components', 'admin', 'GenerateInviteDialog.tsx'),
  'utf-8',
)
const INVITE_DISPLAY = readFileSync(
  join(ROOT, 'src', 'components', 'admin', 'InviteDisplay.tsx'),
  'utf-8',
)

function stripComments(src: string): string {
  // Strip JSX line comments + block comments + // line comments so doc
  // text doesn't trip the asserts.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
}

describe('v1.33.0 (PR ε) — PlayersTab integration', () => {
  const cleaned = stripComments(PLAYERS_TAB)

  it('imports AddPlayerDialog + GenerateInviteDialog', () => {
    expect(cleaned).toMatch(/import\s+AddPlayerDialog\s+from\s+['"]\.\/AddPlayerDialog['"]/)
    expect(cleaned).toMatch(/import\s+GenerateInviteDialog\s+from\s+['"]\.\/GenerateInviteDialog['"]/)
  })

  it('mounts the Add Player button in the toolbar', () => {
    expect(cleaned).toMatch(/<AddPlayerDialog\s/)
  })

  it('per-row Generate Invite menu item is conditional on !player.lineId — only unlinked players (v1.38.0 / PR κ)', () => {
    // PR κ collapsed inline action buttons into the OverflowMenu kebab.
    // The conditional now lives inside `buildPlayerMenuItems`: a
    // "Generate invite" item is pushed only when `!player.lineId`.
    expect(cleaned).toMatch(/if\s*\(\s*!player\.lineId\s*\)\s*\{\s*items\.push\(\s*\{\s*label:\s*['"]Generate invite['"]/)
    // The single-target invite dialog still keys on inviteTargetPlayerId
    // — the kebab's onSelect calls `setInviteTargetPlayerId(player.id)`
    // via the `handlers.onInvite` thread-through.
    expect(cleaned).toMatch(/onInvite:\s*\(\)\s*=>\s*setInviteTargetPlayerId\(player\.id\)/)
  })

  it('Generate Invite menu item is wired through both mobile and desktop buildPlayerMenuItems calls (v1.38.0 / PR κ)', () => {
    // Both mobile and desktop rows pass `handlers.onInvite` into the
    // builder, so the same kebab affordance shows up in both layouts
    // without a duplicate inline button.
    const onInviteCallSites = (
      cleaned.match(/onInvite:\s*\(\)\s*=>\s*setInviteTargetPlayerId/g) ?? []
    ).length
    expect(onInviteCallSites).toBe(2) // one for mobile row, one for desktop row
  })

  it('bulk-select checkbox column is in the desktop grid header (data-testid=bulk-select-all)', () => {
    expect(cleaned).toMatch(/data-testid="bulk-select-all"/)
  })

  it('per-row bulk-select checkbox uses player-id-keyed test-id and is disabled for linked players', () => {
    expect(cleaned).toMatch(/data-testid=\{`bulk-select-\$\{player\.id\}`\}/)
    // Linked players (with lineId) shouldn't be selectable for bulk invite.
    expect(cleaned).toMatch(/disabled=\{!eligibleForInvite\}/)
  })

  it('toolbar shows "Generate N invites" only when ≥1 player is selected', () => {
    expect(cleaned).toMatch(/data-testid="bulk-generate-invites"/)
    expect(cleaned).toMatch(/selectedForBulk\.size\s*>\s*0/)
  })

  it('mounts GenerateInviteDialog in single mode keyed on inviteTargetPlayerId', () => {
    expect(cleaned).toMatch(/<GenerateInviteDialog[\s\S]*?mode="single"/)
    expect(cleaned).toMatch(/inviteTargetPlayerId/)
  })

  it('mounts GenerateInviteDialog in bulk mode keyed on bulkInviteOpen + selectedBulkTargets', () => {
    expect(cleaned).toMatch(/<GenerateInviteDialog[\s\S]*?mode="bulk"/)
    expect(cleaned).toMatch(/bulkInviteOpen/)
  })
})

describe('v1.33.0 (PR ε) — AddPlayerDialog wiring', () => {
  const cleaned = stripComments(ADD_PLAYER)

  it('imports + uses adminCreatePlayer (the new server action)', () => {
    expect(cleaned).toMatch(/adminCreatePlayer/)
    expect(cleaned).toMatch(/from\s+['"]@\/app\/admin\/leagues\/actions['"]/)
  })

  it('imports + uses adminGenerateInvite for the optional create+invite flow', () => {
    expect(cleaned).toMatch(/adminGenerateInvite/)
  })

  it('all three profile fields are optional in the dialog UI (name/team/position)', () => {
    expect(cleaned).toMatch(/data-testid="add-player-name"/)
    expect(cleaned).toMatch(/data-testid="add-player-team"/)
    expect(cleaned).toMatch(/data-testid="add-player-position"/)
  })

  it('renders the four position enum options (GK / DF / MF / FW) plus a "no position" option', () => {
    expect(cleaned).toMatch(/value:\s*['"]GK['"]/)
    expect(cleaned).toMatch(/value:\s*['"]DF['"]/)
    expect(cleaned).toMatch(/value:\s*['"]MF['"]/)
    expect(cleaned).toMatch(/value:\s*['"]FW['"]/)
    expect(cleaned).toMatch(/No position/)
  })

  it('exposes the "Generate invite immediately" affordance with a skipOnboarding sub-checkbox', () => {
    expect(cleaned).toMatch(/data-testid="add-player-generate-invite"/)
    expect(cleaned).toMatch(/data-testid="add-player-skip-onboarding"/)
  })

  it('renders InviteDisplay on success (post-create + invite)', () => {
    expect(cleaned).toMatch(/<InviteDisplay/)
  })
})

describe('v1.33.0 (PR ε) — GenerateInviteDialog wiring', () => {
  const cleaned = stripComments(GEN_INVITE)

  it('imports both single + bulk server actions', () => {
    expect(cleaned).toMatch(/adminGenerateInvite\b/)
    expect(cleaned).toMatch(/adminGenerateInvitesBulk\b/)
  })

  it('exposes a skipOnboarding checkbox for both modes (the user-decided ε flag)', () => {
    expect(cleaned).toMatch(/data-testid="invite-skip-onboarding"/)
  })

  it('bulk mode has a CSV download button (data-testid=bulk-csv-download)', () => {
    expect(cleaned).toMatch(/data-testid="bulk-csv-download"/)
    // The download-CSV branch builds a Blob with text/csv content type
    expect(cleaned).toMatch(/text\/csv/)
  })

  it('renders InviteDisplay on single-mode success', () => {
    expect(cleaned).toMatch(/<InviteDisplay/)
  })

  it('per-row bulk results expose ok/error status with player-id-keyed test ids', () => {
    expect(cleaned).toMatch(/data-testid=\{`bulk-row-\$\{r\.playerId\}`\}/)
    expect(cleaned).toMatch(/data-testid=\{`bulk-error-\$\{r\.playerId\}`\}/)
  })
})

describe('v1.33.0 (PR ε) — InviteDisplay surfaces', () => {
  const cleaned = stripComments(INVITE_DISPLAY)

  it('renders the formatted code (formatInviteCodeForDisplay) + copy button', () => {
    expect(cleaned).toMatch(/formatInviteCodeForDisplay/)
    expect(cleaned).toMatch(/data-testid="invite-code"/)
    expect(cleaned).toMatch(/data-testid="invite-copy-code"/)
  })

  it('renders the join URL + copy button', () => {
    expect(cleaned).toMatch(/data-testid="invite-url"/)
    expect(cleaned).toMatch(/data-testid="invite-copy-url"/)
  })

  it('renders the QR code (lazy-loaded from `qrcode` package as SVG)', () => {
    expect(cleaned).toMatch(/data-testid="invite-qr"/)
    expect(cleaned).toMatch(/import\(['"]qrcode['"]\)/)
    expect(cleaned).toMatch(/type:\s*['"]svg['"]/)
  })

  it('renders the expiry timestamp', () => {
    expect(cleaned).toMatch(/data-testid="invite-expires"/)
  })

  it('renders the skipOnboarding badge ONLY when skipOnboarding=true', () => {
    expect(cleaned).toMatch(/data-testid="invite-skip-onboarding-badge"/)
    expect(cleaned).toMatch(/skipOnboarding\s*&&/)
  })
})
