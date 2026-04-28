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

export async function attemptLink(
  playerId: string,
  deps: { fetch: FetchLike },
): Promise<LinkAttemptResult> {
  try {
    const res = await deps.fetch('/api/assign-player', {
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

export async function attemptUnlink(deps: {
  fetch: FetchLike
}): Promise<UnlinkAttemptResult> {
  try {
    const res = await deps.fetch('/api/assign-player', { method: 'DELETE' })
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
