import { describe, it, expect, vi } from 'vitest'
import { notifyLinkOutcome, notifyUnlinkOutcome } from '@/lib/assignToast'

/**
 * v1.6.0 changed `/assign-player` from "inline success view + Go-home button"
 * to "auto-navigate to / on success, with a Sonner toast confirming the
 * outcome." `notifyLinkOutcome` / `notifyUnlinkOutcome` is the seam between
 * the API result shape (`LinkAttemptResult` / `UnlinkAttemptResult` from
 * `lib/optimisticLink.ts`) and the toast call. The component just calls it
 * with sonner's real `toast` — these tests pin the call shape against a
 * stub.
 *
 * If a future edit fires `toast.success` on failure, or swallows the error
 * message, or stops naming the player in the success message, one of these
 * breaks. They're a small contract but a load-bearing one — the toast IS
 * the success acknowledgement now that the inline view is gone.
 */
describe('notifyLinkOutcome', () => {
  it('fires toast.success with "Linked to {playerName}" on ok=true', () => {
    const toast = { success: vi.fn(), error: vi.fn() }
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
    expect(toast.success).toHaveBeenCalledWith('Linked to Ian Noseda')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('fires toast.error with the server error message on ok=false', () => {
    const toast = { success: vi.fn(), error: vi.fn() }
    const out = notifyLinkOutcome(
      { ok: false, error: 'Player already linked to another LINE user' },
      toast,
    )
    expect(out).toBe('error')
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith(
      'Player already linked to another LINE user',
    )
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('falls back to "Assignment failed" when the error message is empty', () => {
    const toast = { success: vi.fn(), error: vi.fn() }
    notifyLinkOutcome({ ok: false, error: '' }, toast)
    expect(toast.error).toHaveBeenCalledWith('Assignment failed')
  })
})

describe('notifyUnlinkOutcome', () => {
  it('fires toast.success with the unlink confirmation on ok=true', () => {
    const toast = { success: vi.fn(), error: vi.fn() }
    const out = notifyUnlinkOutcome({ ok: true }, toast)
    expect(out).toBe('success')
    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith('Unlinked from your player')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('fires toast.error with the server error on ok=false', () => {
    const toast = { success: vi.fn(), error: vi.fn() }
    const out = notifyUnlinkOutcome({ ok: false, error: 'Not authenticated' }, toast)
    expect(out).toBe('error')
    expect(toast.error).toHaveBeenCalledWith('Not authenticated')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('falls back to "Unassignment failed" when the error message is empty', () => {
    const toast = { success: vi.fn(), error: vi.fn() }
    notifyUnlinkOutcome({ ok: false, error: '' }, toast)
    expect(toast.error).toHaveBeenCalledWith('Unassignment failed')
  })
})
