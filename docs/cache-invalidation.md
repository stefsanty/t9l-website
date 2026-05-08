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
