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
