/**
 * v1.37.0 (PR ι) — header account dropdown surface check.
 *
 * Pin the load-bearing UI contract:
 *   - LineLoginButton renders an "Edit my details" link to /account/player
 *     in the logged-in dropdown.
 *   - The link sits in the linked-player branch (not the lurker branch
 *     — lurkers redeem an invite first; their dropdown gates that flow).
 *   - The link uses next/link (Link href) for client-side nav.
 *
 * Structural test (file content) rather than render — the component
 * pulls in `next-auth/react` and `next/image` which aren't trivial to
 * mock for a tiny presence check.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(
  join(__dirname, '..', '..', 'src', 'components', 'LineLoginButton.tsx'),
  'utf-8',
)

describe('LineLoginButton — Edit my details link', () => {
  it('renders a Link to /account/player', () => {
    expect(SRC).toMatch(/href="\/account\/player"/)
  })

  it('uses the data-testid for e2e/integration assertions', () => {
    expect(SRC).toMatch(/data-testid="account-menu-edit-details"/)
  })

  it("displays the label 'Edit my details'", () => {
    expect(SRC).toMatch(/Edit my details/)
  })

  it("sits in the linked-player branch — same block as 'Change/Unassign player'", () => {
    // The linked-player branch is the !needsSetup else, where
    // "Change/Unassign player" lives. The /account/player link is added
    // in the same fragment.
    const linkedBranchIdx = SRC.indexOf('Change/Unassign player')
    const editIdx = SRC.indexOf('Edit my details')
    expect(linkedBranchIdx).toBeGreaterThan(0)
    expect(editIdx).toBeGreaterThan(0)
    // They should be within ~1k chars of each other (same dropdown block).
    expect(Math.abs(linkedBranchIdx - editIdx)).toBeLessThan(1500)
  })

  it('does not appear in the unauth (signed-out) branch', () => {
    // The signed-out branch returns before the linked-player UI; the
    // /account/player link must NOT be inside the `if (!session)` block.
    const signedOutBranch = SRC.match(/if \(!session\) \{[\s\S]+?\n\s*\}\s*\n/)
    expect(signedOutBranch).toBeTruthy()
    expect(signedOutBranch![0]).not.toMatch(/\/account\/player/)
  })
})
