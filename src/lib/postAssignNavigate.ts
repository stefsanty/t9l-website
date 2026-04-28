/**
 * Post-API-success navigation for the public assign-player flow. Extracted
 * out of `AssignPlayerClient` so the call shape is unit-testable without
 * mounting React — the regression target is the *sequence of router calls*,
 * not the JSX.
 *
 * Why this exists (PR β / v1.2.7):
 *   Pre-fix, the post-API path was `router.push('/'); router.refresh();`.
 *   That's two RSC fetches: one for the navigation, one to invalidate the
 *   client cache. But the API route already calls `revalidatePath('/')` and
 *   `revalidateTag('public-data', { expire: 0 })` server-side — which Next
 *   propagates to the client router cache on the next navigation. The
 *   `refresh()` was a redundant round-trip that paid a full cold-lambda
 *   penalty on the user's critical path (this app runs cold-most-of-the-time
 *   per low traffic). Dropping it saves 200–500ms warm and 1–3s cold.
 *
 *   `startTransition` keeps the UI responsive while the destination RSC
 *   payload arrives — without it the navigation runs at default priority
 *   and can briefly block other state updates. The `redirecting` flag in
 *   the parent already disables the button, so the practical effect is
 *   small, but it follows React's recommended pattern for router.push.
 */

export type NavigateDeps = {
  router: { push: (url: string) => void }
  startTransition: (cb: () => void) => void
}

export function postAssignNavigate(deps: NavigateDeps): void {
  deps.startTransition(() => {
    deps.router.push('/')
  })
}
