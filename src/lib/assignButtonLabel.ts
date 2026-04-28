/**
 * Pure label/affordance state machine for the public-site player-assignment
 * confirm + unassign buttons in `AssignPlayerClient`. Extracted so the bug
 * fix in PR α (1.2.2) is unit-testable without React Testing Library —
 * the state transitions are the regression target, not the JSX.
 *
 * Background — the v1.1.1 stuck-on-Saving bug, second attempt:
 *
 *   Pre-fix the loading state spanned the entire post-click chain (API write
 *   → next-auth `update()` → router.push → destination RSC re-render → unmount).
 *   Under the post-cutover Prisma-on-every-JWT auth path that's 5–7 seconds.
 *   PR #50 added router.refresh which kept the cache fresh but didn't address
 *   the perceived hang.
 *
 *   The right boundary for "Saving…" is just the API write (~500ms). After
 *   that succeeds, switch to a `redirecting` affordance so the user sees
 *   immediate confirmation and a clear "we're navigating now" message. The
 *   button stays disabled either way.
 */

export type ConfirmButtonState = {
  redirecting: boolean
  isAlreadyAssigned: boolean
  submitting: boolean
  selectedPlayerId: string | null
}

export function assignButtonLabel(s: ConfirmButtonState): string {
  if (s.redirecting) return 'Done — redirecting…'
  if (s.isAlreadyAssigned) return 'Linked'
  if (s.submitting) return 'Saving…'
  if (s.selectedPlayerId) return 'Confirm'
  return 'Select Player'
}

export function assignButtonDisabled(
  s: ConfirmButtonState & { unassigning: boolean },
): boolean {
  return (
    !s.selectedPlayerId ||
    s.submitting ||
    s.unassigning ||
    s.redirecting ||
    s.isAlreadyAssigned
  )
}

export type UnassignButtonState = {
  redirecting: boolean
  unassigning: boolean
}

export function unassignButtonLabel(s: UnassignButtonState): string {
  if (s.redirecting) return 'Redirecting…'
  if (s.unassigning) return 'Removing…'
  return 'Unassign Profile'
}

export function unassignButtonDisabled(
  s: UnassignButtonState & { submitting: boolean },
): boolean {
  return s.submitting || s.unassigning || s.redirecting
}
