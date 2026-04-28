import { describe, it, expect } from 'vitest'
import {
  assignButtonLabel,
  assignButtonDisabled,
  unassignButtonLabel,
  unassignButtonDisabled,
} from '@/lib/assignButtonLabel'

const baseConfirm = {
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

  // The "Saving…" window collapsed to a single render in v1.4.0 — the
  // optimistic flip replaces the form with the success view immediately.
  // The label only matters for the brief synchronous gap before the
  // transition body schedules the optimistic update. Pin the legacy state
  // so a future re-introduction of a multi-second submitting window doesn't
  // silently degrade the perceived-instant promise.
  it('shows "Saving…" while submitting (legacy in-flight label)', () => {
    expect(
      assignButtonLabel({ ...baseConfirm, selectedPlayerId: 'p-x', submitting: true }),
    ).toBe('Saving…')
  })

  it('shows "Linked" once the user is already assigned to the selected player', () => {
    expect(
      assignButtonLabel({
        ...baseConfirm,
        selectedPlayerId: 'p-x',
        isAlreadyAssigned: true,
      }),
    ).toBe('Linked')
  })

  it('"Linked" wins over "Saving…"', () => {
    expect(
      assignButtonLabel({
        ...baseConfirm,
        selectedPlayerId: 'p-x',
        isAlreadyAssigned: true,
        submitting: true,
      }),
    ).toBe('Linked')
  })
})

describe('assignButtonDisabled', () => {
  const base = {
    selectedPlayerId: 'p-x' as string | null,
    submitting: false,
    unassigning: false,
    isAlreadyAssigned: false,
  }

  it('enabled when a player is selected and nothing is in flight', () => {
    expect(assignButtonDisabled(base)).toBe(false)
  })

  it('disabled with no selection', () => {
    expect(assignButtonDisabled({ ...base, selectedPlayerId: null })).toBe(true)
  })

  it('disabled while submitting (no double-submit during the brief request window)', () => {
    expect(assignButtonDisabled({ ...base, submitting: true })).toBe(true)
  })

  it('disabled when already assigned', () => {
    expect(assignButtonDisabled({ ...base, isAlreadyAssigned: true })).toBe(true)
  })
})

describe('unassignButtonLabel', () => {
  it('shows the resting label by default', () => {
    expect(unassignButtonLabel({ unassigning: false })).toBe('Unassign Profile')
  })

  it('shows "Removing…" while the API call is in flight', () => {
    expect(unassignButtonLabel({ unassigning: true })).toBe('Removing…')
  })
})

describe('unassignButtonDisabled', () => {
  const base = { submitting: false, unassigning: false }

  it('enabled at rest', () => {
    expect(unassignButtonDisabled(base)).toBe(false)
  })

  it('disabled while unassigning', () => {
    expect(unassignButtonDisabled({ ...base, unassigning: true })).toBe(true)
  })

  it('disabled while a submit is in flight (prevents racing the assign POST with a DELETE)', () => {
    expect(unassignButtonDisabled({ ...base, submitting: true })).toBe(true)
  })
})
