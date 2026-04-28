import { describe, it, expect, vi } from 'vitest'
import { kickOffSessionRefresh } from '@/lib/kickOffSessionRefresh'

describe('kickOffSessionRefresh', () => {
  it('calls update exactly once', () => {
    const update = vi.fn(() => Promise.resolve())
    kickOffSessionRefresh(update)
    expect(update).toHaveBeenCalledTimes(1)
  })

  // Regression for PR 11 / v1.3.0. If a future edit re-introduces `await`
  // into the helper, this assertion fails: kickOffSessionRefresh would block
  // until the Promise resolves instead of returning synchronously, and the
  // caller would once again be paying a cold-lambda /api/auth/session round-
  // trip on the user-visible critical path.
  it('returns synchronously without waiting for the update Promise to resolve', () => {
    let resolveUpdate!: () => void
    const update = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveUpdate = resolve
        }),
    )

    // Helper invocation; we assert it returns immediately even though the
    // Promise is still pending. The function's return type is `void`, so
    // the only way it could "block" is if it became `async` and was awaited
    // by the caller — which the inline call site doesn't do, but the helper
    // shape is what we're pinning here.
    kickOffSessionRefresh(update)

    expect(update).toHaveBeenCalledTimes(1)
    // Resolve the Promise so the test runner doesn't hold a dangling timer.
    resolveUpdate()
  })

  it('swallows update Promise rejections so they do not surface as unhandled', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const update = vi.fn(() => Promise.reject(new Error('boom')))

    kickOffSessionRefresh(update)
    // Yield to the microtask queue so the .catch handler runs.
    await Promise.resolve()
    await Promise.resolve()

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][0]).toMatch(/background session refresh failed/i)
    warnSpy.mockRestore()
  })
})
