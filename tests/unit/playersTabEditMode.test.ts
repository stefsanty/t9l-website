/**
 * v1.41.0 — Admin PlayersTab edit-mode redesign.
 *
 * Pre-v1.41.0 the player name in PlayersTab rendered as a permanent
 * `PillEditor variant="text"` — dotted-underline + click-to-swap-input
 * editor that was always visible on every row. The user's audit ("there
 * is more space" once the inline edit affordance is gone) drove the
 * conversion: display mode is now compact static text, edit mode lives
 * inside a per-row `EditPlayerPanel` toggled by a pencil button next
 * to the kebab. Name AND position are now editable in the same panel
 * (position was previously only set via `adminCreatePlayer` /
 * `submitOnboarding` — admins had no surface to fix it).
 *
 * Three load-bearing surfaces pinned here:
 *   1. PlayersTab — the always-on `PillEditor` for name is gone;
 *      mobile + desktop render plain `<p>` tags. A pencil button +
 *      `EditPlayerPanel` mount appear in both layouts.
 *   2. EditPlayerPanel — has a name input, a position select with the
 *      4 PlayerPosition enum values + a "no position" option, Save +
 *      Cancel buttons, and dirty / invalid gating on Save.
 *   3. adminUpdatePlayerPosition server action — exists with the right
 *      input shape, validates, accepts the 4 enum values + null, and
 *      uses the canonical `revalidate` helper.
 *
 * Structural tests (file content) — RTL not set up; grep + regex
 * against source files is the established pattern for this project.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(__dirname, '..', '..')
const PLAYERS_TAB = readFileSync(
  join(REPO, 'src/components/admin/PlayersTab.tsx'),
  'utf8',
)
const LEAGUES_ACTIONS = readFileSync(
  join(REPO, 'src/app/admin/leagues/actions.ts'),
  'utf8',
)

describe('v1.41.0 — PlayersTab display mode (no inline name PillEditor)', () => {
  it('the always-on `PillEditor variant="text"` for player.name is gone', () => {
    // The v1.20.0 inline editor was rendered with `variant="text"` and
    // `value={player.name ?? ''}` in a single JSX element. Pin removal
    // by asserting that combination no longer appears in PlayersTab.
    expect(PLAYERS_TAB).not.toMatch(/variant="text"[\s\S]*?value=\{player\.name \?\? ''\}/)
  })

  it('PillEditor is no longer imported into PlayersTab', () => {
    // The v1.41.0 refactor drops PillEditor from PlayersTab entirely
    // (no other call site remains). The variant still exists in
    // PillEditor.tsx for future callers — this test pins that the
    // PlayersTab import line specifically is gone.
    expect(PLAYERS_TAB).not.toMatch(/from\s+['"]\.\/PillEditor['"]/)
  })

  it('renders the player name as a plain <p> (mobile + desktop) with the v1.41.0 testid pair', () => {
    // Both branches set `data-testid="player-name-..."` on a <p> with
    // condensed-display typography. Pre-v1.41.0 the testid existed only
    // on the PillEditor display fallback; the new contract is plain text.
    expect(PLAYERS_TAB).toMatch(/data-testid=\{`player-name-mobile-\$\{player\.id\}`\}/)
    expect(PLAYERS_TAB).toMatch(/data-testid=\{`player-name-\$\{player\.id\}`\}/)
  })

  it('the desktop kebab column widens to 80px to fit the pencil + kebab pair', () => {
    // Pre-v1.41.0 the grid ended in 40px (kebab only). Post-v1.41.0
    // the grid ends in 80px to host both the pencil edit button and
    // the kebab on the same row. The matching update on
    // playersTabRedesign.test.ts pins the new width too.
    expect(PLAYERS_TAB).toMatch(/gridTemplateColumns:\s*['"]32px\s+40px\s+1fr\s+140px\s+60px\s+110px\s+80px['"]/)
  })

  it('the per-row pencil button has the expected testid in both layouts', () => {
    expect(PLAYERS_TAB).toMatch(/data-testid=\{`player-edit-button-mobile-\$\{player\.id\}`\}/)
    expect(PLAYERS_TAB).toMatch(/data-testid=\{`player-edit-button-\$\{player\.id\}`\}/)
  })

  it('the pencil button toggles the editPanelId state (single-open)', () => {
    // editPanelId is a string | null state; clicking the same row's
    // pencil twice closes the panel. Pin both the state declaration
    // and the toggle handler shape.
    expect(PLAYERS_TAB).toMatch(/const \[editPanelId, setEditPanelId\]/)
    expect(PLAYERS_TAB).toMatch(
      /setEditPanelId\(editPanelId === player\.id \? null : player\.id\)/,
    )
  })

  it('the EditPlayerPanel mounts below the row in both layouts when editPanelId matches', () => {
    // The conditional render pattern mirrors TransferPanel — wrapped in
    // `{editPanelId === player.id && (...)}`. Two occurrences (mobile
    // card + desktop row).
    const matches = PLAYERS_TAB.match(/editPanelId === player\.id && \(/g) ?? []
    expect(matches.length).toBe(2)
  })
})

describe('v1.41.0 — EditPlayerPanel component', () => {
  it('is defined inside PlayersTab.tsx', () => {
    expect(PLAYERS_TAB).toMatch(/function EditPlayerPanel\(/)
  })

  it('initializes the name field from player.name (or empty string when null)', () => {
    expect(PLAYERS_TAB).toMatch(/useState<string>\(player\.name \?\? ''\)/)
  })

  it('v1.82.0 — initializes the positions[] field from player.positions (with legacy fallback)', () => {
    // Defensive shape — PlayerRow.positions is the canonical source;
    // PlayerRow.position remains for backward-compat fallback.
    expect(PLAYERS_TAB).toMatch(
      /if \(player\.positions && player\.positions\.length > 0\) return \[\.\.\.player\.positions\]/,
    )
    expect(PLAYERS_TAB).toMatch(/return player\.position \? \[player\.position\] : \[\]/)
  })

  it('Save fires only adminUpdatePlayerName when only the name changed', () => {
    // The handleSave guard skips position writes when positionsChanged
    // is false. Pin the conditional shape.
    expect(PLAYERS_TAB).toMatch(/if \(nameChanged\) \{[\s\S]+?adminUpdatePlayerName/)
    expect(PLAYERS_TAB).toMatch(/if \(positionsChanged\) \{[\s\S]+?adminUpdatePlayerPosition/)
  })

  it('v1.82.0 — Save passes positions[] (new contract) to adminUpdatePlayerPosition', () => {
    expect(PLAYERS_TAB).toMatch(/adminUpdatePlayerPosition\(\{[\s\S]+?positions,/)
  })

  it('Save is disabled when the form is not dirty OR the name is invalid', () => {
    expect(PLAYERS_TAB).toMatch(/disabled=\{!dirty \|\| nameInvalid \|\| pending\}/)
  })

  it('Cancel discards local form state and closes the panel', () => {
    // The Cancel button calls onClose directly — local state lives in
    // the panel and is destroyed on unmount. Pin the Cancel onClick.
    const panelIdx = PLAYERS_TAB.indexOf('function EditPlayerPanel(')
    expect(panelIdx).toBeGreaterThan(0)
    const panelBody = PLAYERS_TAB.slice(panelIdx, panelIdx + 7000)
    expect(panelBody).toMatch(/data-testid=\{`player-edit-cancel-\$\{player\.id\}`\}/)
    expect(panelBody).toMatch(/onClick=\{onClose\}/)
  })

  it('v1.82.0 — uses PositionMultiSelect chip picker (vocabulary keys off ballType)', () => {
    expect(PLAYERS_TAB).toMatch(/import PositionMultiSelect from '@\/components\/PositionMultiSelect'/)
    // EditPlayerPanel renders the multi-select with the league's ballType.
    expect(PLAYERS_TAB).toMatch(/<PositionMultiSelect[\s\S]+?ballType=\{ballType\}/)
  })

  it('exposes data-testids for the name input + position select + save button', () => {
    expect(PLAYERS_TAB).toMatch(/data-testid=\{`player-edit-panel-\$\{player\.id\}`\}/)
    expect(PLAYERS_TAB).toMatch(/data-testid=\{`player-edit-name-input-\$\{player\.id\}`\}/)
    expect(PLAYERS_TAB).toMatch(/data-testid=\{`player-edit-position-select-\$\{player\.id\}`\}/)
    expect(PLAYERS_TAB).toMatch(/data-testid=\{`player-edit-save-\$\{player\.id\}`\}/)
  })
})

describe('v1.41.0 — adminUpdatePlayerPosition server action', () => {
  it('is exported from src/app/admin/leagues/actions.ts', () => {
    expect(LEAGUES_ACTIONS).toMatch(/export\s+async\s+function\s+adminUpdatePlayerPosition/)
  })

  it('v1.82.0 — accepts a positions[] array (per-format vocabulary)', () => {
    expect(LEAGUES_ACTIONS).toMatch(
      /adminUpdatePlayerPosition\(input: \{[\s\S]+?positions:\s*ReadonlyArray<string>/,
    )
  })

  it('v1.82.0 — validates positions through normalizePositions + dual-writes legacy enum', () => {
    expect(LEAGUES_ACTIONS).toMatch(
      /const validatedPositions = normalizePositions\(\s*input\.positions,/,
    )
    expect(LEAGUES_ACTIONS).toMatch(
      /const legacyPosition = legacyPositionFromArray\(validatedPositions\)/,
    )
  })

  it('uses the canonical revalidate helper rather than direct revalidatePath / revalidateTag', () => {
    // Per CLAUDE.md v1.16.0 standing rule. The lint guard at
    // tests/unit/revalidatePrimitivesGuard.test.ts covers the global
    // contract; this test pins the call site shape inside the action.
    const fnIdx = LEAGUES_ACTIONS.indexOf('export async function adminUpdatePlayerPosition')
    expect(fnIdx).toBeGreaterThan(0)
    const fnBody = LEAGUES_ACTIONS.slice(fnIdx, fnIdx + 2000)
    expect(fnBody).toMatch(
      /revalidate\(\{ domain: 'admin', paths: \[`\/admin\/leagues\/\$\{leagueId\}\/players`\] \}\)/,
    )
  })

  it('rejects empty playerId before touching Prisma (v1.65.4 — writes to PLM)', () => {
    const fnIdx = LEAGUES_ACTIONS.indexOf('export async function adminUpdatePlayerPosition')
    const fnBody = LEAGUES_ACTIONS.slice(fnIdx, fnIdx + 1500)
    // Validation order: assertAdmin, then `if (!playerId) throw`. The
    // throw comes BEFORE the Prisma update so the action can't no-op an
    // arbitrary row. v1.65.4 — position now writes to playerLeagueMembership,
    // not Player.
    const idGuardIdx = fnBody.indexOf("if (!playerId) throw new Error('playerId is required')")
    const updateIdx = fnBody.indexOf('prisma.playerLeagueMembership.updateMany')
    expect(idGuardIdx).toBeGreaterThan(0)
    expect(updateIdx).toBeGreaterThan(idGuardIdx)
    // v1.82.0 — the updateMany payload now dual-writes positions[] +
    // the legacy enum bucketed via legacyPositionFromArray().
    // v1.86.0 — also writes preferredPositions + secondaryPositions.
    expect(fnBody).toMatch(/data:\s*\{\s*positions:\s*validatedPositions/)
    expect(fnBody).toMatch(/preferredPositions:\s*validatedPositions/)
    expect(fnBody).toMatch(/secondaryPositions:\s*\[\]/)
    expect(fnBody).toMatch(/position:\s*legacyPosition/)
  })

  it('PlayersTab imports the new action alongside adminUpdatePlayerName', () => {
    expect(PLAYERS_TAB).toMatch(
      /import\s+\{[\s\S]+?adminUpdatePlayerName,[\s\S]+?adminUpdatePlayerPosition,[\s\S]+?\}\s+from\s+'@\/app\/admin\/leagues\/actions'/,
    )
  })
})
