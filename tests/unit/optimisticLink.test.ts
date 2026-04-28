import { describe, it, expect, vi } from 'vitest'
import { attemptLink, attemptUnlink } from '@/lib/optimisticLink'

/**
 * `attemptLink` is the rollback gate for `AssignPlayerClient`'s optimistic
 * UI (PR 13 / v1.4.0). The component calls `addOptimisticLinked(...)` first,
 * then awaits this function — and only commits to `setCommittedLinked` when
 * the result is `{ ok: true }`. Any code path that returns `{ ok: false }`
 * causes `useOptimistic` to revert at end-of-transition (no commit), which
 * is the "rollback" the spec requires.
 *
 * The tests below pin every shape of result the component branches on:
 *   - HTTP 200 with payload  → ok=true with playerId/playerName/teamId
 *   - HTTP 4xx/5xx + body    → ok=false with the server-supplied error
 *   - HTTP 4xx/5xx no body   → ok=false with a fallback error
 *   - fetch throws (network) → ok=false with the thrown message
 *
 * If a future edit swallows an error or returns the wrong shape, the
 * component would commit on a failed write or fail to commit on success;
 * one of these tests catches the regression.
 */
describe('attemptLink', () => {
  it('returns ok=true with the API payload on 200', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        playerId: 'ian-noseda',
        playerName: 'Ian Noseda',
        teamId: 'mariners-fc',
      }),
    })
    const result = await attemptLink('ian-noseda', { fetch: fetchSpy })
    expect(result).toEqual({
      ok: true,
      playerId: 'ian-noseda',
      playerName: 'Ian Noseda',
      teamId: 'mariners-fc',
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/assign-player')
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(JSON.parse(init.body)).toEqual({ playerId: 'ian-noseda' })
  })

  it('returns ok=false with the server error message on a 5xx with JSON body', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Storage error' }),
    })
    const result = await attemptLink('ian-noseda', { fetch: fetchSpy })
    expect(result).toEqual({ ok: false, error: 'Storage error' })
  })

  it('returns ok=false with a fallback error when the body is malformed', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => {
        throw new Error('not json')
      },
    })
    const result = await attemptLink('ian-noseda', { fetch: fetchSpy })
    expect(result).toEqual({ ok: false, error: 'Assignment failed' })
  })

  it('returns ok=false when fetch itself rejects (network failure)', async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error('NetworkError'))
    const result = await attemptLink('ian-noseda', { fetch: fetchSpy })
    expect(result).toEqual({ ok: false, error: 'NetworkError' })
  })

  it('returns ok=false with a generic message for non-Error throws', async () => {
    const fetchSpy = vi.fn().mockRejectedValue('boom')
    const result = await attemptLink('ian-noseda', { fetch: fetchSpy })
    expect(result).toEqual({ ok: false, error: 'Something went wrong' })
  })
})

describe('attemptUnlink', () => {
  it('returns ok=true on 200', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    })
    const result = await attemptUnlink({ fetch: fetchSpy })
    expect(result).toEqual({ ok: true })
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/assign-player')
    expect(init).toEqual({ method: 'DELETE' })
  })

  it('returns ok=false with the server error on failure', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Not authenticated' }),
    })
    const result = await attemptUnlink({ fetch: fetchSpy })
    expect(result).toEqual({ ok: false, error: 'Not authenticated' })
  })

  it('returns ok=false on network failure', async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error('offline'))
    const result = await attemptUnlink({ fetch: fetchSpy })
    expect(result).toEqual({ ok: false, error: 'offline' })
  })
})

/**
 * Regression for the "Illegal invocation" bug (PR 15 / v1.4.3).
 *
 * The pre-fix shape REQUIRED callers to pass `{ fetch }`, and the helpers
 * invoked `deps.fetch(...)` internally. In a real browser, that calls fetch
 * as a method of the plain `deps` object — and fetch's WebIDL receiver
 * brand check rejects any `this` that isn't a Window/Worker, throwing
 * `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation`.
 * Vitest spies have no brand check, so the unit suite passed cleanly while
 * every real link/unlink in production threw and rolled back the optimistic
 * UI flip. The user reported it on both link AND unassign paths — both
 * helpers used the same shape.
 *
 * The fix made `deps` optional and routed the no-deps path through a
 * module-scope free-function wrapper (`(input, init) => fetch(input, init)`)
 * which calls fetch as a global — the realm-bound dispatch the WebIDL spec
 * uses for the global call form, no `this` issues.
 *
 * The tests below pin the new contract:
 *   - `attemptLink('id')` / `attemptUnlink()` (no deps) call `globalThis.fetch`
 *     exactly once with the expected args (i.e. they DO route through the
 *     global, not through some captured/aliased form that loses binding).
 *   - The legacy injectable shape (`{ fetch: spy }`) still works.
 *
 * If a future edit re-introduces a `deps.fetch(...)` call, or aliases the
 * fetch reference to a const that the helper invokes as a property of an
 * object, the no-deps test above would still pass — `vi.stubGlobal('fetch', ...)`
 * stubs the global and bare `fetch(...)` finds it. The brand check is
 * un-reproducible in jsdom/node. So this regression test pins the SHAPE of
 * the call (where the call originates), not the brand-check behavior — the
 * real-browser regression is caught by the Playwright spec.
 */
describe('Illegal invocation regression — global fetch fallback (PR 15 / v1.4.3)', () => {
  it('attemptLink with no deps calls globalThis.fetch exactly once', async () => {
    const fetchStub = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        playerId: 'ian-noseda',
        playerName: 'Ian Noseda',
        teamId: 'mariners-fc',
      }),
    })
    vi.stubGlobal('fetch', fetchStub)
    try {
      const result = await attemptLink('ian-noseda')
      expect(result.ok).toBe(true)
      expect(fetchStub).toHaveBeenCalledTimes(1)
      const [url, init] = fetchStub.mock.calls[0]
      expect(url).toBe('/api/assign-player')
      expect(init).toMatchObject({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      expect(JSON.parse(init.body)).toEqual({ playerId: 'ian-noseda' })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('attemptUnlink with no deps calls globalThis.fetch exactly once with DELETE', async () => {
    const fetchStub = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    })
    vi.stubGlobal('fetch', fetchStub)
    try {
      const result = await attemptUnlink()
      expect(result.ok).toBe(true)
      expect(fetchStub).toHaveBeenCalledTimes(1)
      const [url, init] = fetchStub.mock.calls[0]
      expect(url).toBe('/api/assign-player')
      expect(init).toEqual({ method: 'DELETE' })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('attemptLink still accepts the legacy { fetch } injection for tests', async () => {
    // The previous test suite (above) all use this shape. We're keeping the
    // seam — just making it OPTIONAL — so unit-test injectability continues
    // to work without forcing production callers to bind anything.
    const spy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        playerId: 'a',
        playerName: 'A',
        teamId: 't',
      }),
    })
    const result = await attemptLink('a', { fetch: spy })
    expect(result.ok).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
