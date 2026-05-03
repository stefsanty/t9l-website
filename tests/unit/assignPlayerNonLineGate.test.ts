/**
 * v1.39.2 — regression target: Google/email users (signed in via the v1.28.0
 * multi-provider auth foundation) used to reach `/assign-player`, click
 * Confirm, and get a 401 "Not authenticated" because `/api/assign-player`
 * POST/DELETE gate on `session.lineId` (which Google/email users don't have).
 *
 * Per the post-onboarding-chain architecture: existing LINE users are
 * grandfathered onto the legacy picker; non-LINE users redeem invites via
 * PR ζ's `/join/[code]` flow. This test pins three load-bearing surfaces:
 *
 *   1. `/assign-player` page — server-side gate that renders a "need invite"
 *      surface for sessions WITH a userId / authenticated state but WITHOUT
 *      a lineId. Without this gate, Google/email users would see the picker,
 *      click a player, and hit the broken POST.
 *   2. `/api/assign-player` route — POST + DELETE STILL gate on
 *      `session?.lineId`. The fix is at the page + CTA layer, not the API.
 *      A regression that loosens the API check would let non-LINE users
 *      execute against the LINE-keyed Redis store + Prisma `Player.lineId`
 *      column, which is provider-incorrect.
 *   3. `LineLoginButton` dropdown — non-LINE users with no playerId see a
 *      "Need an invite" message (with mailto), NOT the broken
 *      "Assign to my player" link. Non-LINE users WITH a playerId don't see
 *      the legacy "Change/Unassign player" link either (they switch via a
 *      fresh invite redemption, see v1.39.0 PR λ's `linkUserToPlayer`).
 *
 * Structural tests (file content) rather than render — both the page and
 * `LineLoginButton` pull in `next-auth` / `next/image` / portals which
 * aren't trivial to mock for a tiny presence check, and the load-bearing
 * contract here is "does the gate exist in the source", not "does React
 * render the right tree from a synthetic session".
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PROJECT_ROOT = join(__dirname, '..', '..')
const PAGE_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'app', 'assign-player', 'page.tsx'),
  'utf-8',
)
const ROUTE_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'app', 'api', 'assign-player', 'route.ts'),
  'utf-8',
)
const HEADER_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'components', 'LineLoginButton.tsx'),
  'utf-8',
)

describe('/assign-player page — non-LINE gate (v1.39.2)', () => {
  it('renders a NeedInviteSurface helper component', () => {
    expect(PAGE_SRC).toMatch(/function NeedInviteSurface\b/)
  })

  it('the helper carries the data-testid for assertions', () => {
    expect(PAGE_SRC).toMatch(/data-testid="assign-player-need-invite"/)
  })

  it('gates non-LINE sessions BEFORE running the picker render path', () => {
    // The early-return must fire before getLinkedPlayerIds / playersByTeam.
    // We assert the first reference to NeedInviteSurface (the early-return
    // call site, not the function definition) precedes the picker work.
    const gateCallIdx = PAGE_SRC.indexOf('return <NeedInviteSurface')
    const linkedIdsIdx = PAGE_SRC.indexOf('getLinkedPlayerIds(session?.lineId')
    const clientUsageIdx = PAGE_SRC.indexOf('<AssignPlayerClient')
    expect(gateCallIdx).toBeGreaterThan(0)
    expect(linkedIdsIdx).toBeGreaterThan(gateCallIdx)
    expect(clientUsageIdx).toBeGreaterThan(gateCallIdx)
  })

  it('the gate condition is `session && !session.lineId`', () => {
    // The exact predicate matters — `!session?.lineId` alone would also
    // gate unauth visitors (no session at all). The current behavior is to
    // let unauth visitors see the picker (the API call later 401s); only
    // signed-in non-LINE users get the surface.
    expect(PAGE_SRC).toMatch(/if\s*\(\s*session\s*&&\s*!session\.lineId\s*\)/)
  })

  it('surface includes a mailto contact for the operator', () => {
    expect(PAGE_SRC).toMatch(/mailto:vitoriatamachi@gmail\.com/)
  })

  it('surface includes a "Back to home" route to /', () => {
    expect(PAGE_SRC).toMatch(/href="\/"/)
    expect(PAGE_SRC).toMatch(/Back to home/i)
  })

  it('surface uses the explicit "need an invite" copy', () => {
    expect(PAGE_SRC).toMatch(/need an invite/i)
  })
})

describe('/api/assign-player — STILL gates POST + DELETE on session.lineId (v1.39.2 regression target)', () => {
  it('POST returns 401 when session.lineId is missing', () => {
    // The API check is the load-bearing safety net even after the page-level
    // gate ships. A regression that loosens this would allow a directly-
    // crafted POST from a Google/email session to mutate the LINE-keyed
    // Redis store + Prisma `Player.lineId`, which is provider-incorrect.
    expect(ROUTE_SRC).toMatch(/if\s*\(\s*!session\?\.\s*lineId\s*\)/)
    expect(ROUTE_SRC).toMatch(/Not authenticated/)
  })

  it('DELETE handler also gates on session.lineId', () => {
    // The DELETE has its own gate. Both must remain present.
    const deleteHandlerIdx = ROUTE_SRC.indexOf('export async function DELETE')
    expect(deleteHandlerIdx).toBeGreaterThan(0)
    const deleteSection = ROUTE_SRC.slice(deleteHandlerIdx)
    expect(deleteSection).toMatch(/if\s*\(\s*!session\?\.\s*lineId\s*\)/)
  })
})

describe('LineLoginButton — non-LINE dropdown gate (v1.39.2)', () => {
  it('exports a `hasLine` derived flag based on session.lineId', () => {
    // The component derives `hasLine` from session.lineId so the gate logic
    // is reusable across the AssignModal popup (gated in the useEffect) and
    // the multiple dropdown branches.
    expect(HEADER_SRC).toMatch(/const\s+hasLine\s*=\s*!!session\.lineId/)
  })

  it('AssignModal useEffect is gated on session?.lineId', () => {
    // The first-login modal pop-up routes to /assign-player. Showing it to
    // non-LINE users is the user-visible bug: they click "Assign to my
    // player", land on the picker, click Confirm, get 401.
    //
    // Match the dependency array shape — including session.lineId in the
    // deps is the load-bearing signal the effect re-evaluates the gate
    // when the session resolves.
    expect(HEADER_SRC).toMatch(
      /status === 'authenticated' && session\?\.lineId && !session\?\.playerId/,
    )
    expect(HEADER_SRC).toMatch(/\[status, session\?\.lineId, session\?\.playerId\]/)
  })

  it('non-LINE no-player branch surfaces a "Need an invite" message + mailto', () => {
    expect(HEADER_SRC).toMatch(/data-testid="account-menu-need-invite"/)
    // The non-LINE branch contains the mailto so the user has a path forward.
    const needInviteIdx = HEADER_SRC.indexOf('account-menu-need-invite')
    expect(needInviteIdx).toBeGreaterThan(0)
    const block = HEADER_SRC.slice(needInviteIdx, needInviteIdx + 1000)
    expect(block).toMatch(/Need an invite/)
    expect(block).toMatch(/mailto:vitoriatamachi@gmail\.com/)
  })

  it('LINE no-player branch keeps the "Assign to my player" link', () => {
    // Existing LINE users (grandfathered) still see the legacy CTA.
    expect(HEADER_SRC).toMatch(/data-testid="account-menu-assign-player"/)
    expect(HEADER_SRC).toMatch(/Assign to my player/)
  })

  it('the no-player branch is gated by hasLine — picker link only renders for LINE users', () => {
    // The shape is: needsSetup ? (hasLine ? <picker link> : <need-invite>) : ...
    // We pin the regression target by asserting that `hasLine ?` appears in
    // the close vicinity of the "Assign to my player" CTA, AND that the
    // legacy unconditional `href="/assign-player"` for the needsSetup branch
    // is gone (it's now inside the `hasLine ?` ternary).
    expect(HEADER_SRC).toMatch(/needsSetup \? \(\s*hasLine \?/)
  })

  it('linked-player branch gates "Change/Unassign player" on hasLine', () => {
    // The else-branch (player assigned) keeps "Edit my details" for ALL
    // providers but the legacy "Change/Unassign player" picker link is
    // gated on hasLine — non-LINE users switch via fresh invite redemption.
    const editIdx = HEADER_SRC.indexOf('account-menu-edit-details')
    const changeIdx = HEADER_SRC.indexOf('account-menu-change-player')
    expect(editIdx).toBeGreaterThan(0)
    expect(changeIdx).toBeGreaterThan(0)
    // The Change/Unassign block sits inside a `hasLine && (...)` gate.
    // Find the block and look backwards for the gate marker.
    const before = HEADER_SRC.slice(0, changeIdx)
    const lastGate = before.lastIndexOf('hasLine && (')
    // The gate must be within the same conditional block (close enough);
    // 600 chars covers the comment + the JSX line above.
    expect(changeIdx - lastGate).toBeLessThan(600)
  })

  it('every /assign-player href is upstream-gated on session.lineId', () => {
    // Three href occurrences in the file:
    //   (1) AssignModal CTA — the `function AssignModal(...)` body. The
    //       modal is mounted only when showAssignModal is true, which the
    //       useEffect gates on `session?.lineId`. So the href is reachable
    //       only by LINE users; protection is upstream of the link itself.
    //   (2) Dropdown needsSetup branch — wrapped in `hasLine ? (...)`.
    //   (3) Dropdown linked-player branch — wrapped in `hasLine && (...)`.
    // Anything else (e.g. an unconditional href in the dropdown) is a
    // regression and should fail this test.
    const occurrences: number[] = []
    let idx = HEADER_SRC.indexOf('href="/assign-player"')
    while (idx !== -1) {
      occurrences.push(idx)
      idx = HEADER_SRC.indexOf('href="/assign-player"', idx + 1)
    }
    expect(occurrences.length).toBe(3)

    // Find boundaries.
    const assignModalStart = HEADER_SRC.indexOf('function AssignModal(')
    const assignModalEnd = HEADER_SRC.indexOf(
      'function ',
      assignModalStart + 'function AssignModal('.length,
    )
    expect(assignModalStart).toBeGreaterThan(0)
    expect(assignModalEnd).toBeGreaterThan(assignModalStart)

    for (const occ of occurrences) {
      if (occ > assignModalStart && occ < assignModalEnd) {
        // (1) AssignModal CTA — upstream gate is the useEffect that sets
        // showAssignModal. We pin that gate elsewhere in this suite, so
        // here we just confirm this occurrence is inside the AssignModal
        // function body.
        continue
      }
      // (2) and (3) — must have a `hasLine` reference within ~600 chars
      // upstream (the dropdown ternary or `&&` gate).
      const before = HEADER_SRC.slice(Math.max(0, occ - 600), occ)
      expect(before).toMatch(/hasLine/)
    }
  })
})
