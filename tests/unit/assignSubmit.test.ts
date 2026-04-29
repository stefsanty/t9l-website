import { describe, it, expect, vi } from 'vitest'
import { performAssignSubmit } from '@/lib/assignSubmit'
import type { LinkAttemptResult } from '@/lib/optimisticLink'

/**
 * The v1.6.1 navigate-immediately-then-write contract is the regression
 * target — the bug v1.6.1 fixes was that v1.6.0 awaited the API write
 * before navigating, so on a cold Vercel lambda the user stared at
 * "Saving…" for 3–5s before the route changed.
 *
 * These tests pin the order of operations in `performAssignSubmit`:
 *
 *   1. `pushHome()` MUST fire BEFORE the API resolves (not after).
 *   2. The toast MUST fire AFTER the API resolves (not before / not at all).
 *   3. `refreshSession()` MUST be fire-and-forget on success.
 *   4. `onError` MUST be called on failure (NOT on success).
 *
 * If a future edit moves `pushHome` after `await link(...)`, test (1)
 * fails. If a future edit forgets to await and the toast fires before the
 * link resolves, test (2) fails. If the destination starts awaiting
 * `refreshSession`, test (3) fails. If `onError` fires on success, test (4)
 * fails.
 */
describe('performAssignSubmit — navigate-immediately-then-write order', () => {
  function deferred<T>() {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  it('calls pushHome BEFORE the link API resolves', async () => {
    const order: string[] = []
    const linkResult = deferred<LinkAttemptResult>()

    const pushHome = vi.fn(() => {
      order.push('push')
    })
    const link = vi.fn((id: string) => {
      order.push(`link-start:${id}`)
      return linkResult.promise
    })
    const toast = {
      loading: vi.fn(() => {
        order.push('toast.loading')
        return 'toast-id'
      }),
      success: vi.fn(() => order.push('toast.success')),
      error: vi.fn(() => order.push('toast.error')),
    }

    const submitPromise = performAssignSubmit('ian-noseda', {
      pushHome,
      link,
      toast,
      playerName: 'Ian Noseda',
    })

    // Allow microtasks to drain — pushHome must have already fired.
    // v1.17.0: the loading toast also fires synchronously, BEFORE the push,
    // so the user gets immediate feedback while the route transition starts.
    await Promise.resolve()
    expect(order).toEqual(['toast.loading', 'push', 'link-start:ian-noseda'])
    expect(toast.success).not.toHaveBeenCalled()

    // Now resolve the API. Toast fires AFTER, not before.
    linkResult.resolve({
      ok: true,
      playerId: 'ian-noseda',
      playerName: 'Ian Noseda',
      teamId: 'mariners-fc',
    })
    await submitPromise

    expect(order).toEqual([
      'toast.loading',
      'push',
      'link-start:ian-noseda',
      'toast.success',
    ])
    // v1.17.0: success replaces the loading toast in-place via { id }.
    expect(toast.loading).toHaveBeenCalledWith('Linking to Ian Noseda…')
    expect(toast.success).toHaveBeenCalledWith('Linked to Ian Noseda', {
      id: 'toast-id',
    })
  })

  it('still navigates immediately on a stalled API and toasts after it resolves', async () => {
    const order: string[] = []
    const linkResult = deferred<LinkAttemptResult>()

    const pushHome = vi.fn(() => order.push('push'))
    const link = vi.fn(() => {
      order.push('link-start')
      return linkResult.promise
    })
    const toast = {
      loading: vi.fn(() => {
        order.push('toast.loading')
        return 'toast-id'
      }),
      success: vi.fn(() => order.push('toast.success')),
      error: vi.fn(() => order.push('toast.error')),
    }

    const submitPromise = performAssignSubmit('ian-noseda', {
      pushHome,
      link,
      toast,
      playerName: 'Ian Noseda',
    })

    // Simulate the cold-lambda 3–5s stall: drain microtasks, push has
    // already fired even though the API hasn't.
    await Promise.resolve()
    await Promise.resolve()
    // v1.17.0: loading toast also fires synchronously (before push).
    expect(order).toEqual(['toast.loading', 'push', 'link-start'])

    linkResult.resolve({
      ok: true,
      playerId: 'p',
      playerName: 'P',
      teamId: 't',
    })
    await submitPromise

    // Toast comes after the resolution — it does NOT precede navigation.
    // v1.17.0: the loading toast precedes navigation (immediate feedback);
    // the success toast (which replaces it) still comes after the API.
    expect(order[0]).toBe('toast.loading')
    expect(order[1]).toBe('push')
    expect(order.indexOf('toast.success')).toBeGreaterThan(
      order.indexOf('link-start'),
    )
  })

  it('fires refreshSession() but does not await it (fire-and-forget on success)', async () => {
    const refreshDeferred = deferred<void>()
    const refreshSession = vi.fn(() => refreshDeferred.promise)

    const pushHome = vi.fn()
    const link = vi.fn().mockResolvedValue({
      ok: true,
      playerId: 'p',
      playerName: 'P',
      teamId: 't',
    } satisfies LinkAttemptResult)
    const toast = {
      loading: vi.fn(() => 'toast-id'),
      success: vi.fn(),
      error: vi.fn(),
    }

    // submit must resolve even though refreshSession's promise is still
    // pending — the destination cannot block on the next-auth refresh.
    const result = await performAssignSubmit('p', {
      pushHome,
      link,
      toast,
      refreshSession,
      playerName: 'P',
    })

    expect(result.ok).toBe(true)
    expect(refreshSession).toHaveBeenCalledTimes(1)
    // Resolve refresh after the fact to ensure no unhandled-rejection
    // surfaces — this is the fire-and-forget contract.
    refreshDeferred.resolve()
  })

  it('does not throw when refreshSession() rejects (fire-and-forget swallows)', async () => {
    const refreshSession = vi.fn().mockRejectedValue(new Error('upstream nope'))
    const pushHome = vi.fn()
    const link = vi.fn().mockResolvedValue({
      ok: true,
      playerId: 'p',
      playerName: 'P',
      teamId: 't',
    } satisfies LinkAttemptResult)
    const toast = {
      loading: vi.fn(() => 'toast-id'),
      success: vi.fn(),
      error: vi.fn(),
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      performAssignSubmit('p', {
        pushHome,
        link,
        toast,
        refreshSession,
        playerName: 'P',
      }),
    ).resolves.toMatchObject({ ok: true })

    // Let the rejection settle so the .catch handler fires.
    await new Promise((r) => setTimeout(r, 0))
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('calls onError on failure (not toast.success)', async () => {
    const pushHome = vi.fn()
    const onError = vi.fn()
    const link = vi.fn().mockResolvedValue({
      ok: false,
      error: 'Player already linked to another LINE user',
    } satisfies LinkAttemptResult)
    const toast = {
      loading: vi.fn(() => 'toast-id'),
      success: vi.fn(),
      error: vi.fn(),
    }

    const result = await performAssignSubmit('p', {
      pushHome,
      link,
      toast,
      onError,
      playerName: 'P',
    })

    expect(result).toEqual({
      ok: false,
      error: 'Player already linked to another LINE user',
    })
    expect(pushHome).toHaveBeenCalledTimes(1) // still navigated immediately
    // v1.17.0: error replaces the loading toast in-place via { id }.
    expect(toast.error).toHaveBeenCalledWith(
      'Player already linked to another LINE user',
      { id: 'toast-id' },
    )
    expect(toast.success).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(
      'Player already linked to another LINE user',
    )
  })

  it('does NOT call onError on success', async () => {
    const onError = vi.fn()
    const pushHome = vi.fn()
    const link = vi.fn().mockResolvedValue({
      ok: true,
      playerId: 'p',
      playerName: 'P',
      teamId: 't',
    } satisfies LinkAttemptResult)
    const toast = {
      loading: vi.fn(() => 'toast-id'),
      success: vi.fn(),
      error: vi.fn(),
    }

    await performAssignSubmit('p', {
      pushHome,
      link,
      toast,
      onError,
      playerName: 'P',
    })
    expect(onError).not.toHaveBeenCalled()
  })

  it('v1.17.0 — fires toast.loading SYNCHRONOUSLY before pushHome (immediate feedback)', async () => {
    const order: string[] = []
    const linkResult = deferred<LinkAttemptResult>()

    const pushHome = vi.fn(() => order.push('push'))
    const link = vi.fn(() => {
      order.push('link-start')
      return linkResult.promise
    })
    const toast = {
      loading: vi.fn(() => {
        order.push('toast.loading')
        return 'toast-id'
      }),
      success: vi.fn(),
      error: vi.fn(),
    }

    const submitPromise = performAssignSubmit('p', {
      pushHome,
      link,
      toast,
      playerName: 'P',
    })

    // The loading toast must fire BEFORE the route push. Drain microtasks
    // and assert the order — a regression that moves toast.loading after
    // pushHome would break this assertion.
    await Promise.resolve()
    expect(order.indexOf('toast.loading')).toBeLessThan(order.indexOf('push'))
    expect(toast.loading).toHaveBeenCalledWith('Linking to P…')

    linkResult.resolve({
      ok: true,
      playerId: 'p',
      playerName: 'P',
      teamId: 't',
    })
    await submitPromise
  })
})
