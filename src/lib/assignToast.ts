/**
 * Pure toast-dispatch helpers for the v1.6.0 auto-navigate flow on
 * `/assign-player`. The component no longer renders an inline success view —
 * it pushes the user to `/` and relies on a Sonner toast (mounted at the
 * root layout) to confirm the outcome. These helpers convert the I/O result
 * shape from `lib/optimisticLink.ts` into a toast call against any object
 * that satisfies the `ToastApi` shape (production: sonner's `toast`).
 *
 * Pulling the dispatch out of the component lets vitest pin the contract
 * (which side of toast fires, with what string) without mounting React or
 * sonner. The component just calls `notifyLinkOutcome(result, toast)`.
 */

import type {
  LinkAttemptResult,
  UnlinkAttemptResult,
} from './optimisticLink'

export type ToastApi = {
  success: (msg: string) => void
  error: (msg: string) => void
}

const DEFAULT_LINK_ERROR = 'Assignment failed'
const DEFAULT_UNLINK_ERROR = 'Unassignment failed'
const UNLINK_SUCCESS_MESSAGE = 'Unlinked from your player'

export function notifyLinkOutcome(
  result: LinkAttemptResult,
  toast: ToastApi,
): 'success' | 'error' {
  if (result.ok) {
    toast.success(`Linked to ${result.playerName}`)
    return 'success'
  }
  toast.error(result.error || DEFAULT_LINK_ERROR)
  return 'error'
}

export function notifyUnlinkOutcome(
  result: UnlinkAttemptResult,
  toast: ToastApi,
): 'success' | 'error' {
  if (result.ok) {
    toast.success(UNLINK_SUCCESS_MESSAGE)
    return 'success'
  }
  toast.error(result.error || DEFAULT_UNLINK_ERROR)
  return 'error'
}
