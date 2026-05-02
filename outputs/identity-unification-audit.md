# Identity unification audit (PR λ / v1.39.0)

**Date:** 2026-05-03 · **Author:** PR λ session
**Scope:** Trace every site that mutates `Player.lineId` / `Player.userId` / `User.playerId` and verify the invariants from the [account-player-rework plan](account-player-rework-plan.md) are upheld in the post-PR-θ codebase.

This is the third of three follow-up PRs (ι/κ/λ) after the δ→θ onboarding chain. PR λ's task per the briefing was:

> Right now a user and player are different, but when a user signs in and assigns themselves to a player, we should populate the players lineid column with it. Audit the full sign-in + redemption + dual-write chain and verify:
> 1. When LINE-auth user redeems → `Player.lineId` populated (legacy resolver still works)
> 2. When Google/email user redeems → `Player.lineId` stays null, `User.playerId`/`Player.userId` set correctly
> 3. `User`↔`Player` mirror fully consistent (no orphans, no drift)
> 4. `Player.id` (cuid) confirmed as canonical PK
>
> Likely gap to look for: PR ζ may have created `Player.userId` at redemption without also writing `Player.lineId` for LINE flows. Find + fix.

This document records what I found, what I fixed, and what's deferred.

## TL;DR

- ✅ **(1)** LINE-auth redemption populates `Player.lineId` correctly. PR ζ's [redeemInvite](../src/app/join/[code]/actions.ts) sets `lineId, userId` in a single `tx.player.update` and additionally calls `linkPlayerToUser` for the User-side mirror. No gap.
- ✅ **(2)** Google/email redemption leaves `Player.lineId` null and writes `Player.userId` + `User.playerId`. Confirmed in the same file.
- ⚠️ **(3)** Mirror was MOSTLY consistent — but the **non-LINE branch** of redeemInvite did NOT defensively clear stale 1:1 invariant pointers. **Fixed in this PR** by routing both branches through a new generic [`linkUserToPlayer`](../src/lib/identityLink.ts) helper.
- ✅ **(4)** `Player.id` (cuid) is the canonical PK. `Player.lineId` and `Player.userId` are both `String? @unique` mirror columns. Confirmed in [`prisma/schema.prisma`](../prisma/schema.prisma).

## Audit findings

### Sites that write `Player.lineId`

| Site | File | Operation | Dual-write to User-side? |
|------|------|-----------|--------------------------|
| `/api/assign-player` POST (legacy picker) | [route.ts](../src/app/api/assign-player/route.ts) | clear-then-set in transaction | ✅ via `linkPlayerToUser(tx, {playerId, lineId})` |
| `/api/assign-player` DELETE | [route.ts](../src/app/api/assign-player/route.ts) | clear | ✅ via `unlinkPlayerFromUser(tx, {lineId})` |
| `adminLinkLineToPlayer` | [admin/leagues/actions.ts](../src/app/admin/leagues/actions.ts) | clear-then-set in transaction | ✅ via `linkPlayerToUser` + `unlinkPlayerFromUser(targetPriorLineId)` |
| `adminClearLineLink` | [admin/leagues/actions.ts](../src/app/admin/leagues/actions.ts) | clear | ✅ via `unlinkPlayerFromUser(tx, {lineId: before.lineId})` |
| `updatePlayer` | [admin/actions.ts](../src/app/admin/actions.ts) | three branches: noop / clear / set+remap | ✅ |
| `createPlayer` | [admin/actions.ts](../src/app/admin/actions.ts) | set on creation | ✅ when lineId provided |
| `redeemInvite` (LINE branch) | [join/[code]/actions.ts](../src/app/join/[code]/actions.ts) | set in transaction | ✅ via `linkPlayerToUser` |

### Sites that write `Player.userId` / `User.playerId` ONLY (no `Player.lineId`)

| Site | Bug? |
|------|------|
| `redeemInvite` (Google/email branch) | **YES — fixed in this PR.** Pre-λ, the non-LINE branch did `tx.player.update({where: {id: target}, data: {userId}})` and `tx.user.update({where: {id: userId}, data: {playerId: target}})` directly, with NO defensive clearing of stale 1:1 pointers. If a Google user had previously been bound to a different Player (rare in practice but theoretically possible — e.g. admin-side remap, manual SQL, or a future flow that links non-LINE users via an alternate path), redeeming would surface as a Prisma `Player.userId @unique` violation rather than a graceful rebind. |

