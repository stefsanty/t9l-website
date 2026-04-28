import { describe, it, expect } from 'vitest'
import {
  assignButtonLabel,
  assignButtonDisabled,
  unassignButtonLabel,
  unassignButtonDisabled,
} from '@/lib/assignButtonLabel'

const baseConfirm = {
  redirecting: false,
  isAlreadyAssigned: false,
  submitting: false,
  selectedPlayerId: null as string | null,
}

describe('assignButtonLabel', () => {
  it('shows "Select Player" with no selection', () => {
    expect(assignButtonLabel(baseConfirm)).toBe('Select Player')
  })

  it('shows "Confirm" with a selection but nothing in flight', () => {
    expect(assignButtonLabel({ ...baseConfirm, selectedPlayerId: 'p-x' })).toBe('Confirm')
  })

  it('shows "Saving…" only while the API call is in flight', () => {
    expect(
      assignButtonLabel({ ...baseConfirm, selectedPlayerId: 'p-x', submitting: true }),
    ).toBe('Saving…')
  })

  // Regression for the v1.1.1 stuck-on-Saving bug. Pre-fix the loading state
  // spanned API + next-auth update + router.push + destination RSC render
  // (5–7s post-cutover). The fix flips submitting → redirecting the moment
  // the API write succeeds; redirecting MUST take precedence so the button
  // shows the "navigating" affordance, never "Saving…".
  it('shows "Done — redirecting…" while navigation is in progress (regression)', () => {
    expect(
      assignButtonLabel({
        ...baseConfirm,
        selectedPlayerId: 'p-x',
        redirecting: true,
        // submitting may briefly overlap if state updates batch differently —
        // redirecting must still win.
        submitting: true,
      }),
    ).toBe('Done — redirecting…')
  })

  it('"Linked" wins over "Saving…" once isAlreadyAssigned latches', () => {
    expect(
      assignButtonLabel({
        ...baseConfirm,
        selectedPlayerId: 'p-x',
        isAlreadyAssigned: true,
        submitting: true,
      }),
    ).toBe('Linked')
  })

  it('redirecting wins over isAlreadyAssigned (so the affordance is consistent on the way out)', () => {
    expect(
      assignButtonLabel({
        ...baseConfirm,
        selectedPlayerId: 'p-x',
        isAlreadyAssigned: true,
        redirecting: true,
      }),
    ).toBe('Done — redirecting…')
  })
})

describe('assignButtonDisabled', () => {
  const base = {
    selectedPlayerId: 'p-x' as string | null,
    submitting: false,
    unassigning: false,
    redirecting: false,
    isAlreadyAssigned: false,
  }

  it('enabled when a player is selected and nothing is in flight', () => {
    expect(assignButtonDisabled(base)).toBe(false)
  })

  it('disabled with no selection', () => {
    expect(assignButtonDisabled({ ...base, selectedPlayerId: null })).toBe(true)
  })

  it('disabled while redirecting (no double-submit during the slow nav window)', () => {
    expect(assignButtonDisabled({ ...base, redirecting: true })).toBe(true)
  })

  it('disabled when already assigned', () => {
    expect(assignButtonDisabled({ ...base, isAlreadyAssigned: true })).toBe(true)
  })
})

describe('unassignButtonLabel', () => {
  it('shows the resting label by default', () => {
    expect(unassignButtonLabel({ unassigning: false, redirecting: false })).toBe('Unassign Profile')
  })

  it('shows "Removing…" while the API call is in flight', () => {
    expect(unassignButtonLabel({ unassigning: true, redirecting: false })).toBe('Removing…')
  })

  it('shows "Redirecting…" once the API succeeds (regression)', () => {
    expect(unassignButtonLabel({ unassigning: false, redirecting: true })).toBe('Redirecting…')
  })

  it('redirecting wins over unassigning if both flip', () => {
    expect(unassignButtonLabel({ unassigning: true, redirecting: true })).toBe('Redirecting…')
  })
})

describe('unassignButtonDisabled', () => {
  const base = { submitting: false, unassigning: false, redirecting: false }

  it('enabled at rest', () => {
    expect(unassignButtonDisabled(base)).toBe(false)
  })

  it('disabled while redirecting', () => {
    expect(unassignButtonDisabled({ ...base, redirecting: true })).toBe(true)
  })
})
