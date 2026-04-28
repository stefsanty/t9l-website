import { describe, it, expect, vi } from 'vitest'
import { postAssignNavigate } from '@/lib/postAssignNavigate'

describe('postAssignNavigate', () => {
  it('calls router.push("/") inside a transition', () => {
    const push = vi.fn()
    const startTransition = vi.fn((cb: () => void) => cb())

    postAssignNavigate({
      router: { push },
      startTransition,
    })

    expect(startTransition).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/')
  })

  // Regression for PR β / v1.2.7. The helper's NavigateDeps type intentionally
  // narrows `router` to `{ push }` only — so a future edit that re-introduces
  // `router.refresh()` into this helper would be a TS compile error visible
  // in code review. The pre-fix code did
  //   router.push('/'); router.refresh();
  // which fired two RSC fetches — the second one redundant given the API
  // route already calls revalidatePath('/') + revalidateTag('public-data').
  // Under cold-lambda steady-state (this app's regime) that second fetch was
  // a full 1–3s cold-start round-trip on the user's critical path.
  it('runs push exactly once — no second RSC fetch', () => {
    const push = vi.fn()
    const startTransition = vi.fn((cb: () => void) => cb())

    postAssignNavigate({
      router: { push },
      startTransition,
    })

    expect(push).toHaveBeenCalledTimes(1)
  })

  it('runs the push synchronously inside the transition callback', () => {
    const push = vi.fn()
    const order: string[] = []
    const startTransition = vi.fn((cb: () => void) => {
      order.push('transition-start')
      cb()
      order.push('transition-end')
    })

    push.mockImplementation(() => order.push('push'))

    postAssignNavigate({
      router: { push },
      startTransition,
    })

    expect(order).toEqual(['transition-start', 'push', 'transition-end'])
  })
})