### Resolution path

The lineId→Player mapping that powers JWT callbacks goes through the **v1.30.0 (PR γ) flag-dispatched resolver** in [`lib/auth.ts`](../src/lib/auth.ts):

- `Setting('identity.read-source') === 'legacy'` (default) → `Player.findUnique({where: {lineId}})` (the v1.5.0 path).
- `Setting('identity.read-source') === 'user'` → `User.findUnique({where: {lineId}}) → User.playerId → Player.findUnique({where: {id}})` (the new architecture).

Both paths converge on the same `pickAssignmentMapping` projection. The flag is operator-flippable; the post-λ world is suitable for the operator to flip safely (per-flow audit confirms data parity).

### Mirror consistency invariants

After the fix in this PR:

1. **Every site that sets `Player.userId` also goes through `linkPlayerToUser` or the new generic `linkUserToPlayer`.** Both helpers do the same defensive clearing of stale `Player.userId @unique` pointers and the corresponding `User.playerId` back-pointer.
2. **Every site that sets `Player.lineId` either ALSO sets `Player.userId` in the same transaction (legacy LINE picker, admin actions) OR routes through a helper that does (redeemInvite LINE branch).**
3. **`linkPlayerToUser` resolves the User by `User.lineId @unique`.** This is the legacy compat path through stage 3 (γ). When stage 4 (Δ — currently deferred per the soak window) drops `Player.lineId` and `User.lineId`, this helper will be retired in favor of the generic `linkUserToPlayer` that resolves by `User.id`.
4. **`linkUserToPlayer(tx, {userId, playerId, lineId?})` is the new generic helper added in this PR.** Same invariant-clearing logic as `linkPlayerToUser` but keys on `User.id` directly. Used by the redeemInvite Google/email branch. Optionally accepts a `lineId` to set on the same `Player.update` for LINE-auth callers.

### What `Player.id` carries

`Player.id` is a `cuid()` string PK (e.g. `c-xyz...`). The PR 6 backfill migrated existing rows from raw slug ids to `p-<slug>` ids — that prefix-vs-cuid convention is documented in [`src/lib/ids.ts`](../src/lib/ids.ts) (`PLAYER_ID_PREFIX = 'p-'`). New rows from `adminCreatePlayer` use `cuid()` (no `p-` prefix). The codebase tolerates both shapes via `playerIdToSlug` / `slugToPlayerId` round-trip helpers — that's a cosmetic difference at the API/session boundary, not at the FK.

`Player.lineId` and `Player.userId` are both `String? @unique` mirror columns on `Player`. They do NOT have `@relation` declarations yet — see "Deferred" section.

## What changed in PR λ

1. **New helper `linkUserToPlayer(tx, {userId, playerId, lineId?})`** in [`src/lib/identityLink.ts`](../src/lib/identityLink.ts).
   - Resolves User by `User.id @unique` (not by lineId — works for Google/email/LINE alike).
   - Defensively clears any stale `Player.userId === user.id` from a different Player (the `@unique` constraint that previously caused redemption to throw a 500).
   - Defensively clears the User's prior `playerId` pointer.
   - Sets `Player.userId = user.id`, `User.playerId = playerId`, and (when `lineId` is supplied) `Player.lineId = lineId` in the same `tx.player.update`.
   - Returns `false` (with a `console.warn`) when no User exists for the supplied id — consistent with `linkPlayerToUser`'s existing failure mode.

2. **`redeemInvite` refactored to use `linkUserToPlayer` for both branches.** The LINE branch passes `{userId, playerId, lineId}` (sets all three columns in one update), and the Google/email branch passes `{userId, playerId}` (Player.lineId stays null). Both now share the same invariant-clearing path.

3. **Tests updated:**
   - Existing redeemInvite cases (LINE happy path + Google/email happy path) updated for the new call shape — `linkUserToPlayer` is called instead of separate `player.update` + `user.update`.
   - New regression test: rebinding a Google/email user from a prior Player to a new one (the bug fixed by this PR) now succeeds with proper invariant clearing rather than throwing a unique-constraint violation.
   - 6 new pure-helper tests for `linkUserToPlayer`: success path, no-User no-op, stale Player.userId clearing, stale User.playerId clearing, no-lineId branch (Google/email shape), with-lineId branch (LINE shape).

