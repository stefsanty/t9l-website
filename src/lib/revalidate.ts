import { updateTag } from 'next/cache'

/**
 * Bust both the public-data cache (used by `getPublicLeagueData()`) and the
 * legacy admin-data cache. Call from every admin server action that mutates
 * a relevant table so the apex public site reflects writes immediately.
 *
 * Uses `updateTag` (Next 16, server-action-only) for read-your-own-writes
 * semantics. This must therefore only be called from server actions —
 * route handlers (e.g. `api/rsvp`) should use `revalidateTag(tag, { expire: 0 })`
 * or `revalidatePath` instead.
 *
 * Wired into all admin server actions in PR 3.
 */
export function revalidatePublicData(): void {
  updateTag('public-data')
  updateTag('leagues')
}
