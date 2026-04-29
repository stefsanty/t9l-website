/**
 * Pure async orchestration helper for the public-site link flow on
 * `/assign-player`. Pulled out of `AssignPlayerClient` (PR 18 / v1.6.1) so
 * the navigate-vs-API ordering — the regression target for the bug v1.6.1
 * fixes — is unit-testable without React or a real router.
 *
 * v1.6.1 fixes a UX bug introduced when v1.6.0 reverted v1.4.0's optimistic
 * inline-success view. v1.6.0 awaited `attemptLink` before firing
 * `router.push('/')`. On a cold Vercel lambda the API write is 3–5s, so the
 * user clicked Confirm and watched the button stuck on "Saving…" with no
 * perceived navigation until the toast finally appeared — which read as
 * "navigation tied to toast dismissal" because nothing happened until the
 * toast did. v1.6.1 inverts the order: the route push fires synchronously,
 * the API write runs to completion in the background, and the toast (mounted
 * at the root layout, persists across the route change) confirms the
 * outcome on the destination. Error path: the user is already on `/`; the
 * error toast is the surface — a manual return to `/assign-player` to retry
 * is acceptable since this path is rare (4xx is filtered by the picker
 * server-side, 5xx is the only realistic case).
 */

import {
  attemptLink,
  type LinkAttemptResult,
} from './optimisticLink'
import {
  notifyLinkOutcome,
  notifyLinkPending,
  type ToastApi,
} from './assignToast'

export type AssignSubmitDeps = {
  pushHome: () => void
  link?: (playerId: string) => Promise<LinkAttemptResult>
  toast: ToastApi
  refreshSession?: () => Promise<unknown>
  onError?: (error: string) => void
  /** v1.17.0 — used by the loading toast so the user sees feedback during
   * the cold-lambda window between Confirm-click and the API resolve. */
  playerName: string
}

/**
 * Orchestrates the v1.6.1 navigate-immediately-then-write flow with the
 * v1.17.0 loading-toast layer on top.
 *
 * Order of operations (load-bearing — pinned by `tests/unit/assignSubmit.test.ts`):
 *   1. `notifyLinkPending(playerName, toast)` — fires `toast.loading(...)`
 *      synchronously so the user gets immediate feedback. Sonner's
 *      Toaster sits at the root layout so this toast survives the
 *      route push that follows.
 *   2. `pushHome()` — synchronously, before any await. Browser starts
 *      transitioning while the API write is in flight.
 *   3. `link(playerId)` — runs in the background.
 *   4. `notifyLinkOutcome(result, toast, id)` — replaces the loading
 *      toast in-place via the captured id (success → checkmark with
 *      "Linked to {name}", error → X with the error message).
 *   5. `refreshSession()` — fire-and-forget on success.
 *   6. `onError(error)` — if provided, called on failure.
 *
 * Returns the final `LinkAttemptResult` so callers can branch on it for
 * additional bookkeeping (e.g. clearing `submitting`).
 */
export async function performAssignSubmit(
  playerId: string,
  deps: AssignSubmitDeps,
): Promise<LinkAttemptResult> {
  const linkImpl = deps.link ?? attemptLink

  // Step 1: loading toast IMMEDIATELY (synchronously). Captures the id so
  // step 4 can replace it in-place once the API resolves.
  const toastId = notifyLinkPending(deps.playerName, deps.toast)

  // Step 2: navigate IMMEDIATELY. Must happen before any await so the
  // browser starts the route transition while the API write is in flight.
  deps.pushHome()

  // Step 3: fire the API write. The caller has already navigated; this just
  // resolves the actual link state.
  const result = await linkImpl(playerId)

  // Step 4: replace the loading toast in-place via the captured id. Sonner
  // transitions spinner→checkmark/X without flashing or stacking.
  notifyLinkOutcome(result, deps.toast, toastId)

  if (result.ok) {
    // Step 5: refresh next-auth so the destination's `useSession` cache
    // picks up the new `playerId` without a full reload. Fire-and-forget —
    // awaiting it would re-introduce a multi-second hang we just removed.
    deps.refreshSession?.().catch((err) => {
      console.warn('[assign] background session refresh failed:', err)
    })
  } else if (deps.onError) {
    deps.onError(result.error)
  }

  return result
}