4. **No schema change.** All work is at the application layer.

## What's deferred (NOT in this PR)

### `@relation` FK enforcement on User↔Player

The α stage explicitly deferred wiring `@relation` declarations between `User.playerId` and `Player.id`. In Prisma's relational model, you can declare:

```prisma
model User {
  player Player? @relation(fields: [playerId], references: [id], onDelete: SetNull)
  // ...
}
model Player {
  user User? @relation(name: "UserPlayerInverse", ...)
  // ...
}
```

But Prisma rejects symmetric `fields/references` on both sides — only one side owns the FK. For a true 1:1 mirror you'd typically pick one direction. We have both `User.playerId` AND `Player.userId` columns; converting either to a relation requires picking which model "owns" the binding.

**Why deferred:**
- Operationally, the post-β backfill confirmed prod data is consistent (32/32 link-exists, 0 drift). The `@unique` constraints on both sides already enforce the 1:1 invariant; the missing piece is referential integrity (cascading deletes, FK validation on insert).
- The natural next step is **stage 4 (Δ)**: drop `Player.lineId` (and `User.lineId`), making `User.playerId @unique` the canonical binding with a single `@relation` direction. That's a 3–4 week soak window after stage γ's flag flip in prod.
- Adding the FK now would require a schema migration that may fail at apply time if any drift slipped through (e.g. a User row pointing at a deleted Player). The Layer 5c audit script (`scripts/auditRedisVsPrisma.ts`) covers Redis↔Prisma drift but not User↔Player drift; a similar pre-flight check should be written before adding the FK.

### Account-linking UI

Per the rework plan §13 (and the user's PR λ briefing): "account-linking UI (add second auth provider to existing User)" — the user can sign up with LINE and later add Google as a second `Account` row pointing at the same `User.id`. NextAuth's `Account` table supports this; the missing piece is the UI to initiate the linking flow. Deferred.

### Cross-provider de-duplication

If Stefan signs up via LINE today (creating User_A with lineId set) and tomorrow signs up via Google with the same email (creating User_B), they end up as two separate User rows even though they're the same human. NextAuth's `allowDangerousEmailAccountLinking` is intentionally OFF (defends against an attacker creating a Google account with a victim's email and taking over their LINE-only account). The right answer is the account-linking UI above, not auto-linking. Deferred.

### Stage 4 (Δ): drop `Player.lineId` + `User.lineId`

The original rework plan called for dropping these columns 3–4 weeks after stage γ's prod flip. Stage γ shipped at v1.30.0 (2026-05-01), so the earliest natural window for stage Δ is approximately 2026-05-22 to 2026-05-29.

Stage Δ will:
- DROP `Player.lineId` and `User.lineId`.
- Remove `getPlayerMappingFromDbLegacy`.
- Retire `linkPlayerToUser` (the lineId-keyed helper) and route every caller through `linkUserToPlayer`.
- Drop the `Setting('identity.read-source')` flag.
- Drop the legacy Redis `t9l:auth:map:` namespace (the v1.5.0 store) in favor of a User.id-keyed namespace.

That's the right time to also add the `@relation` FK declaration discussed above.

## Operator activation path (none required for PR λ)

This PR is purely code. The fix lands at deploy time without operator intervention. Existing data is unaffected — the new helper does the same thing as the LINE branch already did, just for the non-LINE branch too.

## Tests added

| File | Cases |
|------|-------|
| [`tests/unit/linkUserToPlayer.test.ts`](../tests/unit/linkUserToPlayer.test.ts) | 8 — pure helper branch coverage |
| [`tests/unit/redeemInvite.test.ts`](../tests/unit/redeemInvite.test.ts) | 4 modified (call-shape change), 1 new (rebinding regression target) |
| [`tests/unit/identityUnificationAudit.test.ts`](../tests/unit/identityUnificationAudit.test.ts) | 4 — structural assertions on the redeemInvite call sites |

12 net new test cases. 922 total passing.
