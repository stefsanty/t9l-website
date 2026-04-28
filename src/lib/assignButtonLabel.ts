/**
 * Pure label/disabled state machine for the public-site player-assignment
 * confirm + unassign buttons in `AssignPlayerClient`. Extracted so the
 * transitions are unit-testable without React Testing Library — the state
 * transitions are the regression target, not the JSX.
 *
 * v1.4.0 (PR 13) — optimistic UI rewrite:
 *
 *   The previous "Saving…" → "Done — redirecting…" sequence existed because
 *   the destination was always `/`: the user clicked Confirm, the API ran,
 *   the client kicked next-auth update + router.push, and the form button
 *   needed to keep them informed across all of those phases. v1.4.0 removes
 *   the auto-navigate. After API success the form is replaced by an inline
 *   success view (see `AssignPlayerClient`), so the confirm button only ever
 *   matters for the brief window between click and optimistic flip — which
 *   is one render. The button label collapses back to the simple resting/
 *   in-flight pair and `redirecting` no longer applies.
 *
 *   Unassign keeps a tiny in-flight label since it doesn't render a separate
 *   success view (the form just returns to the unselected state).
 */

export type ConfirmButtonState = {
  isAlreadyAssigned: boolean
  submitting: boolean
  selectedPlayerId: string | null
}

export function assignButtonLabel(s: ConfirmButtonState): string {
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
    s.isAlreadyAssigned
  )
}

export type UnassignButtonState = {
  unassigning: boolean
}

export function unassignButtonLabel(s: UnassignButtonState): string {
  if (s.unassigning) return 'Removing…'
  return 'Unassign Profile'
}

export function unassignButtonDisabled(
  s: UnassignButtonState & { submitting: boolean },
): boolean {
  return s.submitting || s.unassigning
}
