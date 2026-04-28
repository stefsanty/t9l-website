/**
 * Pure I/O helpers for the player-linking flow on /assign-player. These wrap
 * the POST/DELETE against `/api/assign-player` into a discriminated union
 * `{ ok: true, ... } | { ok: false, error }` that callers branch on.
 *
 * Why `deps.fetch` is optional (PR 15 / v1.4.3): the previous shape required
 * callers to pass `{ fetch }` and invoked `deps.fetch(...)` internally —
 * which calls fetch as a method of the plain `deps` object, tripping the
 * browser's WebIDL receiver brand check ("Illegal invocation"). The fix
 * routes the no-deps path through a module-scope wrapper that calls the
 * global `fetch`. Tests still inject via `{ fetch: spy }` for spying.
 */

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
