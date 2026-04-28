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
import { notifyLinkOutcome, type ToastApi } from './assignToast'

export type AssignSubmitDeps = {
  pushHome: () => void
  link?: (playerId: string) => Promise<LinkAttemptResult>
  toast: ToastApi
  refreshSession?: () => Promise<unknown>
  onError?: (error: string) => void
}

/**
 * Orchestrates the v1.6.1 navigate-immediately-then-write flow.
 *
 * Order of operations (load-bearing — pinned by `tests/unit/assignSubmit.test.ts`):
 *   1. `pushHome()` — fires synchronously BEFORE the API write begins.
 *   2. `link(playerId)` — runs in the background (the function awaits, but
 *      the caller has already navigated by step 1).
 *   3. `notifyLinkOutcome(result, toast)` — success or error toast.
 *   4. `refreshSession()` — fire-and-forget, only on success.
 *   5. `onError(error)` — if provided, called only on failure (the
 *      component uses this to render the inline error text for the rare
 *      case where the user navigates back to `/assign-player`).
 *
 * Returns the final `LinkAttemptResult` so callers can branch on it for
 * additional bookkeeping (e.g. clearing `submitting`).
 */
export async function performAssignSubmit(
  playerId: string,
  deps: AssignSubmitDeps,
): Promise<LinkAttemptResult> {
  const linkImpl = deps.link ?? attemptLink

  // Step 1: navigate IMMEDIATELY. This must happen before any await so the
  // browser starts the route transition while the API write is in flight.
  deps.pushHome()

  // Step 2: fire the API write. The caller has already navigated; this just
  // resolves the actual link state.
  const result = await linkImpl(playerId)

  // Step 3: toast on the destination. The Sonner provider lives at the root
  // layout so the toast survives the navigation.
  notifyLinkOutcome(result, deps.toast)

  if (result.ok) {
    // Step 4: refresh next-auth so the destination's `useSession` cache
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
