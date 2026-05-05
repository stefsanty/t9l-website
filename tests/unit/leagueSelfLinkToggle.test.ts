/**
 * v1.60.0 — per-league self-link toggle.
 *
 * Pins three load-bearing surfaces:
 *
 *   1. **Schema** — `League.allowSelfLink Boolean @default(true)` is added
 *      to the Prisma schema and the migration is purely additive (no DROP,
 *      no ALTER COLUMN, no destructive backfill). Default `true` preserves
 *      backward compat: every existing league behaves exactly as before
 *      v1.60.0.
 *
 *   2. **Page + API gate** — `/assign-player` renders a
 *      `SelfLinkDisabledSurface` when the resolved league has the toggle
 *      OFF; the gate fires AFTER the v1.39.2 non-LINE gate (LINE users
 *      hitting a disabled league still see the disabled surface, not the
 *      need-invite surface — both surfaces point at the invite redemption
 *      flow but with distinct copy). The API POST 403s when the flag is
 *      OFF; DELETE is intentionally NOT gated so already-linked players
 *      can still unlink themselves.
 *
 *   3. **Admin SettingsTab** — wires the toggle into the existing
 *      optimistic-flip-with-rollback pattern (mirror of the data-source
 *      and write-mode toggles). New `setLeagueAllowSelfLink` server
 *      action validates type and busts the canonical caches.
 *
 * Structural tests (file content) rather than render — the existing
 * pattern in `assignPlayerNonLineGate.test.ts` for these gates is content
 * matching, since both the page and the API route pull in next-auth /
 * Prisma / portals which are non-trivial to mock for a presence check.
 * The load-bearing contract is "does the gate exist in the source", not
 * "does React render the right tree from a synthetic session".
 *
 * The schema test is structural too — Prisma 5's introspection on a live
 * DB would give us field-level guarantees, but the schema file is the
 * source of truth and the migration file is what runs in prod, so
 * checking those byte-for-byte is the correct gate for the migration's
 * additive-only contract.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PROJECT_ROOT = join(__dirname, '..', '..')

const SCHEMA_SRC = readFileSync(
  join(PROJECT_ROOT, 'prisma', 'schema.prisma'),
  'utf-8',
)
const MIGRATION_SRC = readFileSync(
  join(
    PROJECT_ROOT,
    'prisma',
    'migrations',
    '20260505100000_league_allow_self_link',
    'migration.sql',
  ),
  'utf-8',
)
const HELPER_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'lib', 'leagueSelfLink.ts'),
  'utf-8',
)
const PAGE_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'app', 'assign-player', 'page.tsx'),
  'utf-8',
)
const ROUTE_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'app', 'api', 'assign-player', 'route.ts'),
  'utf-8',
)
const ACTIONS_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'app', 'admin', 'leagues', 'actions.ts'),
  'utf-8',
)
const SETTINGS_TAB_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'components', 'admin', 'SettingsTab.tsx'),
  'utf-8',
)

describe('schema — League.allowSelfLink (v1.60.0)', () => {
  it('declares allowSelfLink Boolean @default(true) on League', () => {
    // Locate the League model block first so we don't accidentally match
    // a similarly-named field on another model.
    const leagueIdx = SCHEMA_SRC.indexOf('model League {')
    expect(leagueIdx).toBeGreaterThan(0)
    // The model block ends at the next top-level `model ` declaration or
    // EOF. Be conservative and grab the next 2KB which comfortably
    // covers the largest model in this codebase.
    const block = SCHEMA_SRC.slice(leagueIdx, leagueIdx + 2000)
    expect(block).toMatch(/allowSelfLink\s+Boolean\s+@default\(true\)/)
  })

  it('default is true — backward compat invariant', () => {
    // Load-bearing: a default of `false` would silently disable the
    // picker on every existing league at deploy time. Default `true`
    // means the v1.60.0 deploy is a no-op for any league the admin
    // hasn't explicitly toggled off.
    const leagueIdx = SCHEMA_SRC.indexOf('model League {')
    const block = SCHEMA_SRC.slice(leagueIdx, leagueIdx + 2000)
    // Match the exact default — `@default(false)` would fail this test.
    expect(block).not.toMatch(/allowSelfLink\s+Boolean\s+@default\(false\)/)
    expect(block).toMatch(/allowSelfLink\s+Boolean\s+@default\(true\)/)
  })
})

describe('migration — 20260505100000_league_allow_self_link is purely additive', () => {
  // SQL line comments (`-- ...`) legitimately discuss destructive operations
  // in the rollback recipe + design rationale. Strip them before checking
  // the executable SQL for destructive patterns. Same shape as the v1.34.0
  // schema test (see tests/unit/redemptionFoundationSchema.test.ts).
  const EXECUTABLE_SQL = MIGRATION_SRC
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')

  it('adds the column with NOT NULL DEFAULT true', () => {
    expect(EXECUTABLE_SQL).toMatch(
      /ALTER TABLE "League" ADD COLUMN "allowSelfLink" BOOLEAN NOT NULL DEFAULT true/,
    )
  })

  it('does not DROP any column or table', () => {
    // Regression target: a migration accidentally including `DROP COLUMN`
    // / `DROP TABLE` in this PR should fail this test.
    expect(EXECUTABLE_SQL).not.toMatch(/\bDROP\s+(COLUMN|TABLE|INDEX|TYPE)\b/i)
  })

  it('does not ALTER any existing column', () => {
    // Regression target: an `ALTER COLUMN` against an existing column would
    // be a destructive change (type narrowing, NOT-NULL flip, etc.). The
    // only ALTER allowed in this PR is `ALTER TABLE ... ADD COLUMN`.
    expect(EXECUTABLE_SQL).not.toMatch(/ALTER\s+COLUMN/i)
    expect(EXECUTABLE_SQL).not.toMatch(/DROP\s+DEFAULT/i)
    expect(EXECUTABLE_SQL).not.toMatch(/SET\s+NOT\s+NULL/i)
  })

  it('does not TRUNCATE or DELETE FROM any table', () => {
    expect(EXECUTABLE_SQL).not.toMatch(/\bTRUNCATE\b/i)
    expect(EXECUTABLE_SQL).not.toMatch(/DELETE\s+FROM/i)
  })

  it('documents the rollback recipe inline (in a comment)', () => {
    // The rollback recipe lives in the SQL comment block, not the
    // executable SQL. Match against the raw migration source.
    expect(MIGRATION_SRC).toMatch(
      /ALTER TABLE "League" DROP COLUMN "allowSelfLink"/,
    )
  })
})

describe('lib/leagueSelfLink.ts — read helper contract', () => {
  it('exports getLeagueAllowSelfLink wrapped in unstable_cache', () => {
    expect(HELPER_SRC).toMatch(/import.*unstable_cache.*from\s+['"]next\/cache['"]/)
    expect(HELPER_SRC).toMatch(/export const getLeagueAllowSelfLink/)
    expect(HELPER_SRC).toMatch(/unstable_cache\(/)
  })

  it('uses the canonical leagues tag for cache invalidation', () => {
    // Admin writes call `revalidate({ domain: 'admin' })` which busts
    // the leagues tag — sharing the tag means a single admin write
    // invalidates this cache too.
    expect(HELPER_SRC).toMatch(/tags:\s*\[\s*['"]leagues['"]/)
  })

  it('defaults to true when the league row is missing', () => {
    // Backward compat: a league row that doesn't exist yet (or was
    // deleted concurrently) should NOT block the picker — the page
    // gate is the affordance, not the safety boundary. The API gate
    // is the contract.
    expect(HELPER_SRC).toMatch(/row\?\.allowSelfLink\s*\?\?\s*true/)
  })

  it('defensively defaults to true on Prisma error', () => {
    // A transient Prisma blip should not block users from a picker on
    // a league that has the toggle ON. The error branch returns true
    // (default ON) so the route remains usable.
    const tryBlock = HELPER_SRC.indexOf('try {')
    const catchBlock = HELPER_SRC.indexOf('catch')
    expect(tryBlock).toBeGreaterThan(0)
    expect(catchBlock).toBeGreaterThan(tryBlock)
    const catchSection = HELPER_SRC.slice(catchBlock, catchBlock + 500)
    expect(catchSection).toMatch(/return\s+true/)
  })
})

describe('/assign-player page — SelfLinkDisabledSurface gate (v1.60.0)', () => {
  it('imports getLeagueAllowSelfLink helper', () => {
    expect(PAGE_SRC).toMatch(
      /import\s*\{\s*getLeagueAllowSelfLink\s*\}\s*from\s+['"]@\/lib\/leagueSelfLink['"]/,
    )
  })

  it('renders a SelfLinkDisabledSurface helper component', () => {
    expect(PAGE_SRC).toMatch(/function SelfLinkDisabledSurface\b/)
  })

  it('the helper carries a unique data-testid for assertions', () => {
    expect(PAGE_SRC).toMatch(/data-testid="assign-player-self-link-disabled"/)
  })

  it('the gate fires BEFORE the picker render (v1.61.0 — unified gate)', () => {
    // v1.61.0 — the v1.39.2 non-LINE gate is gone. allowSelfLink is now
    // the only gate that decides between picker render and disabled
    // surface. The v1.61.0 page also threads viewer { lineId, userId }
    // into getLinkedPlayerIds so the call shape changed; assert the
    // new shape via the lookup body.
    const selfLinkGateIdx = PAGE_SRC.indexOf('return <SelfLinkDisabledSurface />')
    const linkedIdsIdx = PAGE_SRC.indexOf('getLinkedPlayerIds(')
    expect(selfLinkGateIdx).toBeGreaterThan(0)
    expect(linkedIdsIdx).toBeGreaterThan(selfLinkGateIdx)
  })

  it('the gate condition reads from getLeagueAllowSelfLink with a fallback default true', () => {
    // The gate must call the helper with the resolved leagueId. The
    // fallback `true` covers the unknown-league edge case (no default
    // league configured) — same shape as the existing LINE gate.
    expect(PAGE_SRC).toMatch(
      /const\s+allowSelfLink\s*=\s*leagueId\s*\?\s*await\s+getLeagueAllowSelfLink\(leagueId\)\s*:\s*true/,
    )
    expect(PAGE_SRC).toMatch(/if\s*\(\s*!allowSelfLink\s*\)/)
  })

  it('surface includes a mailto contact for the operator', () => {
    const fnIdx = PAGE_SRC.indexOf('function SelfLinkDisabledSurface')
    expect(fnIdx).toBeGreaterThan(0)
    const block = PAGE_SRC.slice(fnIdx)
    expect(block).toMatch(/mailto:vitoriatamachi@gmail\.com/)
  })

  it('surface includes a "Back to home" route to /', () => {
    const fnIdx = PAGE_SRC.indexOf('function SelfLinkDisabledSurface')
    const block = PAGE_SRC.slice(fnIdx)
    expect(block).toMatch(/href="\/"/)
    expect(block).toMatch(/Back to home/i)
  })

  it('surface mentions the admin invite link path forward', () => {
    // The copy must point users at the alternative path (admin invite
    // redemption) so disabling self-link doesn't dead-end users.
    const fnIdx = PAGE_SRC.indexOf('function SelfLinkDisabledSurface')
    const block = PAGE_SRC.slice(fnIdx)
    expect(block.toLowerCase()).toMatch(/invite/)
    expect(block.toLowerCase()).toMatch(/admin/)
  })
})

describe('/api/assign-player route — POST gate on allowSelfLink (v1.60.0)', () => {
  it('imports getLeagueAllowSelfLink helper', () => {
    expect(ROUTE_SRC).toMatch(
      /import\s*\{\s*getLeagueAllowSelfLink\s*\}\s*from\s+['"]@\/lib\/leagueSelfLink['"]/,
    )
  })

  it('POST returns 403 when allowSelfLink is false', () => {
    // The POST handler must call getLeagueAllowSelfLink AFTER resolving
    // the leagueId and BEFORE the player validation / Redis write. A
    // 403 (forbidden) — not 401 (unauth) — because the user IS
    // authenticated, just not allowed to self-link in this league.
    const postHandlerIdx = ROUTE_SRC.indexOf('export async function POST')
    expect(postHandlerIdx).toBeGreaterThan(0)
    const postSection = ROUTE_SRC.slice(postHandlerIdx)
    expect(postSection).toMatch(
      /const\s+allowSelfLink\s*=\s*await\s+getLeagueAllowSelfLink\(leagueId\)/,
    )
    expect(postSection).toMatch(/if\s*\(\s*!allowSelfLink\s*\)/)
    expect(postSection).toMatch(/status:\s*403/)
    expect(postSection).toMatch(/Self-linking is disabled/)
  })

  it('POST gate fires AFTER leagueId resolution but BEFORE getPlayerByPublicId', () => {
    // Order: session check → playerId parse → leagueId resolve →
    // allowSelfLink gate → player validation → Redis write → defer
    // Prisma. Putting the gate before the player lookup avoids
    // unnecessary work on disabled leagues.
    const postHandlerIdx = ROUTE_SRC.indexOf('export async function POST')
    const postSection = ROUTE_SRC.slice(postHandlerIdx)
    const leagueIdResolveIdx = postSection.indexOf('await getDefaultLeagueId()')
    const allowSelfLinkIdx = postSection.indexOf('getLeagueAllowSelfLink')
    const playerLookupIdx = postSection.indexOf('getPlayerByPublicId')
    expect(leagueIdResolveIdx).toBeGreaterThan(0)
    expect(allowSelfLinkIdx).toBeGreaterThan(leagueIdResolveIdx)
    expect(playerLookupIdx).toBeGreaterThan(allowSelfLinkIdx)
  })

  it('DELETE handler is NOT gated on allowSelfLink', () => {
    // Load-bearing semantic: the toggle controls NEW links. Existing
    // linked players must always be able to unlink themselves
    // regardless of the league's setting — otherwise a user could be
    // permanently bound to a player slot if the admin flips the
    // toggle off.
    const deleteHandlerIdx = ROUTE_SRC.indexOf('export async function DELETE')
    expect(deleteHandlerIdx).toBeGreaterThan(0)
    const deleteSection = ROUTE_SRC.slice(deleteHandlerIdx)
    expect(deleteSection).not.toMatch(/getLeagueAllowSelfLink/)
  })
})

describe('admin server action — setLeagueAllowSelfLink (v1.60.0)', () => {
  it('exports an async server action', () => {
    expect(ACTIONS_SRC).toMatch(
      /export\s+async\s+function\s+setLeagueAllowSelfLink\(\s*leagueId:\s*string,\s*value:\s*boolean\s*\)/,
    )
  })

  it('gates on assertAdmin', () => {
    const fnIdx = ACTIONS_SRC.indexOf('export async function setLeagueAllowSelfLink')
    expect(fnIdx).toBeGreaterThan(0)
    // The first ~500 chars of the function should contain the admin check.
    const block = ACTIONS_SRC.slice(fnIdx, fnIdx + 1500)
    expect(block).toMatch(/await\s+assertAdmin\(\)/)
  })

  it('validates the value is a boolean (defensive)', () => {
    const fnIdx = ACTIONS_SRC.indexOf('export async function setLeagueAllowSelfLink')
    const block = ACTIONS_SRC.slice(fnIdx, fnIdx + 1500)
    expect(block).toMatch(/typeof\s+value\s*!==\s*['"]boolean['"]/)
  })

  it('writes via prisma.league.update with allowSelfLink in data', () => {
    const fnIdx = ACTIONS_SRC.indexOf('export async function setLeagueAllowSelfLink')
    const block = ACTIONS_SRC.slice(fnIdx, fnIdx + 1500)
    expect(block).toMatch(/prisma\.league\.update/)
    expect(block).toMatch(/data:\s*\{\s*allowSelfLink:\s*value\s*\}/)
  })

  it('busts the admin cache via the canonical revalidate helper', () => {
    // Cache invalidation rule (v1.16.0): direct revalidateTag /
    // revalidatePath calls outside src/lib/revalidate.ts are forbidden.
    // The action must use the helper.
    const fnIdx = ACTIONS_SRC.indexOf('export async function setLeagueAllowSelfLink')
    const block = ACTIONS_SRC.slice(fnIdx, fnIdx + 1500)
    expect(block).toMatch(/revalidate\(\s*\{\s*domain:\s*['"]admin['"]/)
    // Settings page path is the most relevant for the toggle.
    expect(block).toMatch(/\/admin\/leagues\/\$\{leagueId\}\/settings/)
  })
})

describe('SettingsTab — admin toggle wiring (v1.60.0)', () => {
  it('imports the new server action', () => {
    // The import statement spans multiple lines; flatten newlines to whitespace
    // for matching instead of using the `s` flag (which requires es2018+).
    const flat = SETTINGS_TAB_SRC.replace(/\s+/g, ' ')
    expect(flat).toMatch(
      /import\s*\{[^}]*setLeagueAllowSelfLink[^}]*\}\s*from\s+['"]@\/app\/admin\/leagues\/actions['"]/,
    )
  })

  it('League prop interface includes allowSelfLink: boolean', () => {
    // The page (`getLeagueSettings`) returns the full League row
    // without a select clause, so allowSelfLink flows through. The
    // type-side surface here pins that the SettingsTab component
    // expects the field — a regression that drops it would surface
    // as a tsc error rather than at render time.
    expect(SETTINGS_TAB_SRC).toMatch(/allowSelfLink:\s*boolean/)
  })

  it('renders a section with the load-bearing testid', () => {
    expect(SETTINGS_TAB_SRC).toMatch(/data-testid="settings-tab-self-link-section"/)
  })

  it('renders both On and Off toggle buttons with testids', () => {
    expect(SETTINGS_TAB_SRC).toMatch(/data-testid="settings-tab-self-link-on"/)
    expect(SETTINGS_TAB_SRC).toMatch(/data-testid="settings-tab-self-link-off"/)
  })

  it('uses optimistic flip with rollback on rejection', () => {
    // Mirror of handleDataSourceChange / handleWriteModeChange — the
    // pattern is: capture prev, set optimistic, await action, on
    // rejection setState back to prev. Pinning the function's
    // existence + the rollback shape.
    const fnIdx = SETTINGS_TAB_SRC.indexOf('handleAllowSelfLinkChange')
    expect(fnIdx).toBeGreaterThan(0)
    const block = SETTINGS_TAB_SRC.slice(fnIdx, fnIdx + 800)
    expect(block).toMatch(/setAllowSelfLinkState\(value\)/)
    expect(block).toMatch(/setAllowSelfLinkState\(prev\)/)
    expect(block).toMatch(/await\s+setLeagueAllowSelfLink\(/)
  })

  it('disables both toggle buttons while saving', () => {
    // Prevent double-clicks during the in-flight server-action.
    const sectionIdx = SETTINGS_TAB_SRC.indexOf('settings-tab-self-link-section')
    expect(sectionIdx).toBeGreaterThan(0)
    const block = SETTINGS_TAB_SRC.slice(sectionIdx, sectionIdx + 3000)
    // Both buttons gate disabled on savingToggle !== null (any toggle in flight).
    const disabledMatches = block.match(/disabled=\{savingToggle\s*!==\s*null\}/g)
    expect(disabledMatches?.length ?? 0).toBeGreaterThanOrEqual(2)
  })
})
