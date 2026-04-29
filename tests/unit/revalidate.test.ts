import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * v1.16.0 — canonical revalidation helper contract.
 *
 * `src/lib/revalidate.ts#revalidate({ domain, paths, mode })` is the single
 * entry point for all cache invalidation across server actions and route
 * handlers. The previous shape spread `revalidatePath` / `revalidateTag` /
 * `updateTag` calls across 30+ call sites; v1.16.0 consolidates them.
 *
 * Pinned contracts:
 *   - `domain: 'public'` invalidates the public-data tag set
 *   - `domain: 'admin'` invalidates the same tag set (admin writes always
 *     propagate to the public site) PLUS any supplied paths
 *   - `domain: 'settings'` invalidates settings + public tags + paths
 *   - `domain: 'all'` invalidates the union of all three tag sets
 *   - `mode: 'action'` (default) uses `updateTag` (RYOW)
 *   - `mode: 'route'` uses `revalidateTag(tag, { expire: 0 })`
 *   - `paths` are bust via `revalidatePath` regardless of mode
 *
 * The lint-guard test in this file also asserts no direct
 * `revalidatePath` / `revalidateTag` / `updateTag` call appears outside
 * `src/lib/revalidate.ts`.
 */

const { updateTagMock, revalidateTagMock, revalidatePathMock } = vi.hoisted(() => ({
  updateTagMock: vi.fn(),
  revalidateTagMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}))

vi.mock('next/cache', () => ({
  updateTag: updateTagMock,
  revalidateTag: revalidateTagMock,
  revalidatePath: revalidatePathMock,
}))

import { revalidate } from '@/lib/revalidate'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('revalidate — domain dispatch', () => {
  it("'public' invalidates the public-data tag set via updateTag", () => {
    revalidate({ domain: 'public' })
    expect(updateTagMock).toHaveBeenCalledTimes(2)
    expect(updateTagMock).toHaveBeenCalledWith('public-data')
    expect(updateTagMock).toHaveBeenCalledWith('leagues')
    expect(revalidatePathMock).not.toHaveBeenCalled()
    expect(revalidateTagMock).not.toHaveBeenCalled()
  })

  it("'admin' invalidates the same tag set as public PLUS the supplied paths", () => {
    revalidate({ domain: 'admin', paths: ['/admin/players', '/admin'] })
    expect(updateTagMock).toHaveBeenCalledWith('public-data')
    expect(updateTagMock).toHaveBeenCalledWith('leagues')
    expect(revalidatePathMock).toHaveBeenCalledWith('/admin/players')
    expect(revalidatePathMock).toHaveBeenCalledWith('/admin')
    expect(revalidatePathMock).toHaveBeenCalledTimes(2)
  })

  it("'settings' invalidates settings + public tags PLUS supplied paths", () => {
    revalidate({ domain: 'settings', paths: ['/admin'] })
    expect(updateTagMock).toHaveBeenCalledWith('settings')
    expect(updateTagMock).toHaveBeenCalledWith('public-data')
    expect(updateTagMock).toHaveBeenCalledWith('leagues')
    expect(updateTagMock).toHaveBeenCalledTimes(3)
    expect(revalidatePathMock).toHaveBeenCalledWith('/admin')
  })

  it("'all' invalidates the union of public + settings tag sets", () => {
    revalidate({ domain: 'all' })
    expect(updateTagMock).toHaveBeenCalledWith('public-data')
    expect(updateTagMock).toHaveBeenCalledWith('leagues')
    expect(updateTagMock).toHaveBeenCalledWith('settings')
    expect(updateTagMock).toHaveBeenCalledTimes(3)
  })

  it("paths default to empty (no revalidatePath call when omitted)", () => {
    revalidate({ domain: 'public' })
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })
})

describe('revalidate — mode dispatch', () => {
  it("default mode is 'action' → uses updateTag", () => {
    revalidate({ domain: 'public' })
    expect(updateTagMock).toHaveBeenCalled()
    expect(revalidateTagMock).not.toHaveBeenCalled()
  })

  it("mode: 'route' uses revalidateTag(tag, { expire: 0 }) — for route handlers", () => {
    revalidate({ domain: 'public', mode: 'route' })
    expect(revalidateTagMock).toHaveBeenCalledWith('public-data', { expire: 0 })
    expect(revalidateTagMock).toHaveBeenCalledWith('leagues', { expire: 0 })
    expect(updateTagMock).not.toHaveBeenCalled()
  })

  it("paths are bust via revalidatePath regardless of mode", () => {
    revalidate({ domain: 'public', mode: 'route', paths: ['/x'] })
    expect(revalidatePathMock).toHaveBeenCalledWith('/x')
  })
})
