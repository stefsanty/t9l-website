import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * v1.20.0 — Admin PlayersTab name-edit regression test.
 *
 * Pre-v1.20.0 the player name in PlayersTab was non-editable display
 * text — `<p>{player.name}</p>` on mobile, `<span>{player.name}</span>`
 * on desktop. The only way to change a player name was directly via
 * Prisma Studio. v1.20.0 wired the name through `PillEditor variant="text"`
 * (the new text variant in PillEditor — click-to-swap-input pattern,
 * Enter / blur saves, Escape cancels) and added the `adminUpdatePlayerName`
 * server action.
 *
 * v1.41.0 reverses the inline-pill rendering on PlayersTab — the always-on
 * dotted-underline editor was visually noisy. The name is now plain text;
 * edits live inside the per-row EditPlayerPanel (`tests/unit/playersTabEditMode.test.ts`)
 * which still calls `adminUpdatePlayerName` under the hood. We keep:
 *
 *   - The PillEditor `text` variant contract — still part of the public
 *     PillEditor API for future callers; removing the variant would
 *     silently leak edge-cases the variant fixed (commit-on-blur,
 *     change-guard, rollback-on-failure).
 *   - The `adminUpdatePlayerName` action contract — still the canonical
 *     write path (now invoked from `EditPlayerPanel`).
 *
 * The dropped block — "PlayersTab uses PillEditor for player name" — was
 * the v1.20.0 inline-pill assertion; v1.41.0 contradicts it directly. The
 * v1.41.0 contract lives in [`tests/unit/playersTabEditMode.test.ts`](tests/unit/playersTabEditMode.test.ts).
 */

const REPO = process.cwd()
const PILL_EDITOR = join(REPO, 'src/components/admin/PillEditor.tsx')
const LEAGUES_ACTIONS = join(REPO, 'src/app/admin/leagues/actions.ts')

describe('v1.20.0 — PillEditor text variant', () => {
  it('PillEditor exports a text variant alongside the four existing variants', () => {
    const text = readFileSync(PILL_EDITOR, 'utf8')
    expect(text).toMatch(/variant: 'text'/)
    expect(text).toMatch(/TextPillProps/)
  })

  it('text variant uses click-to-swap-input rather than overlaid native picker', () => {
    const text = readFileSync(PILL_EDITOR, 'utf8')
    // The text variant has no platform-native picker — clicking the pill
    // should toggle into edit mode with a focused <input>. Pre-fix the
    // text branch did NOT exist; a regression that adds a text branch
    // using the opacity-0 overlay pattern would be wrong (no native
    // text picker exists; the overlay would be invisible and unhelpful).
    expect(text).toMatch(/setEditing\(true\)/)
    expect(text).toMatch(/setEditing\(false\)/)
  })

  it('text variant commits on Enter and cancels on Escape', () => {
    const text = readFileSync(PILL_EDITOR, 'utf8')
    expect(text).toMatch(/e\.key === 'Enter'/)
    expect(text).toMatch(/e\.key === 'Escape'/)
  })

  it('text variant commits on blur (matches established InlineEditCell ergonomics)', () => {
    const text = readFileSync(PILL_EDITOR, 'utf8')
    expect(text).toMatch(/onBlur=\{commitText\}/)
  })

  it('text variant skips save when the trimmed value matches the committed value', () => {
    const text = readFileSync(PILL_EDITOR, 'utf8')
    // Same change-guard idea as the date/time/venue path — no spurious
    // writes when the user opens the editor and commits without changes.
    expect(text).toMatch(/if \(next === props\.value\)/)
  })

  it('text variant rolls back the draft on save failure', () => {
    const text = readFileSync(PILL_EDITOR, 'utf8')
    // commitText must catch and reset to props.value (otherwise a
    // failed server action leaves the pill showing the bad input).
    expect(text).toMatch(/commitText/)
    expect(text).toMatch(/setDraft\(props\.value\)/)
  })

  it('text variant defaults maxLength to 100 chars', () => {
    const text = readFileSync(PILL_EDITOR, 'utf8')
    // Matches the server-side cap in adminUpdatePlayerName.
    expect(text).toMatch(/props\.maxLength \?\? 100/)
  })
})

describe('v1.20.0 — adminUpdatePlayerName server action exists', () => {
  it('is exported from src/app/admin/leagues/actions.ts', () => {
    const text = readFileSync(LEAGUES_ACTIONS, 'utf8')
    expect(text).toMatch(/export\s+async\s+function\s+adminUpdatePlayerName/)
  })

  it('accepts playerId / leagueId / name as a single object input (matches existing admin action conventions)', () => {
    const text = readFileSync(LEAGUES_ACTIONS, 'utf8')
    expect(text).toMatch(/adminUpdatePlayerName\(input: \{[\s\S]*?playerId: string[\s\S]*?leagueId: string[\s\S]*?name: string/)
  })

  it('uses the canonical revalidate helper rather than direct revalidatePath / revalidateTag (per v1.16.0 standing rule)', () => {
    const text = readFileSync(LEAGUES_ACTIONS, 'utf8')
    // The function body must not call revalidatePath/revalidateTag
    // directly — those primitives are forbidden outside src/lib/revalidate.ts.
    // The lint guard at `tests/unit/revalidatePrimitivesGuard.test.ts`
    // covers that globally. Here we just pin that the canonical shape
    // (`revalidate({ domain: 'admin', paths: [<players path>] })`) is
    // present in the file — the per-function check is harder to do
    // reliably with regex against the same file, so the global guard
    // does the heavy lifting.
    expect(text).toMatch(/revalidate\(\{ domain: 'admin', paths: \[`\/admin\/leagues\/\$\{leagueId\}\/players`\] \}\)/)
  })
})
