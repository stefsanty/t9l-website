/**
 * v1.29.0 (stage β) — User ↔ Player 1:1 link populator.
 *
 * Stage 2 of the account-player-rework. See
 * `outputs/account-player-rework-plan.md` §3 "Stage 2 (β)" for the plan.
 *
 * v1.27.0 added the additive columns `User.playerId` + `Player.userId`
 * (both nullable @unique). v1.28.0 (α.5) added the `Account` table and
 * the multi-provider auth foundation. This module is the dual-write
 * helper that populates the new columns from every site that mutates
 * `Player.lineId`. Reads continue to go through `Player.lineId` until
 * stage γ flips the resolver.
 *
 * Idempotency: every helper is safe to call multiple times with the same
 * arguments. Concurrent callers race-safely via Prisma's @unique
 * constraints (a parallel link of two different players to the same User
 * surfaces as a unique-constraint violation, not silent corruption).
 *
 * Resolution: identity is keyed on `User.lineId` (legacy compat through
 * stage 3) — the post-α.5 syncUserLineId bridge in `lib/auth.ts` ensures
 * `User.lineId` is populated for every authenticated LINE user. Stage 4
 * removes this column and the helper resolves via Account directly.
 *
 * Failure mode: when no User exists for a given lineId (the user hasn't
 * authenticated post-α.5 yet), the helper logs a warning and returns —
 * the dual-write is a no-op for that call. Reads are unaffected (still
 * via Player.lineId). The next sign-in will create the User+Account, and
 * the next admin/self-serve link will populate the new columns.
 */

import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * Bind a Player to a User (1:1) via the lineId. Sets both
 * `Player.userId = user.id` AND `User.playerId = player.id` atomically
 * within the caller's transaction. Maintains the 1:1 invariant by
 * clearing any other Player that was previously pointing at this User
 * and any prior Player the User was pointing at.
 *
 * Returns `true` if the dual-write fired, `false` if the User couldn't
 * be resolved (no-op case). The caller can ignore the return value
 * unless it cares about whether the new columns were populated.
 */
export async function linkPlayerToUser(
  tx: Tx,
  args: { playerId: string; lineId: string },
): Promise<boolean> {
  const user = await tx.user.findUnique({
    where: { lineId: args.lineId },
    select: { id: true, playerId: true },
  });
  if (!user) {
    console.warn(
      "[identityLink] linkPlayerToUser: no User for lineId=%s — skipping dual-write (user hasn't authenticated post-α.5 yet)",
      args.lineId,
    );
    return false;
  }

  // Clear any other Player that thinks it's bound to this User. The 1:1
  // invariant is enforced by Player.userId @unique; without this clear
  // we'd hit a unique-constraint violation when the User was previously
  // bound to a different Player.
  if (user.playerId && user.playerId !== args.playerId) {
    await tx.player.updateMany({
      where: { id: user.playerId, userId: user.id },
      data: { userId: null },
    });
  }

  // Defensive: clear any stale Player.userId pointing at this User from
  // a different angle (e.g. data drift, manual SQL edit). updateMany
  // handles "row already excluded" silently.
  await tx.player.updateMany({
    where: { userId: user.id, id: { not: args.playerId } },
    data: { userId: null },
  });

  // Forward pointer: Player.userId.
  await tx.player.update({
    where: { id: args.playerId },
    data: { userId: user.id },
  });

  // Back pointer: User.playerId. The User may have been unbound (null) or
  // bound to a different Player above; either way this update is correct.
  await tx.user.update({
    where: { id: user.id },
    data: { playerId: args.playerId },
  });

  return true;
}

/**
 * v1.39.0 (PR λ) — generic User↔Player binder keyed on `User.id`.
 *
 * Sibling of `linkPlayerToUser` for the case where the caller has the
 * `User.id` directly (e.g. `/join/[code]` redemption — the session
 * already carries `userId`, no need for the lineId round-trip).
 * Critically, this helper supports the **non-LINE** flows (Google /
 * email magic-link) for which `linkPlayerToUser` returns false (no
 * `User.lineId` set on those Users).
 *
 * Same invariant-clearing logic as `linkPlayerToUser`:
 *   - Clears `Player.userId` on any other Player previously bound to
 *     this User (defends against the `Player.userId @unique` race).
 *   - Clears `User.playerId` if it was previously set to a different
 *     Player.
 *
 * Optional `lineId` argument lets the LINE redemption branch ALSO set
 * `Player.lineId` in the same `tx.player.update` call, replacing the
 * pre-λ pattern of issuing two separate updates (one for `lineId, userId`
 * and one inside `linkPlayerToUser` for the User-side mirror). Pass
 * `undefined` (or omit) for non-LINE flows so `Player.lineId` is left
 * untouched.
 *
 * Returns `true` on success; `false` if the User couldn't be resolved
 * (consistent with `linkPlayerToUser`'s failure mode — the caller can
 * choose to ignore the return value).
 *
 * Stage 4 (Δ): when `Player.lineId` is dropped, the optional `lineId`
 * argument goes too, leaving this helper as the sole linker.
 */
export async function linkUserToPlayer(
  tx: Tx,
  args: { userId: string; playerId: string; lineId?: string | null },
): Promise<boolean> {
  const user = await tx.user.findUnique({
    where: { id: args.userId },
    select: { id: true, playerId: true },
  });
  if (!user) {
    console.warn(
      "[identityLink] linkUserToPlayer: no User for userId=%s — skipping bind",
      args.userId,
    );
    return false;
  }

  // Clear the User's prior playerId pointer if it was bound to a
  // different Player. The User.playerId @unique constraint allows null
  // duplicates so two cleared Users can coexist.
  if (user.playerId && user.playerId !== args.playerId) {
    await tx.player.updateMany({
      where: { id: user.playerId, userId: user.id },
      data: { userId: null },
    });
  }

  // Defensive: clear any stale Player.userId pointing at this User from
  // a different angle (e.g. data drift, manual SQL edit, or a parallel
  // binder racing the same User.id). updateMany handles "row already
  // excluded" silently.
  await tx.player.updateMany({
    where: { userId: user.id, id: { not: args.playerId } },
    data: { userId: null },
  });

  // Forward pointer + (optional) Player.lineId in the same write.
  // For non-LINE flows (Google / email), `lineId` is undefined so the
  // spread is a no-op and Player.lineId is left at whatever value it
  // already had (typically null for a fresh non-LINE redemption).
  await tx.player.update({
    where: { id: args.playerId },
    data: {
      userId: user.id,
      ...(args.lineId !== undefined ? { lineId: args.lineId } : {}),
    },
  });

  // Back pointer: User.playerId.
  await tx.user.update({
    where: { id: user.id },
    data: { playerId: args.playerId },
  });

  return true;
}

/**
 * Inverse of linkPlayerToUser. Clears `User.playerId` AND `Player.userId`
 * for the User identified by lineId. No-op if the User doesn't exist or
 * has no current playerId.
 */
export async function unlinkPlayerFromUser(
  tx: Tx,
  args: { lineId: string },
): Promise<boolean> {
  const user = await tx.user.findUnique({
    where: { lineId: args.lineId },
    select: { id: true, playerId: true },
  });
  if (!user) return false;

  if (user.playerId) {
    await tx.player.updateMany({
      where: { id: user.playerId, userId: user.id },
      data: { userId: null },
    });
  }

  await tx.user.update({
    where: { id: user.id },
    data: { playerId: null },
  });

  return true;
}
