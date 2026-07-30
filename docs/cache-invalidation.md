# Cache invalidation (revalidate canonical, v1.16.0)

Cache invalidation goes through [`src/lib/revalidate.ts#revalidate({ domain })`](../src/lib/revalidate.ts). Direct `revalidateTag` / `revalidatePath` / `updateTag` calls outside that file are forbidden.

## The lint guard

The CI lint guard at [`tests/unit/revalidatePrimitivesGuard.test.ts`](../tests/unit/revalidatePrimitivesGuard.test.ts) fails if any new primitive call leaks. If a new file legitimately needs a primitive (e.g. a new domain), update the guard's allowlist in the same PR and explain why in the PR description.

## Domains and modes

```ts
revalidate({ domain: 'public' | 'admin' | 'settings' | 'all', mode?, paths? })
```

- **Domains** — define which tag-set gets busted. `'public'` busts the public-data + leagues tags; `'admin'` busts admin-cached queries; `'settings'` busts the Setting table reads; `'all'` busts everything (use sparingly).
- **`mode: 'action'`** (default) — uses `updateTag` for read-your-own-writes inside server actions. The next read inside the same render cycle sees the new value.
- **`mode: 'route'`** — uses `revalidateTag(tag, { expire: 0 })` for route handlers (POST/DELETE handlers in `app/api/...`). The expiry mode is needed because route handlers run outside the React rendering loop where `updateTag` is meaningful.
- **`paths: ['/admin/leagues/X/players']`** — adds per-action `revalidatePath` busts for specific URL paths.

See the helper's docstring for the full domain → tag-set table.

## When NOT to bust

**Writes to Redis-canonical state should NOT invalidate the static `public-data` cache** (v1.8.2). State that lives in Redis (player mapping, RSVP) is its own read path; bursting `public-data` just forces a needless re-derivation of the static blob (~580ms warm). The bust shape is reserved for writes that mutate the static fields themselves (admin actions on Team / Player / Match / Goal / Venue, picture-mirror Blob URL updates).

**Audit before adding a `revalidate({ domain: 'public' })` to any new write site.** If the field being written is reachable from `dbToPublicLeagueData` / the `getFromDb` Prisma include, the bust is correct. If not, drop it.

## TTL floor: every public-path TTL must exceed the Neon autosuspend window (v2.4.0)

The Neon production branch suspends compute after a fixed window of inactivity — **300 s** on the current plan (the endpoint reports `suspend_timeout_seconds: 0`, meaning "use the plan default"; a v2.4.0 attempt to lower it to 60 s was rejected with `HTTP 412 modifying the suspend interval is not permitted on this account`, so it needs a paid plan to change).

**An `unstable_cache` TTL at or below that window silently defeats the cache.** Each expiry triggers a stale-refresh read, which wakes compute; if refreshes arrive more often than the suspend window, the branch never suspends and the cache costs money instead of saving it. Pre-v2.4.0 several public-path readers sat at 30 s or 60 s — refreshing five to ten times per window — which is what kept the branch awake ~11 h/day.

Rules for any reader on a public (anonymous-reachable) path:

- **TTL ≥ 900 s.** That is the v2.4.0 standard for the whole public-read set: `publicData`, `leagueFlags`, `leagueDetailsServer`, `leagueSelfLink`, `leagueSlugServer`, `leagueDirectoryData`, `plannedRosterStats`. Comfortably above 300 s, and still valid if the window is ever lowered.
- **The TTL is not the freshness mechanism** — `revalidate({ domain })` is. Admin writes bust these tags immediately, so a long timer costs nothing in user-visible staleness. Reach for a shorter TTL only if you can name a mutation path that does *not* go through `revalidate()`.
- **Admin-only readers are exempt** (`admin-data.ts`, `settings.ts`, both 30 s). Auth-gated and low-volume, so they contribute little awake time, and `settings.ts` holds migration read-flip flags where a stale read has real consequences.

If you lower a public-path TTL, check the current Neon suspend window first. `tests/unit/perfPhase1.test.ts` pins the `publicData` value and carries this note.

## Never cache a failure: the catch goes OUTSIDE `unstable_cache` (v2.4.0)

`unstable_cache` persists **resolved** values. A reader that catches its own Prisma error and returns a default therefore *stores that default* — the failure becomes a cache entry with a full TTL of life. At 30 s that was survivable; at 900 s a single transient Neon blip would have pinned the homepage to `visibility: 'PUBLIC_CLOSED'` with no league identity for 15 minutes, blanked the league directory and sitemap, or hidden the details and roster panels.

**The pattern:** an inner reader that lets rejections propagate, wrapped by `unstable_cache`, wrapped by a thin exported function holding the try/catch.

```ts
// Inner reader — deliberately does NOT catch, so a rejection escapes the
// cache wrapper and nothing is stored. The next request retries.
async function readThing(id: string): Promise<Thing | null> {
  const row = await prisma.thing.findUnique({ where: { id } })
  return row ?? null            // ← a genuinely missing row IS cacheable
}

const getThingCached = unstable_cache(readThing, ['thing'], {
  revalidate: 900,
  tags: ['leagues'],
})

// Exported wrapper owns the never-throws contract.
export async function getThing(id: string): Promise<Thing | null> {
  try {
    return await getThingCached(id)
  } catch (err) {
    console.warn('[thing] read failed:', err)
    return null
  }
}
```

Note the distinction that makes this safe: a `null` (or `[]`, or a defaults object) derived from a **genuinely missing row** is a correct result and *should* cache. Only *failures* must escape.

Readers following this shape: `leagueFlags`, `leagueDetailsServer`, `leagueSelfLink`, `leagueDirectoryData`, `plannedRosterStats`. `leagueSlugServer` never caught, so it needs no wrapper. The relevant unit suites pin the catch to the wrapper specifically, so moving it back inside the cache body fails CI.
