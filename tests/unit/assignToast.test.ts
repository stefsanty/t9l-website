import { describe, it, expect, vi } from 'vitest'
import {
  notifyLinkOutcome,
  notifyLinkPending,
  notifyUnlinkOutcome,
  notifyUnlinkPending,
  type ToastApi,
} from '@/lib/assignToast'

/**
 * v1.6.0 changed `/assign-player` from "inline success view + Go-home button"
 * to "auto-navigate to / on success, with a Sonner toast confirming the
 * outcome." `notifyLinkOutcome` / `notifyUnlinkOutcome` is the seam between
 * the API result shape (`LinkAttemptResult` / `UnlinkAttemptResult` from
 * `lib/optimisticLink.ts`) and the toast call.
 *
 * v1.17.0 — adds `notifyLinkPending` / `notifyUnlinkPending` to the same
 * file. They fire `toast.loading(...)` synchronously and return a toast id
 * that the corresponding outcome call uses to replace the loading toast
 * in-place.
 */

function makeToast() {
  const toast: ToastApi = {
    loading: vi.fn(() => 'toast-id-42'),
    success: vi.fn(),
    error: vi.fn(),
  }
  return toast as ToastApi & {
    loading: ReturnType<typeof vi.fn>
    success: ReturnType<typeof vi.fn>
    error: ReturnType<typeof vi.fn>
  }
}

describe('notifyLinkPending (v1.17.0)', () => {
  it('fires toast.loading with "Linking to {playerName}…" and returns the id', () => {
    const toast = makeToast()
    const id = notifyLinkPending('Ian Noseda', toast)
    expect(toast.loading).toHaveBeenCalledTimes(1)
    expect(toast.loading).toHaveBeenCalledWith('Linking to Ian Noseda…')
    expect(id).toBe('toast-id-42')
  })
})

describe('notifyUnlinkPending (v1.17.0)', () => {
  it('fires toast.loading with the unlink message and returns the id', () => {
    const toast = makeToast()
    const id = notifyUnlinkPending(toast)
    expect(toast.loading).toHaveBeenCalledTimes(1)
    expect(toast.loading).toHaveBeenCalledWith('Unlinking…')
    expect(id).toBe('toast-id-42')
  })
})

describe('notifyLinkOutcome', () => {
  it('fires toast.success with "Linked to {playerName}" on ok=true', () => {
    const toast = makeToast()
    const out = notifyLinkOutcome(
      {
        ok: true,
        playerId: 'ian-noseda',
        playerName: 'Ian Noseda',
        teamId: 'mariners-fc',
      },
      toast,
    )
    expect(out).toBe('success')
    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith('Linked to Ian Noseda', undefined)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('fires toast.error with the server error message on ok=false', () => {
    const toast = makeToast()
    const out = notifyLinkOutcome(
      { ok: false, error: 'Player already linked to another LINE user' },
      toast,
    )
    expect(out).toBe('error')
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith(
      'Player already linked to another LINE user',
      undefined,
    )
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('falls back to "Assignment failed" when the error message is empty', () => {
    const toast = makeToast()
    notifyLinkOutcome({ ok: false, error: '' }, toast)
    expect(toast.error).toHaveBeenCalledWith('Assignment failed', undefined)
  })

  it("v1.17.0 — passes { id } when an id is supplied (replaces the loading toast in-place)", () => {
    const toast = makeToast()
    notifyLinkOutcome(
      {
        ok: true,
        playerId: 'ian-noseda',
        playerName: 'Ian Noseda',
        teamId: 'mariners-fc',
      },
      toast,
      'toast-id-42',
    )
    expect(toast.success).toHaveBeenCalledWith('Linked to Ian Noseda', { id: 'toast-id-42' })
  })

  it("v1.17.0 — error path also replaces the loading toast in-place", () => {
    const toast = makeToast()
    notifyLinkOutcome({ ok: false, error: 'Not authenticated' }, toast, 'toast-id-42')
    expect(toast.error).toHaveBeenCalledWith('Not authenticated', { id: 'toast-id-42' })
  })
})

describe('notifyUnlinkOutcome', () => {
  it('fires toast.success with the unlink confirmation on ok=true', () => {
    const toast = makeToast()
    const out = notifyUnlinkOutcome({ ok: true }, toast)
    expect(out).toBe('success')
    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith('Unlinked from your player', undefined)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('fires toast.error with the server error on ok=false', () => {
    const toast = makeToast()
    const out = notifyUnlinkOutcome({ ok: false, error: 'Not authenticated' }, toast)
    expect(out).toBe('error')
    expect(toast.error).toHaveBeenCalledWith('Not authenticated', undefined)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('falls back to "Unassignment failed" when the error message is empty', () => {
    const toast = makeToast()
    notifyUnlinkOutcome({ ok: false, error: '' }, toast)
    expect(toast.error).toHaveBeenCalledWith('Unassignment failed', undefined)
  })

  it("v1.17.0 — passes { id } when an id is supplied", () => {
    const toast = makeToast()
    notifyUnlinkOutcome({ ok: true }, toast, 'toast-id-42')
    expect(toast.success).toHaveBeenCalledWith('Unlinked from your player', { id: 'toast-id-42' })
  })
})
