import { updateTag, revalidateTag, revalidatePath } from 'next/cache'

/**
 * Canonical revalidation entry point. ALL cache invalidation across server
 * actions and route handlers goes through this function — direct
 * `revalidateTag` / `revalidatePath` / `updateTag` calls outside this file
 * are forbidden (per the CLAUDE.md autonomy block; v1.16.0).
 *
 * Why one entry point:
 *   The pre-v1.16.0 code spread cache-invalidation primitives across 30+ call
 *   sites in `app/admin/actions.ts`, `app/admin/leagues/actions.ts`, and
 *   `app/api/assign-player/route.ts`. Each site reasoned about its own combo
 *   of tags and paths — `revalidatePublicData()` + `revalidatePath('/admin/x')`,
 *   or `_updateTag('settings')` + `revalidatePublicData()` + `revalidatePath('/admin')`,
 *   etc. Inconsistencies across sites (forgotten cache busts, doubled busts,
 *   wrong tag set) only surfaced at the user-visible layer. v1.16.0
 *   centralizes the policy: each domain has a fixed tag set, callers supply
 *   per-action paths, callers pick the mode.
 *
 * Domain semantics (the tag set per domain):
 *   - `public`   — `public-data` + `leagues`. The default-league reads.
 *   - `admin`    — same tags as `public`. Admin writes also invalidate the
 *                  public site because admin pages drive league data the
 *                  public dashboard reads. Use `paths` to add the specific
 *                  admin route(s) the action just mutated (e.g.
 *                  `/admin/leagues/${id}/schedule`).
 *   - `settings` — `settings` + the public/admin tag set. The `dataSource`
 *                  + `writeMode` flips propagate to both the settings cache
 *                  AND the public cache (the public read switches sources
 *                  on the next render).
 *   - `all`      — `public-data` + `leagues` + `settings`. For nuclear
 *                  options (rare).
 *
 * Mode semantics (`updateTag` vs `revalidateTag`):
 *   - `action` (default) — uses `updateTag(tag)` which provides
 *     read-your-own-writes semantics for the same request; only valid
 *     inside server actions in Next 16. Almost every caller in this
 *     codebase wants this mode.
 *   - `route`            — uses `revalidateTag(tag, { expire: 0 })` which
 *     is callable from route handlers (no RYOW guarantee but that's the
 *     route-handler-side reality). Use this from `app/api/.../route.ts`.
 *
 * `paths` are bust via `revalidatePath` (callable from both action + route
 * contexts in Next 16). Pass an empty list (or omit) when the call site
 * just needs the tag set.
 */

export type RevalidateDomain = 'public' | 'admin' | 'settings' | 'all'
export type RevalidateMode = 'action' | 'route'

const DOMAIN_TAGS: Record<RevalidateDomain, readonly string[]> = {
  public: ['public-data', 'leagues'],
  admin: ['public-data', 'leagues'],
  settings: ['settings', 'public-data', 'leagues'],
  all: ['public-data', 'leagues', 'settings'],
}

interface RevalidateInput {
  domain: RevalidateDomain
  paths?: readonly string[]
  mode?: RevalidateMode
}

export function revalidate({
  domain,
  paths = [],
  mode = 'action',
}: RevalidateInput): void {
  const tags = DOMAIN_TAGS[domain]
  for (const tag of tags) {
    if (mode === 'action') {
      updateTag(tag)
    } else {
      revalidateTag(tag, { expire: 0 })
    }
  }
  for (const p of paths) {
    revalidatePath(p)
  }
}
