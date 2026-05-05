/**
 * v1.61.0 — non-LINE users can self-link via `/assign-player`.
 *
 * Pre-v1.61.0 the picker was LINE-keyed end-to-end: the page rendered
 * a `NeedInviteSurface` for any session without lineId, and the API
 * gated POST + DELETE on `session.lineId`. Google / email users got
 * routed to a "you need an invite" message regardless of league
 * settings, even when the league's `allowSelfLink` toggle was on.
 *
 * v1.61.0 unifies the gate: the per-league `League.allowSelfLink`
 * (v1.60.0) is the only gate that decides whether self-linking is
 * available. Provider type (LINE / Google / email) is no longer a
 * gate. The API write path branches by provider internally — LINE
 * users continue on the v1.5.0 Redis-canonical path; non-LINE users
 * take a synchronous Prisma path that calls `linkUserToPlayer` (the
 * v1.39.0 generic helper) keyed on User.id.
 *
 * This test pins three load-bearing surfaces:
 *
 *   1. `/assign-player` page — the v1.39.2 `NeedInviteSurface` gate is
 *      GONE (regression target — its presence would re-block non-LINE
 *      users). The v1.60.0 `SelfLinkDisabledSurface` gate stays, fired
 *      ONLY by `allowSelfLink === false`.
 *   2. `/api/assign-player` route — POST + DELETE accept any session
 *      with EITHER `lineId` or `userId`. The 401 gate is now
 *      `!session || (!session.lineId && !session.userId)`.
 *   3. `LineLoginButton` dropdown — the no-player CTA gates on
 *      `allowSelfLink`, NOT on `hasLine`. When ON (default true),
 *      shows the picker link regardless of provider; when OFF,
 *      shows the friendly "Need an invite" message regardless of
 *      provider.
 *
 * Structural tests (file content) rather than render — same rationale
 * as the pre-v1.61.0 file.
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

describe('/assign-player page — v1.61.0 gate unification', () => {
  it('the v1.39.2 NeedInviteSurface helper is GONE (regression target)', () => {
    // Pre-v1.61.0 had `function NeedInviteSurface()` and an early-return
    // for `session && !session.lineId`. v1.61.0 drops both — the unified
    // allowSelfLink gate replaces the LINE-only block.
    expect(PAGE_SRC).not.toMatch(/function NeedInviteSurface\b/)
    expect(PAGE_SRC).not.toMatch(/return <NeedInviteSurface/)
    expect(PAGE_SRC).not.toMatch(/data-testid="assign-player-need-invite"/)
    expect(PAGE_SRC).not.toMatch(/if\s*\(\s*session\s*&&\s*!session\.lineId\s*\)/)
  })

  it('the v1.60.0 SelfLinkDisabledSurface gate stays for allowSelfLink === false', () => {
    expect(PAGE_SRC).toMatch(/function SelfLinkDisabledSurface\b/)
    expect(PAGE_SRC).toMatch(/data-testid="assign-player-self-link-disabled"/)
    expect(PAGE_SRC).toMatch(/return <SelfLinkDisabledSurface/)
  })

  it('threads viewer { lineId, userId } into getLinkedPlayerIds', () => {
    // The v1.61.0 helper signature accepts both keys so non-LINE viewers
    // can also see their own player (and have it excluded from the
    // linked-set filter). Pre-v1.61.0 the call was just
    // `getLinkedPlayerIds(session?.lineId ?? null)`.
    expect(PAGE_SRC).toMatch(/getLinkedPlayerIds\s*\(\s*\{[\s\S]*?lineId:[\s\S]*?userId:/)
  })

  it('renders AssignPlayerClient when allowSelfLink === true', () => {
    expect(PAGE_SRC).toMatch(/<AssignPlayerClient/)
  })
})

describe('/api/assign-player — v1.61.0 unified gate', () => {
  it('POST 401 gate accepts session with EITHER lineId or userId', () => {
    // Pre-v1.61.0: `if (!session?.lineId)`. v1.61.0: any auth provider
    // is allowed, so the gate becomes `!session || (!session.lineId && !session.userId)`.
    expect(ROUTE_SRC).not.toMatch(/if\s*\(\s*!session\?\.\s*lineId\s*\)\s*\{[\s\S]{0,80}Not authenticated/)
    expect(ROUTE_SRC).toMatch(
      /!session\.lineId\s*&&\s*!session\.userId/,
    )
  })

  it('POST branches by provider — LINE path uses Redis (setMappingOrThrow), non-LINE path uses linkUserToPlayer', () => {
    // The LINE-only `setMappingOrThrow` call still exists for LINE users.
    expect(ROUTE_SRC).toMatch(/setMappingOrThrow\(\s*session\.lineId/)
    // The non-LINE branch calls `linkUserToPlayer` (v1.39.0 generic
    // helper, keyed on User.id) via the v1.61.0
    // `persistAssignmentToPrismaForUser` helper.
    expect(ROUTE_SRC).toMatch(/persistAssignmentToPrismaForUser/)
    expect(ROUTE_SRC).toMatch(/linkUserToPlayer/)
  })

  it('DELETE handler accepts session with either lineId or userId', () => {
    const deleteHandlerIdx = ROUTE_SRC.indexOf('export async function DELETE')
    expect(deleteHandlerIdx).toBeGreaterThan(0)
    const deleteSection = ROUTE_SRC.slice(deleteHandlerIdx)
    expect(deleteSection).toMatch(/!session\.lineId\s*&&\s*!session\.userId/)
    // The non-LINE unlink path calls the new `unlinkUserFromPlayer` helper.
    expect(deleteSection).toMatch(/persistUnassignmentToPrismaForUser/)
  })

  it('imports the v1.61.0 identityLink helpers (linkUserToPlayer + unlinkUserFromPlayer)', () => {
    expect(ROUTE_SRC).toMatch(/linkUserToPlayer/)
    expect(ROUTE_SRC).toMatch(/unlinkUserFromPlayer/)
  })

  it('legacy LINE-flow helpers preserved (setMappingOrThrow, linkPlayerToUser, unlinkPlayerFromUser)', () => {
    expect(ROUTE_SRC).toMatch(/setMappingOrThrow/)
    expect(ROUTE_SRC).toMatch(/linkPlayerToUser/)
    expect(ROUTE_SRC).toMatch(/unlinkPlayerFromUser/)
  })
})

describe('LineLoginButton — v1.61.0 dropdown gates by allowSelfLink (not by hasLine)', () => {
  it('exports an `allowSelfLink` derived flag from session.allowSelfLink', () => {
    expect(HEADER_SRC).toMatch(/const\s+allowSelfLink\s*=\s*session\.allowSelfLink\s*!==\s*false/)
  })

  it('the v1.39.2 `hasLine` derived flag is GONE (regression target)', () => {
    // Pre-v1.61.0 had `const hasLine = !!session.lineId` driving every
    // dropdown gate. v1.61.0 drops it in favor of `allowSelfLink`.
    expect(HEADER_SRC).not.toMatch(/const\s+hasLine\s*=\s*!!session\.lineId/)
  })

  it('AssignModal useEffect is gated on allowSelfLink (not on session.lineId)', () => {
    // The first-login modal pop-up routes to /assign-player. v1.61.0
    // gates it on `allowSelfLink && !playerId && (lineId || userId)` —
    // any authenticated session with self-link enabled sees the popup.
    expect(HEADER_SRC).toMatch(/session\?\.allowSelfLink/)
    expect(HEADER_SRC).toMatch(/session\?\.lineId\s*\|\|\s*session\?\.userId/)
    // The dependency array includes allowSelfLink so the popup re-evaluates
    // when the session resolves the toggle.
    expect(HEADER_SRC).toMatch(/session\?\.allowSelfLink/)
  })

  it('no-player allowSelfLink-OFF branch surfaces "Need an invite to join" + mailto', () => {
    expect(HEADER_SRC).toMatch(/data-testid="account-menu-need-invite"/)
    // The eyebrow line carries "Need an invite to join" when allowSelfLink
    // is OFF (regardless of provider).
    expect(HEADER_SRC).toMatch(/Need an invite to join/)
    const needInviteIdx = HEADER_SRC.indexOf('account-menu-need-invite')
    expect(needInviteIdx).toBeGreaterThan(0)
    const block = HEADER_SRC.slice(needInviteIdx, needInviteIdx + 1000)
    expect(block).toMatch(/Ask an admin or/)
    expect(block).toMatch(/mailto:vitoriatamachi@gmail\.com/)
    // Regression target: the v1.60.1 "Need an invite link" subtitle stays gone.
    expect(block).not.toMatch(/Need an invite link/)
  })

  it('no-player allowSelfLink-ON branch surfaces "Assign to my player" CTA', () => {
    // v1.61.0 — when self-link is on, the CTA shows for ANY provider.
    expect(HEADER_SRC).toMatch(/data-testid="account-menu-assign-player"/)
    expect(HEADER_SRC).toMatch(/Assign to my player/)
    // Shape: `needsSetup ? (allowSelfLink ? <picker> : <need-invite>) : ...`
    expect(HEADER_SRC).toMatch(/needsSetup \? \(\s*allowSelfLink \?/)
  })

  it('linked-player branch always shows "Change/Unassign player" (v1.39.2 hasLine gate dropped)', () => {
    // v1.61.0 — any linked session can use /assign-player to change or
    // unassign their player; the API DELETE path is ungated by
    // allowSelfLink (v1.60.0), and the POST path accepts all providers
    // when allowSelfLink is on. The hasLine gate is gone.
    const changeIdx = HEADER_SRC.indexOf('account-menu-change-player')
    expect(changeIdx).toBeGreaterThan(0)
    // No `hasLine && (` upstream of the change-player block.
    const before = HEADER_SRC.slice(0, changeIdx)
    const lastGate = before.lastIndexOf('hasLine && (')
    // The gate must be far away (or absent — lastIndexOf returns -1).
    if (lastGate >= 0) {
      // If `hasLine && (` exists at all, it must be more than 1500 chars
      // upstream (i.e. not the immediate gate of the change-player block).
      expect(changeIdx - lastGate).toBeGreaterThan(1500)
    }
  })

  it('every /assign-player href in the dropdown is upstream-gated on allowSelfLink (or unconditional in the linked-player branch)', () => {
    const occurrences: number[] = []
    let idx = HEADER_SRC.indexOf('href="/assign-player"')
    while (idx !== -1) {
      occurrences.push(idx)
      idx = HEADER_SRC.indexOf('href="/assign-player"', idx + 1)
    }
    // Three occurrences:
    //   (1) AssignModal CTA — gated by the useEffect on allowSelfLink.
    //   (2) Dropdown needsSetup branch — gated by `allowSelfLink ?`.
    //   (3) Dropdown linked-player branch — unconditional (v1.61.0 dropped hasLine gate).
    expect(occurrences.length).toBe(3)
  })
})
