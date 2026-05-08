# Redis-canonical state

Two stores in this codebase use Redis as the canonical read source with Prisma as the durable secondary. Player mapping (v1.5.0) was the first; RSVP per-GameWeek (v1.7.0) is the second. **Read this before adding a third.**

## The 11 principles

1. **Redis is canonical for the read path.** The hot read goes Redis-direct. No `unstable_cache` wrapper on top of Redis — that would just be a second layer of staleness on top of an already-fast store.
2. **Prisma is the durable backup.** Same data is persisted to Postgres in the same write — failure of either propagates as an error to the user; partial-write states do not survive. Prisma exists for two reasons: (a) the recovery script reads from it to rebuild Redis on data loss, (b) admin queries that join across many domains (e.g. "show all linked players + their last login") use Prisma where Redis would be a poor index shape.
3. **Tri-state read result.** `{ status: 'hit' | 'miss' | 'error' }` discriminated union. The caller applies different policies per branch. Pre-v1.5.0 code collapsed miss/error into a single nullish return and made the policies indistinguishable; never repeat that.
4. **Miss policy is per-domain.** Player mapping: miss returns `null` (orphan; no Prisma fallback in the happy path). RSVP: miss falls through to Prisma + writes back to Redis (cold-cache fill). The choice depends on whether "missing in Redis" is a normal steady state.
5. **Error policy is universal-defensive.** Any `error` (Upstash unreachable / unconfigured / hgetall threw) falls through to Prisma so a transient outage doesn't break authenticated sessions or null out the dashboard. **Error reads do NOT trigger a write-back** — don't amplify a half-broken connection into a write storm.
6. **TTL is per-domain.** Player mapping: sliding 24h (every read fires a fire-and-forget `expire`). RSVP: absolute, anchored at `max(matchday, now()) + 90 days` — RSVP data has a natural lifetime tied to a real-world event.
7. **Per-write Redis pre-warm.** Every write site that mutates the canonical state does Prisma-first-then-Redis (or Redis-first-then-Prisma; see principle 10) in the same try block. Forgetting the Redis write would leave the store stale until the natural TTL pulls the entry back to a fresh fall-through.
8. **One backfill script per store.** `scripts/backfillRedis<X>FromPrisma.ts`, `--dry-run` / `--apply` modes, idempotent, per-row CREATE/MATCH/DRIFT-OVERWRITE decisions, pure `decideBackfillAction` exported for unit testing. Run dry-run against prod BEFORE merging the no-fallback code.
9. **Tests pin the policy seam.** Each store ships with a Vitest suite that exercises hit/miss/error branches independently, namespace isolation, and the `RedisLike` injection seam. The test seam is `__setRedisClientForTesting(client | null)` — production code never calls it.
10. **Public-write hot paths invert: Redis sync, Prisma deferred via `waitUntil`** (v1.8.0). `/api/assign-player` and `/api/rsvp` write Redis on the response critical path and defer the durable Prisma write to background via `waitUntil` from `@vercel/functions`. **Admin write sites stay Prisma-first** because admin pages re-read Prisma directly on `revalidatePath('/admin/...')`. **Throwing variants required.** Public hot paths use `setMappingOrThrow` / `setRsvpOrThrow`; the silent variants would 200-OK with no durable write landing on Redis failure (since Prisma is now deferred). **Drift on background-Prisma failure** emits inline `console.error('[v1.8.0 DRIFT] kind=<domain> ...')` log lines for operator grep; the audit script (`auditRedisVsPrisma.ts`) covers write-side drift recovery (Layer 5c).
    - **Exception (v1.61.0):** non-LINE sessions write Prisma synchronously, not deferred — they have no Redis-canonical store, and the JWT callback resolves `playerId` via Prisma. Deferring would race the `update()` refresh.
11. **Writes to Redis-canonical state should NOT invalidate the static `public-data` cache** (v1.8.2). State that lives in Redis (player mapping, RSVP) is its own read path — `getMapping` / `getRsvpForGameWeeks` are called at session-aware boundaries, NOT through `unstable_cache`. The static `public-data:db` cache holds team / player / matchday / match / goal data — none of which depend on Redis state. Calling `revalidatePath('/')` + `revalidateTag('public-data')` on a Redis-canonical write forces a needless full re-derivation (~580ms warm and multi-second cold). Reserve that bust for writes that mutate the static fields themselves.

## Stores under this pattern

| Store | File | Namespace | TTL | Backfill script |
|-------|------|-----------|-----|-----------------|
| Player mapping (lineId → Player) | [`src/lib/playerMappingStore.ts`](../src/lib/playerMappingStore.ts) | `t9l:auth:map:` | 24h sliding | [`scripts/backfillRedisFromPrisma.ts`](../scripts/backfillRedisFromPrisma.ts) |
| RSVP per GameWeek | [`src/lib/rsvpStore.ts`](../src/lib/rsvpStore.ts) | `t9l:rsvp:gw:` | matchday + 90d (absolute) | [`scripts/backfillRedisRsvpFromPrisma.ts`](../scripts/backfillRedisRsvpFromPrisma.ts) |

## Stores explicitly NOT under this pattern (considered, decided against)

- **Goals / scores** — admin-write-only, not on the public read hot path. The `unstable_cache(getFromDb, 30s)` is fine.
- **Profile pics (Vercel Blob URLs)** — already cached in Redis as a value, populated as a side-effect of `/api/assign-player`. Lookup is by player slug and never falls through; no need for tri-state.
- **Settings** — admin-flip cadence is once-a-week or rarer; `unstable_cache(..., 30s)` suffices.
- **LineLogin** — write-only from JWT callback for admin Flow B; never read on the public hot path.

## When to add a third

If the read frequency is **public dashboard render** (every page view, every authenticated user) AND the data has natural cardinality bounded per league/event/user (not unbounded relations), the Redis-canonical pattern fits. Otherwise the `unstable_cache` shape is simpler and adequate.

## Recovery

Three rollback layers are dedicated to Redis-canonical state — see [release-and-ship.md](release-and-ship.md):

- **Layer 5** — read-side rebuild for player mapping (Redis lost, Prisma fresh)
- **Layer 5b** — read-side rebuild for RSVP per-GameWeek (same shape)
- **Layer 5c** — write-side audit (Redis canonical, Prisma drifted; `auditRedisVsPrisma.ts --repair-prisma`)
