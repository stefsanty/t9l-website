/**
 * Pure helpers for the optimistic player-linking flow on /assign-player.
 *
 * Why this lives outside `AssignPlayerClient.tsx` (PR 13 / v1.4.0):
 *   `useOptimistic` flips the UI before the API resolves — but we still need
 *   to bound the request boundary so the component can decide commit-vs-revert.
 *   That request boundary is the rollback gate. Pulling it into a pure async
 *   function lets vitest pin the gate without mounting React: the test fakes
 *   `fetch`, calls `attemptLink`, and asserts the returned discriminated
 *   union. Any future edit that swallows an error or returns the wrong shape
 *   breaks the test.
 *
 * The component owns the optimistic state itself (`useOptimistic`) and the
 * commit/revert wiring; this module only owns the I/O.
 *
 * Why `deps.fetch` is optional (PR 15 / v1.4.3):
 *   The previous shape REQUIRED callers to pass `{ fetch }` and then invoked
 *   `deps.fetch(...)` internally — which calls fetch as a *method of `deps`*,
 *   not as a method of the Window. Browser fetch's WebIDL brand check rejects
 *   any receiver that isn't a Window/Worker → "Illegal invocation". Vitest
 *   spies have no such brand check, so unit tests passed cleanly while every
 *   real link/unlink in production threw and rolled back the optimistic flip.
 *   The fix: make `deps` optional, and when it's omitted, default to a
 *   free-function wrapper around the global `fetch`. Free-function fetch in
 *   module scope works in browsers (the WebIDL realm-binding handles the
 *   global call). Tests still pass `{ fetch: spy }` — the seam is preserved
 *   for injection, but production callers no longer touch the fetch reference
 *   at all.
 */

export type LinkedState = {
  playerId: string
  playerName: string
  teamId: string
}

export type LinkAttemptResult =
  | { ok: true; playerId: string; playerName: string; teamId: string }
  | { ok: false; error: string }

export type UnlinkAttemptResult = { ok: true } | { ok: false; error: string }

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>

// Default to a free-function call against the global `fetch`, so there is no
// way to accidentally invoke fetch as a method of any other receiver. Tests
// can override by passing `deps.fetch`.
const defaultFetch: FetchLike = (input, init) => fetch(input, init)

export async function attemptLink(
  playerId: string,
  deps?: { fetch?: FetchLike },
): Promise<LinkAttemptResult> {
  const fetchImpl = deps?.fetch ?? defaultFetch
  try {
    const res = await fetchImpl('/api/assign-player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      return { ok: false, error: body.error ?? 'Assignment failed' }
    }
    const body = (await res.json()) as {
      ok: boolean
      playerId: string
      playerName: string
      teamId: string
    }
    return {
      ok: true,
      playerId: body.playerId,
      playerName: body.playerName,
      teamId: body.teamId,
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Something went wrong',
    }
  }
}

export async function attemptUnlink(deps?: {
  fetch?: FetchLike
}): Promise<UnlinkAttemptResult> {
  const fetchImpl = deps?.fetch ?? defaultFetch
  try {
    const res = await fetchImpl('/api/assign-player', { method: 'DELETE' })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      return { ok: false, error: body.error ?? 'Unassignment failed' }
    }
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Something went wrong',
    }
  }
}
