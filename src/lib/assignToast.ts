/**
 * Pure toast-dispatch helpers for the v1.6.0 auto-navigate flow on
 * `/assign-player`. The component no longer renders an inline success view —
 * it pushes the user to `/` and relies on a Sonner toast (mounted at the
 * root layout) to confirm the outcome. These helpers convert the I/O result
 * shape from `lib/optimisticLink.ts` into a toast call against any object
 * that satisfies the `ToastApi` shape (production: sonner's `toast`).
 *
 * v1.17.0 — Loading toast pattern. The window between Confirm-click and the
 * cold-lambda API resolve was 500ms-3s of perceived dead time: navigation
 * fired synchronously (good) but the user got no toast feedback until the
 * API resolved. v1.17.0 fires `toast.loading(...)` synchronously, captures
 * the returned id, and replaces it in-place via `toast.success/error(msg,
 * { id })` once the API resolves. Sonner does the spinner→checkmark/X
 * transition in-place — no flash, no double toast.
 *
 * Pulling the dispatch out of the component lets vitest pin the contract
 * (which side of toast fires, with what string, with the right id) without
 * mounting React or sonner.
 */

import type {
  LinkAttemptResult,
  UnlinkAttemptResult,
} from './optimisticLink'

export type ToastId = string | number

export type ToastApi = {
  loading: (msg: string) => ToastId
  success: (msg: string, opts?: { id?: ToastId }) => void
  error: (msg: string, opts?: { id?: ToastId }) => void
}

const DEFAULT_LINK_ERROR = 'Assignment failed'
const DEFAULT_UNLINK_ERROR = 'Unassignment failed'
const UNLINK_SUCCESS_MESSAGE = 'Unlinked from your player'

/**
 * Fire a loading toast that survives navigation (Sonner Toaster lives at
 * the root layout). Returns the toast id so the caller can pass it to
 * `notifyLinkOutcome` for in-place replacement when the API resolves.
 */
export function notifyLinkPending(
  playerName: string,
  toast: ToastApi,
): ToastId {
  return toast.loading(`Linking to ${playerName}…`)
}

export function notifyUnlinkPending(toast: ToastApi): ToastId {
  return toast.loading('Unlinking…')
}

/**
 * Replace the loading toast with success/error (or fire a fresh toast if
 * `id` is not supplied — preserves callers that don't use the loading
 * pattern).
 */
export function notifyLinkOutcome(
  result: LinkAttemptResult,
  toast: ToastApi,
  id?: ToastId,
): 'success' | 'error' {
  const opts = id !== undefined ? { id } : undefined
  if (result.ok) {
    toast.success(`Linked to ${result.playerName}`, opts)
    return 'success'
  }
  toast.error(result.error || DEFAULT_LINK_ERROR, opts)
  return 'error'
}

export function notifyUnlinkOutcome(
  result: UnlinkAttemptResult,
  toast: ToastApi,
  id?: ToastId,
): 'success' | 'error' {
  const opts = id !== undefined ? { id } : undefined
  if (result.ok) {
    toast.success(UNLINK_SUCCESS_MESSAGE, opts)
    return 'success'
  }
  toast.error(result.error || DEFAULT_UNLINK_ERROR, opts)
  return 'error'
}
